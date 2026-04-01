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
  Serial.println("[SIM MQTT] Connected");
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

// Drain unread bytes (PUBACK, PINGRESP, etc.)
static void _sim_mqtt_drain() {
  while (simClient.available()) simClient.read();
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

      const char* broker = "192.168.103.241";
      char client_id[32];
      snprintf(client_id, sizeof(client_id), "%s-sim", DEVICE_ID);

      if (!_sim_mqtt_connect(broker, MQTT_PORT, client_id)) {
        vTaskDelay(pdMS_TO_TICKS(10000));
        continue;
      }

      // SIM MQTT connected — set connected state
      state_set_connected(true);
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
