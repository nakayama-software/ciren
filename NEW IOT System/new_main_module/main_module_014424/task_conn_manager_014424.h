#pragma once
#include <WiFi.h>
#include "ciren_config_014424.h"
#include "system_state_014424.h"
#include "task_publish_014424.h"

static const char* _wifi_ssid     = nullptr;
static const char* _wifi_password = nullptr;
static const char* _mqtt_host     = nullptr;

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

void task_conn_manager(void* param) {
  while (!wifi_connect()) {
    Serial.println("[ConnMgr] WiFi failed, retry in 5s");
    vTaskDelay(pdMS_TO_TICKS(5000));
  }
  mqtt_init(_mqtt_host);

  for (;;) {
    vTaskDelay(pdMS_TO_TICKS(5000));
    if (WiFi.status() != WL_CONNECTED) {
      state_set_connected(false);
      Serial.println("[ConnMgr] WiFi dropped");
      if (!wifi_recover()) {
        Serial.println("[ConnMgr] All retries failed, restarting...");
        vTaskDelay(pdMS_TO_TICKS(1000));
        esp_restart();
      }
    }
    xSemaphoreTake(state_mutex, portMAX_DELAY);
    sys_state.rssi = WiFi.RSSI();
    xSemaphoreGive(state_mutex);
  }
}
