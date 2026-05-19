#pragma once
#include <Arduino.h>

typedef struct {
  char     device_id[32];    // runtime device ID — generate dari MAC, bisa di-override via portal
  char     topic_data[72];   // "ciren/data/{device_id}"
  char     topic_status[72];
  char     topic_hello[72];
  char     topic_config[72];
  bool     is_connected;
  char     conn_mode[8];
  float    gps_lat;
  float    gps_lon;
  bool     gps_fix;
  uint32_t gps_fix_ms;
  float    gps_alt;
  float    gps_speed;
  char     gps_ts[24];
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
} SystemState;

// Deklarasi extern — definisi ada di main_module.ino
extern SystemState       sys_state;
extern SemaphoreHandle_t state_mutex;

// Build topic strings dari device_id yang sudah diset — panggil setelah device_id di-set
void state_build_topics() {
  snprintf(sys_state.topic_data,   sizeof(sys_state.topic_data),   "ciren/data/%s",   sys_state.device_id);
  snprintf(sys_state.topic_status, sizeof(sys_state.topic_status), "ciren/status/%s", sys_state.device_id);
  snprintf(sys_state.topic_hello,  sizeof(sys_state.topic_hello),  "ciren/hello/%s",  sys_state.device_id);
  snprintf(sys_state.topic_config, sizeof(sys_state.topic_config), "ciren/config/%s", sys_state.device_id);
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