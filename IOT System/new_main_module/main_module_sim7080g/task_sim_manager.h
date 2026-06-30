#pragma once
// ─────────────────────────────────────────────────────────────────────────────
// SIM7080G (M5STAMP CatM) driver — pure AT commands, no TinyGSM.
// Replaces SIM7600 + TinyGSM implementation.
//
// Shared AT bus (Serial2) is protected by sim_at_mutex.
// task_mqtt_sim.h (included after this file) uses the same mutex
// and the AT helpers defined here.
// ─────────────────────────────────────────────────────────────────────────────

#include <Arduino.h>
#include <HardwareSerial.h>
#include <esp_task_wdt.h>
#include "ciren_config.h"
#include "system_state.h"
#include "task_logger.h"

// ── Shared AT bus ─────────────────────────────────────────────────────────────
static HardwareSerial& _sim_ser = Serial2;
SemaphoreHandle_t sim_at_mutex  = NULL;   // shared with task_mqtt_sim

// ── Shared AT response buffer — no heap alloc/free on every AT command ────────
static char _sim_rxbuf[512];

// ── AT failure counter for modem crash detection ─────────────────────────────
// If AT commands fail consecutively, the modem is likely unresponsive and
// needs a PWRKEY reset. Reset to 0 on every success.
#define SIM_MAX_AT_FAILURES 5
static uint8_t _sim_fail_count = 0;

// ── Low-level AT helpers ──────────────────────────────────────────────────────
// Call with sim_at_mutex held (or before tasks start during init phase).

static void _sim_flush() {
  delay(20);
  while (_sim_ser.available()) _sim_ser.read();
}

// Send AT command, return true if expected string appears in response within ms.
static bool _sim_sendAT(const char* cmd, const char* expect = "OK",
                         uint32_t ms = 5000, bool verbose = false) {
  esp_task_wdt_reset();   // feed watchdog before potentially long AT command
  _sim_flush();
  if (verbose) Serial.printf("[AT>>] %s\n", cmd);
  _sim_ser.println(cmd);
  uint32_t t = millis();
  size_t pos = 0;
  _sim_rxbuf[0] = '\0';
  while (millis() - t < ms) {
    while (_sim_ser.available() && pos < sizeof(_sim_rxbuf) - 1) {
      _sim_rxbuf[pos++] = (char)_sim_ser.read();
      _sim_rxbuf[pos]   = '\0';
    }
    if (strstr(_sim_rxbuf, expect)) {
      if (verbose) Serial.printf("[AT<<] %s\n", _sim_rxbuf);
      _sim_fail_count = 0;   // reset failure counter on success
      return true;
    }
    if (strstr(_sim_rxbuf, "ERROR")) {
      if (verbose) Serial.printf("[AT<<ERR] %s\n", _sim_rxbuf);
      _sim_fail_count++;
      return false;
    }
    delay(10);
  }
  if (verbose) Serial.printf("[AT<<TO] %s\n", _sim_rxbuf);
  _sim_fail_count++;   // timeout also counts as failure
  return false;
}

// Send AT command, return pointer to shared _sim_rxbuf containing the reply.
// WARNING: returned pointer is invalidated by the next _sim_sendAT/_sim_atReply call.
static const char* _sim_atReply(const char* cmd, uint32_t ms = 5000) {
  _sim_flush();
  _sim_ser.println(cmd);
  uint32_t t = millis();
  size_t pos = 0;
  _sim_rxbuf[0] = '\0';
  while (millis() - t < ms) {
    while (_sim_ser.available() && pos < sizeof(_sim_rxbuf) - 1) {
      _sim_rxbuf[pos++] = (char)_sim_ser.read();
      _sim_rxbuf[pos]   = '\0';
    }
    if (strstr(_sim_rxbuf, "OK") || strstr(_sim_rxbuf, "ERROR")) break;
    esp_task_wdt_reset();   // feed watchdog during long AT reply waits (e.g. AT+CNTP 30s)
    delay(10);
  }
  while (pos > 0 && (_sim_rxbuf[pos-1] == '\r' || _sim_rxbuf[pos-1] == '\n' ||
                      _sim_rxbuf[pos-1] == ' '))
    _sim_rxbuf[--pos] = '\0';
  return _sim_rxbuf;
}

