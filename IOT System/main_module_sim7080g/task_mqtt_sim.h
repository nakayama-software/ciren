#pragma once
// ─────────────────────────────────────────────────────────────────────────────
// SIM7080G built-in MQTT client — uses AT+SMCONF/SMCONN/SMPUB/SMSUB/SMDISC.
// No TinyGSM, no raw TCP.
//
// Requires: task_sim_manager.h included first (defines _sim_ser,
//           sim_at_mutex, _sim_sendAT, _sim_atReply, _sim_flush).
//
// Incoming messages (server heartbeat, node config) are detected via
// +SMSUB: URC parsed in the main loop.
// ─────────────────────────────────────────────────────────────────────────────

#include "ciren_config.h"
#include "system_state.h"
#include "task_publish.h"   // for publish_queue + PublishItem
#include "task_logger.h"
#include "task_flash_store.h"   // for fb_confirm() — see PublishItem.from_flash
#include <esp_task_wdt.h>

static bool     _smq_connected  = false;
static uint32_t _smq_backoff_ms = MQTT_BACKOFF_MIN_MS;
// 0 = currently connected (or not yet tracking); set to millis() the moment
// we first notice we're disconnected, cleared back to 0 on successful connect.
// Used to escalate to a full modem reset if stuck disconnected too long —
// see MQTT_STUCK_RESET_MS in ciren_config.h.
static uint32_t _smq_disconnected_since_ms = 0;

// ── Shared drain buffer — no heap alloc/free per URC poll cycle ───────────────
static char _smq_drainbuf[1024];

// ── Parse +SMSUB URC and act ──────────────────────────────────────────────────
static void _smq_process_urcs(const char* buf) {
  if (!buf || buf[0] == '\0') return;

  if (strstr(buf, "+SMSUB:"))
    Serial.printf("[SIM MQTT] URC received (%d bytes): %.120s\n", (int)strlen(buf), buf);

  // Server heartbeat — topic appears in buf
  if (strstr(buf, TOPIC_SERVER_HB)) {
    xSemaphoreTake(state_mutex, portMAX_DELAY);
    sys_state.server_hb_ms = millis();
    xSemaphoreGive(state_mutex);
    state_set_connected(true);   // confirm liveness regardless of mode
    Serial.println("[SIM MQTT] Server heartbeat");
    LOG_INFO("SIM_MQTT", "Server heartbeat received");
  }

  // Config: look for +SMSUB: with the config topic
  const char* sub_ptr = buf;
  while ((sub_ptr = strstr(sub_ptr, "+SMSUB:")) != nullptr) {
    const char* nl = strchr(sub_ptr, '\n');
    if (!nl) break;

    // Extract topic from first quoted string in header line
    const char* q1 = sub_ptr;
    while (q1 < nl && *q1 != '"') q1++;
    if (q1 >= nl) { sub_ptr += 7; continue; }
    const char* q2 = q1 + 1;
    while (q2 < nl && *q2 != '"') q2++;
    if (q2 >= nl) { sub_ptr += 7; continue; }

    size_t topic_len = (size_t)(q2 - q1 - 1);
    size_t cfg_len   = strlen(sys_state.topic_config);

    if (topic_len == cfg_len && strncmp(q1 + 1, sys_state.topic_config, topic_len) == 0) {
      char payload_buf[256]; payload_buf[0] = '\0';

      // Try same-line payload: find { ... } after closing topic quote (SIM7080G format)
      const char* js = q2 + 1;
      while (js < nl && *js != '{') js++;
      if (js < nl) {
        const char* je = nl - 1;
        while (je > js && *je != '}') je--;
        if (je > js) {
          size_t plen = (size_t)(je - js + 1);
          if (plen >= sizeof(payload_buf)) plen = sizeof(payload_buf) - 1;
          memcpy(payload_buf, js, plen);
          payload_buf[plen] = '\0';
        }
      }

      // Fallback: payload on next line (legacy format)
      if (payload_buf[0] == '\0' && *(nl + 1)) {
        const char* nxt = nl + 1;
        const char* nl2 = strchr(nxt, '\n');
        size_t plen = nl2 ? (size_t)(nl2 - nxt) : strlen(nxt);
        while (plen > 0 && (nxt[plen-1] == '\r' || nxt[plen-1] == ' ')) plen--;
        if (plen > 0) {
          if (plen >= sizeof(payload_buf)) plen = sizeof(payload_buf) - 1;
          memcpy(payload_buf, nxt, plen);
          payload_buf[plen] = '\0';
        }
      }

      if (strstr(payload_buf, "reboot")) {
          Serial.println("[SIM MQTT] Remote reboot command — restarting in 500ms");
          LOG_WARN("SIM_MQTT", "Remote reboot command received");
          delay(500);
          esp_restart();
      } else if (strstr(payload_buf, "set_node_interval")) {
        int ctrl_id = 0, port_num = 0;
        uint32_t interval_ms = 0;
        const char* p;
        if ((p = strstr(payload_buf, "\"ctrl_id\":")))     ctrl_id     = atoi(p + 10);
        if ((p = strstr(payload_buf, "\"port_num\":")))    port_num    = atoi(p + 11);
        if ((p = strstr(payload_buf, "\"interval_ms\":"))) interval_ms = (uint32_t)atoi(p + 14);
        if (ctrl_id > 0 && port_num > 0 && interval_ms > 0) {
          Serial.printf("[SIM MQTT] set_node_interval: ctrl=%d port=%d interval=%lu ms\n",
                        ctrl_id, port_num, interval_ms);
          LOG_INFO("SIM_MQTT", "set_node_interval: ctrl=%d port=%d interval=%lu ms", ctrl_id, port_num, interval_ms);
          nc_set((uint8_t)ctrl_id, (uint8_t)port_num, interval_ms);
        } else {
          Serial.printf("[SIM MQTT] Bad set_node_interval payload: %s\n", payload_buf);
          LOG_WARN("SIM_MQTT", "Bad set_node_interval payload: %s", payload_buf);
        }
      }
    }

    sub_ptr += 7;
  }

  // Capture +CNTP: URC for the NTP task (it releases the AT mutex while waiting
  // for this URC, so _smq_drain() may consume it before the NTP task can read it)
  const char* cntp = strstr(buf, "+CNTP:");
  if (cntp) {
    int code = -1; long epoch = 0;
    if (sscanf(cntp, "+CNTP: %d,%ld", &code, &epoch) == 2) {
      _ntp_urc_code  = code;
      _ntp_urc_epoch = epoch;
      _ntp_urc_ready = true;
      Serial.printf("[SIM MQTT] Captured +CNTP URC: code=%d epoch=%ld\n", code, epoch);
    }
  }

  // Detect remote disconnect URC
  if (strstr(buf, "+SMSTATE: 0")) {
    _smq_connected = false;
    state_set_connected(false);
    _smq_backoff_ms = MQTT_BACKOFF_MIN_MS;  // reset backoff on disconnect so reconnect is fast
    // Clear stale heartbeat timestamp so it doesn't trigger false timeout after reconnect
    xSemaphoreTake(state_mutex, portMAX_DELAY);
    sys_state.server_hb_ms = 0;
    xSemaphoreGive(state_mutex);
    Serial.println("[SIM MQTT] Remote disconnect detected — backoff reset");
    LOG_WARN("SIM_MQTT", "Remote disconnect detected — backoff reset");
  }
}

