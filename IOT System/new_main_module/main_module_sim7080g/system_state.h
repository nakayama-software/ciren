#pragma once
#include <Arduino.h>
#include "ciren_config.h"

// ── Per-controller node registry (populated from ESP-NOW ISR) ──────────────
typedef struct {
  uint8_t  port_num;
  uint8_t  stype_count;
  uint8_t  stypes[MAX_STYPES_PER_PORT];
} CtrlPortInfo;

typedef struct {
  uint8_t      ctrl_id;
  uint32_t     last_seen_ms;
  uint8_t      port_count;
  CtrlPortInfo ports[MAX_PORTS_PER_CTRL];
} CtrlInfo;

typedef struct {
  char     device_id[32];    // runtime device ID — generate dari MAC, bisa di-override via portal
  char     topic_data[72];   // "ciren/data/{device_id}"
  char     topic_status[72];
  char     topic_hello[72];
  char     topic_config[72];
  char     topic_log[72];
  bool     is_connected;
  char     conn_mode[8];
  int8_t   rssi;
  uint8_t  batt_pct;
  uint32_t last_publish_ms;
  uint16_t err_counter;
  uint32_t agg_window_ms;
  bool     sim_enabled;
  bool     sim_modem_ok;
  bool     sim_gprs;
  uint8_t  sim_pdp_method;   // 0=none, 1=CGACT, 2=NETOPEN
  int8_t   sim_signal;
  char     sim_operator[24];
  uint16_t peer_count;
  bool     last_post_ok;
  int      last_status_code;
  char     mqtt_host[64];
  uint32_t server_hb_ms;   // millis() of last received server heartbeat (0 = never)
  char     sim_apn[64];
  char     sim_apn_user[32];
  char     sim_apn_pass[32];
  bool     ntp_synced;           // true setelah NTP sync berhasil
  int64_t  ntp_epoch_offset_ms;  // epoch_ms = ntp_epoch_offset_ms + millis()
                                 // contoh: jika NTP returns 1700000000 dan millis()=5000
                                 // maka ntp_epoch_offset_ms = 1700000000000 - 5000
} SystemState;

// Deklarasi extern — definisi ada di main_module.ino
extern SystemState       sys_state;
extern SemaphoreHandle_t state_mutex;

// Per-controller info — defined in task_espnow_rx.h (ISR writer)
extern CtrlInfo          _ctrl_info[MAX_CTRL_IDS];
extern volatile uint8_t  _ctrl_info_count;

// Build topic strings dari device_id yang sudah diset — panggil setelah device_id di-set
void state_build_topics() {
  snprintf(sys_state.topic_data,   sizeof(sys_state.topic_data),   "ciren/data/%s",   sys_state.device_id);
  snprintf(sys_state.topic_status, sizeof(sys_state.topic_status), "ciren/status/%s", sys_state.device_id);
  snprintf(sys_state.topic_hello,  sizeof(sys_state.topic_hello),  "ciren/hello/%s",  sys_state.device_id);
  snprintf(sys_state.topic_config, sizeof(sys_state.topic_config), "ciren/config/%s", sys_state.device_id);
  snprintf(sys_state.topic_log,    sizeof(sys_state.topic_log),    "ciren/log/%s",    sys_state.device_id);
}

void state_init() {
  memset(&sys_state, 0, sizeof(sys_state));
  sys_state.agg_window_ms = 50;
  sys_state.sim_enabled   = true;
  strncpy(sys_state.conn_mode, "wifi", sizeof(sys_state.conn_mode));
}

void state_set_connected(bool v) {
  if (!state_mutex) return;
  xSemaphoreTake(state_mutex, portMAX_DELAY);
  sys_state.is_connected = v;
  xSemaphoreGive(state_mutex);
}

bool state_is_connected() {
  if (!state_mutex) return false;
  xSemaphoreTake(state_mutex, portMAX_DELAY);
  bool v = sys_state.is_connected;
  xSemaphoreGive(state_mutex);
  return v;
}

// ── Epoch timestamp helpers ──────────────────────────────────────────────────
// Return epoch seconds (Unix timestamp) or epoch milliseconds.
// Falls back to monotonic millis() if NTP has not synced yet.
// ntp_epoch_offset_ms is written by task_ntp and read by other tasks;
// on 32-bit ESP32, int64_t reads are NOT atomic, so we take state_mutex
// for safety.  The relaxed-read path (no mutex) is provided for ISR
// contexts where mutex is unavailable — a torn 64-bit read is extremely
// unlikely (only two 32-bit halves, both 0 after memset) and self-corrects
// on the next NTP sync.

static inline uint32_t state_epoch_s() {
  if (!sys_state.ntp_synced) return (uint32_t)(millis() / 1000);
  xSemaphoreTake(state_mutex, portMAX_DELAY);
  uint32_t s = (uint32_t)((sys_state.ntp_epoch_offset_ms + (int64_t)millis()) / 1000);
  xSemaphoreGive(state_mutex);
  return s;
}

static inline uint32_t state_epoch_ms() {
  if (!sys_state.ntp_synced) return (uint32_t)millis();
  xSemaphoreTake(state_mutex, portMAX_DELAY);
  uint32_t ms = (uint32_t)(sys_state.ntp_epoch_offset_ms + (int64_t)millis());
  xSemaphoreGive(state_mutex);
  return ms;
}

// ISR-safe variant — no mutex (torn 64-bit read possible but self-corrects)
static inline uint32_t state_epoch_ms_isr() {
  if (!sys_state.ntp_synced) return (uint32_t)millis();
  // Relaxed read — no mutex in ISR
  return (uint32_t)(sys_state.ntp_epoch_offset_ms + (int64_t)millis());
}

// Convert a specific millis() value to epoch seconds (thread-safe).
// If NTP not synced, returns monotonic seconds since boot.
static inline uint32_t state_epoch_s_at(uint32_t ms) {
  if (!sys_state.ntp_synced) return ms / 1000;
  xSemaphoreTake(state_mutex, portMAX_DELAY);
  uint32_t s = (uint32_t)((sys_state.ntp_epoch_offset_ms + (int64_t)ms) / 1000);
  xSemaphoreGive(state_mutex);
  return s;
}