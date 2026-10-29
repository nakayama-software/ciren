#pragma once
// ─────────────────────────────────────────────────────────────────────────────
// SIM7600X MQTT client — uses AT+CMQTT* built-in commands.
// No TinyGSM, no raw TCP.
//
// AT+CMQTT* command flow:
//   AT+CMQTTSTART                       → start MQTT service
//   AT+CMQTTACCSTART=0,"client_id"      → create client (index 0)
//   AT+CMQTTCONNECT=0,"host",port,keep   → connect broker
//   AT+CMQTTSUB=0,"topic",qos            → subscribe
//   AT+CMQTTTOPIC=0,len → > → topic     → set publish topic
//   AT+CMQTTPAYLOAD=0,len → > → payload → set publish payload
//   AT+CMQTTPUB=0,qos,retain             → publish
//   AT+CMQTTDISC=0                       → disconnect
//   AT+CMQTTACCRELEASE=0                 → release client
//   AT+CMQTTSTOP                         → stop service
//
// Requires: task_sim_manager.h included first (defines _sim_ser,
//           sim_at_mutex, _sim_sendAT, _sim_atReply, _sim_flush).
//
// Incoming messages (server heartbeat, node config) are detected via
// +CMQTTRX: URC parsed in the main task loop.
// ─────────────────────────────────────────────────────────────────────────────

#include "ciren_config.h"
#include "system_state.h"
#include "task_publish.h"   // for publish_queue + PublishItem

static bool _smq_connected = false;
static bool _smq_service_started = false;

// ── Parse +CMQTTRX URC and act ────────────────────────────────────────────────
// URC format: +CMQTTRX: <client_idx>,<topic_len>,<payload_len>\r\n<topic>\r\n<payload>
static void _smq_process_urcs(const String& buf) {
  if (buf.length() == 0) return;

  // Debug: show received URC data (truncated to avoid spam)
  if (buf.indexOf("+CMQTTRX:") >= 0) {
    Serial.printf("[SIM MQTT] URC received (%d bytes): %.120s\n", buf.length(), buf.c_str());
  }

  // Server heartbeat — topic appears in buf (quick scan)
  if (buf.indexOf(TOPIC_SERVER_HB) >= 0) {
    xSemaphoreTake(state_mutex, portMAX_DELAY);
    sys_state.server_hb_ms = millis();
    xSemaphoreGive(state_mutex);
    state_set_connected(true);
    Serial.println("[SIM MQTT] Server heartbeat");
  }

  // Config: look for +CMQTTRX: with the config topic
  int rx_idx = buf.indexOf("+CMQTTRX:");
  while (rx_idx >= 0) {
    // Find the payload section after the header line
    int nl = buf.indexOf('\n', rx_idx);
    if (nl < 0) break;

    // The next lines contain topic and payload
    // +CMQTTRX: 0,<topic_len>,<payload_len>\r\n<topic>\r\n<payload>
    // For simplicity, scan the entire remaining buffer for our config topic
    String remainder = buf.substring(rx_idx);

    if (remainder.indexOf(sys_state.topic_config) >= 0) {
      // Find the JSON payload after the topic
      int json_start = remainder.indexOf('{');
      if (json_start >= 0) {
        String payload = remainder.substring(json_start);
        // Truncate at next URC or end
        int next_urc = payload.indexOf("+CMQTTRX:");
        if (next_urc > 0) payload = payload.substring(0, next_urc);
        payload.trim();

        if (payload.indexOf("set_node_interval") >= 0) {
          int ctrl_id = 0, port_num = 0;
          uint32_t interval_ms = 0;
          const char* p = payload.c_str();
          const char* q;
          if ((q = strstr(p, "\"ctrl_id\":")))     ctrl_id     = atoi(q + 10);
          if ((q = strstr(p, "\"port_num\":")))    port_num    = atoi(q + 11);
          if ((q = strstr(p, "\"interval_ms\":"))) interval_ms = (uint32_t)atoi(q + 14);
          if (ctrl_id > 0 && port_num > 0 && interval_ms > 0) {
            Serial.printf("[SIM MQTT] set_node_interval: ctrl=%d port=%d interval=%lu ms\n",
                          ctrl_id, port_num, interval_ms);
            nc_set((uint8_t)ctrl_id, (uint8_t)port_num, interval_ms);
          } else {
            Serial.printf("[SIM MQTT] Bad set_node_interval payload: %s\n", payload.c_str());
          }
        }
      }
    }

    // Look for next +CMQTTRX: in remaining buffer
    rx_idx = buf.indexOf("+CMQTTRX:", rx_idx + 9);
  }

  // Detect remote disconnect URC
  if (buf.indexOf("+CMQTTDISC:") >= 0 || buf.indexOf("+CMQTTCONNLOST:") >= 0) {
    _smq_connected = false;
    state_set_connected(false);
    Serial.println("[SIM MQTT] Remote disconnect detected");
  }
}

