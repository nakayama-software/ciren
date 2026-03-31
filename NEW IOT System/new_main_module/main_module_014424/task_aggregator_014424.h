#pragma once
#include <Arduino.h>
#include "ciren_config_014424.h"
#include "ring_buffer_014424.h"
#include "system_state_014424.h"
#include "task_publish_014424.h"

#define AGG_BATCH_MAX 64

void task_aggregator(void* param) {
  SensorPacket batch[AGG_BATCH_MAX];
  for (;;) {
    xSemaphoreTake(state_mutex, portMAX_DELAY);
    uint32_t window = sys_state.agg_window_ms;
    xSemaphoreGive(state_mutex);

    vTaskDelay(pdMS_TO_TICKS(window));

    uint8_t count = rb_drain(batch, AGG_BATCH_MAX);
    if (count == 0) continue;

    for (int i = 0; i < count; i++) {
      if (!publish_queue) continue;

      PublishItem item;
      item.qos = MQTT_QOS_DATA;
      strncpy(item.topic, TOPIC_DATA, sizeof(item.topic));
      item.len = snprintf(item.payload, PQ_MAX_PAYLOAD,
        "{\"device_id\":\"%s\","
        "\"ctrl_id\":%d,"
        "\"port_num\":%d,"
        "\"sensor_type\":%d,"
        "\"value\":%.4f,"
        "\"timestamp_ms\":%lu,"
        "\"ftype\":%d}",
        DEVICE_ID, batch[i].ctrl_id, batch[i].port_num,
        batch[i].sensor_type, batch[i].value,
        batch[i].timestamp_ms, batch[i].ftype
      );

      // FIX Bug 2: tunggu hingga 200ms agar queue tidak drop paket
      // xQueueSend(..., 0) non-blocking akan buang paket kalau queue penuh
      if (xQueueSend(publish_queue, &item, pdMS_TO_TICKS(200)) != pdTRUE) {
        Serial.printf("[AGG] queue full — drop ctrl=%d port=%d stype=0x%02X\n",
                      batch[i].ctrl_id, batch[i].port_num, batch[i].sensor_type);
      }
    }
  }
}