#pragma once
#include <WiFi.h>
#include <mqtt_client.h>
#include "ciren_config_014424.h"
#include "system_state_014424.h"

QueueHandle_t publish_queue = NULL;

#define PQ_MAX_PAYLOAD 512

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
      // Hanya update connected state jika sedang dalam WiFi mode
      if (strcmp(sys_state.conn_mode, "wifi") == 0) {
        state_set_connected(true);
      }
      esp_mqtt_client_subscribe(mqtt_client, TOPIC_CONFIG, MQTT_QOS);
      Serial.println("[MQTT] Connected");
      break;
    case MQTT_EVENT_DISCONNECTED:
      // Hanya clear connected state jika sedang dalam WiFi mode
      if (strcmp(sys_state.conn_mode, "wifi") == 0) {
        state_set_connected(false);
      }
      Serial.println("[MQTT] Disconnected");
      break;
    default: break;
  }
}

// Dipanggil dari setup() sebelum task apapun dibuat
void publish_queue_init() {
  // FIX Bug 2: naikkan queue dari 8 ke 32 slot
  // 8 slot terlalu kecil — aggregator bisa drain 64 item per window
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
  cfg.credentials.client_id     = DEVICE_ID;
#else
  cfg.host      = broker_host;
  cfg.port      = MQTT_PORT;
  cfg.transport = MQTT_TRANSPORT_OVER_TCP;
  cfg.keepalive = MQTT_KEEPALIVE;
  cfg.client_id = DEVICE_ID;
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
      if (xQueueReceive(publish_queue, &item, portMAX_DELAY) == pdTRUE) {
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