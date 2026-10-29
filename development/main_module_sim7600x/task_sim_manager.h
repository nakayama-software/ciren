#pragma once
// ─────────────────────────────────────────────────────────────────────────────
// SIM7600X (Waveshare LTE) driver — pure AT commands.
//
// Key differences from SIM7080G:
//   - AT+CNMP=2 (LTE auto) instead of AT+CNMP=38 (Cat-M only)
//   - AT+CMNB=2 (LTE) instead of AT+CMNB=1 (Cat-M)
//   - AT+CBANDCFG="GSM_LTE",... instead of AT+CBANDCFG="CAT-M",...
//   - AT+CEREG? + AT+CREG? for network registration
//   - AT+CGACT for PDP context instead of AT+CNACT
//   - Has built-in GPS (AT+CGPS) — handled in task_gps.h
//
// Shared AT bus (Serial2) is protected by sim_at_mutex.
// task_mqtt_sim.h (included after this file) uses the same mutex
// and the AT helpers defined here.
// ─────────────────────────────────────────────────────────────────────────────

#include <Arduino.h>
#include <HardwareSerial.h>
#include "ciren_config.h"
#include "system_state.h"

// ── Shared AT bus ─────────────────────────────────────────────────────────────
static HardwareSerial& _sim_ser = Serial2;
SemaphoreHandle_t sim_at_mutex  = NULL;   // shared with task_mqtt_sim

// ── Low-level AT helpers ──────────────────────────────────────────────────────
// Call with sim_at_mutex held (or before tasks start during init phase).

static void _sim_flush() {
  delay(20);
  while (_sim_ser.available()) _sim_ser.read();
}

// Send AT command, return true if expected string appears in response within ms.
static bool _sim_sendAT(const char* cmd, const char* expect = "OK",
                         uint32_t ms = 5000, bool verbose = false) {
  _sim_flush();
  if (verbose) Serial.printf("[AT>>] %s\n", cmd);
  _sim_ser.println(cmd);
  uint32_t t = millis();
  String buf = "";
  while (millis() - t < ms) {
    while (_sim_ser.available()) buf += (char)_sim_ser.read();
    if (buf.indexOf(expect) >= 0) {
      if (verbose) { buf.trim(); Serial.printf("[AT<<] %s\n", buf.c_str()); }
      return true;
    }
    if (buf.indexOf("ERROR") >= 0) {
      if (verbose) { buf.trim(); Serial.printf("[AT<<ERR] %s\n", buf.c_str()); }
      return false;
    }
    delay(10);
  }
  if (verbose) { buf.trim(); Serial.printf("[AT<<TO] %s\n", buf.c_str()); }
  return false;
}

// Send AT command, return full modem reply as String.
static String _sim_atReply(const char* cmd, uint32_t ms = 5000) {
  _sim_flush();
  _sim_ser.println(cmd);
  uint32_t t = millis();
  String r = "";
  while (millis() - t < ms) {
    while (_sim_ser.available()) r += (char)_sim_ser.read();
    if (r.indexOf("OK") >= 0 || r.indexOf("ERROR") >= 0) break;
    delay(10);
  }
  r.trim();
  return r;
}

// ── Phase 1: Init modem ───────────────────────────────────────────────────────
static bool _sim_init_modem() {
  _sim_flush();
  // SIM7600X needs a few seconds after power-on — try AT up to 15 times
  for (int i = 0; i < 15; i++) {
    _sim_ser.println("AT");
    delay(800);
    String r = "";
    uint32_t t = millis();
    while (millis() - t < 500) {
      while (_sim_ser.available()) r += (char)_sim_ser.read();
    }
    if (r.indexOf("OK") >= 0) {
      Serial.println("[SIM] Modem responding");
      break;
    }
    Serial.printf("[SIM] Waiting modem (%d/15)\n", i + 1);
    if (i == 14) { Serial.println("[SIM] Modem not responding — check wiring/power"); return false; }
    delay(500);
  }

  _sim_sendAT("ATE0");         // echo off
  _sim_sendAT("AT+CMEE=2");   // verbose errors

  // Check SIM card
  if (!_sim_sendAT("AT+CPIN?", "READY", 8000)) {
    Serial.println("[SIM] SIM not ready");
    return false;
  }

  // Print modem info
  Serial.printf("[SIM] %s\n", _sim_atReply("ATI").c_str());
  Serial.printf("[SIM] IMEI: %s\n", _sim_atReply("AT+CGSN").c_str());

  xSemaphoreTake(state_mutex, portMAX_DELAY);
  sys_state.sim_modem_ok = true;
  xSemaphoreGive(state_mutex);
  return true;
}

