#pragma once
// ─────────────────────────────────────────────────────────────────────────────
// NTP time synchronisation — provides epoch timestamps for MQTT payloads.
//
// WiFi mode: uses ESP32 built-in configTime() (lwIP SNTP client).
// SIM mode:  uses AT+CNTP command on SIM7080G modem.
//
// After successful sync, ntp_epoch_offset_ms is set so that:
//   epoch_ms = ntp_epoch_offset_ms + millis()
// This lets any task call state_epoch_ms() / state_epoch_s() to get a
// Unix timestamp without blocking or calling NTP again.
//
// If NTP has not synced yet (early boot, network down), the helpers
// fall back to monotonic millis() — the backend recognises small values
// as "not yet synced" and uses its own clock.
// ─────────────────────────────────────────────────────────────────────────────

#include <Arduino.h>
#include <WiFi.h>
#include <esp_task_wdt.h>
#include "ciren_config.h"
#include "system_state.h"
#include "task_logger.h"

// configTime() needs these prototypes (esp_sntp.h on ESP32 Arduino core ≥ 3.x)
#if __has_include(<esp_sntp.h>)
  #include <esp_sntp.h>
#endif

// ── NTP servers ───────────────────────────────────────────────────────────────
static const char* NTP_SERVERS[] = {
  "ntp.nict.jp",      // Japan NICT — primary
  "time.google.com",  // Google — fallback
  "pool.ntp.org"       // pool — tertiary
};

// ── Try NTP sync via WiFi (configTime / SNTP) ─────────────────────────────────
static bool _ntp_sync_wifi() {
  if (WiFi.status() != WL_CONNECTED) return false;

  configTime(9 * 3600, 0,            // JST (UTC+9), no DST
             NTP_SERVERS[0], NTP_SERVERS[1], NTP_SERVERS[2]);

  // Wait up to NTP_TIMEOUT_MS for the time to be set
  uint32_t start = millis();
  struct tm timeinfo;
  while (millis() - start < NTP_TIMEOUT_MS) {
    if (getLocalTime(&timeinfo, 0)) {
      // Got the time — compute epoch offset
      time_t now = mktime(&timeinfo);
      // Adjust back from JST to UTC: mktime() treats struct tm as local (JST)
      // since we configured JST=+9, so mktime returns UTC+9 epoch.
      // Actually, configTime sets the timezone offset, so mktime should return
      // the correct local time. We want UTC epoch:
      // UTC = local_time - timezone_offset
      // But time() returns UTC directly when SNTP is configured.
      // Let's just use time() which gives UTC epoch after configTime.
      time_t utc_now = time(NULL);
      if (utc_now > 1700000000) {   // sanity: after 2023-11-14
        uint32_t ms = millis();
        int64_t offset_ms = (int64_t)utc_now * 1000LL - (int64_t)ms;

        xSemaphoreTake(state_mutex, portMAX_DELAY);
        sys_state.ntp_epoch_offset_ms = offset_ms;
        sys_state.ntp_synced = true;
        xSemaphoreGive(state_mutex);

        Serial.printf("[NTP] WiFi sync OK: epoch=%lld offset_ms=%lld\n",
                      (long long)utc_now, (long long)offset_ms);
        LOG_INFO("NTP", "WiFi sync OK: epoch=%lld offset=%lldms",
                 (long long)utc_now, (long long)offset_ms);
        return true;
      }
    }
    vTaskDelay(pdMS_TO_TICKS(500));
    esp_task_wdt_reset();
  }

  Serial.println("[NTP] WiFi sync failed — timeout");
  LOG_WARN("NTP", "WiFi sync failed — timeout");
  return false;
}

// ── Try NTP sync via SIM7080G AT+CNTP ──────────────────────────────────────────
// AT+CNTP="ntp.nict.jp",36   (36 = JST timezone in 15-min units: UTC+9 → 9×4)
// The modem responds to AT+CNTP in TWO stages:
//   1) "OK"   — acknowledges the command was received
//   2) "+CNTP: <code>,<timestamp>" — arrives later as URC (up to 30s)
// _sim_atReply() breaks on "OK" and misses the +CNTP: response,
// so we need a dedicated wait function that looks for "+CNTP:" specifically.
// Requires sim_at_mutex (shared with task_sim_manager / task_mqtt_sim).

