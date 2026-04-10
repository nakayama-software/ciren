#pragma once

#ifndef TINY_GSM_MODEM_SIM7600
#define TINY_GSM_MODEM_SIM7600
#endif
#ifndef TINY_GSM_YIELD
#define TINY_GSM_YIELD() { vTaskDelay(pdMS_TO_TICKS(1)); }
#endif
#include <TinyGsmClient.h>

#include "ciren_config_014424.h"
#include "system_state_014424.h"
#include "task_publish_014424.h"

// ── Minimal MQTT 3.1.1 client via TinyGSM TCP ──────────────────────────────
// Tidak membutuhkan PubSubClient — langsung di atas TinyGsmClient dari
// task_sim_manager_014424.h yang sudah di-include sebelum header ini.

extern TinyGsm       modem;
extern TinyGsmClient simClient;

static uint16_t _sim_pkt_id       = 1;
static bool     _sim_mqtt_conn    = false;
static uint32_t _sim_last_ping_ms = 0;

// ── Helpers ─────────────────────────────────────────────────────────────────

// Encode MQTT variable-length remaining field, return byte count used
static int _mqtt_encode_len(uint8_t* buf, int len) {
  int i = 0;
  do {
    buf[i] = len % 128;
    len /= 128;
    if (len > 0) buf[i] |= 0x80;
    i++;
  } while (len > 0 && i < 4);
  return i;
}

// ── CONNECT ─────────────────────────────────────────────────────────────────
static bool _sim_mqtt_connect(const char* broker, uint16_t port, const char* client_id) {
  if (!simClient.connect(broker, port)) {
    Serial.println("[SIM MQTT] TCP connect failed");
    return false;
  }

  int cid_len     = strlen(client_id);
  int var_hdr_len = 2 + 4 + 1 + 1 + 2;     // "MQTT" name + level + flags + keepalive
  int payload_len = 2 + cid_len;            // client_id with length prefix
  int remaining   = var_hdr_len + payload_len;

  uint8_t buf[96];
  int pos = 0;
  buf[pos++] = 0x10;                         // CONNECT packet type

  uint8_t enc[4];
  int enc_len = _mqtt_encode_len(enc, remaining);
  memcpy(&buf[pos], enc, enc_len); pos += enc_len;

  // Protocol name
  buf[pos++] = 0x00; buf[pos++] = 0x04;
  buf[pos++] = 'M';  buf[pos++] = 'Q';
  buf[pos++] = 'T';  buf[pos++] = 'T';
  buf[pos++] = 0x04;                         // protocol level = MQTT 3.1.1
  buf[pos++] = 0x02;                         // connect flags = clean session
  buf[pos++] = 0x00;
  buf[pos++] = (uint8_t)MQTT_KEEPALIVE;      // keepalive (seconds)

  // Client ID
  buf[pos++] = (uint8_t)((cid_len >> 8) & 0xFF);
  buf[pos++] = (uint8_t)(cid_len & 0xFF);
  memcpy(&buf[pos], client_id, cid_len); pos += cid_len;

  simClient.write(buf, pos);

  // Wait for CONNACK (0x20 0x02 flags return_code)
  uint32_t t = millis();
  while (simClient.available() < 4 && millis() - t < 4000) delay(20);
  if (simClient.available() < 4) {
    Serial.println("[SIM MQTT] CONNACK timeout");
    simClient.stop(); return false;
  }
  uint8_t ack[4];
  simClient.read(ack, 4);
  if (ack[0] != 0x20 || ack[3] != 0x00) {
    Serial.printf("[SIM MQTT] CONNACK rejected rc=0x%02X\n", ack[3]);
    simClient.stop(); return false;
  }

  _sim_mqtt_conn    = true;
  _sim_last_ping_ms = millis();
  Serial.println("[SIM MQTT] Broker connected — subscribing topics");

  // Helper: subscribe one topic
  auto _sub = [&](const char* topic, uint8_t qos, uint8_t pkt_id) {
    int tlen    = strlen(topic);
    int sub_rem = 2 + 2 + tlen + 1;
    uint8_t sbuf[128];
    int sp = 0;
    sbuf[sp++] = 0x82;
    uint8_t senc[4];
    int senc_len = _mqtt_encode_len(senc, sub_rem);
    memcpy(&sbuf[sp], senc, senc_len); sp += senc_len;
    sbuf[sp++] = 0x00; sbuf[sp++] = pkt_id;
    sbuf[sp++] = (uint8_t)((tlen >> 8) & 0xFF);
    sbuf[sp++] = (uint8_t)(tlen & 0xFF);
    memcpy(&sbuf[sp], topic, tlen); sp += tlen;
    sbuf[sp++] = qos;
    simClient.write(sbuf, sp);
  };

  _sub(TOPIC_SERVER_HB,        0, 1);
  _sub(sys_state.topic_config, 1, 2);

  // connected state ditentukan oleh server heartbeat, bukan broker CONNACK
  return true;
}