// ── PWRKEY pulse — power on SIM7080G ─────────────────────────────────────────
static void _sim_pwrkey_pulse() {
  pinMode(PIN_MODEM_PWRKEY, OUTPUT);
  digitalWrite(PIN_MODEM_PWRKEY, HIGH); delay(100);
  digitalWrite(PIN_MODEM_PWRKEY, LOW);  delay(1200);  // hold low ≥1s
  digitalWrite(PIN_MODEM_PWRKEY, HIGH);
  Serial.println("[SIM] PWRKEY pulsed");
  LOG_INFO("SIM", "PWRKEY pulsed — powering on modem");
}

// ── Forward declarations (needed because _sim_reset_modem calls Phase 1-4 fns) ──
static bool _sim_init_modem();
static void _sim_set_catm();
static bool _sim_wait_registered(uint32_t timeout_ms);
static bool _sim_activate_pdp();

// ── Runtime modem reset ──────────────────────────────────────────────────────
// Called when AT commands fail consecutively (modem unresponsive).
// Pulses PWRKEY to hard-reset the modem, then re-initializes from Phase 1.
// Returns true if modem comes back online, false if reset fails.
// Caller must NOT hold sim_at_mutex — this function takes it internally.
static bool _sim_reset_modem() {
  LOG_ERROR("SIM", "Modem unresponsive (%d consecutive AT failures) — resetting", _sim_fail_count);
  Serial.printf("[SIM] Modem unresponsive (%d failures) — resetting modem\n", _sim_fail_count);

  // Mark GPRS as down so mqtt_sim_task stops publishing and disconnects
  xSemaphoreTake(state_mutex, portMAX_DELAY);
  sys_state.sim_gprs = false;
  xSemaphoreGive(state_mutex);

  // Take AT mutex for the full reset sequence
  xSemaphoreTake(sim_at_mutex, portMAX_DELAY);

  // Full PWRKEY reset cycle
  _sim_pwrkey_pulse();
  esp_task_wdt_reset();   // feed watchdog during boot wait
  vTaskDelay(pdMS_TO_TICKS(SIM_BOOT_WAIT_MS));

  // Re-init from Phase 1
  esp_task_wdt_reset();
  if (!_sim_init_modem()) {
    xSemaphoreGive(sim_at_mutex);
    LOG_ERROR("SIM", "Modem reset failed — init unsuccessful");
    Serial.println("[SIM] Modem reset failed — init unsuccessful");
    _sim_fail_count = 0;  // reset so we don't immediately try again
    return false;
  }

  esp_task_wdt_reset();
  _sim_set_catm();

  esp_task_wdt_reset();
  if (!_sim_wait_registered(180000UL)) {
    LOG_WARN("SIM", "Registration timeout after reset — continuing anyway");
    Serial.println("[SIM] Registration timeout after reset — continuing anyway");
  }

  esp_task_wdt_reset();
  if (!_sim_activate_pdp()) {
    xSemaphoreGive(sim_at_mutex);
    LOG_ERROR("SIM", "PDP activation failed after reset");
    Serial.println("[SIM] PDP activation failed after reset");
    _sim_fail_count = 0;
    return false;
  }

  xSemaphoreGive(sim_at_mutex);
  LOG_INFO("SIM", "Modem reset successful — PDP re-activated");
  Serial.println("[SIM] Modem reset successful — PDP re-activated");
  _sim_fail_count = 0;
  return true;
}

// ── Phase 1: Init modem ───────────────────────────────────────────────────────
static bool _sim_init_modem() {
  _sim_flush();
  // SIM7080G needs a few seconds after power-on — try AT up to 15 times
  for (int i = 0; i < 15; i++) {
    _sim_ser.println("AT");
    delay(800);
    char r[64]; size_t rpos = 0; r[0] = '\0';
    uint32_t t = millis();
    while (millis() - t < 500) {
      while (_sim_ser.available() && rpos < sizeof(r) - 1) {
        r[rpos++] = (char)_sim_ser.read();
        r[rpos]   = '\0';
      }
    }
    if (strstr(r, "OK")) {
      Serial.println("[SIM] Modem responding");
      LOG_INFO("SIM", "Modem responding after %d attempts", i + 1);
      break;
    }
    esp_task_wdt_reset();   // feed watchdog between attempts
    Serial.printf("[SIM] Waiting modem (%d/15)\n", i + 1);
    if (i == 14) {
      Serial.println("[SIM] Modem not responding — check wiring/power");
      LOG_ERROR("SIM", "Modem not responding after 15 attempts");
      return false;
    }
    delay(500);
  }

  _sim_sendAT("ATE0");         // echo off
  _sim_sendAT("AT+CMEE=2");   // verbose errors

  // Check SIM card
  if (!_sim_sendAT("AT+CPIN?", "READY", 8000)) {
    Serial.println("[SIM] SIM not ready");
    LOG_ERROR("SIM", "SIM card not ready (CPIN check failed)");
    return false;
  }

  // Use result immediately — each call overwrites _sim_rxbuf
  Serial.printf("[SIM] %s\n",       _sim_atReply("ATI"));
  Serial.printf("[SIM] IMEI: %s\n", _sim_atReply("AT+CGSN"));
  LOG_INFO("SIM", "Modem initialized OK");

  xSemaphoreTake(state_mutex, portMAX_DELAY);
  sys_state.sim_modem_ok = true;
  xSemaphoreGive(state_mutex);
  return true;
}