// Wait for +CNTP: URC after sending AT+CNTP.
// The modem first sends "OK", then later sends "+CNTP: <code>,<epoch>".
// We must NOT break on "OK" — we keep reading until "+CNTP:" appears or timeout.
static const char* _ntp_waitCNTP(uint32_t timeout_ms) {
  _sim_flush();
  _sim_ser.println("AT+CNTP");
  uint32_t t = millis();
  size_t pos = 0;
  _sim_rxbuf[0] = '\0';
  while (millis() - t < timeout_ms) {
    while (_sim_ser.available() && pos < sizeof(_sim_rxbuf) - 1) {
      _sim_rxbuf[pos++] = (char)_sim_ser.read();
      _sim_rxbuf[pos] = '\0';
    }
    if (strstr(_sim_rxbuf, "+CNTP:")) break;   // got the result!
    // "ERROR" here means the modem rejected the command outright
    if (strstr(_sim_rxbuf, "ERROR")) break;
    esp_task_wdt_reset();
    delay(10);
  }
  // Trim trailing whitespace
  while (pos > 0 && (_sim_rxbuf[pos-1] == '\r' || _sim_rxbuf[pos-1] == '\n' ||
                      _sim_rxbuf[pos-1] == ' '))
    _sim_rxbuf[--pos] = '\0';
  return _sim_rxbuf;
}

static bool _ntp_sync_sim() {
  if (!sys_state.sim_enabled || !sys_state.sim_gprs) return false;
  if (!xSemaphoreTake(sim_at_mutex, pdMS_TO_TICKS(15000))) {
    LOG_WARN("NTP", "SIM NTP — cannot take AT mutex");
    return false;
  }
  esp_task_wdt_reset();

  // AT+CNTP second parameter is timezone in units of 15 minutes (not port!).
  // JST = UTC+9 → 9 * 4 = 36
  #define NTP_TZ_QUARTERS  36

  // Try each NTP server until one succeeds
  for (int i = 0; i < 3; i++) {
    esp_task_wdt_reset();
    char cmd[64];
    snprintf(cmd, sizeof(cmd), "AT+CNTP=\"%s\",%d", NTP_SERVERS[i], NTP_TZ_QUARTERS);

    // Step 1: Configure NTP server (AT+CNTP="server",tz)
    if (!_sim_sendAT(cmd, "OK", 5000)) {
      Serial.printf("[NTP] SIM config failed for server %d: %s\n", i, NTP_SERVERS[i]);
      continue;   // try next server
    }
    esp_task_wdt_reset();

    // Step 2: Query NTP — must wait for +CNTP: URC, not just "OK"
    // The modem sends "OK" first, then "+CNTP: <code>,<epoch>" later.
    // Using _sim_atReply would break on "OK" and miss the timestamp.
    const char* reply = _ntp_waitCNTP(30000);

    Serial.printf("[NTP] SIM CNTP reply (server %d): %.100s\n", i, reply);

    // Parse: +CNTP: <code>,<timestamp>
    //   code 1 = success
    //   code 61 = network error
    //   code 62 = DNS resolve error
    //   code 63 = connect error
    // SIM7080G returns timestamp in one of two formats:
    //   Numeric epoch: +CNTP: 1,1751320000
    //   Datetime string: +CNTP: 1,"2026/06/30,23:28:36"  (JST when tz=36)
    const char* cntp = strstr(reply, "+CNTP:");
    if (cntp) {
      int code = 0;
      long epoch = 0;
      bool got_epoch = false;

      // Try numeric epoch format: +CNTP: 1,1751320000
      if (sscanf(cntp, "+CNTP: %d,%ld", &code, &epoch) == 2 && code == 1 && epoch > 1700000000) {
        got_epoch = true;
      }
      // Try datetime format: +CNTP: 1,"2026/06/30,23:28:36"  (JST since tz=36)
      if (!got_epoch) {
        int y, mo, d, h, mi, s;
        if (sscanf(cntp, "+CNTP: %d,\"%d/%d/%d,%d:%d:%d\"", &code, &y, &mo, &d, &h, &mi, &s) >= 7 && code == 1) {
          // Convert JST datetime to UTC epoch
          // JST = UTC+9, so UTC = JST - 9h
          struct tm t = {};
          t.tm_year = y - 1900;
          t.tm_mon  = mo - 1;
          t.tm_mday = d;
          t.tm_hour = h;
          t.tm_min  = mi;
          t.tm_sec  = s;
          t.tm_isdst = -1;
          time_t jst_epoch = mktime(&t);     // mktime interprets as local (UTC at boot)
          epoch = (long)(jst_epoch - 9 * 3600);  // JST → UTC
          if (epoch > 1700000000) got_epoch = true;
        }
      }

      if (got_epoch && code == 1) {
        uint32_t ms = millis();
        int64_t offset_ms = (int64_t)epoch * 1000LL - (int64_t)ms;

        xSemaphoreGive(sim_at_mutex);

        xSemaphoreTake(state_mutex, portMAX_DELAY);
        sys_state.ntp_epoch_offset_ms = offset_ms;
        sys_state.ntp_synced = true;
        xSemaphoreGive(state_mutex);

        Serial.printf("[NTP] SIM sync OK: epoch=%ld offset_ms=%lld (server: %s)\n",
                      epoch, (long long)offset_ms, NTP_SERVERS[i]);
        LOG_INFO("NTP", "SIM sync OK: epoch=%ld offset=%lldms (server: %s)",
                 epoch, (long long)offset_ms, NTP_SERVERS[i]);
        return true;
      }
      // +CNTP returned but with error code or unparseable data
      Serial.printf("[NTP] SIM CNTP error code=%d epoch=%ld\n", code, epoch);
    }
    // Failed with this server — try next
    LOG_WARN("NTP", "SIM NTP server %s failed — trying next", NTP_SERVERS[i]);
  }

  xSemaphoreGive(sim_at_mutex);
  LOG_WARN("NTP", "SIM sync failed (all servers)");
  return false;
}

