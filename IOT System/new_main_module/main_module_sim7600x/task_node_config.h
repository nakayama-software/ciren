#pragma once
#include <Preferences.h>
#include <esp_now.h>
#include "ciren_config.h"
#include "system_state.h"
#include "ring_buffer.h"   // for SensorPacket

// ─────────────────────────────────────────────────────────────────────────────
// Node interval config — stores per-(ctrl_id, port_num) forward interval.
//
// Lifecycle:
//   1. Backend sends MQTT config: { action:"set_node_interval", ctrl_id, port_num, interval_ms }
//   2. Main module parses, calls nc_set() → saves to NVS, sends ConfigPacket via ESP-NOW
//   3. Sensor controller applies interval, sends CONFIG_ACK
//   4. Main module receives ACK → clears pending retry state
//   5. On sensor controller HELLO (port_num==0), main module calls nc_resync_ctrl()
//      to re-send all stored configs for that ctrl_id (handles reboot case)
// ─────────────────────────────────────────────────────────────────────────────

typedef struct {
  uint8_t  ctrl_id;
  uint8_t  port_num;
  uint32_t interval_ms;
} NodeConfigEntry;

static NodeConfigEntry _nc_entries[MAX_NODE_CONFIGS];
static uint8_t         _nc_count = 0;
static Preferences     _nc_prefs;

// ── Pending ACK tracking ─────────────────────────────────────────────────────
typedef struct {
  uint8_t  ctrl_id;
  uint8_t  port_num;
  uint32_t interval_ms;
  uint32_t sent_at_ms;
  uint8_t  retries;
  bool     active;
} PendingAckEntry;

#define MAX_PENDING_ACKS 16
static PendingAckEntry _pending_acks[MAX_PENDING_ACKS];

// Mutex for _nc_entries (accessed from MQTT task and espnow task)
static SemaphoreHandle_t _nc_mutex = NULL;

// ── Forward declaration ───────────────────────────────────────────────────────
void nc_send_espnow(uint8_t ctrl_id, uint8_t port_num, uint32_t interval_ms);

// ── NVS persistence ──────────────────────────────────────────────────────────
static void _nc_nvs_save() {
  _nc_prefs.begin("nodecfg", false);
  _nc_prefs.putBytes("entries", _nc_entries, sizeof(NodeConfigEntry) * _nc_count);
  _nc_prefs.putUChar("count",   _nc_count);
  _nc_prefs.end();
}

static void _nc_nvs_load() {
  _nc_prefs.begin("nodecfg", true);
  uint8_t cnt = _nc_prefs.getUChar("count", 0);
  if (cnt > MAX_NODE_CONFIGS) cnt = 0;
  if (cnt > 0) {
    _nc_prefs.getBytes("entries", _nc_entries, sizeof(NodeConfigEntry) * cnt);
    _nc_count = cnt;
  }
  _nc_prefs.end();
  Serial.printf("[NC] Loaded %d node config(s) from NVS\n", _nc_count);
}

// ── Init ─────────────────────────────────────────────────────────────────────
void nc_init() {
  _nc_mutex = xSemaphoreCreateMutex();
  memset(_pending_acks, 0, sizeof(_pending_acks));
  _nc_nvs_load();
}

// ── Find entry (call with mutex held) ────────────────────────────────────────
static int _nc_find(uint8_t ctrl_id, uint8_t port_num) {
  for (int i = 0; i < _nc_count; i++) {
    if (_nc_entries[i].ctrl_id == ctrl_id && _nc_entries[i].port_num == port_num)
      return i;
  }
  return -1;
}

// ── Public: set interval for a node ──────────────────────────────────────────
// Called when MQTT config message arrives.
void nc_set(uint8_t ctrl_id, uint8_t port_num, uint32_t interval_ms) {
  xSemaphoreTake(_nc_mutex, portMAX_DELAY);

  int idx = _nc_find(ctrl_id, port_num);
  if (idx >= 0) {
    _nc_entries[idx].interval_ms = interval_ms;
  } else if (_nc_count < MAX_NODE_CONFIGS) {
    _nc_entries[_nc_count++] = { ctrl_id, port_num, interval_ms };
  } else {
    Serial.println("[NC] config table full");
    xSemaphoreGive(_nc_mutex);
    return;
  }
  _nc_nvs_save();
  xSemaphoreGive(_nc_mutex);

  Serial.printf("[NC] Set ctrl=%d port=%d interval=%lu ms\n",
                ctrl_id, port_num, interval_ms);
  nc_send_espnow(ctrl_id, port_num, interval_ms);
}