// ── PUBLISH ─────────────────────────────────────────────────────────────────
static bool _sim_mqtt_publish(const char* topic, const char* payload,
                               int payload_len, uint8_t qos) {
  if (!_sim_mqtt_conn || !simClient.connected()) return false;

  int topic_len = strlen(topic);
  int remaining = 2 + topic_len + payload_len;
  if (qos > 0) remaining += 2;               // packet id field

  uint8_t header[8];
  int pos = 0;
  header[pos++] = (qos == 0) ? 0x30 : 0x32; // PUBLISH fixed header (QoS bit)

  uint8_t enc[4];
  int enc_len = _mqtt_encode_len(enc, remaining);
  memcpy(&header[pos], enc, enc_len); pos += enc_len;

  simClient.write(header, pos);

  // Topic with 2-byte length prefix
  uint8_t tl[2] = { (uint8_t)((topic_len >> 8) & 0xFF),
                    (uint8_t)(topic_len & 0xFF) };
  simClient.write(tl, 2);
  simClient.write((const uint8_t*)topic, topic_len);

  // Packet ID (QoS 1 only)
  if (qos > 0) {
    uint8_t pid[2] = { (uint8_t)((_sim_pkt_id >> 8) & 0xFF),
                       (uint8_t)(_sim_pkt_id & 0xFF) };
    simClient.write(pid, 2);
    if (++_sim_pkt_id == 0) _sim_pkt_id = 1;
  }

  simClient.write((const uint8_t*)payload, payload_len);
  return true;
}

// ── PINGREQ ─────────────────────────────────────────────────────────────────
static void _sim_mqtt_ping() {
  if (!simClient.connected()) return;
  const uint8_t ping[2] = { 0xC0, 0x00 };
  simClient.write(ping, 2);
}