// ── Task ───────────────────────────────────────────────────────────────────────
void task_ntp(void* param) {
  esp_task_wdt_add(NULL);   // subscribe to Task Watchdog
  Serial.println("[NTP] Task started");
  LOG_INFO("NTP", "Task started");

  uint32_t last_sync_ms = 0;
  bool initial_sync_done = false;

  for (;;) {
    vTaskDelay(pdMS_TO_TICKS(10000));   // check every 10s initially, then hourly
    esp_task_wdt_reset();

    uint32_t now = millis();

    // Re-sync periodically, or if not yet synced
    bool need_sync = !initial_sync_done ||
                     (now - last_sync_ms >= (uint32_t)NTP_SYNC_INTERVAL_MS);

    if (!need_sync) continue;

    // Re-check WD flag before potentially long sync operations
    esp_task_wdt_reset();

    char mode[8];
    xSemaphoreTake(state_mutex, portMAX_DELAY);
    strncpy(mode, sys_state.conn_mode, sizeof(mode));
    xSemaphoreGive(state_mutex);

    bool ok = false;
    if (strcmp(mode, "wifi") == 0) {
      ok = _ntp_sync_wifi();
    } else {
      // SIM mode — try AT+CNTP (requires GPRS active)
      ok = _ntp_sync_sim();
    }

    if (ok) {
      initial_sync_done = true;
      last_sync_ms = now;
    } else {
      // Retry sooner on failure (every 30s for first 5 minutes, then back to hourly)
      if (!initial_sync_done) {
        // Keep trying every 30s until first sync
        // Split the 20s delay into 5s chunks to feed the watchdog
        for (int i = 0; i < 4; i++) { vTaskDelay(pdMS_TO_TICKS(5000)); esp_task_wdt_reset(); }
        continue;
      }
      // Periodic re-sync failed — try again in 5 minutes
      last_sync_ms = now - (NTP_SYNC_INTERVAL_MS - 300000);
    }
  }
}