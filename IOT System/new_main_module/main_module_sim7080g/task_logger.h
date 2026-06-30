#pragma once
#include <Arduino.h>
#include <esp_task_wdt.h>
#include "ciren_config.h"
#include "system_state.h"

// Forward declarations — avoid circular include dependency.
// Actual definitions are in task_publish.h and task_mqtt_sim.h,
// which are included in the main .ino in the correct order.
void mqtt_publish_raw(const char* topic, const char* payload, int len, int qos);
bool sim_mqtt_publish(const char* topic, const char* payload, uint8_t qos);

// ─────────────────────────────────────────────────────────────────────────────
// Remote Logger — batches log entries and publishes via MQTT to
// ciren/log/{device_id}.  This gives remote visibility into what the
// gateway is doing without needing serial monitor access.
//
// LOG_INFO / LOG_WARN / LOG_ERROR macros enqueue items into a FreeRTOS
// queue.  task_logger drains the queue every LOG_BATCH_MS, builds a JSON
// array, and publishes it on the appropriate path (WiFi or SIM).
//
// If MQTT is disconnected, logs are silently dropped (best-effort).
// Serial.printf is NOT replaced — macros ADD remote logging on top of it.
// ─────────────────────────────────────────────────────────────────────────────

// ── Log levels ────────────────────────────────────────────────────────────────
#define LOG_LEVEL_INFO   0
#define LOG_LEVEL_WARN   1
#define LOG_LEVEL_ERROR  2

static const char* const _log_level_str[] = { "INFO", "WARN", "ERROR" };

// ── Log item struct ───────────────────────────────────────────────────────────
#define LOG_MAX_MSG    128
#define LOG_MAX_TAG    16

typedef struct {
  uint8_t  level;
  uint32_t timestamp_ms;
  char     tag[LOG_MAX_TAG];
  char     msg[LOG_MAX_MSG];
} LogItem;

// ── Queue ─────────────────────────────────────────────────────────────────────
static QueueHandle_t log_queue = NULL;

// ── Init ──────────────────────────────────────────────────────────────────────
void log_queue_init() {
  log_queue = xQueueCreate(LOG_QUEUE_SIZE, sizeof(LogItem));
  if (!log_queue) {
    Serial.println("[LOGGER] Queue create FAILED");
  }
}

// ── Enqueue macros ────────────────────────────────────────────────────────────
// Non-blocking — drops the item if the queue is full.
// Serial output is preserved; these only ADD remote forwarding.

#define LOG_INFO(log_tag, fmt, ...) do {                                         \
  LogItem _li;                                                                   \
  _li.level = LOG_LEVEL_INFO;                                                    \
  _li.timestamp_ms = millis();                                                   \
  strncpy(_li.tag, log_tag, LOG_MAX_TAG); _li.tag[LOG_MAX_TAG - 1] = '\0';     \
  snprintf(_li.msg, LOG_MAX_MSG, fmt, ##__VA_ARGS__);                            \
  xQueueSend(log_queue, &_li, 0);                                                \
} while (0)

#define LOG_WARN(log_tag, fmt, ...) do {                                         \
  LogItem _li;                                                                   \
  _li.level = LOG_LEVEL_WARN;                                                    \
  _li.timestamp_ms = millis();                                                   \
  strncpy(_li.tag, log_tag, LOG_MAX_TAG); _li.tag[LOG_MAX_TAG - 1] = '\0';     \
  snprintf(_li.msg, LOG_MAX_MSG, fmt, ##__VA_ARGS__);                            \
  xQueueSend(log_queue, &_li, 0);                                                \
} while (0)

#define LOG_ERROR(log_tag, fmt, ...) do {                                        \
  LogItem _li;                                                                   \
  _li.level = LOG_LEVEL_ERROR;                                                   \
  _li.timestamp_ms = millis();                                                   \
  strncpy(_li.tag, log_tag, LOG_MAX_TAG); _li.tag[LOG_MAX_TAG - 1] = '\0';     \
  snprintf(_li.msg, LOG_MAX_MSG, fmt, ##__VA_ARGS__);                            \
  xQueueSend(log_queue, &_li, 0);                                                \
} while (0)

