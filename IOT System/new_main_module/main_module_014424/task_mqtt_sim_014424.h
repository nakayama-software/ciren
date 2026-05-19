#pragma once
// ─────────────────────────────────────────────────────────────────────────────
// SIM7080G built-in MQTT client — uses AT+SMCONF/SMCONN/SMPUB/SMSUB/SMDISC.
// No TinyGSM, no raw TCP.
//
// Requires: task_sim_manager_014424.h included first (defines _sim_ser,
//           sim_at_mutex, _sim_sendAT, _sim_atReply, _sim_flush).
//
// Incoming messages (server heartbeat, node config) are detected via
// +SMSUB: URC parsed in the main loop.
// ─────────────────────────────────────────────────────────────────────────────

#include <esp_task_wdt.h>
#include "ciren_config_014424.h"
#include "system_state_014424.h"
#include "task_publish_014424.h"   // for publish_queue + PublishItem

static bool _smq_connected = false;

// ── Static buffers — no heap alloc in hot paths ───────────────────────────────
#define DRAIN_BUF_SIZE  512
#define PUB_RESP_SIZE   256
static char _drain_buf[DRAIN_BUF_SIZE];
static char _pub_resp_buf[PUB_RESP_SIZE];

// ── Parse +SMSUB URC and act ──────────────────────────────────────────────────
// SIM7080G format: +SMSUB: "topic","payload"\r\n
// Payload (JSON) may be on the same line as the header (inside 2nd quote pair)
// or on a separate line. Handle both.
// buf is a static char array; we build a String here just once for substr ops.
static void _smq_process_urcs(const char* cbuf, int clen) {
  if (clen == 0) return;
  const String buf(cbuf);  // single allocation from known-size buffer

  // Server heartbeat — topic appears in buf (quick scan, no full MQTT parse)
  if (buf.indexOf(TOPIC_SERVER_HB) >= 0) {
    xSemaphoreTake(state_mutex, portMAX_DELAY);
    sys_state.server_hb_ms = millis();
    xSemaphoreGive(state_mutex);
    state_set_connected(true);
    Serial.println("[SIM MQTT] Server heartbeat");
  }

  // Config: look for +SMSUB: with the config topic
  int sub_idx = buf.indexOf("+SMSUB:");
  while (sub_idx >= 0) {
    int nl = buf.indexOf('\n', sub_idx);
    if (nl < 0) break;

    String header  = buf.substring(sub_idx, nl);
    String nextLine = buf.substring(nl + 1);
    nextLine.trim();

    // Extract topic from first quoted string
    int q1 = header.indexOf('"');
    int q2 = header.indexOf('"', q1 + 1);
    if (q1 >= 0 && q2 > q1) {
      String topic = header.substring(q1 + 1, q2);

      if (topic == String(sys_state.topic_config)) {
        // Extract payload JSON: find { ... } on the SAME line (SIM7080G format)
        // or fall back to the next line
        String payload;
        int json_start = header.indexOf('{', q2 + 1);
        int json_end   = header.lastIndexOf('}');
        if (json_start >= 0 && json_end > json_start) {
          payload = header.substring(json_start, json_end + 1);
        } else {
          payload = nextLine;
        }

        if (payload.indexOf("set_node_interval") >= 0) {
          int ctrl_id = 0, port_num = 0;
          uint32_t interval_ms = 0;
          const char* p = payload.c_str();
          const char* q;
          if ((q = strstr(p, "\"ctrl_id\":")))     ctrl_id     = atoi(q + 10);
          if ((q = strstr(p, "\"port_num\":")))    port_num    = atoi(q + 11);
          if ((q = strstr(p, "\"interval_ms\":"))) interval_ms = (uint32_t)atoi(q + 14);
          if (ctrl_id > 0 && port_num > 0 && interval_ms > 0) {
            nc_set((uint8_t)ctrl_id, (uint8_t)port_num, interval_ms);
          }
        }
      }
    }

    // Look for next +SMSUB: in remaining buffer
    sub_idx = buf.indexOf("+SMSUB:", sub_idx + 7);
  }

  // Detect remote disconnect URC
  if (buf.indexOf("+SMSTATE: 0") >= 0) {
    _smq_connected = false;
    state_set_connected(false);
    Serial.println("[SIM MQTT] Remote disconnect detected");
  }
}