// ── Drain any available bytes from Serial2, return as String ──────────────────
static String _smq_drain() {
  String buf = "";
  uint32_t t = millis();
  uint32_t last_byte_ms = millis();
  while (millis() - t < 500) {
    while (_sim_ser.available()) {
      buf += (char)_sim_ser.read();
      last_byte_ms = millis();
    }
    // If we received data, wait 80ms of silence before concluding
    if (buf.length() > 0 && (millis() - last_byte_ms) > 80) break;
    // If no data at all after 200ms, give up
    if (buf.length() == 0 && (millis() - t) > 200) break;
    delay(5);
  }
  return buf;
}

// ── Wait for prompt ">" from modem ─────────────────────────────────────────────
static bool _smq_wait_prompt(uint32_t ms = 5000) {
  uint32_t t = millis();
  String r = "";
  while (millis() - t < ms) {
    while (_sim_ser.available()) r += (char)_sim_ser.read();
    if (r.indexOf('>') >= 0) return true;
    if (r.indexOf("ERROR") >= 0) return false;
    delay(10);
  }
  return false;
}

// Include raw TCP MQTT after _smq_wait_prompt is defined — it needs that function
#include "mqtt_raw_tcp.h"

// ── Connect to MQTT broker using SIM7600X AT+CMQTT* ────────────────────────────
static bool _smq_connect() {
  char buf[128];

  // Clean up any previous MQTT session first (all verbose to see responses)
  Serial.println("[SIM MQTT] === Starting MQTT connect sequence ===");
  snprintf(buf, sizeof(buf), "AT+CMQTTDISC=%d,0", SIM_MQTT_CLIENT_IDX);
  _sim_sendAT(buf, "OK", 3000, true);
  snprintf(buf, sizeof(buf), "AT+CMQTTACCRELEASE=%d", SIM_MQTT_CLIENT_IDX);
  _sim_sendAT(buf, "OK", 3000, true);
  _sim_sendAT("AT+CMQTTSTOP", "OK", 3000, true);
  delay(500);

  // Start MQTT service
  if (!_sim_sendAT("AT+CMQTTSTART", "OK", 5000, true)) {
    // May already be started — try to recover
    Serial.println("[SIM MQTT] CMQTTSTART failed — forcing stop/restart");
    _sim_sendAT("AT+CMQTTSTOP", "OK", 3000, true);
    delay(1000);
    if (!_sim_sendAT("AT+CMQTTSTART", "OK", 5000, true)) {
      Serial.println("[SIM MQTT] CMQTTSTART failed after restart");

      // CMQTT* may not work with NETOPEN — try raw TCP fallback
      Serial.println("[SIM MQTT] CMQTT unavailable — NETOPEN may not support it");
      return false;
    }
  }
  _smq_service_started = true;

  // Create client
  snprintf(buf, sizeof(buf), "AT+CMQTTACCSTART=%d,\"%s-sim\"", SIM_MQTT_CLIENT_IDX, sys_state.device_id);
  if (!_sim_sendAT(buf, "OK", 5000, true)) {
    Serial.printf("[SIM MQTT] ACCSTART failed (device_id=%s)\n", sys_state.device_id);
    // Client 0 may still be occupied — force release and retry
    snprintf(buf, sizeof(buf), "AT+CMQTTACCRELEASE=%d", SIM_MQTT_CLIENT_IDX);
    _sim_sendAT(buf, "OK", 3000, true);
    delay(500);
    snprintf(buf, sizeof(buf), "AT+CMQTTACCSTART=%d,\"%s-sim\"", SIM_MQTT_CLIENT_IDX, sys_state.device_id);
    if (!_sim_sendAT(buf, "OK", 5000, true)) {
      Serial.println("[SIM MQTT] ACCSTART retry failed");
      return false;
    }
  }

  // Connect to broker
  snprintf(buf, sizeof(buf), "AT+CMQTTCONNECT=%d,\"%s\",%d,%d",
           SIM_MQTT_CLIENT_IDX, sys_state.mqtt_host, MQTT_PORT, MQTT_KEEPALIVE);
  Serial.printf("[SIM MQTT] Connecting to %s:%d ...\n", sys_state.mqtt_host, MQTT_PORT);
  if (!_sim_sendAT(buf, "OK", 60000)) {
    Serial.println("[SIM MQTT] CONNECT failed");
    return false;
  }

  // Wait for connection confirmation URC: +CMQTTCONNLOST or connected state
  // AT+CMQTTCONNECT returns OK quickly; connection confirmed by no error

  // Subscribe: server heartbeat (QoS 0) + config topic (QoS 1)
  Serial.printf("[SIM MQTT] topic_config = \"%s\"\n", sys_state.topic_config);
  snprintf(buf, sizeof(buf), "AT+CMQTTSUB=%d,\"%s\",0", SIM_MQTT_CLIENT_IDX, TOPIC_SERVER_HB);
  bool hb_ok = _sim_sendAT(buf);
  Serial.printf("[SIM MQTT] Subscribe HB: %s\n", hb_ok ? "OK" : "FAIL");

  snprintf(buf, sizeof(buf), "AT+CMQTTSUB=%d,\"%s\",1", SIM_MQTT_CLIENT_IDX, sys_state.topic_config);
  bool cfg_ok = _sim_sendAT(buf);
  Serial.printf("[SIM MQTT] Subscribe config: %s\n", cfg_ok ? "OK" : "FAIL");

  Serial.println("[SIM MQTT] Connected, subscribed");
  return true;
}