// ── Drain any available bytes from Serial2, return pointer to static buffer ───
// Uses "silence gap" detection: after receiving bytes, waits 80ms of silence
// before concluding the URC is complete.
static const char* _smq_drain() {
  size_t pos = 0;
  _smq_drainbuf[0] = '\0';
  uint32_t t = millis();
  uint32_t last_byte_ms = millis();
  while (millis() - t < 500) {
    while (_sim_ser.available() && pos < sizeof(_smq_drainbuf) - 1) {
      _smq_drainbuf[pos++] = (char)_sim_ser.read();
      _smq_drainbuf[pos]   = '\0';
      last_byte_ms = millis();
    }
    if (pos > 0 && (millis() - last_byte_ms) > 80) break;
    if (pos == 0 && (millis() - t) > 200) break;
    delay(5);
  }
  return _smq_drainbuf;
}

// ── Connect to MQTT broker using SIM7080G AT+SMCONF / AT+SMCONN ───────────────
static bool _smq_connect() {
  // Clear any stale MQTT session left in the modem (e.g. after ESP32 reboot without
  // modem power cycle). AT+SMDISC returns ERROR if not connected — ignore the result.
  _sim_sendAT("AT+SMDISC", "OK", 3000);
  vTaskDelay(pdMS_TO_TICKS(300));

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
  LOG_INFO("SIM_MQTT", "Connecting to %s:%d ...", sys_state.mqtt_host, MQTT_PORT);
  if (!_sim_sendAT("AT+SMCONN", "OK", 60000)) {
    Serial.println("[SIM MQTT] SMCONN failed");
    LOG_ERROR("SIM_MQTT", "SMCONN failed — broker unreachable");
    return false;
  }

  // Subscribe: server heartbeat (QoS 0) + config topic (QoS 1)
  Serial.printf("[SIM MQTT] topic_config = \"%s\"\n", sys_state.topic_config);
  snprintf(buf, sizeof(buf), "AT+SMSUB=\"%s\",0", TOPIC_SERVER_HB);
  bool hb_ok = _sim_sendAT(buf);
  Serial.printf("[SIM MQTT] Subscribe HB: %s\n", hb_ok ? "OK" : "FAIL");
  if (!hb_ok) LOG_WARN("SIM_MQTT", "Subscribe HB topic failed");

  snprintf(buf, sizeof(buf), "AT+SMSUB=\"%s\",1", sys_state.topic_config);
  bool cfg_ok = _sim_sendAT(buf);
  Serial.printf("[SIM MQTT] Subscribe config: %s\n", cfg_ok ? "OK" : "FAIL");
  if (!cfg_ok) LOG_WARN("SIM_MQTT", "Subscribe config topic failed");

  Serial.println("[SIM MQTT] Connected, subscribed");
  LOG_INFO("SIM_MQTT", "Connected to broker, subscribed");
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

  // Wait for ">" prompt
  uint32_t t = millis();
  char r[64]; size_t rpos = 0; r[0] = '\0';
  bool got_prompt = false;
  while (millis() - t < 5000) {
    while (_sim_ser.available() && rpos < sizeof(r) - 1) {
      r[rpos++] = (char)_sim_ser.read();
      r[rpos]   = '\0';
    }
    if (strchr(r, '>')) { got_prompt = true; break; }
    if (strstr(r, "ERROR")) return false;
    delay(10);
  }
  if (!got_prompt) { Serial.println("[SIM MQTT] No > prompt"); LOG_ERROR("SIM_MQTT", "No prompt for publish — timeout"); return false; }

  // Send exactly len bytes (no extra newline — modem counts bytes)
  _sim_ser.write((const uint8_t*)payload, len);

  // Wait for OK (or +SMPUB: msgid confirmation for QoS 1)
  t = millis();
  rpos = 0; r[0] = '\0';
  while (millis() - t < 10000) {
    while (_sim_ser.available() && rpos < sizeof(r) - 1) {
      r[rpos++] = (char)_sim_ser.read();
      r[rpos]   = '\0';
    }
    if (strstr(r, "OK") || strstr(r, "+SMPUB:")) return true;
    if (strstr(r, "ERROR")) return false;
    delay(10);
  }
  return false;
}