// ── Task ──────────────────────────────────────────────────────────────────────
void task_logger(void* param) {
  esp_task_wdt_add(NULL);   // subscribe to Task Watchdog
  static LogItem batch[LOG_MAX_BATCH];             // static — avoids stack overflow
  static char payload[LOG_MAX_BATCH * 200];        // static — avoids stack overflow

  for (;;) {
    esp_task_wdt_reset();   // feed WD at start of every loop — before delays

    vTaskDelay(pdMS_TO_TICKS(LOG_BATCH_MS));

    // Drain up to LOG_MAX_BATCH items from the queue
    uint8_t count = 0;
    while (count < LOG_MAX_BATCH && xQueueReceive(log_queue, &batch[count], 0) == pdTRUE) {
      count++;
    }
    if (count == 0) continue;

    // Check connection
    if (!state_is_connected()) continue;

    // Build JSON array payload
    // Single item → plain JSON object (smaller, backward compatible)
    // Multiple items → JSON array
    // Convert millis()-based timestamps to epoch seconds if NTP synced.
    // Using epoch seconds (not ms) because epoch_ms overflows uint32_t.
    int pos = 0;

    if (count == 1) {
      uint32_t ts = state_epoch_s_at(batch[0].timestamp_ms);
      pos = snprintf(payload, sizeof(payload),
        "{\"device_id\":\"%s\","
        "\"ts\":%lu,"
        "\"level\":\"%s\","
        "\"tag\":\"%s\","
        "\"msg\":\"%s\"}",
        sys_state.device_id,
        (unsigned long)ts,
        _log_level_str[batch[0].level],
        batch[0].tag,
        batch[0].msg
      );
    } else {
      uint32_t ts0 = state_epoch_s_at(batch[0].timestamp_ms);
      pos = snprintf(payload, sizeof(payload),
        "[{\"device_id\":\"%s\","
        "\"ts\":%lu,"
        "\"level\":\"%s\","
        "\"tag\":\"%s\","
        "\"msg\":\"%s\"}",
        sys_state.device_id,
        (unsigned long)ts0,
        _log_level_str[batch[0].level],
        batch[0].tag,
        batch[0].msg
      );
      for (uint8_t i = 1; i < count && pos < (int)sizeof(payload) - 200; i++) {
        uint32_t tsi = state_epoch_s_at(batch[i].timestamp_ms);
        pos += snprintf(payload + pos, sizeof(payload) - pos,
          ",{\"device_id\":\"%s\","
          "\"ts\":%lu,"
          "\"level\":\"%s\","
          "\"tag\":\"%s\","
          "\"msg\":\"%s\"}",
          sys_state.device_id,
          (unsigned long)tsi,
          _log_level_str[batch[i].level],
          batch[i].tag,
          batch[i].msg
        );
      }
      pos += snprintf(payload + pos, sizeof(payload) - pos, "]");
    }

    if (pos <= 0 || pos >= (int)sizeof(payload)) continue;

    // Publish on the appropriate path
    char mode[8];
    xSemaphoreTake(state_mutex, portMAX_DELAY);
    strncpy(mode, sys_state.conn_mode, sizeof(mode));
    xSemaphoreGive(state_mutex);

    esp_task_wdt_reset();   // feed WD before potentially blocking publish

    if (strcmp(mode, "wifi") == 0) {
      // WiFi path — use esp_mqtt_client
      mqtt_publish_raw(sys_state.topic_log, payload, pos, 0);
    } else {
      // SIM path — use AT command MQTT
      sim_mqtt_publish(sys_state.topic_log, payload, 0);
    }
    esp_task_wdt_reset();   // feed watchdog — loop every LOG_BATCH_MS (5s)
  }
}