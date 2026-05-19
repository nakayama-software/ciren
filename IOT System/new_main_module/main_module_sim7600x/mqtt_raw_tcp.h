#pragma once
// ─────────────────────────────────────────────────────────────────────────────
// Raw TCP MQTT client for SIM7600G-H NETOPEN path.
//
// When CGACT fails but NETOPEN succeeds, AT+CMQTT* commands don't work
// (+CMQTTNONET). This module implements MQTT 3.1.1 directly over raw TCP
// using AT+CIPOPEN / AT+CIPSEND / +IPD.
//
// Requires: task_sim_manager.h included first (defines _sim_ser,
//           sim_at_mutex, _sim_sendAT, _sim_atReply, _sim_flush).
// ─────────────────────────────────────────────────────────────────────────────

#include <Arduino.h>

// ── Constants ────────────────────────────────────────────────────────────────
#define MQTT_RAW_RX_BUF_SIZE   2048
#define MQTT_RAW_SEND_BUF      1400
#define MQTT_RAW_SOCK          0
#define MQTT_RAW_CIP_TIMEOUT   30000

// MQTT 3.1.1 packet types (upper 4 bits of fixed header)
#define MQTT_PKT_CONNECT       0x10
#define MQTT_PKT_CONNACK       0x20
#define MQTT_PKT_PUBLISH       0x30
#define MQTT_PKT_PUBACK        0x40
#define MQTT_PKT_SUBSCRIBE     0x82
#define MQTT_PKT_SUBACK        0x90
#define MQTT_PKT_PINGREQ       0xC0
#define MQTT_PKT_PINGRESP      0xD0
#define MQTT_PKT_DISCONNECT    0xE0

// ── State ─────────────────────────────────────────────────────────────────────
static bool     _raw_mqtt_connected  = false;
static bool     _raw_mqtt_sock_open  = false;
static bool     _raw_got_connack     = false;
static uint16_t _raw_sub_pkt_id      = 1;
static uint16_t _raw_pub_pkt_id      = 1;

static uint8_t  _raw_rx_buf[MQTT_RAW_RX_BUF_SIZE];
static uint16_t _raw_rx_len          = 0;

static uint32_t _raw_last_ping_ms   = 0;
static uint32_t _raw_last_rx_ms     = 0;

// ── MQTT remaining-length encoder ────────────────────────────────────────────
static uint8_t _mqtt_encode_rem_len(uint32_t len, uint8_t* buf) {
  uint8_t i = 0;
  do {
    uint8_t b = len % 128;
    len /= 128;
    if (len > 0) b |= 0x80;
    buf[i++] = b;
  } while (len > 0);
  return i;
}

// ── MQTT remaining-length decoder ────────────────────────────────────────────
// Returns bytes consumed (1-4), or 0 on error / insufficient data.
static uint8_t _mqtt_decode_rem_len(const uint8_t* buf, uint16_t buf_len, uint32_t* out) {
  if (buf_len < 1) return 0;
  uint32_t val = 0;
  uint8_t mult = 1;
  uint8_t i = 0;
  uint8_t b;
  do {
    if (i >= buf_len) return 0;  // incomplete
    b = buf[i];
    val += (b & 0x7F) * mult;
    mult *= 128;
    i++;
    if (i > 4) return 0;  // malformed
  } while (b & 0x80);
  *out = val;
  return i;
}

// ── Build MQTT CONNECT ───────────────────────────────────────────────────────
// Returns total packet length.
static uint16_t _mqtt_build_connect(uint8_t* buf, const char* client_id,
                                     uint16_t keepalive) {
  uint16_t cid_len = (uint16_t)strlen(client_id);
  // Variable header: protocol name + level + flags + keepalive
  uint16_t vh_len = 6 + 1 + 1 + 2;  // "MQTT" (6) + level(1) + flags(1) + keep(2)
  // Payload: client ID length prefix + string
  uint16_t payload_len = 2 + cid_len;
  uint16_t rem = vh_len + payload_len;

  uint16_t i = 0;
  buf[i++] = MQTT_PKT_CONNECT;      // fixed header byte 1
  i += _mqtt_encode_rem_len(rem, buf + i);

  // Protocol name "MQTT"
  buf[i++] = 0x00; buf[i++] = 0x04;
  buf[i++] = 'M';  buf[i++] = 'Q';
  buf[i++] = 'T';  buf[i++] = 'T';
  buf[i++] = 0x04;                   // protocol level 4 = MQTT 3.1.1
  buf[i++] = 0x02;                   // connect flags: Clean Session
  buf[i++] = (uint8_t)(keepalive >> 8);
  buf[i++] = (uint8_t)(keepalive & 0xFF);

  // Payload: client ID
  buf[i++] = (uint8_t)(cid_len >> 8);
  buf[i++] = (uint8_t)(cid_len & 0xFF);
  memcpy(buf + i, client_id, cid_len);
  i += cid_len;

  return i;
}