// ── Phase 2: Set CAT-M mode ───────────────────────────────────────────────────
static void _sim_set_catm() {
  _sim_sendAT("AT+CNMP=38");   // LTE only
  _sim_sendAT("AT+CMNB=1");    // CAT-M only (not NB-IoT)
  char buf[64];
  snprintf(buf, sizeof(buf), "AT+CBANDCFG=\"CAT-M\",%s", SIM_CATM_BANDS);
  _sim_sendAT(buf, "OK", 5000);
  Serial.printf("[SIM] CAT-M mode set, JP bands: %s\n", SIM_CATM_BANDS);
  LOG_INFO("SIM", "CAT-M mode set, bands=%s", SIM_CATM_BANDS);
}

// ── Phase 3: Wait for network registration ────────────────────────────────────
static bool _sim_wait_registered(uint32_t timeout_ms = 180000UL) {
  Serial.print("[SIM] Waiting registration");
  uint32_t t = millis();
  while (millis() - t < timeout_ms) {
    const char* cereg = _sim_atReply("AT+CEREG?", 3000);
    bool ok = (strstr(cereg, ",1") != nullptr || strstr(cereg, ",5") != nullptr);
    if (ok) {
      Serial.println(" OK");
      LOG_INFO("SIM", "Network registered OK");
      esp_task_wdt_reset();   // feed watchdog after successful registration
      int csq = -1;
      {
        const char* r = _sim_atReply("AT+CSQ");
        const char* colon = strchr(r, ':');
        if (colon) csq = atoi(colon + 2);
        Serial.printf("[SIM] Signal: %s\n", r);
      }
      char op[24] = "";
      {
        const char* r = _sim_atReply("AT+COPS?");
        const char* q1 = strchr(r, '"');
        if (q1) {
          const char* q2 = strchr(q1 + 1, '"');
          if (q2 && q2 > q1) {
            size_t len = (size_t)(q2 - q1 - 1);
            if (len >= sizeof(op)) len = sizeof(op) - 1;
            strncpy(op, q1 + 1, len);
            op[len] = '\0';
          }
        }
        Serial.printf("[SIM] Operator: %s\n", r);
      }
      LOG_INFO("SIM", "Network registered, signal=%d op=%s", csq, op);
      return true;
    }
    Serial.print(".");
    esp_task_wdt_reset();   // feed watchdog during registration wait
    delay(3000);
  }
  Serial.println(" TIMEOUT");
  LOG_WARN("SIM", "Network registration timeout");
  return false;
}