// ── Phase 2: Set LTE mode ─────────────────────────────────────────────────────
static void _sim_set_lte() {
  _sim_sendAT("AT+CNMP=2");   // LTE auto (includes 4G)
  _sim_sendAT("AT+CMNB=2");   // LTE mode (not Cat-M/NB)
  char buf[96];
  snprintf(buf, sizeof(buf), "AT+CBANDCFG=\"GSM_LTE\",%s", SIM_LTE_BANDS);
  _sim_sendAT(buf, "OK", 5000);
  Serial.printf("[SIM] LTE mode set, JP bands: %s\n", SIM_LTE_BANDS);
}

// ── Phase 3: Wait for network registration ────────────────────────────────────
// SIM7600X uses both CREG (GSM) and CEREG (LTE) — check both
static bool _sim_wait_registered(uint32_t timeout_ms = 180000UL) {
  Serial.print("[SIM] Waiting registration");
  uint32_t t = millis();
  while (millis() - t < timeout_ms) {
    // Check CEREG (LTE) first
    String cereg = _sim_atReply("AT+CEREG?", 3000);
    bool ok = (cereg.indexOf(",1") >= 0 || cereg.indexOf(",5") >= 0);
    if (!ok) {
      // Also check CREG (GSM fallback)
      String creg = _sim_atReply("AT+CREG?", 3000);
      ok = (creg.indexOf(",1") >= 0 || creg.indexOf(",5") >= 0);
    }
    if (ok) {
      Serial.println(" OK");
      Serial.printf("[SIM] Signal: %s\n", _sim_atReply("AT+CSQ").c_str());
      Serial.printf("[SIM] Operator: %s\n", _sim_atReply("AT+COPS?").c_str());
      return true;
    }
    Serial.print(".");
    delay(3000);
  }
  Serial.println(" TIMEOUT");
  return false;
}

// ── Phase 4: Activate PDP ────────────────────────────────────────────────────
// SIM7600G-H supports two methods:
//   Method A: AT+CGACT (standard 3GPP) — works for some carriers (e.g. jpsim.me)
//   Method B: AT+NETOPEN (SIM7600 native) — works for others (e.g. ppsim.jp)
// We try CGACT first, then fall back to NETOPEN if it fails.
static bool _sim_activate_pdp() {
  // Read APN from sys_state with mutex (strings are not atomic)
  char apn[64], apn_user[32], apn_pass[32];
  xSemaphoreTake(state_mutex, portMAX_DELAY);
  strncpy(apn,      sys_state.sim_apn,      sizeof(apn)      - 1); apn[sizeof(apn)-1]           = '\0';
  strncpy(apn_user, sys_state.sim_apn_user, sizeof(apn_user) - 1); apn_user[sizeof(apn_user)-1] = '\0';
  strncpy(apn_pass, sys_state.sim_apn_pass, sizeof(apn_pass) - 1); apn_pass[sizeof(apn_pass)-1] = '\0';
  xSemaphoreGive(state_mutex);

  if (strlen(apn) == 0) {
    Serial.println("[SIM] APN not configured — set via portal");
    return false;
  }

  Serial.printf("[SIM] Activating PDP, APN=%s user=%s\n", apn, apn_user);

  // Deactivate any existing context
  _sim_sendAT("AT+CGACT=0,1", "OK", 5000, true);
  _sim_sendAT("AT+NETCLOSE", "OK", 3000, true);
  delay(1000);

  // Set APN — SIM7600X uses AT+CGDCONT for PDP context
  char buf[160];
  snprintf(buf, sizeof(buf), "AT+CGDCONT=1,\"IP\",\"%s\"", apn);
  _sim_sendAT(buf, "OK", 5000, true);

  // Set PDP authentication
  // AT+CGAUTH=<cid>,<auth_type>,<password>,<username>
  // auth_type: 0=none, 1=PAP, 2=CHAP
  if (strlen(apn_user) > 0) {
    snprintf(buf, sizeof(buf), "AT+CGAUTH=1,1,\"%s\",\"%s\"", apn_pass, apn_user);
    _sim_sendAT(buf, "OK", 5000, true);
  } else {
    _sim_sendAT("AT+CGAUTH=1,0", "OK", 5000, true);
  }

  // ── Method A: CGACT ──────────────────────────────────────────────────────
  if (_sim_sendAT("AT+CGACT=1,1", "OK", 30000, true)) {
    // Verify — check for IP address
    delay(2000);
    String ipReply = _sim_atReply("AT+CGPADDR=1", 5000);
    int q1 = ipReply.indexOf('"');
    int q2 = ipReply.indexOf('"', q1 + 1);
    if (q1 >= 0 && q2 > q1) {
      String ip = ipReply.substring(q1 + 1, q2);
      if (ip.length() >= 7 && ip != "0.0.0.0") {
        Serial.printf("[SIM] IP (CGACT): %s\n", ip.c_str());
        xSemaphoreTake(state_mutex, portMAX_DELAY);
        sys_state.sim_gprs = true;
        sys_state.sim_pdp_method = 1;  // CGACT
        xSemaphoreGive(state_mutex);
        return true;
      }
    }
  }

  // ── Method B: NETOPEN (fallback for carriers where CGACT fails) ──────────
  Serial.println("[SIM] CGACT failed, trying NETOPEN...");
  _sim_sendAT("AT+NETCLOSE", "OK", 3000, true);
  delay(500);

  // Send NETOPEN command
  Serial.println("[SIM] >> AT+NETOPEN");
  _sim_ser.println("AT+NETOPEN");
  // Wait for +NETOPEN URC (0=success, nonzero=error)
  String urc = "";
  uint32_t t = millis();
  while (millis() - t < 30000) {
    while (_sim_ser.available()) urc += (char)_sim_ser.read();
    if (urc.indexOf("+NETOPEN:") >= 0) break;
    delay(10);
  }
  urc.trim();
  Serial.printf("[SIM] << %s\n", urc.c_str());

  if (urc.indexOf("+NETOPEN: 0") >= 0) {
    // Success — check IP
    delay(1000);
    String ipReply = _sim_atReply("AT+CGPADDR=1", 5000);
    int q1 = ipReply.indexOf('"');
    int q2 = ipReply.indexOf('"', q1 + 1);
    if (q1 >= 0 && q2 > q1) {
      String ip = ipReply.substring(q1 + 1, q2);
      if (ip.length() >= 7 && ip != "0.0.0.0") {
        Serial.printf("[SIM] IP (NETOPEN): %s\n", ip.c_str());
      }
    }
    xSemaphoreTake(state_mutex, portMAX_DELAY);
    sys_state.sim_gprs = true;
    sys_state.sim_pdp_method = 2;  // NETOPEN
    xSemaphoreGive(state_mutex);
    return true;
  }

  Serial.println("[SIM] PDP activation failed (both CGACT and NETOPEN)");
  xSemaphoreTake(state_mutex, portMAX_DELAY);
  sys_state.sim_pdp_method = 0;  // none
  xSemaphoreGive(state_mutex);
  return false;
}

