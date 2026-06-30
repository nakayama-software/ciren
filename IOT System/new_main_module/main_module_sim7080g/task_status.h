#pragma once
#include <Arduino.h>
#include <esp_task_wdt.h>
#include "ciren_config.h"
#include "system_state.h"
#include "task_publish.h"
#include "task_logger.h"

void task_status(void* param) {
  esp_task_wdt_add(NULL);   // subscribe to Task Watchdog
  static bool hello_sent    = false;
  static bool was_connected = false;
  static uint8_t status_log_counter = 0;   // throttle: log every 6th cycle (~60s)

  for (;;) {
    esp_task_wdt_reset();   // feed WD at start of every loop — before any delays

    // Mode-dependent interval: 10s WiFi, 30s SIM (saves bandwidth on constrained links)
    xSemaphoreTake(state_mutex, portMAX_DELAY);
    uint32_t status_interval = (strcmp(sys_state.conn_mode, "sim") == 0)
        ? STATUS_INTERVAL_SIM_MS : STATUS_INTERVAL_WIFI_MS;
    xSemaphoreGive(state_mutex);

    // Split long delays into 5s chunks to keep feeding the watchdog
    // (TWDT timeout is 15s — a 30s delay would trigger it)
    for (uint32_t waited = 0; waited < status_interval; waited += 5000) {
      uint32_t chunk = (status_interval - waited > 5000) ? 5000 : (status_interval - waited);
      vTaskDelay(pdMS_TO_TICKS(chunk));
      esp_task_wdt_reset();   // feed WD during long waits
    }

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
      if (xQueueSend(publish_queue, &item, pdMS_TO_TICKS(100)) == pdTRUE) {
        LOG_INFO("STATUS", "HELLO sent for %s", sys_state.device_id);
      } else {
        LOG_WARN("STATUS", "HELLO publish queue full");
      }
      hello_sent = true;
    }

    char conn_mode_buf[8];
    xSemaphoreTake(state_mutex, portMAX_DELAY);
    int8_t rssi  = (strcmp(sys_state.conn_mode, "sim") == 0)
                     ? (int8_t)sys_state.sim_signal   // Fix 10: pakai SIM signal di SIM mode
                     : sys_state.rssi;
    uint8_t batt = sys_state.batt_pct;
    strncpy(conn_mode_buf, sys_state.conn_mode, sizeof(conn_mode_buf));
    xSemaphoreGive(state_mutex);

    // ── Build ctrl_status JSON ────────────────────────────────────────────────
    // Snapshot controller info for inclusion in the status message.
    // _ctrl_info is written from ISR — we read with relaxed consistency
    // (same pattern as _ctrl_seen_ms in the old code). Worst case: a torn
    // read is corrected on the next status cycle (10-30s).
    uint8_t snap_count = _ctrl_info_count;
    if (snap_count > MAX_CTRL_IDS) snap_count = MAX_CTRL_IDS;
    uint32_t now_ms = (uint32_t)millis();

    // Build the ctrl_status JSON fragment
    char ctrl_json[512];
    int cpos = 0;
    ctrl_json[0] = '\0';

    if (snap_count > 0) {
      cpos += snprintf(ctrl_json + cpos, sizeof(ctrl_json) - cpos, "\"ctrl_status\":{");
      for (uint8_t i = 0; i < snap_count && cpos < (int)(sizeof(ctrl_json) - 80); i++) {
        CtrlInfo *ci = &_ctrl_info[i];
        bool online = (now_ms - ci->last_seen_ms) < (uint32_t)CTRL_TIMEOUT_MS;
        // Use epoch timestamp if NTP synced, otherwise monotonic seconds since boot
        uint32_t ts_s = state_epoch_s_at(ci->last_seen_ms);

        if (i > 0) cpos += snprintf(ctrl_json + cpos, sizeof(ctrl_json) - cpos, ",");

        // Build nodes array
        char nodes_json[256];
        int npos = 0;
        nodes_json[0] = '\0';
        if (ci->port_count > 0) {
          npos += snprintf(nodes_json + npos, sizeof(nodes_json) - npos, "[");
          for (uint8_t p = 0; p < ci->port_count && npos < (int)(sizeof(nodes_json) - 60); p++) {
            CtrlPortInfo *pi = &ci->ports[p];
            if (p > 0) npos += snprintf(nodes_json + npos, sizeof(nodes_json) - npos, ",");
            npos += snprintf(nodes_json + npos, sizeof(nodes_json) - npos,
              "{\"p\":%d,\"stypes\":[", pi->port_num);
            for (uint8_t s = 0; s < pi->stype_count; s++) {
              if (s > 0) npos += snprintf(nodes_json + npos, sizeof(nodes_json) - npos, ",");
              npos += snprintf(nodes_json + npos, sizeof(nodes_json) - npos, "%d", pi->stypes[s]);
            }
            npos += snprintf(nodes_json + npos, sizeof(nodes_json) - npos, "]}");
          }
          npos += snprintf(nodes_json + npos, sizeof(nodes_json) - npos, "]");
        } else {
          snprintf(nodes_json, sizeof(nodes_json), "[]");
        }

        cpos += snprintf(ctrl_json + cpos, sizeof(ctrl_json) - cpos,
          "\"%d\":{\"online\":%s,\"ts\":%lu,\"nodes\":%s}",
          ci->ctrl_id, online ? "true" : "false", ts_s, nodes_json);
      }
      cpos += snprintf(ctrl_json + cpos, sizeof(ctrl_json) - cpos, "}");
    }

    // ── Build status payload ──────────────────────────────────────────────────
    strncpy(item.topic, sys_state.topic_status, sizeof(item.topic));

    if (snap_count > 0) {
      item.len = snprintf(item.payload, PQ_MAX_PAYLOAD,
        "{\"conn_mode\":\"%s\","
        "\"rssi\":%d,\"batt_pct\":%d,\"fw_version\":\"%s\","
        "%s}",
        conn_mode_buf, rssi, batt, FW_VERSION,
        ctrl_json
      );
    } else {
      // No controllers — omit ctrl_status to save bandwidth
      item.len = snprintf(item.payload, PQ_MAX_PAYLOAD,
        "{\"conn_mode\":\"%s\","
        "\"rssi\":%d,\"batt_pct\":%d,\"fw_version\":\"%s\"}",
        conn_mode_buf, rssi, batt, FW_VERSION
      );
    }

    if (item.len >= PQ_MAX_PAYLOAD - 1) {
      LOG_WARN("STATUS", "Status payload truncated at %d bytes", item.len);
    }

    if (xQueueSend(publish_queue, &item, 0) != pdTRUE) {
      LOG_WARN("STATUS", "Status publish queue full");
    }

    // Throttled status log: every 6th cycle (~60s WiFi, ~180s SIM)
    status_log_counter++;
    if (status_log_counter >= 6) {
      status_log_counter = 0;
      LOG_INFO("STATUS", "RSSI=%d batt=%d mode=%s ctrl=%d", rssi, batt, conn_mode_buf, snap_count);
    }
    // WD feed is now at the start of the loop + during the delay chunks
  }
}