// ── Phase 4: Activate PDP ────────────────────────────────────────────────────
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
    LOG_ERROR("SIM", "APN not configured — cannot activate PDP");
    return false;
  }

  Serial.printf("[SIM] Activating PDP, APN=%s user=%s\n", apn, apn_user);
  LOG_INFO("SIM", "Activating PDP, APN=%s", apn);

  // Deactivate existing context
  _sim_sendAT("AT+CNACT=0,0", "OK", 5000);
  delay(1000);

  // Set APN
  char buf[128];
  snprintf(buf, sizeof(buf), "AT+CGDCONT=1,\"IP\",\"%s\"", apn);
  _sim_sendAT(buf);
  snprintf(buf, sizeof(buf), "AT+CNCFG=0,1,\"%s\",\"%s\",\"%s\",3",
           apn, apn_user, apn_pass);
  _sim_sendAT(buf);

  // Activate
  _sim_ser.println("AT+CNACT=0,1");
  delay(500);

  Serial.print("[SIM] PDP activating");
  uint32_t t = millis();
  char rbuf[256]; size_t rpos = 0; rbuf[0] = '\0';
  bool activated = false;
  while (millis() - t < 60000UL) {
    while (_sim_ser.available() && rpos < sizeof(rbuf) - 1) {
      rbuf[rpos++] = (char)_sim_ser.read();
      rbuf[rpos]   = '\0';
    }
    if (strstr(rbuf, "ACTIVE") && !strstr(rbuf, "DEACTIVE")) {
      activated = true;
      Serial.println(" ACTIVE");
      break;
    }
    if (strstr(rbuf, "DEACTIVE")) {
      Serial.println(" DEACTIVE");
      LOG_ERROR("SIM", "PDP activation failed — DEACTIVE response");
      break;
    }
    Serial.print(".");
    esp_task_wdt_reset();   // feed watchdog during PDP activation (can take 60s)
    delay(1000);
  }
  if (!activated) {
    LOG_ERROR("SIM", "PDP activation timeout");
    return false;
  }

  // Verify IP
  delay(500);
  const char* ipReply = _sim_atReply("AT+CNACT?");
  const char* q1p = strchr(ipReply, '"');
  if (q1p) {
    const char* q2p = strchr(q1p + 1, '"');
    if (q2p && q2p > q1p + 1) {
      char ip[32];
      size_t iplen = (size_t)(q2p - q1p - 1);
      if (iplen >= sizeof(ip)) iplen = sizeof(ip) - 1;
      strncpy(ip, q1p + 1, iplen);
      ip[iplen] = '\0';
      if (strlen(ip) >= 7 && strcmp(ip, "0.0.0.0") != 0) {
        Serial.printf("[SIM] IP: %s\n", ip);
        LOG_INFO("SIM", "PDP active, IP=%s", ip);
        xSemaphoreTake(state_mutex, portMAX_DELAY);
        sys_state.sim_gprs = true;
        xSemaphoreGive(state_mutex);
        return true;
      }
    }
  }
  Serial.println("[SIM] IP invalid");
  LOG_ERROR("SIM", "PDP activated but IP invalid");
  return false;
}

