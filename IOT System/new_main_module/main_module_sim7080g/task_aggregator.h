#pragma once
#include <Arduino.h>
#include <esp_task_wdt.h>
#include "ciren_config.h"
#include "ring_buffer.h"
#include "system_state.h"
#include "task_publish.h"
#include "task_logger.h"

#define AGG_BATCH_MAX 64
#define AGG_PUB_BATCH  8   // readings per MQTT publish (fits ~8 in 1024 bytes)

void task_aggregator(void* param) {
  esp_task_wdt_add(NULL);   // subscribe to Task Watchdog
  SensorPacket batch[AGG_BATCH_MAX];
  static uint16_t _agg_batch_count = 0;
  for (;;) {
    esp_task_wdt_reset();   // feed WD every loop iteration — before any delays

    xSemaphoreTake(state_mutex, portMAX_DELAY);
    uint32_t window = sys_state.agg_window_ms;
    xSemaphoreGive(state_mutex);

    vTaskDelay(pdMS_TO_TICKS(window));

    uint8_t count = rb_drain(batch, AGG_BATCH_MAX);
    if (count == 0) continue;

    // Drop HB_TYPED from MQTT publish — local liveness already tracked in ISR.
    // They are still drained from the ring buffer to prevent backlog.
    uint8_t kept = 0;
    for (uint8_t i = 0; i < count; i++) {
      if (batch[i].ftype != FTYPE_HB_TYPED)
        batch[kept++] = batch[i];
    }
    count = kept;
    if (count == 0) continue;

    // Batch multiple readings into fewer MQTT messages
    for (int i = 0; i < count; ) {
      if (!publish_queue) break;

      int batch_len = (count - i < AGG_PUB_BATCH) ? (count - i) : AGG_PUB_BATCH;

      // Keep HumTemp pairs (0x01+0x02 same ctrl+port) in the same MQTT batch
      // so the server can align their timestamps. When batch_len==1 and the
      // reading is a HumTemp type, look for its companion in the drain buffer.
      if (batch_len == 1 && count > i + 1 &&
          (batch[i].sensor_type == 0x01 || batch[i].sensor_type == 0x02)) {
        uint8_t companion = (batch[i].sensor_type == 0x01) ? 0x02 : 0x01;
        for (int j = i + 1; j < count; j++) {
          if (batch[j].ctrl_id == batch[i].ctrl_id &&
              batch[j].port_num == batch[i].port_num &&
              batch[j].sensor_type == companion) {
            // Found — swap adjacent so both go in this batch
            SensorPacket tmp = batch[i + 1];
            batch[i + 1] = batch[j];
            batch[j] = tmp;
            batch_len = 2;
            break;
          }
        }
      }

      // Convert ISR millis() timestamps to epoch seconds if NTP synced.
      // If NTP has not synced yet, send monotonic seconds since boot (small number,
      // backend detects "not synced" and uses its own arrival time).
      // Using epoch seconds (not ms) because epoch_ms overflows uint32_t.
      // NOTE: we convert at publish time, not ISR time. The delay is at most
      // agg_window_ms (10ms) + queue wait, which is negligible for 30-min intervals.
      PublishItem item;
      item.qos = MQTT_QOS_DATA;
      strncpy(item.topic, sys_state.topic_data, sizeof(item.topic));

      if (batch_len == 1) {
        // Single reading — send as plain JSON object (backward compatible)
        uint32_t ts = state_epoch_s_at(batch[i].timestamp_ms);
        item.len = snprintf(item.payload, PQ_MAX_PAYLOAD,
          "{\"device_id\":\"%s\","
          "\"ctrl_id\":%d,"
          "\"port_num\":%d,"
          "\"sensor_type\":%d,"
          "\"value\":%.4f,"
          "\"timestamp\":%lu,"
          "\"ftype\":%d}",
          sys_state.device_id, batch[i].ctrl_id, batch[i].port_num,
          batch[i].sensor_type, batch[i].value,
          (unsigned long)ts, batch[i].ftype
        );
      } else {
        // Multiple readings — send as JSON array for efficiency
        int pos = snprintf(item.payload, PQ_MAX_PAYLOAD,
          "[{\"device_id\":\"%s\","
          "\"ctrl_id\":%d,\"port_num\":%d,\"sensor_type\":%d,"
          "\"value\":%.4f,\"timestamp\":%lu,\"ftype\":%d}",
          sys_state.device_id, batch[i].ctrl_id, batch[i].port_num,
          batch[i].sensor_type, batch[i].value,
          (unsigned long)state_epoch_s_at(batch[i].timestamp_ms), batch[i].ftype
        );
        for (int j = 1; j < batch_len && pos < PQ_MAX_PAYLOAD - 120; j++) {
          pos += snprintf(item.payload + pos, PQ_MAX_PAYLOAD - pos,
            ",{\"device_id\":\"%s\","
            "\"ctrl_id\":%d,\"port_num\":%d,\"sensor_type\":%d,"
            "\"value\":%.4f,\"timestamp\":%lu,\"ftype\":%d}",
            sys_state.device_id, batch[i + j].ctrl_id, batch[i + j].port_num,
            batch[i + j].sensor_type, batch[i + j].value,
            (unsigned long)state_epoch_s_at(batch[i + j].timestamp_ms), batch[i + j].ftype
          );
        }
        if (pos >= PQ_MAX_PAYLOAD - 120 && batch_len > 1) {
          LOG_WARN("AGG", "Payload truncated, %d bytes", pos);
        }
        pos += snprintf(item.payload + pos, PQ_MAX_PAYLOAD - pos, "]");
        item.len = pos;
      }

      if (xQueueSend(publish_queue, &item, pdMS_TO_TICKS(200)) != pdTRUE) {
        Serial.printf("[AGG] queue full — drop batch starting ctrl=%d port=%d\n",
                      batch[i].ctrl_id, batch[i].port_num);
        LOG_WARN("AGG", "Publish queue full — dropping ctrl=%d port=%d", batch[i].ctrl_id, batch[i].port_num);
      } else {
        _agg_batch_count++;
        if (_agg_batch_count % 10 == 0) {
          LOG_INFO("AGG", "Batch #%u: %d readings queued", _agg_batch_count, count);
        }
      }
      i += batch_len;
    }
    esp_task_wdt_reset();   // feed watchdog — loop completes every ~10ms
  }
}