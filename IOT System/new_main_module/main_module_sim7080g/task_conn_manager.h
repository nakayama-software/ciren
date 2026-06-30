#pragma once
#include <WiFi.h>
#include <esp_wifi.h>
#include <esp_task_wdt.h>
#include "ciren_config.h"
#include "system_state.h"
#include "task_publish.h"
#include "task_logger.h"

static const char* _wifi_ssid     = nullptr;
static const char* _wifi_password = nullptr;
static const char* _mqtt_host     = nullptr;
static bool        _mqtt_started  = false;

// ── WiFi retry backoff state (used when SIM disabled + WiFi down) ──────────
static uint32_t _wifi_retry_delay_ms = WIFI_RETRY_MIN_MS;

void conn_manager_init(const char* ssid, const char* password, const char* mqtt_host) {
  _wifi_ssid     = ssid;
  _wifi_password = password;
  _mqtt_host     = mqtt_host;
}

static bool wifi_connect() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(_wifi_ssid, _wifi_password);
  LOG_INFO("ConnMgr", "WiFi connecting SSID=%s", _wifi_ssid);
  uint32_t start = millis();
  int attempt = 0;
  while (WiFi.status() != WL_CONNECTED) {
    if (millis() - start > WIFI_TIMEOUT_MS) {
      LOG_WARN("ConnMgr", "WiFi connect timeout after %d attempts", attempt);
      return false;
    }
    vTaskDelay(pdMS_TO_TICKS(200));
    attempt++;
  }
  // Disable WiFi power save — mencegah dropout ESP-NOW saat WiFi aktif
  esp_wifi_set_ps(WIFI_PS_NONE);
  xSemaphoreTake(state_mutex, portMAX_DELAY);
  sys_state.rssi = WiFi.RSSI();
  xSemaphoreGive(state_mutex);
  Serial.printf("[WiFi] Connected RSSI=%d IP=%s\n",
    WiFi.RSSI(), WiFi.localIP().toString().c_str());
  LOG_INFO("WiFi", "Connected RSSI=%d IP=%s", WiFi.RSSI(), WiFi.localIP().toString().c_str());
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
  LOG_WARN("ConnMgr", "Switching to SIM mode — WiFi unavailable");
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
  LOG_INFO("ConnMgr", "Switching to WiFi mode");
  xSemaphoreTake(state_mutex, portMAX_DELAY);
  strncpy(sys_state.conn_mode, "wifi", sizeof(sys_state.conn_mode));
  sys_state.rssi = WiFi.RSSI();
  xSemaphoreGive(state_mutex);
  _start_wifi_mqtt();
  // Reset retry backoff on successful WiFi connection
  _wifi_retry_delay_ms = WIFI_RETRY_MIN_MS;
}