// ── Poll signal + operator ────────────────────────────────────────────────────
static void _sim_poll_status() {
  // CSQ: +CSQ: rssi,ber — must consume before next call overwrites _sim_rxbuf
  int8_t sig = -1;
  {
    const char* csq = _sim_atReply("AT+CSQ", 3000);
    const char* colon = strchr(csq, ':');
    if (colon) sig = (int8_t)atoi(colon + 2);
  }

  // COPS: +COPS: 0,0,"NTT DOCOMO",7
  char op[24] = "";
  {
    const char* cops = _sim_atReply("AT+COPS?", 3000);
    const char* q1 = strchr(cops, '"');
    if (q1) {
      const char* q2 = strchr(q1 + 1, '"');
      if (q2 && q2 > q1) {
        size_t len = (size_t)(q2 - q1 - 1);
        if (len >= sizeof(op)) len = sizeof(op) - 1;
        strncpy(op, q1 + 1, len);
        op[len] = '\0';
      }
    }
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
  // +CNACT: 0,1,"x.x.x.x" = active
  return (strstr(_sim_atReply("AT+CNACT?", 3000), "0,1") != nullptr);
}

// ── Public API ────────────────────────────────────────────────────────────────

void sim_manager_init() {
  sim_at_mutex = xSemaphoreCreateMutex();
}

void sim_manager_task(void* param) {
  esp_task_wdt_add(NULL);   // subscribe to Task Watchdog
  if (!sys_state.sim_enabled) {
    Serial.println("[SIM] sim_enabled=false, task exit");
    LOG_WARN("SIM", "SIM disabled — task exiting");
    vTaskDelete(NULL);
    return;
  }

  // Init Serial2 for modem AT communication
  _sim_ser.begin(MODEM_BAUD, SERIAL_8N1, PIN_MODEM_RX, PIN_MODEM_TX);
  vTaskDelay(pdMS_TO_TICKS(500));

  // Try AT first (modem may already be on); if no response, send PWRKEY pulse
  _sim_flush();
  _sim_ser.println("AT");
  vTaskDelay(pdMS_TO_TICKS(1000));
  bool already_on = (_sim_ser.available() && strstr(_sim_atReply("AT", 2000), "OK") != nullptr);
  if (!already_on) {
    LOG_WARN("SIM", "Modem not responding — retrying PWRKEY");
    Serial.println("[SIM] Modem not responding — sending PWRKEY pulse");
    _sim_pwrkey_pulse();
    vTaskDelay(pdMS_TO_TICKS(SIM_BOOT_WAIT_MS));  // wait for boot
  } else {
    Serial.println("[SIM] Modem already on");
    LOG_INFO("SIM", "Modem already on");
  }

  // ── Phase 1: Init modem ──────────────────────────────────────────────────────
  Serial.println("[SIM] Phase 1: Init modem");
  while (!_sim_init_modem()) {
    LOG_WARN("SIM", "Modem init failed — retry in 10s");
    Serial.println("[SIM] Modem init failed, retry in 10s");
    esp_task_wdt_reset();   // feed watchdog during retry wait
    vTaskDelay(pdMS_TO_TICKS(10000));
  }

  // ── Phase 2: Set CAT-M mode ───────────────────────────────────────────────────
  Serial.println("[SIM] Phase 2: Set CAT-M mode");
  _sim_set_catm();

  // ── Phase 3: Wait registration ────────────────────────────────────────────────
  Serial.println("[SIM] Phase 3: Wait network registration");
  if (!_sim_wait_registered(180000UL)) {
    LOG_WARN("SIM", "Registration timeout — continuing anyway");
    Serial.println("[SIM] Registration timeout — continuing anyway");
  }

  // ── Phase 4: Activate PDP ─────────────────────────────────────────────────────
  Serial.println("[SIM] Phase 4: Activate PDP");
  while (!_sim_activate_pdp()) {
    Serial.printf("[SIM] PDP failed, retry in %ds\n", SIM_RETRY_MS / 1000);
    // Split long delay into 5s chunks to keep feeding watchdog
    for (uint32_t _d = 0; _d < SIM_RETRY_MS; _d += 5000) {
      vTaskDelay(pdMS_TO_TICKS(5000));
      esp_task_wdt_reset();
    }
  }
  LOG_INFO("SIM", "SIM fully initialized — PDP active");

  // ── Main loop: monitor + reconnect ────────────────────────────────────────────
  uint32_t last_poll_ms = 0;
  for (;;) {
    esp_task_wdt_reset();   // feed watchdog every loop iteration
    vTaskDelay(pdMS_TO_TICKS(5000));

    uint32_t now = millis();
    if (now - last_poll_ms < (uint32_t)SIM_SIGNAL_INT_MS) continue;
    last_poll_ms = now;

    if (xSemaphoreTake(sim_at_mutex, pdMS_TO_TICKS(3000)) != pdTRUE) continue;

    // ── Check for modem crash (consecutive AT failures) ────────────────────
    if (_sim_fail_count >= SIM_MAX_AT_FAILURES) {
      xSemaphoreGive(sim_at_mutex);
      // Modem appears unresponsive — hard reset via PWRKEY
      // _sim_reset_modem takes the mutex internally
      _sim_reset_modem();
      continue;   // next iteration will poll again with fresh modem
    }

    _sim_poll_status();
    bool pdp_ok = _sim_check_pdp();
    xSemaphoreGive(sim_at_mutex);

    if (!pdp_ok) {
      Serial.println("[SIM] PDP lost — reactivating");
      LOG_WARN("SIM", "PDP lost — reactivating");
      xSemaphoreTake(state_mutex, portMAX_DELAY);
      sys_state.sim_gprs = false;
      sys_state.server_hb_ms = 0;   // clear stale heartbeat timestamp
      xSemaphoreGive(state_mutex);

      xSemaphoreTake(sim_at_mutex, portMAX_DELAY);
      // Re-register if needed — consume cereg before next AT call
      {
        const char* cereg = _sim_atReply("AT+CEREG?", 3000);
        bool registered = (strstr(cereg, ",1") != nullptr || strstr(cereg, ",5") != nullptr);
        if (!registered) _sim_wait_registered(90000UL);
      }
      bool ok = _sim_activate_pdp();
      xSemaphoreGive(sim_at_mutex);

      if (!ok) {
        Serial.println("[SIM] PDP re-activate failed");
        LOG_ERROR("SIM", "PDP re-activation failed");
      } else {
        LOG_INFO("SIM", "PDP re-activated OK");
      }
    }
  }
}