// ── Build MQTT SUBSCRIBE ─────────────────────────────────────────────────────
static uint16_t _mqtt_build_subscribe(uint8_t* buf, uint16_t pkt_id,
                                       const char* topic, uint8_t qos) {
  uint16_t topic_len = (uint16_t)strlen(topic);
  uint16_t rem = 2 + 2 + topic_len + 1;  // pkt_id + topic_len + topic + qos

  uint16_t i = 0;
  buf[i++] = MQTT_PKT_SUBSCRIBE;
  i += _mqtt_encode_rem_len(rem, buf + i);

  // Packet ID
  buf[i++] = (uint8_t)(pkt_id >> 8);
  buf[i++] = (uint8_t)(pkt_id & 0xFF);

  // Topic
  buf[i++] = (uint8_t)(topic_len >> 8);
  buf[i++] = (uint8_t)(topic_len & 0xFF);
  memcpy(buf + i, topic, topic_len);
  i += topic_len;

  // Requested QoS
  buf[i++] = qos;

  return i;
}

// ── Build MQTT PUBLISH ───────────────────────────────────────────────────────
static uint16_t _mqtt_build_publish(uint8_t* buf, uint16_t buf_size,
                                      const char* topic,
                                      const uint8_t* payload, uint16_t payload_len,
                                      uint8_t qos, uint16_t pkt_id) {
  uint16_t topic_len = (uint16_t)strlen(topic);
  uint16_t rem = 2 + topic_len + payload_len;
  if (qos >= 1) rem += 2;  // packet ID for QoS 1+

  if (rem + 5 > buf_size) return 0;  // won't fit (5 = worst-case header)

  uint16_t i = 0;
  uint8_t flags = (qos << 1);  // QoS bits in positions 2-1
  buf[i++] = MQTT_PKT_PUBLISH | flags;
  i += _mqtt_encode_rem_len(rem, buf + i);

  // Topic
  buf[i++] = (uint8_t)(topic_len >> 8);
  buf[i++] = (uint8_t)(topic_len & 0xFF);
  memcpy(buf + i, topic, topic_len);
  i += topic_len;

  // Packet ID (QoS 1+)
  if (qos >= 1) {
    buf[i++] = (uint8_t)(pkt_id >> 8);
    buf[i++] = (uint8_t)(pkt_id & 0xFF);
  }

  // Payload
  memcpy(buf + i, payload, payload_len);
  i += payload_len;

  return i;
}

// ── Build MQTT PINGREQ ───────────────────────────────────────────────────────
static uint16_t _mqtt_build_pingreq(uint8_t* buf) {
  buf[0] = MQTT_PKT_PINGREQ;
  buf[1] = 0x00;
  return 2;
}

// ── Build MQTT DISCONNECT ─────────────────────────────────────────────────────
static uint16_t _mqtt_build_disconnect(uint8_t* buf) {
  buf[0] = MQTT_PKT_DISCONNECT;
  buf[1] = 0x00;
  return 2;
}

// ── Parse CONNACK ─────────────────────────────────────────────────────────────
static bool _mqtt_parse_connack(const uint8_t* buf, uint16_t len) {
  // CONNACK: 0x20, 0x02, session_present, return_code
  if (len < 4) return false;
  if (buf[0] != MQTT_PKT_CONNACK) return false;
  return (buf[3] == 0x00);  // return code 0 = accepted
}

// ── Parse SUBACK ──────────────────────────────────────────────────────────────
static bool _mqtt_parse_suback(const uint8_t* buf, uint16_t len,
                                uint16_t expect_pkt_id) {
  if (len < 5) return false;
  if (buf[0] != MQTT_PKT_SUBACK) return false;
  uint16_t pkt_id = ((uint16_t)buf[2] << 8) | buf[3];
  if (pkt_id != expect_pkt_id) return false;
  // At least one granted QoS >= 0
  return (buf[4] != 0x80);  // 0x80 = failure
}