void task_conn_manager(void* param) {
  esp_task_wdt_add(NULL);   // subscribe to Task Watchdog

  // ── Initial WiFi connect ──────────────────────────────────────────────────
  // Try 3 quick attempts. If SIM is available, fall back to SIM.
  // If SIM is disabled, enter persistent retry loop (no reboot).
  bool wifi_ok = false;
  for (int i = 0; i < 3 && !wifi_ok; i++) {
    Serial.printf("[ConnMgr] WiFi attempt %d/3...\n", i + 1);
    wifi_ok = wifi_connect();
    if (!wifi_ok) vTaskDelay(pdMS_TO_TICKS(5000));
  }

  if (wifi_ok) {
    _switch_to_wifi();
  } else if (sys_state.sim_enabled) {
    _switch_to_sim();
    LOG_WARN("ConnMgr", "No WiFi at boot — SIM fallback active");
  } else {
    // No WiFi and no SIM — enter persistent retry loop.
    // Do NOT reboot: keep ESP-NOW alive, retry WiFi with backoff.
    LOG_WARN("ConnMgr", "No WiFi at boot, SIM disabled — persistent retry (no reboot)");
    Serial.println("[ConnMgr] No WiFi, no SIM — entering persistent retry");
    // Pin ESP-NOW channel so local radio keeps working
    WiFi.disconnect(false);
    vTaskDelay(pdMS_TO_TICKS(100));
    WiFi.mode(WIFI_STA);
    esp_wifi_set_channel(ESPNOW_FIXED_CHANNEL, WIFI_SECOND_CHAN_NONE);
    xSemaphoreTake(state_mutex, portMAX_DELAY);
    strncpy(sys_state.conn_mode, "wifi", sizeof(sys_state.conn_mode));  // keep mode as "wifi" intent
    xSemaphoreGive(state_mutex);
    _wifi_retry_delay_ms = WIFI_RETRY_MIN_MS;
    state_set_connected(false);
  }

  uint32_t last_wifi_probe_ms = 0;

  for (;;) {
    vTaskDelay(pdMS_TO_TICKS(5000));
    esp_task_wdt_reset();   // feed watchdog — loop every 5s

    char current_mode[8];
    xSemaphoreTake(state_mutex, portMAX_DELAY);
    strncpy(current_mode, sys_state.conn_mode, sizeof(current_mode));
    bool sim_en = sys_state.sim_enabled;
    xSemaphoreGive(state_mutex);

    if (strcmp(current_mode, "wifi") == 0) {
      // ── WiFi mode: monitor connection or retry ──────────────────────────────
      if (WiFi.status() == WL_CONNECTED) {
        // WiFi is up — update RSSI and reset backoff
        xSemaphoreTake(state_mutex, portMAX_DELAY);
        sys_state.rssi = WiFi.RSSI();
        xSemaphoreGive(state_mutex);
        _wifi_retry_delay_ms = WIFI_RETRY_MIN_MS;
      } else {
        // WiFi is down
        state_set_connected(false);

        if (sim_en) {
          // SIM available — try quick recovery (3 attempts), then switch to SIM
          Serial.println("[ConnMgr] WiFi dropped — attempting recovery");
          LOG_WARN("ConnMgr", "WiFi dropped — attempting recovery");
          if (wifi_recover()) {
            _switch_to_wifi();
            continue;
          }
          // Recovery failed — switch to SIM mode
          _switch_to_sim();
        } else {
          // No SIM — persistent retry with exponential backoff (NO REBOOT)
          // Use single connect attempt per cycle (not 3-attempt recovery) to
          // avoid blocking the task for too long.
          Serial.printf("[ConnMgr] WiFi down, no SIM — retry in %lu ms\n", _wifi_retry_delay_ms);
          LOG_WARN("ConnMgr", "WiFi down, no SIM — retry in %lu ms", _wifi_retry_delay_ms);

          // Wait with backoff, feeding watchdog
          uint32_t wait_start = millis();
          while (millis() - wait_start < _wifi_retry_delay_ms) {
            vTaskDelay(pdMS_TO_TICKS(1000));
            esp_task_wdt_reset();
          }

          // Pin ESP-NOW channel before attempting connect
          WiFi.disconnect(false);
          vTaskDelay(pdMS_TO_TICKS(100));
          WiFi.mode(WIFI_STA);
          esp_wifi_set_channel(ESPNOW_FIXED_CHANNEL, WIFI_SECOND_CHAN_NONE);

          // Try to connect
          if (wifi_connect()) {
            // Successfully reconnected — resume normal operation
            _switch_to_wifi();
          } else {
            // Double backoff for next attempt (cap at max)
            _wifi_retry_delay_ms *= 2;
            if (_wifi_retry_delay_ms > WIFI_RETRY_MAX_MS) _wifi_retry_delay_ms = WIFI_RETRY_MAX_MS;
          }
        }
      }
    } else {
      // ── SIM mode: probe WiFi every 30s (only if SSID is configured) ─────────
      if (millis() - last_wifi_probe_ms >= 30000) {
        last_wifi_probe_ms = millis();
        if (_wifi_ssid && strlen(_wifi_ssid) > 0) {
          Serial.println("[ConnMgr] SIM mode — probing WiFi...");
          LOG_INFO("ConnMgr", "SIM mode — probing WiFi...");
          if (wifi_connect()) {
            _switch_to_wifi();
          } else {
            Serial.println("[ConnMgr] WiFi still unavailable");
            LOG_INFO("ConnMgr", "WiFi probe failed — staying in SIM mode");
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