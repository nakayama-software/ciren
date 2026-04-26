#pragma once
#include <WiFi.h>
#include <mqtt_client.h>
#include "ciren_config.h"
#include "system_state.h"

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
      break;
    case MQTT_EVENT_DISCONNECTED:
      if (strcmp(sys_state.conn_mode, "wifi") == 0) {
        state_set_connected(false);
        xSemaphoreTake(state_mutex, portMAX_DELAY);
        sys_state.server_hb_ms = 0;
        xSemaphoreGive(state_mutex);
      }
      Serial.println("[MQTT] Disconnected");
      break;
    case MQTT_EVENT_DATA:
      // Cek apakah ini heartbeat dari server
      if (ev->topic_len > 0 &&
          strncmp(ev->topic, TOPIC_SERVER_HB, ev->topic_len) == 0) {
        xSemaphoreTake(state_mutex, portMAX_DELAY);
        sys_state.server_hb_ms = millis();
        xSemaphoreGive(state_mutex);
        if (strcmp(sys_state.conn_mode, "wifi") == 0) {
          state_set_connected(true);
        }
        Serial.println("[MQTT] Server heartbeat received");
      }
      // Cek apakah ini config dari server: {"action":"set_node_interval",...}
      else if (ev->topic_len > 0 &&
               ev->topic_len == (int)strlen(sys_state.topic_config) &&
               strncmp(ev->topic, sys_state.topic_config, ev->topic_len) == 0) {
        char buf[256];
        int plen = (ev->data_len < (int)sizeof(buf) - 1) ? ev->data_len : (int)sizeof(buf) - 1;
        memcpy(buf, ev->data, plen);
        buf[plen] = '\0';

        if (strstr(buf, "\"set_node_interval\"")) {
          int ctrl_id = 0, port_num = 0;
          uint32_t interval_ms = 0;
          const char* p;
          if ((p = strstr(buf, "\"ctrl_id\":")))    ctrl_id     = atoi(p + 10);
          if ((p = strstr(buf, "\"port_num\":")))   port_num    = atoi(p + 11);
          if ((p = strstr(buf, "\"interval_ms\":"))) interval_ms = (uint32_t)atoi(p + 14);
          if (ctrl_id > 0 && port_num > 0 && interval_ms > 0) {
            nc_set((uint8_t)ctrl_id, (uint8_t)port_num, interval_ms);
          } else {
            Serial.printf("[MQTT] Bad set_node_interval payload: %s\n", buf);
          }
        }
      }
      break;
    default: break;
  }
}

// Dipanggil dari setup() sebelum task apapun dibuat
void publish_queue_init() {
  publish_queue = xQueueCreate(32, sizeof(PublishItem));
  if (!publish_queue) {
    Serial.println("[PUBLISH] Queue create FAILED");
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
}

void mqtt_publish_raw(const char* topic, const char* payload, int len, int qos = MQTT_QOS) {
  if (!mqtt_client) return;
  int msg_id = esp_mqtt_client_publish(mqtt_client, topic, payload, len, qos, 0);
  if (msg_id < 0) {
    Serial.printf("[PUBLISH] publish failed topic=%s\n", topic);
  }
}

void task_publish(void* param) {
  PublishItem item;
  for (;;) {
    // Only process MQTT when in WiFi mode
    if (strcmp(sys_state.conn_mode, "wifi") == 0) {
      // Cek heartbeat timeout — anggap server offline jika tidak ada HB > 60s
      xSemaphoreTake(state_mutex, portMAX_DELAY);
      uint32_t hb_ms = sys_state.server_hb_ms;
      xSemaphoreGive(state_mutex);
      if (hb_ms > 0 && (millis() - hb_ms) > SERVER_HB_TIMEOUT_MS) {
        state_set_connected(false);
      }

      if (xQueueReceive(publish_queue, &item, pdMS_TO_TICKS(5000)) == pdTRUE) {
        if (!state_is_connected()) {
          // Kembalikan ke depan queue, tunggu reconnect
          xQueueSendToFront(publish_queue, &item, 0);
          vTaskDelay(pdMS_TO_TICKS(1000));
          continue;
        }
        mqtt_publish_raw(item.topic, item.payload, item.len, item.qos);
        xSemaphoreTake(state_mutex, portMAX_DELAY);
        sys_state.last_publish_ms = millis();
        xSemaphoreGive(state_mutex);
      }
    } else {
      // In SIM mode, just delay to prevent hogging CPU
      vTaskDelay(pdMS_TO_TICKS(100));
    }
  }
}