// ── Parse PUBLISH (extract topic + payload info) ─────────────────────────────
typedef struct {
  char     topic[256];
  uint8_t  qos;
  uint16_t packet_id;
  uint16_t payload_offset;   // offset into original buffer
  uint16_t payload_len;
} RawMqttPublishInfo;

static bool _mqtt_parse_publish(const uint8_t* buf, uint16_t buf_len,
                                 RawMqttPublishInfo* info) {
  if (buf_len < 5) return false;
  uint8_t type = buf[0] & 0xF0;
  if (type != MQTT_PKT_PUBLISH) return false;

  info->qos = (buf[0] >> 1) & 0x03;

  uint32_t rem = 0;
  uint8_t hdr_len = _mqtt_decode_rem_len(buf + 1, buf_len - 1, &rem);
  if (hdr_len == 0) return false;
  uint16_t pos = 1 + hdr_len;

  // Topic
  if (pos + 2 > buf_len) return false;
  uint16_t topic_len = ((uint16_t)buf[pos] << 8) | buf[pos + 1];
  pos += 2;
  if (pos + topic_len > buf_len) return false;
  uint16_t copy = topic_len < 255 ? topic_len : 255;
  memcpy(info->topic, buf + pos, copy);
  info->topic[copy] = '\0';
  pos += topic_len;

  // Packet ID (QoS 1+)
  info->packet_id = 0;
  if (info->qos >= 1) {
    if (pos + 2 > buf_len) return false;
    info->packet_id = ((uint16_t)buf[pos] << 8) | buf[pos + 1];
    pos += 2;
  }

  info->payload_offset = pos;
  info->payload_len = (uint16_t)rem - (pos - 1 - hdr_len);
  return true;
}

// ══════════════════════════════════════════════════════════════════════════════
// TCP layer: AT+CIPOPEN / AT+CIPSEND / AT+CIPCLOSE
// ══════════════════════════════════════════════════════════════════════════════

// Wait for ">" prompt (reuse from task_mqtt_sim.h)
// _smq_wait_prompt is defined in task_mqtt_sim.h which is included before us.

static bool _raw_tcp_open(const char* host, uint16_t port) {
  char cmd[128];
  snprintf(cmd, sizeof(cmd), "AT+CIPOPEN=%d,\"TCP\",\"%s\",%d",
           MQTT_RAW_SOCK, host, port);
  Serial.printf("[RAW MQTT] >> %s\n", cmd);
  _sim_flush();
  _sim_ser.println(cmd);

  String r = "";
  uint32_t t = millis();
  while (millis() - t < MQTT_RAW_CIP_TIMEOUT) {
    while (_sim_ser.available()) r += (char)_sim_ser.read();
    // SIM7600: +CIPOPEN: <sock>,<err> — err=0 means success
    if (r.indexOf("+CIPOPEN: 0,0") >= 0 || r.indexOf("+CIPOPEN: 0") >= 0) {
      _raw_mqtt_sock_open = true;
      Serial.printf("[RAW MQTT] TCP connected (response: %s)\n", r.c_str());
      return true;
    }
    // Some firmware returns just "CONNECT" or "OK" after CIPOPEN
    if (r.indexOf("CONNECT") >= 0 && r.indexOf("DISCONNECT") < 0) {
      _raw_mqtt_sock_open = true;
      Serial.printf("[RAW MQTT] TCP CONNECT detected (response: %s)\n", r.c_str());
      return true;
    }
    if (r.indexOf("ERROR") >= 0) {
      r.trim();
      Serial.printf("[RAW MQTT] CIPOPEN ERROR: %s\n", r.c_str());
      return false;
    }
    // +CIPOPEN: with non-zero error code
    if (r.indexOf("+CIPOPEN:") >= 0 && r.indexOf("+CIPOPEN: 0,0") < 0) {
      r.trim();
      Serial.printf("[RAW MQTT] CIPOPEN failed: %s\n", r.c_str());
      return false;
    }
    delay(10);
  }
  Serial.printf("[RAW MQTT] CIPOPEN timeout (partial: %s)\n", r.c_str());
  return false;
}

