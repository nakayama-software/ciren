#pragma once
#include <Arduino.h>
#include <esp_task_wdt.h>
#include "ciren_config.h"
#include "ring_buffer.h"
#include "system_state.h"
#include "task_publish.h"
#include "task_logger.h"
#include "task_flash_store.h"

#define AGG_BATCH_MAX 64
#define AGG_PUB_BATCH 8 // readings per MQTT publish (fits ~8 in 1024 bytes)
#define AGG_BATCH_GPS_MAX 8

static uint32_t totalPublished = 0;

static void lora_gps_publish_pending()
{
  GpsPacket batch[8];
  uint8_t n = rb_gps_drain(batch, 8); // ambil maks 8 record yang menumpuk

  for (uint8_t i = 0; i < n; i++)
  {
    if (!publish_queue)
      break;

    PublishItem item;
    item.qos = MQTT_QOS_DATA;
    item.from_flash  = false;   // never a replayed record — see task_flash_store.h
    item.flash_count = 0;
    strncpy(item.topic, sys_state.topic_gps, sizeof(item.topic));

    item.len = snprintf(item.payload, PQ_MAX_PAYLOAD,
                        "{\"device_id\":\"%s\","
                        "\"type\":\"gps\","
                        "\"node_id\":%lu,"
                        "\"seq\":%lu,"
                        "\"lat\":%.6f,"
                        "\"lon\":%.6f,"
                        "\"alt\":%.2f,"
                        "\"speed\":%.2f,"
                        "\"heading\":%.2f,"
                        "\"hdop\":%.2f,"
                        "\"sat\":%d,"
                        "\"timestamp\":%lu}",
                        sys_state.device_id,
                        (unsigned long)batch[i].node_id,
                        (unsigned long)batch[i].seq,
                        batch[i].latitude,
                        batch[i].longitude,
                        batch[i].altitude_m,
                        batch[i].speed_kmph,
                        batch[i].heading_deg,
                        batch[i].hdop,
                        batch[i].satellites,
                        (unsigned long)state_epoch_s() // timestamp diisi main modulPacket (tidak ada field waktu di struct itu)
    );

    if (xQueueSend(publish_queue, &item, pdMS_TO_TICKS(200)) == pdTRUE)
    {
      totalPublished++;
      Serial.printf("[LoRa] queued to MQTT #%lu -> topic=%s node=%lu\n",
                    (unsigned long)totalPublished, item.topic, (unsigned long)batch[i].node_id);
    }
    else
    {
      Serial.println("[LoRa] publish_queue full — drop GPS packet");
    }
  }
}

// ── Shared JSON rendering — live readings and replayed flash backlog both
//    go through this exact same code, so the wire format can never drift
//    between the two paths. Takes an already-resolved absolute epoch second
//    per record (epoch_s) rather than deriving it internally, because the
//    two callers resolve it differently: live readings convert their
//    timestamp_ms via state_epoch_s_at() (this boot's NTP offset); replayed
//    records already carry an absolute epoch_s written at buffer time,
//    possibly from a previous boot, which state_epoch_s_at() cannot redo. ──
typedef struct
{
  uint8_t  ctrl_id;
  uint8_t  port_num;
  uint8_t  sensor_type;
  uint8_t  ftype;
  float    value;
  uint32_t epoch_s;
} RenderItem;

static void _agg_render(PublishItem *item, const RenderItem *r, int count)
{
  if (count == 1)
  {
    item->len = snprintf(item->payload, PQ_MAX_PAYLOAD,
                         "{\"device_id\":\"%s\","
                         "\"ctrl_id\":%d,"
                         "\"port_num\":%d,"
                         "\"sensor_type\":%d,"
                         "\"value\":%.4f,"
                         "\"timestamp\":%lu,"
                         "\"ftype\":%d}",
                         sys_state.device_id, r[0].ctrl_id, r[0].port_num,
                         r[0].sensor_type, r[0].value,
                         (unsigned long)r[0].epoch_s, r[0].ftype);
    return;
  }

  int pos = snprintf(item->payload, PQ_MAX_PAYLOAD,
                     "[{\"device_id\":\"%s\","
                     "\"ctrl_id\":%d,\"port_num\":%d,\"sensor_type\":%d,"
                     "\"value\":%.4f,\"timestamp\":%lu,\"ftype\":%d}",
                     sys_state.device_id, r[0].ctrl_id, r[0].port_num,
                     r[0].sensor_type, r[0].value,
                     (unsigned long)r[0].epoch_s, r[0].ftype);
  for (int j = 1; j < count && pos < PQ_MAX_PAYLOAD - 120; j++)
  {
    pos += snprintf(item->payload + pos, PQ_MAX_PAYLOAD - pos,
                    ",{\"device_id\":\"%s\","
                    "\"ctrl_id\":%d,\"port_num\":%d,\"sensor_type\":%d,"
                    "\"value\":%.4f,\"timestamp\":%lu,\"ftype\":%d}",
                    sys_state.device_id, r[j].ctrl_id, r[j].port_num,
                    r[j].sensor_type, r[j].value,
                    (unsigned long)r[j].epoch_s, r[j].ftype);
  }
  if (pos >= PQ_MAX_PAYLOAD - 120 && count > 1)
  {
    LOG_WARN("AGG", "Payload truncated, %d bytes", pos);
  }
  pos += snprintf(item->payload + pos, PQ_MAX_PAYLOAD - pos, "]");
  item->len = pos;
}

