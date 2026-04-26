#pragma once
#include <Arduino.h>
#include "ciren_config.h"
#include "system_state.h"
#include "task_publish.h"

void task_status(void* param) {
  static bool hello_sent    = false;
  static bool was_connected = false;

  for (;;) {
    vTaskDelay(pdMS_TO_TICKS(10000));

    bool connected = state_is_connected();

    // Reset hello_sent saat koneksi drop → akan dikirim ulang saat reconnect
    if (was_connected && !connected) {
      hello_sent = false;
    }
    was_connected = connected;

    if (!connected) continue;

    PublishItem item;
    item.qos = MQTT_QOS;   // QoS=1 untuk HELLO dan STATUS

    if (!hello_sent) {
      strncpy(item.topic, sys_state.topic_hello, sizeof(item.topic));
      item.len = snprintf(item.payload, PQ_MAX_PAYLOAD,
        "{\"conn_mode\":\"%s\",\"fw_version\":\"%s\"}",
        sys_state.conn_mode, FW_VERSION
      );
      xQueueSend(publish_queue, &item, pdMS_TO_TICKS(100));
      hello_sent = true;
    }

    char conn_mode_buf[8];
    xSemaphoreTake(state_mutex, portMAX_DELAY);
    float  lat   = sys_state.gps_lat;
    float  lon   = sys_state.gps_lon;
    bool   fix   = sys_state.gps_fix;
    int8_t rssi  = (strcmp(sys_state.conn_mode, "sim") == 0)
                     ? (int8_t)sys_state.sim_signal   // Fix 10: pakai SIM signal di SIM mode
                     : sys_state.rssi;
    uint8_t batt = sys_state.batt_pct;
    strncpy(conn_mode_buf, sys_state.conn_mode, sizeof(conn_mode_buf));
    xSemaphoreGive(state_mutex);

    strncpy(item.topic, sys_state.topic_status, sizeof(item.topic));
    item.len = snprintf(item.payload, PQ_MAX_PAYLOAD,
      "{\"conn_mode\":\"%s\","
      "\"gps_lat\":%.6f,\"gps_lon\":%.6f,\"gps_fix\":%s,"
      "\"rssi\":%d,\"batt_pct\":%d,\"fw_version\":\"%s\"}",
      conn_mode_buf, lat, lon, fix ? "true" : "false",
      rssi, batt, FW_VERSION
    );
    xQueueSend(publish_queue, &item, 0);
  }
}