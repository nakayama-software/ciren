#pragma once
// ─────────────────────────────────────────────────────────────────────────────
// SIM7600X GPS task — uses AT+CGPS built-in GPS commands.
//
// The SIM7600X has an integrated GNSS receiver. AT commands:
//   AT+CGPS=1,1       → start GPS (standalone mode)
//   AT+CGPS=0          → stop GPS
//   AT+CGPSINFO         → get fix info (lat, lon, alt, speed, course, UTC)
//
// This task polls GPS info every GPS_POLL_MS and updates sys_state.
// It must be started AFTER sim_manager_task has initialized the modem.
//
// Requires: task_sim_manager.h included first (defines _sim_ser,
//           sim_at_mutex, _sim_sendAT, _sim_atReply, _sim_flush).
// ─────────────────────────────────────────────────────────────────────────────

#include <Arduino.h>
#include "ciren_config.h"
#include "system_state.h"

static bool _gps_started = false;
static uint32_t _gps_start_retry_ms = 0;  // last _gps_start() attempt timestamp

// ── Parse AT+CGPSINFO response ────────────────────────────────────────────────
// Response format: +CGPSINFO: [<lat>],[<N/S>],[<lon>],[<E/W>],[<date>],[<UTC_time>],[<alt>],[<speed_km>],[<course>]
// Example: +CGPSINFO: 35.123456,N,139.123456,E,2025/04/10,12:34:56,50.0,10.0,0.0
// Or empty if no fix: +CGPSINFO: ,,,,,,,,
static void _gps_parse_info(const String& info) {
  // Check for empty fix: all fields blank
  if (info.indexOf(",,,,,,,") >= 0) {
    xSemaphoreTake(state_mutex, portMAX_DELAY);
    sys_state.gps_fix = false;
    xSemaphoreGive(state_mutex);
    return;
  }

  // Parse +CGPSINFO: line
  int colon = info.indexOf(':');
  if (colon < 0) return;
  String data = info.substring(colon + 1);
  data.trim();

  // Split by comma
  // Format: lat,N/S,lon,E/W,date,time,alt,speed_km,course
  // We need: lat, N/S, lon, E/W, alt, speed
  float lat = 0.0f, lon = 0.0f, alt = 0.0f, speed_km = 0.0f;
  char ns = 'N', ew = 'E';
  int field = 0;
  int start = 0;

  for (int i = 0; i <= (int)data.length(); i++) {
    if (i == (int)data.length() || data[i] == ',') {
      String val = data.substring(start, i);
      val.trim();

      switch (field) {
        case 0: lat = val.toFloat(); break;       // latitude (DDMM.MMMMM)
        case 1: ns = (val.length() > 0) ? val[0] : 'N'; break;  // N/S
        case 2: lon = val.toFloat(); break;       // longitude (DDDMM.MMMMM)
        case 3: ew = (val.length() > 0) ? val[0] : 'E'; break;  // E/W
        case 6: alt = val.toFloat(); break;        // altitude (meters)
        case 7: speed_km = val.toFloat(); break;   // speed (km/h)
      }
      start = i + 1;
      field++;
    }
  }

  // SIM7600X returns coordinates in DDMM.MMMMM format — convert to decimal degrees
  // Latitude: DDMM.MMMMM → DD + MM/60
  // Longitude: DDDMM.MMMMM → DDD + MM/60
  float lat_deg = 0.0f, lon_deg = 0.0f;
  if (lat != 0.0f) {
    int lat_dd = (int)(lat / 100);
    float lat_mm = lat - (lat_dd * 100);
    lat_deg = lat_dd + lat_mm / 60.0f;
    if (ns == 'S') lat_deg = -lat_deg;
  }
  if (lon != 0.0f) {
    int lon_dd = (int)(lon / 100);
    float lon_mm = lon - (lon_dd * 100);
    lon_deg = lon_dd + lon_mm / 60.0f;
    if (ew == 'W') lon_deg = -lon_deg;
  }

  bool valid_fix = (lat_deg != 0.0f || lon_deg != 0.0f);
  float speed_ms = speed_km / 3.6f;  // convert km/h to m/s

  xSemaphoreTake(state_mutex, portMAX_DELAY);
  sys_state.gps_lat    = lat_deg;
  sys_state.gps_lon    = lon_deg;
  sys_state.gps_fix    = valid_fix;
  sys_state.gps_fix_ms = millis();
  sys_state.gps_alt    = alt;
  sys_state.gps_speed  = speed_ms;
  // Timestamp: use current time as approximation
  snprintf(sys_state.gps_ts, sizeof(sys_state.gps_ts), "%lu", millis());
  xSemaphoreGive(state_mutex);

  if (valid_fix) {
    Serial.printf("[GPS] Fix: lat=%.6f lon=%.6f alt=%.1f speed=%.1f km/h\n",
                  lat_deg, lon_deg, alt, speed_km);
  }
}