// ── Drain any available bytes from Serial2 into _drain_buf, return length ──────
// Uses static buffer — no heap allocation in this hot path (called every 100ms).
static int _smq_drain() {
  int len = 0;
  uint32_t t = millis();
  uint32_t last_byte_ms = t;
  while (millis() - t < 500 && len < DRAIN_BUF_SIZE - 1) {
    while (_sim_ser.available() && len < DRAIN_BUF_SIZE - 1) {
      _drain_buf[len++] = (char)_sim_ser.read();
      last_byte_ms = millis();
    }
    if (len > 0 && (millis() - last_byte_ms) > 80) break;
    if (len == 0 && (millis() - t) > 200) break;
    delay(5);
  }
  _drain_buf[len] = '\0';
  return len;
}

// ── Connect to MQTT broker using SIM7080G AT+SMCONF / AT+SMCONN ───────────────
static bool _smq_connect() {
  char buf[128];

  // Configure client
  snprintf(buf, sizeof(buf), "AT+SMCONF=\"CLIENTID\",\"%s-sim\"", sys_state.device_id);
  if (!_sim_sendAT(buf)) return false;

  snprintf(buf, sizeof(buf), "AT+SMCONF=\"URL\",\"%s\",%d",
           sys_state.mqtt_host, MQTT_PORT);
  if (!_sim_sendAT(buf)) return false;

  snprintf(buf, sizeof(buf), "AT+SMCONF=\"KEEPTIME\",%d", MQTT_KEEPALIVE);
  _sim_sendAT(buf);

  _sim_sendAT("AT+SMCONF=\"CLEANSS\",1");   // clean session

  // Connect (can take up to 60s on first attempt)
  Serial.printf("[SIM MQTT] Connecting to %s:%d ...\n",
                sys_state.mqtt_host, MQTT_PORT);
  if (!_sim_sendAT("AT+SMCONN", "OK", 60000)) {
    Serial.println("[SIM MQTT] SMCONN failed");
    return false;
  }

  // Subscribe: server heartbeat (QoS 0) + config topic (QoS 1)
  snprintf(buf, sizeof(buf), "AT+SMSUB=\"%s\",0", TOPIC_SERVER_HB);
  _sim_sendAT(buf);
  snprintf(buf, sizeof(buf), "AT+SMSUB=\"%s\",1", sys_state.topic_config);
  _sim_sendAT(buf);

  Serial.println("[SIM MQTT] Connected, subscribed");
  return true;
}

// ── Disconnect ────────────────────────────────────────────────────────────────
static void _smq_disconnect() {
  _sim_sendAT("AT+SMDISC", "OK", 5000);
  _smq_connected = false;
}

// ── Publish one item via AT+SMPUB ─────────────────────────────────────────────
// AT+SMPUB="topic",len,qos,retained
// Modem responds with ">" prompt, then send exactly len bytes of payload.
static bool _smq_pub(const char* topic, const char* payload, int len, uint8_t qos) {
  char cmd[128];
  snprintf(cmd, sizeof(cmd), "AT+SMPUB=\"%s\",%d,%d,0", topic, len, (int)qos);

  _sim_flush();
  _sim_ser.println(cmd);

  // Wait for ">" prompt — use static buffer, no heap alloc
  uint32_t t = millis();
  int rlen = 0;
  bool got_prompt = false;
  while (millis() - t < 5000 && rlen < PUB_RESP_SIZE - 1) {
    while (_sim_ser.available() && rlen < PUB_RESP_SIZE - 1)
      _pub_resp_buf[rlen++] = (char)_sim_ser.read();
    _pub_resp_buf[rlen] = '\0';
    if (strchr(_pub_resp_buf, '>'))        { got_prompt = true; break; }
    if (strstr(_pub_resp_buf, "ERROR"))    return false;
    delay(10);
  }
  if (!got_prompt) { Serial.println("[SIM MQTT] No > prompt"); return false; }

  // Send exactly len bytes (no extra newline — modem counts bytes)
  _sim_ser.write((const uint8_t*)payload, len);

  // Wait for OK (or +SMPUB: msgid confirmation for QoS 1)
  t = millis();
  rlen = 0;
  while (millis() - t < 10000 && rlen < PUB_RESP_SIZE - 1) {
    while (_sim_ser.available() && rlen < PUB_RESP_SIZE - 1)
      _pub_resp_buf[rlen++] = (char)_sim_ser.read();
    _pub_resp_buf[rlen] = '\0';
    if (strstr(_pub_resp_buf, "OK") || strstr(_pub_resp_buf, "+SMPUB:")) return true;
    if (strstr(_pub_resp_buf, "ERROR")) return false;
    delay(10);
  }
  return false;
}