static bool _raw_tcp_send(const uint8_t* data, uint16_t len) {
  // ── SIM7600G-H CIPSEND flow ──────────────────────────────────────────
  // This firmware does NOT send ">" prompt for AT+CIPSEND=<sock>,<len>.
  // Instead: send command, wait briefly for ERROR, then send data.
  // Modem counts bytes and responds with +CIPSEND: <sock>,<sent>,<acked>
  // or SEND OK depending on AT+CIPQSEND setting.
  // ─────────────────────────────────────────────────────────────────────

  _sim_flush();

  char cmd[48];
  snprintf(cmd, sizeof(cmd), "AT+CIPSEND=%d,%d", MQTT_RAW_SOCK, len);
  Serial.printf("[RAW MQTT] >> %s\n", cmd);
  _sim_ser.println(cmd);

  // Brief pause: check for immediate ERROR (bad socket, etc.)
  delay(50);
  String early = "";
  while (_sim_ser.available()) early += (char)_sim_ser.read();
  if (early.indexOf("ERROR") >= 0) {
    Serial.printf("[RAW MQTT] CIPSEND immediate ERROR: %s\n", early.c_str());
    return false;
  }

  // Send data immediately (no ">" prompt on this firmware)
  _sim_ser.write(data, len);
  Serial.printf("[RAW MQTT] Sent %d bytes\n", len);

  // Wait for +CIPSEND: or SEND OK or ERROR
  String r = early;  // include any early data
  uint32_t t = millis();
  while (millis() - t < 10000) {
    while (_sim_ser.available()) r += (char)_sim_ser.read();
    if (r.indexOf("SEND OK") >= 0 || r.indexOf("+CIPSEND:") >= 0) {
      Serial.printf("[RAW MQTT] Send confirmed: %s\n", r.c_str());
      return true;
    }
    if (r.indexOf("ERROR") >= 0) {
      Serial.printf("[RAW MQTT] CIPSEND error: %s\n", r.c_str());
      return false;
    }
    delay(10);
  }
  Serial.printf("[RAW MQTT] CIPSEND timeout. Response: %s\n", r.c_str());
  return false;
}

static void _raw_tcp_close() {
  char cmd[32];
  snprintf(cmd, sizeof(cmd), "AT+CIPCLOSE=%d", MQTT_RAW_SOCK);
  _sim_sendAT(cmd, "OK", 5000, true);
  _raw_mqtt_sock_open = false;
}

// ══════════════════════════════════════════════════════════════════════════════
// +IPD reception and MQTT frame reassembly
// ══════════════════════════════════════════════════════════════════════════════

