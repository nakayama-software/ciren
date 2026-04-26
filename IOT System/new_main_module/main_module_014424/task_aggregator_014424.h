#pragma once
#include <Arduino.h>
#include "ciren_config_014424.h"
#include "ring_buffer_014424.h"
#include "system_state_014424.h"
#include "task_publish_014424.h"

#define AGG_BATCH_MAX 64
#define AGG_PUB_BATCH  8   // readings per MQTT publish (fits ~8 in 1024 bytes)

void task_aggregator(void* param) {
  SensorPacket batch[AGG_BATCH_MAX];
  for (;;) {
    xSemaphoreTake(state_mutex, portMAX_DELAY);
    uint32_t window = sys_state.agg_window_ms;
    xSemaphoreGive(state_mutex);

    vTaskDelay(pdMS_TO_TICKS(window));

    uint8_t count = rb_drain(batch, AGG_BATCH_MAX);
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

      PublishItem item;
      item.qos = MQTT_QOS_DATA;
      strncpy(item.topic, sys_state.topic_data, sizeof(item.topic));

      if (batch_len == 1) {
        // Single reading — send as plain JSON object (backward compatible)
        item.len = snprintf(item.payload, PQ_MAX_PAYLOAD,
          "{\"device_id\":\"%s\","
          "\"ctrl_id\":%d,"
          "\"port_num\":%d,"
          "\"sensor_type\":%d,"
          "\"value\":%.4f,"
          "\"timestamp_ms\":%lu,"
          "\"ftype\":%d}",
          sys_state.device_id, batch[i].ctrl_id, batch[i].port_num,
          batch[i].sensor_type, batch[i].value,
          batch[i].timestamp_ms, batch[i].ftype
        );
      } else {
        // Multiple readings — send as JSON array for efficiency
        int pos = snprintf(item.payload, PQ_MAX_PAYLOAD,
          "[{\"device_id\":\"%s\","
          "\"ctrl_id\":%d,\"port_num\":%d,\"sensor_type\":%d,"
          "\"value\":%.4f,\"timestamp_ms\":%lu,\"ftype\":%d}",
          sys_state.device_id, batch[i].ctrl_id, batch[i].port_num,
          batch[i].sensor_type, batch[i].value,
          batch[i].timestamp_ms, batch[i].ftype
        );
        for (int j = 1; j < batch_len && pos < PQ_MAX_PAYLOAD - 120; j++) {
          pos += snprintf(item.payload + pos, PQ_MAX_PAYLOAD - pos,
            ",{\"device_id\":\"%s\","
            "\"ctrl_id\":%d,\"port_num\":%d,\"sensor_type\":%d,"
            "\"value\":%.4f,\"timestamp_ms\":%lu,\"ftype\":%d}",
            sys_state.device_id, batch[i + j].ctrl_id, batch[i + j].port_num,
            batch[i + j].sensor_type, batch[i + j].value,
            batch[i + j].timestamp_ms, batch[i + j].ftype
          );
        }
        pos += snprintf(item.payload + pos, PQ_MAX_PAYLOAD - pos, "]");
        item.len = pos;
      }

      if (xQueueSend(publish_queue, &item, pdMS_TO_TICKS(200)) != pdTRUE) {
        Serial.printf("[AGG] queue full — drop batch starting ctrl=%d port=%d\n",
                      batch[i].ctrl_id, batch[i].port_num);
      }
      i += batch_len;
    }
  }
}