// ── Poll signal + operator ────────────────────────────────────────────────────
static void _sim_poll_status() {
  String csq  = _sim_atReply("AT+CSQ",   3000);
  String cops = _sim_atReply("AT+COPS?", 3000);

  // Parse CSQ: +CSQ: rssi,ber
  int8_t sig = -1;
  int colon = csq.indexOf(':');
  if (colon >= 0) {
    int comma = csq.indexOf(',', colon);
    if (comma > colon) sig = (int8_t)csq.substring(colon + 2, comma).toInt();
  }

  // Parse operator name (quoted string)
  char op[24] = "";
  int q1 = cops.indexOf('"');
  int q2 = cops.indexOf('"', q1 + 1);
  if (q1 >= 0 && q2 > q1) {
    String op_str = cops.substring(q1 + 1, q2);
    strncpy(op, op_str.c_str(), sizeof(op) - 1);
  }

  xSemaphoreTake(state_mutex, portMAX_DELAY);
  sys_state.sim_signal = sig;
  strncpy(sys_state.sim_operator, op, sizeof(sys_state.sim_operator) - 1);
  xSemaphoreGive(state_mutex);

  Serial.printf("[SIM] Signal=%d  Op=%s  GPRS=%s\n",
                sig, op, sys_state.sim_gprs ? "Y" : "N");
}

// ── Check if PDP is still active ──────────────────────────────────────────────
static bool _sim_check_pdp() {
  uint8_t method;
  xSemaphoreTake(state_mutex, portMAX_DELAY);
  method = sys_state.sim_pdp_method;
  xSemaphoreGive(state_mutex);

  if (method == 1) {
    // CGACT: +CGACT: 1,1 = active
    String r = _sim_atReply("AT+CGACT?", 3000);
    return (r.indexOf("+CGACT: 1,1") >= 0);
  } else if (method == 2) {
    // NETOPEN: AT+NETOPEN? query returns +NETOPEN: <state>
    //   state 0 = closed, state 1 = opened
    // (Do NOT confuse with the +NETOPEN: <err> URC from AT+NETOPEN command)
    String r = _sim_atReply("AT+NETOPEN?", 3000);
    bool ok = (r.indexOf("+NETOPEN: 1") >= 0 || r.indexOf("Network is already opened") >= 0);
    if (!ok) {
      Serial.printf("[SIM] NETOPEN check: [%s]\n", r.c_str());
    }
    return ok;
  }
  return false;
}

