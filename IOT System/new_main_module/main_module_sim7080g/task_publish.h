#pragma once
#include <WiFi.h>
#include <mqtt_client.h>
#include <esp_task_wdt.h>
#include "ciren_config.h"
#include "system_state.h"
#include "task_logger.h"

QueueHandle_t publish_queue = NULL;

#define PQ_MAX_PAYLOAD 1024

typedef struct {
  char     topic[64];
  char     payload[PQ_MAX_PAYLOAD];
  uint16_t len;
  uint8_t  qos;   // 0 = fire-and-forget, 1 = confirmed
} PublishItem;

static esp_mqtt_client_handle_t mqtt_client = NULL;

static void mqtt_event_handler(void* arg, esp_event_base_t base,
                                int32_t event_id, void* event_data) {
  esp_mqtt_event_handle_t ev = (esp_mqtt_event_handle_t)event_data;
  switch (ev->event_id) {
    case MQTT_EVENT_CONNECTED:
      // connected state sekarang ditentukan oleh heartbeat server, bukan MQTT broker connect
      esp_mqtt_client_subscribe(mqtt_client, sys_state.topic_config, MQTT_QOS);
      esp_mqtt_client_subscribe(mqtt_client, TOPIC_SERVER_HB, 0);
      Serial.println("[MQTT] Connected — waiting for server heartbeat");
      LOG_INFO("MQTT", "Broker connected — waiting for server heartbeat");
      break;
    case MQTT_EVENT_DISCONNECTED:
      {
        char mode[8];
        xSemaphoreTake(state_mutex, portMAX_DELAY);
        strncpy(mode, sys_state.conn_mode, sizeof(mode));
        xSemaphoreGive(state_mutex);
        if (strcmp(mode, "wifi") == 0) {
          state_set_connected(false);
          xSemaphoreTake(state_mutex, portMAX_DELAY);
          sys_state.server_hb_ms = 0;
          xSemaphoreGive(state_mutex);
        }
      }
      Serial.println("[MQTT] Disconnected");
      LOG_WARN("MQTT", "Broker disconnected");
      break;
    case MQTT_EVENT_DATA:
      // Cek apakah ini heartbeat dari server
      if (ev->topic_len > 0 &&
          strncmp(ev->topic, TOPIC_SERVER_HB, ev->topic_len) == 0) {
        xSemaphoreTake(state_mutex, portMAX_DELAY);
        sys_state.server_hb_ms = millis();
        xSemaphoreGive(state_mutex);
        char hb_mode[8];
        xSemaphoreTake(state_mutex, portMAX_DELAY);
        strncpy(hb_mode, sys_state.conn_mode, sizeof(hb_mode));
        xSemaphoreGive(state_mutex);
        if (strcmp(hb_mode, "wifi") == 0) {
          state_set_connected(true);
        }
        Serial.println("[MQTT] Server heartbeat received");
        LOG_INFO("MQTT", "Server heartbeat received");
      }
      // Cek apakah ini config dari server: {"action":"set_node_interval",...}
      else if (ev->topic_len > 0 &&
               ev->topic_len == (int)strlen(sys_state.topic_config) &&
               strncmp(ev->topic, sys_state.topic_config, ev->topic_len) == 0) {
        char buf[256];
        int plen = (ev->data_len < (int)sizeof(buf) - 1) ? ev->data_len : (int)sizeof(buf) - 1;
        memcpy(buf, ev->data, plen);
        buf[plen] = '\0';

        if (strstr(buf, "\"reboot\"")) {
          Serial.println("[MQTT] Remote reboot command — restarting in 500ms");
          LOG_WARN("MQTT", "Remote reboot command received");
          vTaskDelay(pdMS_TO_TICKS(500));
          esp_restart();
        } else if (strstr(buf, "\"set_node_interval\"")) {
          int ctrl_id = 0, port_num = 0;
          uint32_t interval_ms = 0;
          const char* p;
          if ((p = strstr(buf, "\"ctrl_id\":")))    ctrl_id     = atoi(p + 10);
          if ((p = strstr(buf, "\"port_num\":")))   port_num    = atoi(p + 11);
          if ((p = strstr(buf, "\"interval_ms\":"))) interval_ms = (uint32_t)atoi(p + 14);
          if (ctrl_id > 0 && port_num > 0 && interval_ms > 0) {
            Serial.printf("[MQTT] set_node_interval: ctrl=%d port=%d interval=%lu ms\n", ctrl_id, port_num, interval_ms);
            LOG_INFO("MQTT", "set_node_interval: ctrl=%d port=%d interval=%lu ms", ctrl_id, port_num, interval_ms);
            nc_set((uint8_t)ctrl_id, (uint8_t)port_num, interval_ms);
          } else {
            Serial.printf("[MQTT] Bad set_node_interval payload: %s\n", buf);
            LOG_WARN("MQTT", "Bad set_node_interval payload: %s", buf);
          }
        }
      }
      break;
    default: break;
  }
}