// ── Public: publish from external task (takes mutex) ─────────────────────────
bool sim_mqtt_publish(const char* topic, const char* payload, uint8_t qos) {
  if (!_smq_connected) return false;
  if (xSemaphoreTake(sim_at_mutex, pdMS_TO_TICKS(5000)) != pdTRUE) return false;
  bool ok = _smq_pub(topic, payload, (int)strlen(payload), qos);
  xSemaphoreGive(sim_at_mutex);
  return ok;
}

void mqtt_sim_init() { /* no state to init */ }

// ── Main task ─────────────────────────────────────────────────────────────────
void mqtt_sim_task(void* param) {
  esp_task_wdt_add(NULL);  // register with hardware watchdog
  for (;;) {
    esp_task_wdt_reset();
    // Only active when SIM mode + GPRS ready
    if (!sys_state.sim_enabled || !sys_state.sim_gprs) {
      if (_smq_connected) {
        xSemaphoreTake(sim_at_mutex, portMAX_DELAY);
        _smq_disconnect();
        xSemaphoreGive(sim_at_mutex);
      }
      vTaskDelay(pdMS_TO_TICKS(5000));
      continue;
    }

    char mode[8];
    xSemaphoreTake(state_mutex, portMAX_DELAY);
    strncpy(mode, sys_state.conn_mode, sizeof(mode));
    xSemaphoreGive(state_mutex);

    if (strcmp(mode, "sim") != 0) {
      if (_smq_connected) {
        xSemaphoreTake(sim_at_mutex, portMAX_DELAY);
        _smq_disconnect();
        xSemaphoreGive(sim_at_mutex);
      }
      vTaskDelay(pdMS_TO_TICKS(5000));
      continue;
    }

    // ── (Re)connect ───────────────────────────────────────────────────────────
    if (!_smq_connected) {
      state_set_connected(false);
      // Reset WDT before long sequence: mutex wait (up to 65s) + AT+SMCONN (up to 60s)
      esp_task_wdt_reset();
      if (xSemaphoreTake(sim_at_mutex, pdMS_TO_TICKS(65000)) == pdTRUE) {
        if (_smq_connect()) {
          _smq_connected = true;
        }
        xSemaphoreGive(sim_at_mutex);
      }
      if (!_smq_connected) {
        vTaskDelay(pdMS_TO_TICKS(10000));
        continue;
      }
    }

    // ── Server heartbeat timeout ──────────────────────────────────────────────
    {
      xSemaphoreTake(state_mutex, portMAX_DELAY);
      uint32_t hb_ms = sys_state.server_hb_ms;
      xSemaphoreGive(state_mutex);
      if (hb_ms > 0 && (millis() - hb_ms) > SERVER_HB_TIMEOUT_MS) {
        state_set_connected(false);
      }
    }

    // ── Drain incoming URCs (non-blocking, short mutex hold) ─────────────────
    if (xSemaphoreTake(sim_at_mutex, pdMS_TO_TICKS(100)) == pdTRUE) {
      int n = _smq_drain();
      xSemaphoreGive(sim_at_mutex);
      if (n > 0) _smq_process_urcs(_drain_buf, n);
    }

    // ── Drain publish queue (up to 16 items per cycle) ────────────────────────
    PublishItem item;
    int drained = 0;
    while (drained < 16 && xQueueReceive(publish_queue, &item, 0) == pdTRUE) {
      if (xSemaphoreTake(sim_at_mutex, pdMS_TO_TICKS(12000)) == pdTRUE) {
        bool ok = _smq_pub(item.topic, item.payload, item.len, item.qos);
        xSemaphoreGive(sim_at_mutex);
        if (!ok) {
          xQueueSendToFront(publish_queue, &item, 0);
          _smq_connected = false;
          state_set_connected(false);
          Serial.println("[SIM MQTT] Publish failed — will reconnect");
          break;
        }
        xSemaphoreTake(state_mutex, portMAX_DELAY);
        sys_state.last_publish_ms = millis();
        xSemaphoreGive(state_mutex);
        drained++;
      }
    }

    vTaskDelay(pdMS_TO_TICKS(100));
  }
}