// Drain unread bytes (PUBACK, SUBACK, PINGRESP, PUBLISH, etc.)
// Scans payload for heartbeat and config topics to update state
static void _sim_mqtt_drain() {
  uint8_t drain_buf[512];
  int n = 0;
  while (simClient.available() && n < (int)sizeof(drain_buf) - 1) {
    drain_buf[n++] = (uint8_t)simClient.read();
  }
  while (simClient.available()) simClient.read();  // discard overflow

  if (n == 0) return;
  drain_buf[n] = '\0';  // null-terminate for string scanning

  // Scan for heartbeat topic
  const char* hb = TOPIC_SERVER_HB;
  int hb_len = strlen(hb);
  for (int i = 0; i <= n - hb_len; i++) {
    if (memcmp(&drain_buf[i], hb, hb_len) == 0) {
      xSemaphoreTake(state_mutex, portMAX_DELAY);
      sys_state.server_hb_ms = millis();
      xSemaphoreGive(state_mutex);
      state_set_connected(true);
      Serial.println("[SIM MQTT] Server heartbeat received");
      break;
    }
  }

  // Scan for config topic + action string
  const char* cfg_topic = sys_state.topic_config;
  int cfg_len = strlen(cfg_topic);
  for (int i = 0; i <= n - cfg_len; i++) {
    if (memcmp(&drain_buf[i], cfg_topic, cfg_len) == 0) {
      // Topic found — scan remaining bytes for JSON action
      char* payload = (char*)&drain_buf[i + cfg_len];
      if (strstr(payload, "\"set_node_interval\"")) {
        int ctrl_id = 0, port_num = 0;
        uint32_t interval_ms = 0;
        const char* p;
        if ((p = strstr(payload, "\"ctrl_id\":")))    ctrl_id     = atoi(p + 10);
        if ((p = strstr(payload, "\"port_num\":")))   port_num    = atoi(p + 11);
        if ((p = strstr(payload, "\"interval_ms\":"))) interval_ms = (uint32_t)atoi(p + 14);
        if (ctrl_id > 0 && port_num > 0 && interval_ms > 0) {
          nc_set((uint8_t)ctrl_id, (uint8_t)port_num, interval_ms);
        }
      }
      break;
    }
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

// Publish via SIM — dipanggil dari task_aggregator atau task lain saat mode SIM
bool sim_mqtt_publish(const char* topic, const char* payload, uint8_t qos) {
  return _sim_mqtt_publish(topic, payload, (int)strlen(payload), qos);
}

void mqtt_sim_init() {
  // Tidak ada state global yang perlu diinit di sini
}

void mqtt_sim_task(void* param) {
  for (;;) {
    // Hanya aktif jika SIM enabled dan GPRS sudah konek
    if (!sys_state.sim_enabled || !sys_state.sim_gprs) {
      if (_sim_mqtt_conn) {
        _sim_mqtt_conn = false;
        simClient.stop();
      }
      vTaskDelay(pdMS_TO_TICKS(5000));
      continue;
    }

    // Cek apakah sedang dalam mode SIM
    char current_mode[8];
    xSemaphoreTake(state_mutex, portMAX_DELAY);
    strncpy(current_mode, sys_state.conn_mode, sizeof(current_mode));
    xSemaphoreGive(state_mutex);

    bool in_sim_mode = (strcmp(current_mode, "sim") == 0);

    // Jika WiFi mode aktif, SIM MQTT tidak perlu connect — tutup jika masih buka
    if (!in_sim_mode) {
      if (_sim_mqtt_conn) {
        Serial.println("[SIM MQTT] WiFi mode active — disconnecting SIM MQTT");
        _sim_mqtt_conn = false;
        simClient.stop();
      }
      vTaskDelay(pdMS_TO_TICKS(5000));
      continue;
    }

    // ── SIM mode: (Re)connect jika belum terhubung ───────────────────────────
    if (!_sim_mqtt_conn || !simClient.connected()) {
      _sim_mqtt_conn = false;
      state_set_connected(false);

      const char* broker = sys_state.mqtt_host;
      char client_id[40];
      snprintf(client_id, sizeof(client_id), "%s-sim", sys_state.device_id);

      if (!_sim_mqtt_connect(broker, MQTT_PORT, client_id)) {
        vTaskDelay(pdMS_TO_TICKS(10000));
        continue;
      }
      // connected state ditentukan oleh server heartbeat — tidak set di sini
    }

    // ── Heartbeat timeout — anggap server offline jika > 60s tidak ada HB ──
    {
      xSemaphoreTake(state_mutex, portMAX_DELAY);
      uint32_t hb_ms = sys_state.server_hb_ms;
      xSemaphoreGive(state_mutex);
      if (hb_ms > 0 && (millis() - hb_ms) > SERVER_HB_TIMEOUT_MS) {
        state_set_connected(false);
      }
    }

    // ── Drain publish_queue ─────────────────────────────────────────────────
    PublishItem item;
    // Non-blocking: process up to 8 items per cycle to avoid hogging
    int drained = 0;
    while (drained < 8 && xQueueReceive(publish_queue, &item, 0) == pdTRUE) {
      bool ok = _sim_mqtt_publish(item.topic, item.payload, item.len, item.qos);
      if (!ok) {
        // TCP connection lost — put item back and reconnect
        xQueueSendToFront(publish_queue, &item, 0);
        _sim_mqtt_conn = false;
        simClient.stop();
        state_set_connected(false);
        Serial.println("[SIM MQTT] Connection lost during publish");
        break;
      }
      xSemaphoreTake(state_mutex, portMAX_DELAY);
      sys_state.last_publish_ms = millis();
      xSemaphoreGive(state_mutex);
      drained++;
    }

    // ── Keepalive ping setiap setengah keepalive interval ───────────────────
    if (millis() - _sim_last_ping_ms > (uint32_t)(MQTT_KEEPALIVE * 500UL)) {
      _sim_mqtt_ping();
      _sim_last_ping_ms = millis();
    }

    _sim_mqtt_drain();
    vTaskDelay(pdMS_TO_TICKS(500));
  }
}