// Dipanggil dari setup() sebelum task apapun dibuat
void publish_queue_init() {
  publish_queue = xQueueCreate(64, sizeof(PublishItem));
  if (!publish_queue) {
    Serial.println("[PUBLISH] Queue create FAILED");
    LOG_ERROR("PUBLISH", "Queue create FAILED");
  }
}

void mqtt_init(const char* broker_host) {
  esp_mqtt_client_config_t cfg = {};

#if defined(ESP_ARDUINO_VERSION_MAJOR) && (ESP_ARDUINO_VERSION_MAJOR >= 3)
  cfg.broker.address.hostname  = broker_host;
  cfg.broker.address.port      = MQTT_PORT;
  cfg.broker.address.transport = MQTT_TRANSPORT_OVER_TCP;
  cfg.session.keepalive         = MQTT_KEEPALIVE;
  cfg.credentials.client_id     = sys_state.device_id;
#else
  cfg.host      = broker_host;
  cfg.port      = MQTT_PORT;
  cfg.transport = MQTT_TRANSPORT_OVER_TCP;
  cfg.keepalive = MQTT_KEEPALIVE;
  cfg.client_id = sys_state.device_id;
#endif

  mqtt_client = esp_mqtt_client_init(&cfg);
  esp_mqtt_client_register_event(mqtt_client, MQTT_EVENT_ANY,
                                  mqtt_event_handler, NULL);
  esp_mqtt_client_start(mqtt_client);
  LOG_INFO("MQTT", "Client initialized, host=%s port=%d", broker_host, MQTT_PORT);
}

void mqtt_publish_raw(const char* topic, const char* payload, int len, int qos = MQTT_QOS) {
  if (!mqtt_client) return;
  int msg_id = esp_mqtt_client_publish(mqtt_client, topic, payload, len, qos, 0);
  if (msg_id < 0) {
    Serial.printf("[PUBLISH] publish failed topic=%s\n", topic);
    LOG_ERROR("MQTT", "Publish failed, msg_id=%d", msg_id);
  }
}

void task_publish(void* param) {
  esp_task_wdt_add(NULL);   // subscribe to Task Watchdog
  PublishItem item;
  for (;;) {
    // Only process MQTT when in WiFi mode
    char current_mode[8];
    xSemaphoreTake(state_mutex, portMAX_DELAY);
    strncpy(current_mode, sys_state.conn_mode, sizeof(current_mode));
    xSemaphoreGive(state_mutex);

    if (strcmp(current_mode, "wifi") == 0) {
      // Cek heartbeat timeout — anggap server offline jika tidak ada HB > timeout
      xSemaphoreTake(state_mutex, portMAX_DELAY);
      uint32_t hb_ms = sys_state.server_hb_ms;
      xSemaphoreGive(state_mutex);
      if (hb_ms > 0 && (millis() - hb_ms) > SERVER_HB_TIMEOUT_MS) {
        state_set_connected(false);
        xSemaphoreTake(state_mutex, portMAX_DELAY);
        sys_state.server_hb_ms = 0;   // clear stale timestamp
        xSemaphoreGive(state_mutex);
        LOG_WARN("MQTT", "Server heartbeat timeout — disconnecting");
      }

      if (xQueueReceive(publish_queue, &item, pdMS_TO_TICKS(5000)) == pdTRUE) {
        if (!state_is_connected()) {
          // Not connected — check if queue is nearly full (stale data)
          // If offline for a long time, queued data is stale and should be flushed
          // to prevent memory pressure and ensure fresh data gets through on reconnect.
          UBaseType_t queued = uxQueueMessagesWaiting(publish_queue);
          if (queued >= 48) {
            // Queue is nearly full — flush all items (stale data)
            PublishItem _flush;
            uint16_t flushed = 1;  // include the item we just dequeued
            while (xQueueReceive(publish_queue, &_flush, 0) == pdTRUE) flushed++;
            Serial.printf("[MQTT] Flushed %u stale items (queue was %u/64)\n", flushed, queued + 1);
            LOG_WARN("MQTT", "Flushed %u stale items (queue was %u/64)", flushed, queued + 1);
          } else {
            // Queue not full yet — put item back and wait for reconnect
            xQueueSendToFront(publish_queue, &item, 0);
            vTaskDelay(pdMS_TO_TICKS(1000));
          }
        } else {
          mqtt_publish_raw(item.topic, item.payload, item.len, item.qos);
          xSemaphoreTake(state_mutex, portMAX_DELAY);
          sys_state.last_publish_ms = millis();
          xSemaphoreGive(state_mutex);
        }
      }
    } else {
      // In SIM mode, just delay to prevent hogging CPU
      vTaskDelay(pdMS_TO_TICKS(100));
    }
    esp_task_wdt_reset();   // feed watchdog every loop iteration
  }
}