// ── Public API ────────────────────────────────────────────────────────────────

void sim_manager_init() {
  sim_at_mutex = xSemaphoreCreateMutex();
}

void sim_manager_task(void* param) {
  if (!sys_state.sim_enabled) {
    Serial.println("[SIM] sim_enabled=false, task exit");
    vTaskDelete(NULL);
    return;
  }

  // Boot delay — give SIM7600X time to power up
  vTaskDelay(pdMS_TO_TICKS(SIM_BOOT_WAIT_MS));

  // Init Serial2 for modem AT communication
  _sim_ser.begin(MODEM_BAUD, SERIAL_8N1, PIN_MODEM_RX, PIN_MODEM_TX);
  vTaskDelay(pdMS_TO_TICKS(500));

  // ── Phase 1: Init modem ──────────────────────────────────────────────────────
  Serial.println("[SIM] Phase 1: Init modem");
  while (!_sim_init_modem()) {
    Serial.println("[SIM] Modem init failed, retry in 10s");
    vTaskDelay(pdMS_TO_TICKS(10000));
  }

  // ── Phase 2: Set LTE mode ─────────────────────────────────────────────────────
  Serial.println("[SIM] Phase 2: Set LTE mode");
  _sim_set_lte();

  // ── Phase 3: Wait registration ────────────────────────────────────────────────
  Serial.println("[SIM] Phase 3: Wait network registration");
  if (!_sim_wait_registered(180000UL)) {
    Serial.println("[SIM] Registration timeout — continuing anyway");
  }

  // ── Phase 4: Activate PDP ─────────────────────────────────────────────────────
  Serial.println("[SIM] Phase 4: Activate PDP");
  while (!_sim_activate_pdp()) {
    Serial.printf("[SIM] PDP failed, retry in %ds\n", SIM_RETRY_MS / 1000);
    vTaskDelay(pdMS_TO_TICKS(SIM_RETRY_MS));
  }

  // GPS will be handled by task_gps (started separately)
  // Initialize GPS fields to empty/false until GPS task provides data
  xSemaphoreTake(state_mutex, portMAX_DELAY);
  sys_state.gps_lat    = 0.0f;
  sys_state.gps_lon    = 0.0f;
  sys_state.gps_fix    = false;
  sys_state.gps_fix_ms = 0;
  sys_state.gps_alt    = 0.0f;
  sys_state.gps_speed  = 0.0f;
  sys_state.gps_ts[0]  = '\0';
  xSemaphoreGive(state_mutex);

  // ── Main loop: monitor + reconnect ────────────────────────────────────────────
  uint32_t last_poll_ms = 0;
  for (;;) {
    vTaskDelay(pdMS_TO_TICKS(5000));

    uint32_t now = millis();
    if (now - last_poll_ms < (uint32_t)SIM_SIGNAL_INT_MS) continue;
    last_poll_ms = now;

    if (xSemaphoreTake(sim_at_mutex, pdMS_TO_TICKS(3000)) != pdTRUE) continue;

    _sim_poll_status();
    bool pdp_ok = _sim_check_pdp();
    xSemaphoreGive(sim_at_mutex);

    if (!pdp_ok) {
      Serial.println("[SIM] PDP lost — reactivating");
      xSemaphoreTake(state_mutex, portMAX_DELAY);
      sys_state.sim_gprs = false;
      sys_state.sim_pdp_method = 0;
      xSemaphoreGive(state_mutex);

      xSemaphoreTake(sim_at_mutex, portMAX_DELAY);
      // Re-register if needed
      String cereg = _sim_atReply("AT+CEREG?", 3000);
      bool registered = (cereg.indexOf(",1") >= 0 || cereg.indexOf(",5") >= 0);
      if (!registered) {
        String creg = _sim_atReply("AT+CREG?", 3000);
        registered = (creg.indexOf(",1") >= 0 || creg.indexOf(",5") >= 0);
      }
      if (!registered) _sim_wait_registered(90000UL);
      bool ok = _sim_activate_pdp();
      xSemaphoreGive(sim_at_mutex);

      if (!ok) Serial.println("[SIM] PDP re-activate failed");
    }
  }
}