// ── Disconnect ────────────────────────────────────────────────────────────────
static void _smq_disconnect() {
  char buf[64];
  snprintf(buf, sizeof(buf), "AT+CMQTTDISC=%d,0", SIM_MQTT_CLIENT_IDX);
  _sim_sendAT(buf, "OK", 5000);
  snprintf(buf, sizeof(buf), "AT+CMQTTACCRELEASE=%d", SIM_MQTT_CLIENT_IDX);
  _sim_sendAT(buf, "OK", 3000);
  _sim_sendAT("AT+CMQTTSTOP", "OK", 3000);
  _smq_connected = false;
  _smq_service_started = false;
}

// ── Publish one item via AT+CMQTTTOPIC + CMQTTPAYLOAD + CMQTTPUB ──────────────
static bool _smq_pub(const char* topic, const char* payload, int len, uint8_t qos) {
  char cmd[128];

  // Step 1: Set topic
  snprintf(cmd, sizeof(cmd), "AT+CMQTTTOPIC=%d,%d", SIM_MQTT_CLIENT_IDX, (int)strlen(topic));
  _sim_flush();
  _sim_ser.println(cmd);
  if (!_smq_wait_prompt(5000)) {
    Serial.println("[SIM MQTT] No > prompt for topic");
    return false;
  }
  _sim_ser.write((const uint8_t*)topic, strlen(topic));

  // Wait for topic acceptance
  delay(100);

  // Step 2: Set payload
  snprintf(cmd, sizeof(cmd), "AT+CMQTTPAYLOAD=%d,%d", SIM_MQTT_CLIENT_IDX, len);
  _sim_flush();
  _sim_ser.println(cmd);
  if (!_smq_wait_prompt(5000)) {
    Serial.println("[SIM MQTT] No > prompt for payload");
    return false;
  }
  // Send exactly len bytes (no extra newline — modem counts bytes)
  _sim_ser.write((const uint8_t*)payload, len);

  // Step 3: Publish
  snprintf(cmd, sizeof(cmd), "AT+CMQTTPUB=%d,%d,0", SIM_MQTT_CLIENT_IDX, (int)qos);
  uint32_t t = millis();
  String r = "";
  while (millis() - t < 10000) {
    while (_sim_ser.available()) r += (char)_sim_ser.read();
    if (r.indexOf("OK") >= 0 || r.indexOf("+CMQTTPUB:") >= 0) return true;
    if (r.indexOf("ERROR") >= 0) {
      Serial.printf("[SIM MQTT] PUB error: %s\n", r.c_str());
      return false;
    }
    delay(10);
  }
  Serial.println("[SIM MQTT] PUB timeout");
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

void mqtt_sim_init() { _raw_mqtt_init(); }

// ── Main task ─────────────────────────────────────────────────────────────────
// Dual-path: CMQTT* for CGACT, raw TCP MQTT for NETOPEN
void mqtt_sim_task(void* param) {
  for (;;) {
    // Only Active when SIM mode + GPRS ready
    if (!sys_state.sim_enabled || !sys_state.sim_gprs) {
      if (_smq_connected) {
        xSemaphoreTake(sim_at_mutex, portMAX_DELAY);
        _smq_disconnect();
        xSemaphoreGive(sim_at_mutex);
      }
      if (_raw_mqtt_connected) {
        xSemaphoreTake(sim_at_mutex, portMAX_DELAY);
        _raw_mqtt_disconnect();
        xSemaphoreGive(sim_at_mutex);
      }
      vTaskDelay(pdMS_TO_TICKS(5000));
      continue;
    }

    char mode[8];
    uint8_t pdp_method;
    xSemaphoreTake(state_mutex, portMAX_DELAY);
    strncpy(mode, sys_state.conn_mode, sizeof(mode));
    pdp_method = sys_state.sim_pdp_method;
    xSemaphoreGive(state_mutex);

    if (strcmp(mode, "sim") != 0) {
      if (_smq_connected) {
        xSemaphoreTake(sim_at_mutex, portMAX_DELAY);
        _smq_disconnect();
        xSemaphoreGive(sim_at_mutex);
      }
      if (_raw_mqtt_connected) {
        xSemaphoreTake(sim_at_mutex, portMAX_DELAY);
        _raw_mqtt_disconnect();
        xSemaphoreGive(sim_at_mutex);
      }
      vTaskDelay(pdMS_TO_TICKS(5000));
      continue;
    }

    // ── Route based on PDP method ──────────────────────────────────
    bool use_raw_tcp = (pdp_method == 2);  // NETOPEN

    if (use_raw_tcp) {
      // ══════════════════════════════════════════════════════════════
      // RAW TCP MQTT PATH (NETOPEN)
      // ══════════════════════════════════════════════════════════════

      // (Re)connect
      if (!_raw_mqtt_connected) {
        state_set_connected(false);
        _raw_rx_len = 0;
        // _raw_mqtt_connect() manages sim_at_mutex internally
        // (holds it during CONNACK wait to prevent other tasks from flushing +IPD)
        if (_raw_mqtt_connect()) {
          _raw_mqtt_connected = true;
        }
        if (!_raw_mqtt_connected) {
          vTaskDelay(pdMS_TO_TICKS(10000));
          continue;
        }
      }

      // Server heartbeat timeout
      {
        xSemaphoreTake(state_mutex, portMAX_DELAY);
        uint32_t hb_ms = sys_state.server_hb_ms;
        xSemaphoreGive(state_mutex);
        if (hb_ms > 0 && (millis() - hb_ms) > SERVER_HB_TIMEOUT_MS) {
          state_set_connected(false);
          xSemaphoreTake(sim_at_mutex, portMAX_DELAY);
          _raw_mqtt_disconnect();
          xSemaphoreGive(sim_at_mutex);
          continue;
        }
      }

      // ── Hold mutex for the entire cycle to prevent SIM manager interference ──
      if (xSemaphoreTake(sim_at_mutex, pdMS_TO_TICKS(500)) == pdTRUE) {
        // 1. Drain +IPD data from modem
        _raw_drain_ipd();

        // 2. Process MQTT frames (heartbeats, config, etc.)
        //    Release mutex briefly — _raw_process_frames only needs rx_buf
        xSemaphoreGive(sim_at_mutex);
        _raw_process_frames();

        if (xSemaphoreTake(sim_at_mutex, pdMS_TO_TICKS(500)) == pdTRUE) {
          // 3. Keepalive
          _raw_mqtt_keepalive();

          // 4. Batch publish: dequeue items, build MQTT packets into send_buf,
          //    then send all in one CIPSEND call. This reduces AT+CIPSEND
          //    overhead from N calls (one per message) to just 1 call.
          {
            uint8_t send_buf[MQTT_RAW_SEND_BUF];
            uint16_t batch_len = 0;
            int batch_count = 0;

            PublishItem item;
            while (batch_count < 8 && xQueueReceive(publish_queue, &item, 0) == pdTRUE) {
              uint16_t remaining = sizeof(send_buf) - batch_len;
              if (remaining < 20) {
                // Not enough room for next packet — put item back
                xQueueSendToFront(publish_queue, &item, 0);
                break;
              }

              uint16_t pkt_len = _mqtt_build_publish(
                send_buf + batch_len, remaining,
                item.topic,
                (const uint8_t*)item.payload, item.len,
                item.qos,
                item.qos >= 1 ? _raw_pub_pkt_id++ : 0
              );

              if (pkt_len == 0) {
                // Packet too large — put item back, send what we have
                xQueueSendToFront(publish_queue, &item, 0);
                break;
              }

              batch_len += pkt_len;
              batch_count++;
            }

            if (batch_count > 0 && batch_len > 0) {
              bool ok = _raw_tcp_send(send_buf, batch_len);
              if (!ok) {
                // Connection likely broken — will reconnect on next cycle
                _raw_mqtt_connected = false;
                state_set_connected(false);
                Serial.printf("[RAW MQTT] Batch failed (%d items, %d bytes)\n", batch_count, batch_len);
              } else {
                xSemaphoreTake(state_mutex, portMAX_DELAY);
                sys_state.last_publish_ms = millis();
                xSemaphoreGive(state_mutex);
                Serial.printf("[RAW MQTT] Batch %d msgs/%dB\n", batch_count, batch_len);
              }
            }
          }

          xSemaphoreGive(sim_at_mutex);
        }
      }

    } else {
      // ══════════════════════════════════════════════════════════════
      // CMQTT* PATH (CGACT) — existing code
      // ══════════════════════════════════════════════════════════════

      // (Re)connect
      if (!_smq_connected) {
        state_set_connected(false);
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

      // Server heartbeat timeout
      {
        xSemaphoreTake(state_mutex, portMAX_DELAY);
        uint32_t hb_ms = sys_state.server_hb_ms;
        xSemaphoreGive(state_mutex);
        if (hb_ms > 0 && (millis() - hb_ms) > SERVER_HB_TIMEOUT_MS) {
          state_set_connected(false);
        }
      }

      // Drain incoming URCs
      if (xSemaphoreTake(sim_at_mutex, pdMS_TO_TICKS(100)) == pdTRUE) {
        String urcs = _smq_drain();
        xSemaphoreGive(sim_at_mutex);
        _smq_process_urcs(urcs);
      }

      // Drain publish queue (up to 16 items per cycle)
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
    }

    vTaskDelay(pdMS_TO_TICKS(50));
  }
}