// Pull one batch (up to AGG_PUB_BATCH records) from the flash ledger into
// publish_queue. This is now the ONLY path that enqueues sensor data for
// publish — every reading is written to flash first (see task_aggregator's
// main loop), so "backlog" here includes readings from this very tick, not
// just ones left over from a past outage.
static void _agg_replay_from_flash()
{
  if (!publish_queue || !fb_has_backlog()) return;
  if (uxQueueSpacesAvailable(publish_queue) == 0) return;

  FlashRecord fbatch[AGG_PUB_BATCH];
  uint8_t n = fb_peek_batch(fbatch, AGG_PUB_BATCH);
  if (n == 0) return;

  RenderItem rbatch[AGG_PUB_BATCH];
  for (uint8_t k = 0; k < n; k++)
  {
    rbatch[k].ctrl_id     = fbatch[k].ctrl_id;
    rbatch[k].port_num    = fbatch[k].port_num;
    rbatch[k].sensor_type = fbatch[k].sensor_type;
    rbatch[k].ftype       = fbatch[k].ftype;
    rbatch[k].value       = fbatch[k].value;
    rbatch[k].epoch_s     = fbatch[k].epoch_s;
  }

  PublishItem item;
  item.qos = MQTT_QOS_DATA;
  item.from_flash  = true;
  item.flash_count = n;
  strncpy(item.topic, sys_state.topic_data, sizeof(item.topic));
  _agg_render(&item, rbatch, n);

  if (xQueueSend(publish_queue, &item, 0) != pdTRUE)
  {
    // Checked uxQueueSpacesAvailable above, so this shouldn't happen — but if
    // it does, release the in-flight mark so the same records are re-peeked
    // next cycle instead of being stuck "in flight" with nothing actually
    // queued to confirm them.
    fb_release_peek();
    LOG_WARN("AGG", "Replay enqueue failed despite free slot");
  }
}

void task_aggregator(void *param)
{
  esp_task_wdt_add(NULL); // subscribe to Task Watchdog
  SensorPacket batch[AGG_BATCH_MAX];
  static uint16_t _agg_write_count = 0;
  for (;;)
  {
    esp_task_wdt_reset(); // feed WD every loop iteration — before any delays

    xSemaphoreTake(state_mutex, portMAX_DELAY);
    uint32_t window = sys_state.agg_window_ms;
    xSemaphoreGive(state_mutex);

    vTaskDelay(pdMS_TO_TICKS(window));

    lora_gps_publish_pending();   // jalan tiap tick, tidak boleh ke-skip oleh continue di bawah

    uint8_t count = rb_drain(batch, AGG_BATCH_MAX);
    if (count > 0)
    {
      uint8_t kept = 0;
      for (uint8_t i = 0; i < count; i++)
      {
        if (batch[i].ftype != FTYPE_HB_TYPED)
          batch[kept++] = batch[i];
      }
      count = kept;
    }

    // Write-ahead: every genuine reading goes to the flash ledger FIRST,
    // before it has ever touched publish_queue — it is durable the instant
    // fb_write() returns. Flash is the source of truth for sensor data, not
    // an overflow bucket for when RAM is full (see task_flash_store.h).
    // Non-reading frames that still reach here (e.g. a port-level HELLO)
    // are not buffered — same as they were already dropped under the old
    // overflow path.
    uint8_t buffered = 0, dropped = 0;
    for (uint8_t i = 0; i < count; i++)
    {
      if (batch[i].ftype == FTYPE_DATA || batch[i].ftype == FTYPE_DATA_TYPED)
      {
        uint32_t epoch_s = state_epoch_s_at(batch[i].timestamp_ms);
        if (fb_write(batch[i].ctrl_id, batch[i].port_num, batch[i].sensor_type,
                     batch[i].value, batch[i].ftype, epoch_s))
          buffered++;
        else
          dropped++;
      }
      else
      {
        dropped++;
      }
    }
    if (dropped > 0)
    {
      LOG_WARN("AGG", "%d non-data/unwritable frame(s) dropped this tick", dropped);
    }
    if (buffered > 0)
    {
      _agg_write_count += buffered;
      if (_agg_write_count >= 50)
      {
        LOG_INFO("AGG", "%u reading(s) written to flash ledger", _agg_write_count);
        _agg_write_count = 0;
      }
    }

    // Drain flash into publish_queue. Each call enqueues at most one
    // AGG_PUB_BATCH-sized item — loop (bounded) so a burst bigger than
    // AGG_PUB_BATCH still fully drains within this same tick instead of
    // trickling out over the next few 10ms ticks.
    for (uint8_t iter = 0; iter < (AGG_BATCH_MAX / AGG_PUB_BATCH) + 1; iter++)
    {
      if (!publish_queue || !fb_has_backlog() || uxQueueSpacesAvailable(publish_queue) == 0)
        break;
      _agg_replay_from_flash();
    }

    esp_task_wdt_reset(); // feed watchdog — loop completes every ~10ms
  }
}