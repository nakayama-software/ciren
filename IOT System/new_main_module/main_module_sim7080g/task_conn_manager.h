#pragma once
#include <WiFi.h>
#include <esp_wifi.h>
#include "ciren_config.h"
#include "system_state.h"
#include "task_publish.h"

static const char* _wifi_ssid     = nullptr;
static const char* _wifi_password = nullptr;
static const char* _mqtt_host     = nullptr;
static bool        _mqtt_started  = false;

void conn_manager_init(const char* ssid, const char* password, const char* mqtt_host) {
  _wifi_ssid     = ssid;
  _wifi_password = password;
  _mqtt_host     = mqtt_host;
}

static bool wifi_connect() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(_wifi_ssid, _wifi_password);
  uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED) {
    if (millis() - start > WIFI_TIMEOUT_MS) return false;
    vTaskDelay(pdMS_TO_TICKS(200));
  }
  // Disable WiFi power save — mencegah dropout ESP-NOW saat WiFi aktif
  esp_wifi_set_ps(WIFI_PS_NONE);
  xSemaphoreTake(state_mutex, portMAX_DELAY);
  sys_state.rssi = WiFi.RSSI();
  xSemaphoreGive(state_mutex);
  Serial.printf("[WiFi] Connected RSSI=%d IP=%s\n",
    WiFi.RSSI(), WiFi.localIP().toString().c_str());
  return true;
}

static bool wifi_recover() {
  WiFi.disconnect();
  vTaskDelay(pdMS_TO_TICKS(500));
  if (wifi_connect()) return true;
  vTaskDelay(pdMS_TO_TICKS(RECONNECT_DELAY_1));
  if (wifi_connect()) return true;
  vTaskDelay(pdMS_TO_TICKS(RECONNECT_DELAY_2));
  if (wifi_connect()) return true;
  vTaskDelay(pdMS_TO_TICKS(RECONNECT_DELAY_3));
  return false;
}

static void _start_wifi_mqtt() {
  if (!_mqtt_started) {
    mqtt_init(_mqtt_host);
    _mqtt_started = true;
  } else {
    esp_mqtt_client_reconnect(mqtt_client);
  }
}

static void _switch_to_sim() {
  Serial.println("[ConnMgr] Switching to SIM mode");
  // Stop any ongoing WiFi scan/connect, then pin to a fixed channel so
  // ESP-NOW works without an AP connection. Without disconnect+pin the radio
  // scans freely and WiFi.channel() returns random values, causing
  // "Peer channel != home channel" ESP-NOW send failures.
  WiFi.disconnect(false);
  vTaskDelay(pdMS_TO_TICKS(100));
  WiFi.mode(WIFI_STA);
  esp_wifi_set_channel(ESPNOW_FIXED_CHANNEL, WIFI_SECOND_CHAN_NONE);
  Serial.printf("[ConnMgr] ESP-NOW channel pinned to %d\n", ESPNOW_FIXED_CHANNEL);
  xSemaphoreTake(state_mutex, portMAX_DELAY);
  strncpy(sys_state.conn_mode, "sim", sizeof(sys_state.conn_mode));
  xSemaphoreGive(state_mutex);
}

static void _switch_to_wifi() {
  Serial.println("[ConnMgr] Switching to WiFi mode");
  xSemaphoreTake(state_mutex, portMAX_DELAY);
  strncpy(sys_state.conn_mode, "wifi", sizeof(sys_state.conn_mode));
  sys_state.rssi = WiFi.RSSI();
  xSemaphoreGive(state_mutex);
  _start_wifi_mqtt();
}

void task_conn_manager(void* param) {
  // ── Initial WiFi connect ─────────────────────────────────────────────────
  bool wifi_ok = false;
  for (int i = 0; i < 3 && !wifi_ok; i++) {
    Serial.printf("[ConnMgr] WiFi attempt %d/3...\n", i + 1);
    wifi_ok = wifi_connect();
    if (!wifi_ok) vTaskDelay(pdMS_TO_TICKS(5000));
  }

  if (wifi_ok) {
    _switch_to_wifi();
  } else {
    if (sys_state.sim_enabled) {
      _switch_to_sim();
      Serial.println("[ConnMgr] No WiFi at boot — SIM fallback active");
    } else {
      Serial.println("[ConnMgr] No WiFi, SIM disabled — restarting...");
      esp_restart();
    }
  }

  uint32_t last_wifi_probe_ms = 0;

  for (;;) {
    vTaskDelay(pdMS_TO_TICKS(5000));

    char current_mode[8];
    xSemaphoreTake(state_mutex, portMAX_DELAY);
    strncpy(current_mode, sys_state.conn_mode, sizeof(current_mode));
    xSemaphoreGive(state_mutex);

    if (strcmp(current_mode, "wifi") == 0) {
      // ── WiFi mode: monitor connection ──────────────────────────────────────
      if (WiFi.status() != WL_CONNECTED) {
        state_set_connected(false);
        Serial.println("[ConnMgr] WiFi dropped");
        if (!wifi_recover()) {
          if (sys_state.sim_enabled) {
            _switch_to_sim();
          } else {
            Serial.println("[ConnMgr] WiFi lost, no SIM — restarting...");
            esp_restart();
          }
        } else {
          xSemaphoreTake(state_mutex, portMAX_DELAY);
          sys_state.rssi = WiFi.RSSI();
          xSemaphoreGive(state_mutex);
        }
      } else {
        xSemaphoreTake(state_mutex, portMAX_DELAY);
        sys_state.rssi = WiFi.RSSI();
        xSemaphoreGive(state_mutex);
      }
    } else {
      // ── SIM mode: probe WiFi every 30s (only if SSID is configured) ─────────
      if (millis() - last_wifi_probe_ms >= 30000) {
        last_wifi_probe_ms = millis();
        if (_wifi_ssid && strlen(_wifi_ssid) > 0) {
          Serial.println("[ConnMgr] SIM mode — probing WiFi...");
          if (wifi_connect()) {
            _switch_to_wifi();
          } else {
            Serial.println("[ConnMgr] WiFi still unavailable");
            // WiFi.begin() during probe causes the radio to scan freely,
            // which breaks the fixed ESP-NOW channel. Re-pin after failure.
            WiFi.disconnect(false);
            vTaskDelay(pdMS_TO_TICKS(100));
            esp_wifi_set_channel(ESPNOW_FIXED_CHANNEL, WIFI_SECOND_CHAN_NONE);
            Serial.printf("[ConnMgr] ESP-NOW channel re-pinned to %d\n", ESPNOW_FIXED_CHANNEL);
          }
        }
      }
    }
  }
}