// ── Public: ACK received from sensor controller ───────────────────────────────
void nc_on_ack(uint8_t ctrl_id, uint8_t port_num) {
  for (int i = 0; i < MAX_PENDING_ACKS; i++) {
    if (_pending_acks[i].active &&
        _pending_acks[i].ctrl_id  == ctrl_id &&
        _pending_acks[i].port_num == port_num) {
      _pending_acks[i].active = false;
      Serial.printf("[NC] ACK ctrl=%d port=%d\n", ctrl_id, port_num);
      return;
    }
  }
}

// ── Public: re-send all stored configs for a ctrl_id (after HELLO) ───────────
void nc_resync_ctrl(uint8_t ctrl_id) {
  xSemaphoreTake(_nc_mutex, portMAX_DELAY);
  int found = 0;
  for (int i = 0; i < _nc_count; i++) {
    if (_nc_entries[i].ctrl_id == ctrl_id) {
      nc_send_espnow(ctrl_id, _nc_entries[i].port_num, _nc_entries[i].interval_ms);
      found++;
    }
  }
  xSemaphoreGive(_nc_mutex);
  if (found) Serial.printf("[NC] Resync %d config(s) → ctrl=%d\n", found, ctrl_id);
}

// ── Send ConfigPacket via ESP-NOW + register pending ACK ─────────────────────
void nc_send_espnow(uint8_t ctrl_id, uint8_t port_num, uint32_t interval_ms) {
  // Find a free pending slot
  int slot = -1;
  for (int i = 0; i < MAX_PENDING_ACKS; i++) {
    if (!_pending_acks[i].active ||
        (_pending_acks[i].ctrl_id == ctrl_id && _pending_acks[i].port_num == port_num)) {
      slot = i;
      break;
    }
  }
  if (slot < 0) {
    // Table full — overwrite oldest
    slot = 0;
    for (int i = 1; i < MAX_PENDING_ACKS; i++) {
      if (_pending_acks[i].sent_at_ms < _pending_acks[slot].sent_at_ms) slot = i;
    }
  }
  _pending_acks[slot] = {
    ctrl_id, port_num, interval_ms,
    (uint32_t)millis(), 0, true
  };

  // Build ConfigPacket reusing SensorPacket layout
  SensorPacket pkt;
  pkt.ctrl_id      = ctrl_id;
  pkt.port_num     = port_num;
  pkt.sensor_type  = 0;
  pkt.value        = (float)interval_ms;
  pkt.timestamp_ms = (uint32_t)millis();
  pkt.ftype        = FTYPE_CONFIG;

  // Broadcast to all registered ESP-NOW peers
  // (sensor controller will filter by ctrl_id match)
  esp_now_send(nullptr, (uint8_t*)&pkt, sizeof(pkt));
  Serial.printf("[NC] → ConfigPacket ctrl=%d port=%d interval=%lu ms\n",
                ctrl_id, port_num, interval_ms);
}

// ── Task: retry loop ──────────────────────────────────────────────────────────
void task_node_config(void* param) {
  for (;;) {
    vTaskDelay(pdMS_TO_TICKS(200));

    uint32_t now = millis();
    for (int i = 0; i < MAX_PENDING_ACKS; i++) {
      PendingAckEntry& p = _pending_acks[i];
      if (!p.active) continue;
      if (now - p.sent_at_ms < NODE_CONFIG_ACK_MS) continue;

      if (p.retries >= NODE_CONFIG_RETRIES) {
        Serial.printf("[NC] No ACK after %d retries ctrl=%d port=%d — giving up\n",
                      NODE_CONFIG_RETRIES, p.ctrl_id, p.port_num);
        p.active = false;
        continue;
      }

      p.retries++;
      p.sent_at_ms = now;
      SensorPacket pkt;
      pkt.ctrl_id      = p.ctrl_id;
      pkt.port_num     = p.port_num;
      pkt.sensor_type  = 0;
      pkt.value        = (float)p.interval_ms;
      pkt.timestamp_ms = now;
      pkt.ftype        = FTYPE_CONFIG;
      esp_now_send(nullptr, (uint8_t*)&pkt, sizeof(pkt));
      Serial.printf("[NC] Retry %d ctrl=%d port=%d\n", p.retries, p.ctrl_id, p.port_num);
    }
  }
}