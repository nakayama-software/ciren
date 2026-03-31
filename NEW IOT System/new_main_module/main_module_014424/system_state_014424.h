#pragma once
#include <Arduino.h>

typedef struct {
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
  int8_t   sim_signal;
  char     sim_operator[24];
  uint16_t peer_count;
  bool     last_post_ok;
  int      last_status_code;
} SystemState;

// Deklarasi extern — definisi ada di main_module.ino
extern SystemState       sys_state;
extern SemaphoreHandle_t state_mutex;

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