// Drain Serial2, reading ALL available bytes into _raw_rx_buf.
// Then parse for +IPD markers and extract binary MQTT payload.
// Handles both SIM7600 +IPD formats:
//   CGACT:    +IPD,<sock>,<len>:<data>
//   NETOPEN:  \r\nRECV FROM:<ip>:<port>\r\n+IPD<len>\r\n<data>\r\n
// Also detects socket close URCs.
// Returns true if any MQTT data was appended to rx_buf.
// Must be called with sim_at_mutex held.
static bool _raw_drain_ipd() {
  if (!_sim_ser.available()) return false;

  // Read ALL available bytes from Serial2 into a temporary buffer
  // (use a local buffer first to avoid corrupting _raw_rx_buf with URC text)
  uint8_t tmp[512];
  uint16_t tmp_len = 0;
  uint32_t start = millis();

  while (millis() - start < 200 && tmp_len < sizeof(tmp)) {
    while (_sim_ser.available() && tmp_len < sizeof(tmp)) {
      uint8_t b = (uint8_t)_sim_ser.read();
      tmp[tmp_len++] = b;

      // Quick check for socket close URC while reading
      if (tmp_len >= 10) {
        // Check last 10 bytes for +IPCLOSE: or +CIPCLOSE:
        if ((tmp[tmp_len-10] == '+' && tmp[tmp_len-9] == 'I' && tmp[tmp_len-8] == 'P'
             && tmp[tmp_len-7] == 'C' && tmp[tmp_len-6] == 'L' && tmp[tmp_len-5] == 'O'
             && tmp[tmp_len-4] == 'S' && tmp[tmp_len-3] == 'E' && tmp[tmp_len-2] == ':')
            ||
            (tmp[tmp_len-10] == '+' && tmp[tmp_len-9] == 'C' && tmp[tmp_len-8] == 'I'
             && tmp[tmp_len-7] == 'P' && tmp[tmp_len-6] == 'C' && tmp[tmp_len-5] == 'L'
             && tmp[tmp_len-4] == 'O' && tmp[tmp_len-3] == 'S' && tmp[tmp_len-2] == 'E'
             && tmp[tmp_len-1] == ':')) {
          _raw_mqtt_sock_open = false;
          _raw_mqtt_connected = false;
          state_set_connected(false);
          Serial.println("[RAW MQTT] Socket closed by remote");
          return false;
        }
      }
    }
    if (!_sim_ser.available()) delay(5);
  }

  if (tmp_len == 0) return false;

  // Parse +IPD from the temporary buffer
  bool got_data = false;
  for (uint16_t si = 0; si < tmp_len; si++) {
    if (tmp[si] != '+' || si + 3 >= tmp_len) continue;
    if (tmp[si+1] != 'I' || tmp[si+2] != 'P' || tmp[si+3] != 'D') continue;

    // Found "+IPD" at position si
    uint16_t pos = si + 4;  // right after "D"

    // Skip comma if present (+IPD,<sock>,<len>:)
    if (pos < tmp_len && tmp[pos] == ',') {
      pos++;
      while (pos < tmp_len && tmp[pos] >= '0' && tmp[pos] <= '9') pos++;
      if (pos < tmp_len && tmp[pos] == ',') pos++;
    }

    // Parse length (digits after +IPD or after comma)
    int data_len = 0;
    while (pos < tmp_len && tmp[pos] >= '0' && tmp[pos] <= '9') {
      data_len = data_len * 10 + (tmp[pos] - '0');
      pos++;
    }

    // Skip colon if present (+IPD,<sock>,<len>:<data>)
    if (pos < tmp_len && tmp[pos] == ':') pos++;

    // Skip \r\n if present (+IPD<len>\r\n<data>)
    if (pos + 1 < tmp_len && tmp[pos] == '\r' && tmp[pos+1] == '\n') pos += 2;

    if (data_len > 0 && pos < tmp_len) {
      // Extract binary payload into _raw_rx_buf
      uint16_t avail = tmp_len - pos;
      uint16_t copy = (uint16_t)data_len < avail ? (uint16_t)data_len : avail;

      if (_raw_rx_len + copy > MQTT_RAW_RX_BUF_SIZE) {
        Serial.printf("[RAW MQTT] +IPD overflow: %d + %d > %d\n",
                      _raw_rx_len, copy, MQTT_RAW_RX_BUF_SIZE);
        _raw_rx_len = 0;
      }

      memcpy(_raw_rx_buf + _raw_rx_len, tmp + pos, copy);
      _raw_rx_len += copy;
      got_data = true;
      _raw_last_rx_ms = millis();
    }
    break;  // only process first +IPD per call
  }

  return got_data;
}