// ── Public: publish from external task (takes mutex) ─────────────────────────
bool sim_mqtt_publish(const char* topic, const char* payload, uint8_t qos) {
  if (!_smq_connected) {
    LOG_WARN("SIM_MQTT", "Publish skipped — not connected");
    return false;
  }
  if (xSemaphoreTake(sim_at_mutex, pdMS_TO_TICKS(5000)) != pdTRUE) return false;
  bool ok = _smq_pub(topic, payload, (int)strlen(payload), qos);
  xSemaphoreGive(sim_at_mutex);
  return ok;
}

void mqtt_sim_init() { /* no state to init */ }

// ── Main task ─────────────────────────────────────────────────────────────────
void mqtt_sim_task(void* param) {
  esp_task_wdt_add(NULL);   // subscribe to Task Watchdog
  static bool _was_gprs_down = false;   // track GPRS transitions for backoff reset
  for (;;) {
    // Only active when SIM mode + GPRS ready
    if (!sys_state.sim_enabled || !sys_state.sim_gprs) {
      if (_smq_connected) {
        // Bounded, watchdog-fed wait — GPRS-not-ready and task_sim_manager
        // holding sim_at_mutex for 15s+ during modem bring-up are likely to
        // coincide (both happen right after boot/reconnect), so an unbounded
        // portMAX_DELAY here risked the same watchdog starvation as below.
        bool got_mutex = false;
        for (uint32_t _mw = 0; _mw < 30000 && !got_mutex; _mw += 1000) {
          got_mutex = (xSemaphoreTake(sim_at_mutex, pdMS_TO_TICKS(1000)) == pdTRUE);
          esp_task_wdt_reset();
        }
        if (got_mutex) {
          _smq_disconnect();
          xSemaphoreGive(sim_at_mutex);
        }
      }
      _was_gprs_down = true;    // mark that GPRS was down
      vTaskDelay(pdMS_TO_TICKS(5000));
      esp_task_wdt_reset();     // feed watchdog — loop bawah tidak tercapai lewat jalur ini
      continue;
    }

    // GPRS just came back up — reset backoff so MQTT reconnects immediately
    if (_was_gprs_down) {
      _smq_backoff_ms = MQTT_BACKOFF_MIN_MS;
      _was_gprs_down = false;
      LOG_INFO("SIM_MQTT", "GPRS recovered — backoff reset");
    }

    char mode[8];
    xSemaphoreTake(state_mutex, portMAX_DELAY);
    strncpy(mode, sys_state.conn_mode, sizeof(mode));
    xSemaphoreGive(state_mutex);

    if (strcmp(mode, "sim") != 0) {
      if (_smq_connected) {
        // Bounded, watchdog-fed wait — sim_at_mutex can legitimately be held
        // by task_sim_manager for 15s+ during modem bring-up. portMAX_DELAY
        // here (with no reset in this branch at all) let that starve the
        // watchdog and abort() the device — same bug class as the publish
        // drain loop and _sim_sendAT() fixed earlier.
        bool got_mutex = false;
        for (uint32_t _mw = 0; _mw < 30000 && !got_mutex; _mw += 1000) {
          got_mutex = (xSemaphoreTake(sim_at_mutex, pdMS_TO_TICKS(1000)) == pdTRUE);
          esp_task_wdt_reset();
        }
        if (got_mutex) {
          _smq_disconnect();
          xSemaphoreGive(sim_at_mutex);
          LOG_INFO("SIM_MQTT", "Disconnected — switched to WiFi mode");
        }
      }
      vTaskDelay(pdMS_TO_TICKS(5000));
      esp_task_wdt_reset();
      continue;
    }

    // ── (Re)connect ───────────────────────────────────────────────────────────
    if (!_smq_connected) {
      if (_smq_disconnected_since_ms == 0) _smq_disconnected_since_ms = millis();
      Serial.printf("[SIM MQTT] Reconnecting (backoff=%lu ms)...\n", _smq_backoff_ms);
      LOG_INFO("SIM_MQTT", "Reconnecting (backoff=%lu ms)...", _smq_backoff_ms);
      // Mutex held for the full connect sequence (can take ~60s).
      // Acquire in 1s chunks so we keep feeding the watchdog while waiting our
      // turn — task_sim_manager can legitimately hold this mutex for >15s
      // during modem bring-up (boot wait + network registration + PDP activation).
      bool got_at_mutex = false;
      for (uint32_t _mw = 0; _mw < 65000 && !got_at_mutex; _mw += 1000) {
        got_at_mutex = (xSemaphoreTake(sim_at_mutex, pdMS_TO_TICKS(1000)) == pdTRUE);
        esp_task_wdt_reset();
      }
      if (got_at_mutex) {
        esp_task_wdt_reset();   // feed watchdog before long connect sequence
        if (_smq_connect()) {
          _smq_connected  = true;
          _smq_backoff_ms = MQTT_BACKOFF_MIN_MS;  // reset backoff on success
          _smq_disconnected_since_ms = 0;         // reset stuck-timer on success
          // Mark connected immediately so HELLO/status can be sent without
          // waiting for first server heartbeat. Heartbeat timeout will still
          // catch cases where backend is down but broker is up.
          state_set_connected(true);
          // Only flush if queue is nearly full (>= 48/64 slots) — means device was
          // offline long enough that queued data is truly stale. For brief reconnects
          // (signal blip, <30s) keep queued items so no sensor readings are lost.
          UBaseType_t queued = uxQueueMessagesWaiting(publish_queue);
          if (queued >= 48) {
            PublishItem _flush;
            uint16_t flushed = 0;
            while (xQueueReceive(publish_queue, &_flush, 0) == pdTRUE) {
              flushed++;
              // A replayed flash batch discarded here was never actually
              // sent — release its in-flight mark (don't confirm) so the
              // same backlog gets re-peeked and retried later, instead of
              // leaving fb_peek_batch() permanently blocked.
              if (_flush.from_flash) fb_release_peek();
            }
            Serial.printf("[SIM MQTT] Flushed %u stale items (queue was %u/64)\n", flushed, queued);
            LOG_WARN("SIM_MQTT", "Flushed %u stale items (queue was %u/64)", flushed, queued);
          } else {
            Serial.printf("[SIM MQTT] Reconnected — keeping %u queued item(s)\n", queued);
            LOG_INFO("SIM_MQTT", "Reconnected, %u items queued", queued);
          }
        }
        xSemaphoreGive(sim_at_mutex);
      }
      if (!_smq_connected) {
        // ── Escalation: stuck disconnected too long ────────────────────────
        // Plain MQTT-level retry (above) assumes the modem/PDP is fine and
        // only AT+SMCONN is failing. But a flaky-signal episode can leave the
        // modem itself wedged (lost registration, stuck PDP) for hours — in
        // that case no amount of AT+SMCONN retrying helps, yet the old code
        // just kept backing off forever at this layer. If we've been
        // disconnected continuously for MQTT_STUCK_RESET_MS, stop retrying
        // softly and force a full modem reset instead (same reset path as
        // the AT-failure-count trigger in task_sim_manager.h).
        uint32_t stuck_ms = millis() - _smq_disconnected_since_ms;
        if (stuck_ms >= MQTT_STUCK_RESET_MS) {
          Serial.printf("[SIM MQTT] Stuck disconnected %lu ms — forcing modem reset\n", stuck_ms);
          LOG_ERROR("SIM_MQTT", "Stuck disconnected %lu ms (>= %dms) — forcing modem reset",
                    stuck_ms, MQTT_STUCK_RESET_MS);
          // sim_at_mutex was already released above (or never acquired) — safe to call.
          _sim_reset_modem();
          _smq_disconnected_since_ms = millis();   // restart the clock after escalating
          _smq_backoff_ms = MQTT_BACKOFF_MIN_MS;   // retry promptly right after a reset
          esp_task_wdt_reset();
          continue;
        }

        // Exponential backoff: double each failure, cap at max
        uint32_t d = _smq_backoff_ms;
        _smq_backoff_ms = _smq_backoff_ms * 2;
        if (_smq_backoff_ms > MQTT_BACKOFF_MAX_MS) _smq_backoff_ms = MQTT_BACKOFF_MAX_MS;
        // Split long delay into 5s chunks to keep feeding watchdog
        for (uint32_t _bd = 0; _bd < d; _bd += 5000) {
          uint32_t _chunk = (d - _bd > 5000) ? 5000 : (d - _bd);
          vTaskDelay(pdMS_TO_TICKS(_chunk));
          esp_task_wdt_reset();
        }
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
        xSemaphoreTake(state_mutex, portMAX_DELAY);
        sys_state.server_hb_ms = 0;   // clear stale timestamp
        xSemaphoreGive(state_mutex);
        // Don't force disconnect — the broker connection stays up. When the
        // backend recovers and sends a heartbeat, is_connected becomes true again.
        // If the broker also goes down, +SMSTATE: 0 URC will trigger reconnect.
        LOG_WARN("SIM_MQTT", "Server heartbeat timeout");
      }
    }

    // ── Drain incoming URCs (non-blocking, short mutex hold) ─────────────────
    if (xSemaphoreTake(sim_at_mutex, pdMS_TO_TICKS(100)) == pdTRUE) {
      const char* urcs = _smq_drain();
      xSemaphoreGive(sim_at_mutex);
      _smq_process_urcs(urcs);  // _smq_drainbuf valid until next _smq_drain call
    }

    // ── Drain publish queue (up to 16 items per cycle) ────────────────────────
    PublishItem item;
    int drained = 0;
    while (drained < 16 && xQueueReceive(publish_queue, &item, 0) == pdTRUE) {
      // Feed the watchdog every iteration — the mutex wait below (up to 12s)
      // plus a stalled _smq_pub() (up to 5s "> " wait + 10s "OK" wait = 15s)
      // can alone exceed the 15s TWDT timeout, and nothing else in this loop
      // resets it. Under modem trouble (re-registration, no ">" prompt) this
      // starved the watchdog and force-aborted the whole device.
      esp_task_wdt_reset();
      if (xSemaphoreTake(sim_at_mutex, pdMS_TO_TICKS(12000)) == pdTRUE) {
        bool ok = _smq_pub(item.topic, item.payload, item.len, item.qos);
        xSemaphoreGive(sim_at_mutex);
        if (!ok) {
          xQueueSendToFront(publish_queue, &item, 0);
          _smq_connected = false;
          state_set_connected(false);
          Serial.println("[SIM MQTT] Publish failed — will reconnect");
          LOG_ERROR("SIM_MQTT", "Publish failed — will reconnect");
          break;
        }
        // Only now — genuine publish success, not just "reached the front of
        // the queue" — may a replayed batch's flash slots be reclaimed. A
        // failure above leaves confirmed_idx untouched, so the same backlog
        // is offered again next cycle (see fb_confirm()'s contract).
        if (item.from_flash) fb_confirm(item.flash_count);
        xSemaphoreTake(state_mutex, portMAX_DELAY);
        sys_state.last_publish_ms = millis();
        xSemaphoreGive(state_mutex);
        drained++;
      }
    }

    vTaskDelay(pdMS_TO_TICKS(100));
    esp_task_wdt_reset();   // feed watchdog — loop every ~100ms when connected
  }
}