// ── Public: start GPS ─────────────────────────────────────────────────────────
static bool _gps_start() {
  if (_gps_started) return true;

  // Start GPS in standalone mode
  if (!_sim_sendAT("AT+CGPS=1,1", "OK", 5000)) {
    Serial.println("[GPS] Failed to start GPS");
    return false;
  }

  _gps_started = true;
  Serial.println("[GPS] Started (standalone mode)");
  return true;
}

// ── GPS task ──────────────────────────────────────────────────────────────────
// NOTE: On SIM7600G-H (Waveshare), AT+CGPS=1,1 consistently fails.
// GPS polling is skipped when raw TCP MQTT is connected to avoid
// AT+CGPSINFO responses interfering with CIPSEND/+IPD data.
void task_gps(void* param) {
  // Wait for modem to be ready
  for (;;) {
    if (sys_state.sim_modem_ok && sys_state.sim_gprs) break;
    vTaskDelay(pdMS_TO_TICKS(5000));
  }

  // Try to start GPS (will likely fail on SIM7600G-H)
  if (!_gps_start()) {
    Serial.println("[GPS] Could not start GPS — will retry every 60s");
  }
  _gps_start_retry_ms = millis();

  uint32_t last_poll_ms = 0;

  for (;;) {
    vTaskDelay(pdMS_TO_TICKS(GPS_POLL_MS));

    // Only poll GPS when SIM mode is active
    char mode[8];
    xSemaphoreTake(state_mutex, portMAX_DELAY);
    strncpy(mode, sys_state.conn_mode, sizeof(mode));
    xSemaphoreGive(state_mutex);

    if (strcmp(mode, "sim") != 0) {
      continue;
    }

    // ── Skip GPS entirely when raw TCP MQTT is active ──────────────────
    // AT+CGPSINFO on the shared Serial2 bus corrupts CIPSEND responses
    // by mixing "+CGPSINFO: ,,,,,,,," into the CIPSEND confirmation data.
    if (_raw_mqtt_connected) {
      continue;
    }

    if (!_gps_started) {
      // Retry GPS start every 60 seconds (not every poll cycle)
      uint32_t now = millis();
      if (now - _gps_start_retry_ms >= 60000UL) {
        if (sys_state.sim_modem_ok && sys_state.sim_gprs) {
          _gps_start();
        }
        _gps_start_retry_ms = now;
      }
      continue;
    }

    // Poll GPS info — use mutex to share AT bus
    if (xSemaphoreTake(sim_at_mutex, pdMS_TO_TICKS(3000)) != pdTRUE) continue;

    String info = _sim_atReply("AT+CGPSINFO", 3000);
    xSemaphoreGive(sim_at_mutex);

    if (info.indexOf("+CGPSINFO:") >= 0) {
      _gps_parse_info(info);
    } else if (info.indexOf("GPS not ready") >= 0 || info.indexOf("ERROR") >= 0) {
      // GPS not ready yet — just skip this cycle
    }

    // Check if fix is stale
    xSemaphoreTake(state_mutex, portMAX_DELAY);
    uint32_t fix_age = millis() - sys_state.gps_fix_ms;
    if (sys_state.gps_fix && fix_age > GPS_STALE_MS) {
      sys_state.gps_fix = false;
      Serial.println("[GPS] Fix stale — marking invalid");
    }
    xSemaphoreGive(state_mutex);
  }
}