// Process all complete MQTT frames in _raw_rx_buf.
// Called WITHOUT sim_at_mutex (operates on local buffer only).
static void _raw_process_frames() {
  while (_raw_rx_len >= 2) {
    uint8_t pkt_type = _raw_rx_buf[0] & 0xF0;
    uint32_t rem = 0;
    uint8_t hdr_len = _mqtt_decode_rem_len(_raw_rx_buf + 1, _raw_rx_len - 1, &rem);
    if (hdr_len == 0) break;  // incomplete length encoding

    uint16_t total = 1 + hdr_len + (uint16_t)rem;
    if (_raw_rx_len < total) break;  // incomplete frame

    // Process complete frame
    switch (pkt_type) {
      case MQTT_PKT_CONNACK:
        if (_mqtt_parse_connack(_raw_rx_buf, total)) {
          Serial.println("[RAW MQTT] CONNACK — broker accepted");
          _raw_got_connack = true;
        } else {
          Serial.println("[RAW MQTT] CONNACK — broker rejected!");
          _raw_got_connack = false;
        }
        break;

      case MQTT_PKT_PUBLISH: {
        RawMqttPublishInfo info;
        if (_mqtt_parse_publish(_raw_rx_buf, total, &info)) {
          // Server heartbeat
          if (strcmp(info.topic, TOPIC_SERVER_HB) == 0) {
            xSemaphoreTake(state_mutex, portMAX_DELAY);
            sys_state.server_hb_ms = millis();
            xSemaphoreGive(state_mutex);
            state_set_connected(true);
            Serial.println("[RAW MQTT] Server heartbeat");
          }
          // Config message
          else if (strcmp(info.topic, sys_state.topic_config) == 0) {
            char payload_buf[1025];
            uint16_t copy_len = info.payload_len < 1024 ? info.payload_len : 1024;
            memcpy(payload_buf, _raw_rx_buf + info.payload_offset, copy_len);
            payload_buf[copy_len] = '\0';

            if (strstr(payload_buf, "set_node_interval")) {
              int ctrl_id = 0, port_num = 0;
              uint32_t interval_ms = 0;
              const char* p;
              if ((p = strstr(payload_buf, "\"ctrl_id\":")))     ctrl_id     = atoi(p + 10);
              if ((p = strstr(payload_buf, "\"port_num\":")))    port_num    = atoi(p + 11);
              if ((p = strstr(payload_buf, "\"interval_ms\":"))) interval_ms = (uint32_t)atoi(p + 14);
              if (ctrl_id > 0 && port_num > 0 && interval_ms > 0) {
                nc_set((uint8_t)ctrl_id, (uint8_t)port_num, interval_ms);
              }
            }
          } else {
            Serial.printf("[RAW MQTT] PUBLISH topic=%s len=%d\n",
                          info.topic, info.payload_len);
          }

          // Send PUBACK for QoS 1
          if (info.qos >= 1 && _raw_mqtt_sock_open) {
            uint8_t puback[4] = {
              MQTT_PKT_PUBACK, 0x02,
              (uint8_t)(info.packet_id >> 8),
              (uint8_t)(info.packet_id & 0xFF)
            };
            if (xSemaphoreTake(sim_at_mutex, pdMS_TO_TICKS(3000)) == pdTRUE) {
              _raw_tcp_send(puback, 4);
              xSemaphoreGive(sim_at_mutex);
            }
          }
        }
        break;
      }

      case MQTT_PKT_SUBACK:
        Serial.println("[RAW MQTT] SUBACK received");
        break;

      case MQTT_PKT_PINGRESP:
        // Silent — just consume the frame
        break;

      default:
        Serial.printf("[RAW MQTT] Unknown pkt 0x%02X\n", pkt_type);
        break;
    }

    // Shift remaining data
    if (total < _raw_rx_len) {
      memmove(_raw_rx_buf, _raw_rx_buf + total, _raw_rx_len - total);
    }
    _raw_rx_len -= total;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// MQTT lifecycle
// ══════════════════════════════════════════════════════════════════════════════

static bool _raw_mqtt_connect() {
  _raw_rx_len = 0;
  _raw_got_connack = false;

  // Take mutex for entire connect sequence — prevents other tasks from
  // flushing Serial2 and discarding +IPD CONNACK data
  if (xSemaphoreTake(sim_at_mutex, pdMS_TO_TICKS(65000)) != pdTRUE) {
    Serial.println("[RAW MQTT] Cannot take mutex for connect");
    return false;
  }

  // Read broker host
  char host[64];
  xSemaphoreTake(state_mutex, portMAX_DELAY);
  strncpy(host, sys_state.mqtt_host, sizeof(host) - 1);
  host[sizeof(host) - 1] = '\0';
  xSemaphoreGive(state_mutex);

  // Step 0: Clean up any previous socket
  _sim_sendAT("AT+CIPCLOSE=0", "OK", 3000, true);  // ignore error

  // Step 1: Open TCP
  Serial.printf("[RAW MQTT] TCP connect %s:%d\n", host, MQTT_PORT);
  if (!_raw_tcp_open(host, MQTT_PORT)) {
    xSemaphoreGive(sim_at_mutex);
    return false;
  }

  // Drain any leftover URCs after socket open
  _sim_flush();
  delay(500);  // Give modem a moment to settle

  // Step 2: Send MQTT CONNECT
  char client_id[40];
  snprintf(client_id, sizeof(client_id), "%s-raw", sys_state.device_id);

  uint8_t connect_buf[256];
  uint16_t connect_len = _mqtt_build_connect(connect_buf, client_id, MQTT_KEEPALIVE);
  Serial.printf("[RAW MQTT] CONNECT packet: %d bytes (client_id=%s)\n", connect_len, client_id);
  if (!_raw_tcp_send(connect_buf, connect_len)) {
    Serial.println("[RAW MQTT] CONNECT send failed");
    _raw_tcp_close();
    xSemaphoreGive(sim_at_mutex);
    return false;
  }

  // Step 3: Wait for CONNACK (mutex is still held!)
  Serial.println("[RAW MQTT] Waiting for CONNACK (mutex held)...");
  uint32_t t = millis();
  bool connack_received = false;

  while (millis() - t < 15000) {
    // Read ALL available bytes from Serial2 into rx_buf
    uint16_t prev_len = _raw_rx_len;
    while (_sim_ser.available() && _raw_rx_len < MQTT_RAW_RX_BUF_SIZE) {
      _raw_rx_buf[_raw_rx_len++] = (uint8_t)_sim_ser.read();
    }

    if (_raw_rx_len > prev_len && (millis() - t) < 8000) {
      Serial.printf("[RAW MQTT] RX +%d bytes (total %d): ", _raw_rx_len - prev_len, _raw_rx_len);
      for (uint16_t i = prev_len; i < _raw_rx_len && i < prev_len + 80; i++) {
        uint8_t b = _raw_rx_buf[i];
        if (b >= 0x20 && b < 0x7F) Serial.write(b);
        else Serial.printf("\\x%02X", b);
      }
      Serial.println();
    }

    // ── Parse +IPD from rx_buf ──────────────────────────────────────────
    // SIM7600 NETOPEN +IPD formats seen:
    //   +IPD,<sock>,<len>:<data>        (CGACT path)
    //   +IPD<len>\r\n<data>             (NETOPEN path — NO comma, NO colon!)
    //   \r\nRECV FROM:<ip>:<port>\r\n+IPD<len>\r\n<data>\r\n
    // Also: the buffer may start with "RECV FROM:" prefix text.
    //
    // Strategy: search for "+IPD" anywhere in the buffer, parse the
    // length, skip to data, extract binary payload into start of rx_buf.
    bool ipd_extracted = false;
    for (uint16_t si = 0; si < _raw_rx_len; si++) {
      if (_raw_rx_buf[si] != '+' || si + 3 >= _raw_rx_len) continue;
      if (_raw_rx_buf[si+1] != 'I' || _raw_rx_buf[si+2] != 'P'
          || _raw_rx_buf[si+3] != 'D') continue;

      // Found "+IPD" at position si
      uint16_t pos = si + 4;  // right after "D"

      // Skip comma if present (+IPD,<sock>,<len>:)
      if (pos < _raw_rx_len && _raw_rx_buf[pos] == ',') {
        pos++;
        // Skip socket number
        while (pos < _raw_rx_len && _raw_rx_buf[pos] >= '0' && _raw_rx_buf[pos] <= '9') pos++;
        if (pos < _raw_rx_len && _raw_rx_buf[pos] == ',') pos++;
      }

      // Parse length (digits after +IPD or after comma)
      int data_len = 0;
      while (pos < _raw_rx_len && _raw_rx_buf[pos] >= '0' && _raw_rx_buf[pos] <= '9') {
        data_len = data_len * 10 + (_raw_rx_buf[pos] - '0');
        pos++;
      }

      // Skip colon if present (+IPD,<sock>,<len>:<data>)
      if (pos < _raw_rx_len && _raw_rx_buf[pos] == ':') pos++;

      // Skip \r\n if present (+IPD<len>\r\n<data>)
      if (pos + 1 < _raw_rx_len && _raw_rx_buf[pos] == '\r' && _raw_rx_buf[pos+1] == '\n') pos += 2;

      if (data_len > 0 && pos < _raw_rx_len) {
        // Extract binary payload
        uint16_t avail = _raw_rx_len - pos;
        uint16_t copy = (uint16_t)data_len < avail ? (uint16_t)data_len : avail;
        memmove(_raw_rx_buf, _raw_rx_buf + pos, copy);
        _raw_rx_len = copy;
        Serial.printf("[RAW MQTT] +IPD: len=%d, extracted %d bytes\n", data_len, copy);
        ipd_extracted = true;
      }
      break;  // only process first +IPD
    }

    // If no +IPD found, try to find MQTT frame directly
    // (in case +IPD was already processed or data came without +IPD wrapper)
    if (!ipd_extracted && _raw_rx_len >= 2) {
      // Check if buffer starts with a valid MQTT packet type
      uint8_t pkt_type = _raw_rx_buf[0] & 0xF0;
      if (pkt_type >= 0x10 && pkt_type <= 0xE0 && pkt_type != 0x00) {
        // Looks like raw MQTT — skip any leading CRLF
        uint16_t start = 0;
        while (start < _raw_rx_len && (_raw_rx_buf[start] == '\r' || _raw_rx_buf[start] == '\n'))
          start++;
        if (start > 0 && start < _raw_rx_len) {
          memmove(_raw_rx_buf, _raw_rx_buf + start, _raw_rx_len - start);
          _raw_rx_len -= start;
        }
      }
    }

    // Process MQTT frames in buffer
    _raw_process_frames();
    if (_raw_got_connack) { connack_received = true; break; }

    delay(10);  // Small delay, but keep mutex held
  }

  xSemaphoreGive(sim_at_mutex);  // Finally release mutex

  if (!connack_received) {
    Serial.printf("[RAW MQTT] CONNACK timeout (waited %d ms, rx_len=%d)\n",
                  (int)(millis() - t), _raw_rx_len);
    if (_raw_rx_len > 0) {
      Serial.print("[RAW MQTT] rx_buf: ");
      for (uint16_t i = 0; i < _raw_rx_len && i < 64; i++) {
        Serial.printf("%02X ", _raw_rx_buf[i]);
      }
      Serial.println();
    }
    _raw_tcp_close();
    return false;
  }

  // Step 4: Subscribe
  uint8_t sub_buf[256];

  // Server heartbeat (QoS 0)
  _raw_sub_pkt_id = 1;
  uint16_t sub_len = _mqtt_build_subscribe(sub_buf, _raw_sub_pkt_id,
                                             TOPIC_SERVER_HB, 0);
  _raw_tcp_send(sub_buf, sub_len);
  _raw_sub_pkt_id++;

  delay(200);

  // Config topic (QoS 1)
  sub_len = _mqtt_build_subscribe(sub_buf, _raw_sub_pkt_id,
                                    sys_state.topic_config, 1);
  _raw_tcp_send(sub_buf, sub_len);

  _raw_last_ping_ms = millis();
  _raw_last_rx_ms = millis();
  _raw_mqtt_connected = true;
  _raw_got_connack = false;

  Serial.println("[RAW MQTT] Connected, subscribed");
  return true;
}

static bool _raw_mqtt_pub(const char* topic, const char* payload,
                           uint16_t len, uint8_t qos) {
  uint8_t pub_buf[MQTT_RAW_SEND_BUF];
  uint16_t pub_len = _mqtt_build_publish(pub_buf, sizeof(pub_buf),
                                            topic,
                                            (const uint8_t*)payload, len,
                                            qos,
                                            qos >= 1 ? _raw_pub_pkt_id++ : 0);
  if (pub_len == 0) {
    Serial.println("[RAW MQTT] Publish too large for send buffer");
    return false;
  }
  return _raw_tcp_send(pub_buf, pub_len);
}

static void _raw_mqtt_keepalive() {
  if ((millis() - _raw_last_ping_ms) >= ((uint32_t)MQTT_KEEPALIVE * 500UL)) {
    uint8_t ping[2];
    _mqtt_build_pingreq(ping);
    if (_raw_tcp_send(ping, 2)) {
      _raw_last_ping_ms = millis();
    }
  }
}

static void _raw_mqtt_disconnect() {
  if (_raw_mqtt_sock_open) {
    uint8_t disc[2];
    _mqtt_build_disconnect(disc);
    _raw_tcp_send(disc, 2);
    delay(100);
    _raw_tcp_close();
  }
  _raw_mqtt_connected = false;
  _raw_mqtt_sock_open = false;
  _raw_rx_len = 0;
}

// Init (called from mqtt_sim_init)
static void _raw_mqtt_init() {
  _raw_mqtt_connected = false;
  _raw_mqtt_sock_open = false;
  _raw_rx_len = 0;
  _raw_pub_pkt_id = 1;
}