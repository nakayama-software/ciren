#pragma once

// Harus didefinisikan sebelum include TinyGSM
#ifndef TINY_GSM_MODEM_SIM7600
#define TINY_GSM_MODEM_SIM7600
#endif
// Override TinyGSM yield: default delay(0)=vTaskDelay(0) never yields to IDLE,
// causing task watchdog. Use vTaskDelay(1) so IDLE gets 1ms each iteration.
#ifndef TINY_GSM_YIELD
#define TINY_GSM_YIELD() { vTaskDelay(pdMS_TO_TICKS(1)); }
#endif

#include <TinyGsmClient.h>
#include <HardwareSerial.h>
#include "ciren_config_014424.h"
#include "system_state_014424.h"

// SIM configuration
#define SIM_APN       "ppsim.jp"
#define SIM_USER      "pp@sim"
#define SIM_PASS      "jpn"

// ── Global TinyGSM objects (definitions, not just extern) ───────────────────
static HardwareSerial modemSerial(2);   // UART2
TinyGsm       modem(modemSerial);
TinyGsmClient simClient(modem);

// ── Init ────────────────────────────────────────────────────────────────────
void sim_manager_init() {
  if (!sys_state.sim_enabled) return;
  modemSerial.begin(MODEM_BAUD, SERIAL_8N1, PIN_MODEM_RX, PIN_MODEM_TX);
  delay(100);
}

// ── Internal: update GPS state from modem ───────────────────────────────────
static void _sim_update_gps() {
  float lat, lon, speed, alt;
  int vsat, usat;
  float accuracy;
  int year, month, day, hour, min, sec;

  bool fix = modem.getGPS(&lat, &lon, &speed, &alt,
                           &vsat, &usat, &accuracy,
                           &year, &month, &day,
                           &hour, &min, &sec);

  char ts_buf[24] = "";
  if (fix) {
    snprintf(ts_buf, sizeof(ts_buf),
             "%04d-%02d-%02dT%02d:%02d:%02dZ",
             year, month, day, hour, min, sec);
  }

  xSemaphoreTake(state_mutex, portMAX_DELAY);
  sys_state.gps_fix   = fix;
  if (fix) {
    sys_state.gps_lat    = lat;
    sys_state.gps_lon    = lon;
    sys_state.gps_alt    = alt;
    sys_state.gps_speed  = speed;
    sys_state.gps_fix_ms = millis();
    strncpy(sys_state.gps_ts, ts_buf, sizeof(sys_state.gps_ts) - 1);
    Serial.printf("[SIM-GPS] Fix: %.6f, %.6f  sat:%d  alt:%.1f\n", lat, lon, vsat, alt);
  } else {
    // Mark stale if no fix for too long
    if (sys_state.gps_fix_ms > 0 &&
        (millis() - sys_state.gps_fix_ms) > GPS_STALE_MS) {
      sys_state.gps_lat = 0;
      sys_state.gps_lon = 0;
    }
    Serial.println("[SIM-GPS] No fix");
  }
  xSemaphoreGive(state_mutex);
}

// ── Task ────────────────────────────────────────────────────────────────────
void sim_manager_task(void* param) {
  if (!sys_state.sim_enabled) {
    vTaskDelete(NULL);
    return;
  }

  // Give modem time to boot after power-on
  vTaskDelay(pdMS_TO_TICKS(SIM_BOOT_WAIT_MS));

  Serial.println("[SIM] Initializing modem...");

  // Try to initialize modem (restart clears previous state)
  if (!modem.restart()) {
    Serial.println("[SIM] Modem restart failed — retrying AT...");
    if (!modem.init()) {
      Serial.println("[SIM] Modem init failed");
    }
  }

  String modemInfo = modem.getModemInfo();
  Serial.printf("[SIM] Modem: %s\n", modemInfo.c_str());

  // Check SIM card
  SimStatus simStatus = modem.getSimStatus();
  if (simStatus != SIM_READY) {
    Serial.println("[SIM] SIM card not ready");
    // Continue — may recover after network wait
  } else {
    Serial.println("[SIM] SIM OK");
  }

  String op = modem.getOperator();
  xSemaphoreTake(state_mutex, portMAX_DELAY);
  sys_state.sim_modem_ok = true;
  strncpy(sys_state.sim_operator, op.c_str(), sizeof(sys_state.sim_operator) - 1);
  xSemaphoreGive(state_mutex);

  // Enable GPS once modem is up (before GPRS — GPS runs independently)
  Serial.println("[SIM] Enabling GPS...");
  modem.enableGPS();

  bool gprs_was_connected = false;
  uint32_t last_gps_ms    = 0;
  uint32_t last_signal_ms = 0;

  for (;;) {
    uint32_t now_ms = millis();

    // ── GPS polling — always runs, independent of GPRS ──────────────────────
    if (now_ms - last_gps_ms >= GPS_POLL_MS) {
      last_gps_ms = now_ms;
      _sim_update_gps();
    }

    // ── Signal quality + operator — always runs, independent of GPRS ────────
    if (now_ms - last_signal_ms >= SIM_SIGNAL_INT_MS) {
      last_signal_ms = now_ms;
      int8_t sig    = (int8_t)modem.getSignalQuality();
      String op_now = modem.getOperator();
      xSemaphoreTake(state_mutex, portMAX_DELAY);
      sys_state.sim_signal = sig;
      strncpy(sys_state.sim_operator, op_now.c_str(), sizeof(sys_state.sim_operator) - 1);
      xSemaphoreGive(state_mutex);
      Serial.printf("[SIM] Signal:%d  GPRS:%s  Op:%s\n",
                    sig, sys_state.sim_gprs ? "Y" : "N", op_now.c_str());
    }

    // ── GPRS connectivity ────────────────────────────────────────────────────
    if (!modem.isGprsConnected()) {
      if (gprs_was_connected) {
        Serial.println("[SIM] GPRS dropped");
        xSemaphoreTake(state_mutex, portMAX_DELAY);
        sys_state.sim_gprs = false;
        xSemaphoreGive(state_mutex);
        if (strncmp(sys_state.conn_mode, "sim", 3) == 0)
          state_set_connected(false);
      }
      gprs_was_connected = false;

      Serial.println("[SIM] Waiting for network...");
      if (!modem.waitForNetwork(30000UL)) {
        Serial.println("[SIM] Network wait failed, retry in 60s");
        vTaskDelay(pdMS_TO_TICKS(SIM_RETRY_MS));
        continue;
      }

      Serial.println("[SIM] Connecting GPRS...");
      if (modem.gprsConnect(SIM_APN, SIM_USER, SIM_PASS)) {
        Serial.println("[SIM] GPRS connected");
        gprs_was_connected = true;
        xSemaphoreTake(state_mutex, portMAX_DELAY);
        sys_state.sim_gprs = true;
        xSemaphoreGive(state_mutex);
        if (strncmp(sys_state.conn_mode, "sim", 3) == 0)
          state_set_connected(true);
      } else {
        Serial.println("[SIM] GPRS connect failed, retry in 60s");
        vTaskDelay(pdMS_TO_TICKS(SIM_RETRY_MS));
        continue;
      }
    } else if (!gprs_was_connected) {
      // GPRS already up on first check (e.g. modem retained connection)
      gprs_was_connected = true;
      xSemaphoreTake(state_mutex, portMAX_DELAY);
      sys_state.sim_gprs = true;
      xSemaphoreGive(state_mutex);
      if (strncmp(sys_state.conn_mode, "sim", 3) == 0)
        state_set_connected(true);
    }

    vTaskDelay(pdMS_TO_TICKS(1000));
  }
}
