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
// AT+CNTP on SIM7080G:
//   AT+CNTP="server",tz   — configure NTP server (does NOT start query)
//   AT+CNTP               — start NTP query using configured server
// Response: "OK" immediately, then "+CNTP: <code>,<epoch>" as a URC seconds later.
// Requires sim_at_mutex (shared with task_sim_manager / task_mqtt_sim).
static bool _ntp_sync_sim() {
  if (!sys_state.sim_enabled || !sys_state.sim_gprs) return false;
  if (!xSemaphoreTake(sim_at_mutex, pdMS_TO_TICKS(15000))) {
    LOG_WARN("NTP", "SIM NTP — cannot take AT mutex");
    return false;
  }
  esp_task_wdt_reset();

  // Clear any stale NTP URC result from a previous attempt
  _ntp_urc_ready = false;

  // Step 1: Configure NTP server.
  // AT+CNTP second parameter is timezone in units of 15 minutes (quarter-hours).
  // JST = UTC+9 → 9 * 4 = 36. SIM7080G accepts timezone, NOT port number.
  #define NTP_TZ_QUARTERS  36
  char cmd[64];
  snprintf(cmd, sizeof(cmd), "AT+CNTP=\"%s\",%d", NTP_SERVERS[0], NTP_TZ_QUARTERS);
  Serial.printf("[NTP] SIM: %s\n", cmd);
  bool config_ok = _sim_sendAT(cmd, "OK", 5000, true);
  if (!config_ok) {
    // Try fallback server
    snprintf(cmd, sizeof(cmd), "AT+CNTP=\"%s\",%d", NTP_SERVERS[1], NTP_TZ_QUARTERS);
    Serial.printf("[NTP] SIM: %s\n", cmd);
    config_ok = _sim_sendAT(cmd, "OK", 5000, true);
  }
  if (!config_ok) {
    xSemaphoreGive(sim_at_mutex);
    LOG_WARN("NTP", "SIM NTP — CNTP config failed");
    return false;
  }

  // Step 2: Start NTP query.
  // AT+CNTP (without parameters) triggers the actual NTP request.
  // _sim_sendAT internally calls _sim_flush() which captures any pending +CNTP: URC
  // from a previous attempt, and reads the "OK" response into _sim_rxbuf.
  Serial.println("[NTP] SIM: AT+CNTP (start query)");
  if (!_sim_sendAT("AT+CNTP", "OK", 3000, true)) {
    xSemaphoreGive(sim_at_mutex);
    LOG_WARN("NTP", "SIM NTP — AT+CNTP start failed");
    return false;
  }

  // Step 3: Check if +CNTP: arrived very quickly (within the _sim_sendAT read window).
  // _sim_sendAT reads all available Serial2 data into _sim_rxbuf. If the NTP server
  // responded very fast, +CNTP: could already be in _sim_rxbuf.
  const char* cntp_rx = strstr(_sim_rxbuf, "+CNTP:");
  if (cntp_rx) {
    int code = -1; long epoch = 0;
    if (sscanf(cntp_rx, "+CNTP: %d,%ld", &code, &epoch) == 2) {
      if (code == 1 && epoch > 1700000000) {
        uint32_t ms = millis();
        int64_t offset_ms = (int64_t)epoch * 1000LL - (int64_t)ms;
        xSemaphoreTake(state_mutex, portMAX_DELAY);
        sys_state.ntp_epoch_offset_ms = offset_ms;
        sys_state.ntp_synced = true;
        xSemaphoreGive(state_mutex);
        xSemaphoreGive(sim_at_mutex);
        Serial.printf("[NTP] SIM sync OK (immediate): epoch=%ld offset_ms=%lld\n", epoch, (long long)offset_ms);
        LOG_INFO("NTP", "SIM sync OK (immediate): epoch=%ld offset=%lldms", epoch, (long long)offset_ms);
        return true;
      }
      // +CNTP arrived but with error code — log and fail
      xSemaphoreGive(sim_at_mutex);
      Serial.printf("[NTP] SIM NTP failed — immediate code=%d epoch=%ld\n", code, epoch);
      LOG_WARN("NTP", "SIM sync failed — CNTP code=%d epoch=%ld", code, epoch);
      return false;
    }
  }

  // Step 4: +CNTP: not yet arrived — release mutex and wait for it via shared variables.
  // The URC arrives seconds later as an unsolicited response. _smq_drain() in
  // mqtt_sim_task will capture it and set _ntp_urc_ready. _sim_flush() (called
  // before AT commands) also captures it as a safety net.
  xSemaphoreGive(sim_at_mutex);
  Serial.println("[NTP] SIM: waiting for CNTP URC (mutex released)...");
  LOG_INFO("NTP", "SIM: AT+CNTP sent, waiting for URC (mutex released)");

  uint32_t t = millis();
  bool got_cntp = false;
  int cntp_code = -1;
  long cntp_epoch = 0;

  // Wait up to 30s for the +CNTP: URC (without holding the mutex).
  // All Serial2 data goes through _smq_drain() → _smq_process_urcs(),
  // which detects +CNTP: and sets _ntp_urc_ready. We never read Serial2 directly
  // to avoid data fragmentation between tasks.
  while (millis() - t < 30000) {
    if (_ntp_urc_ready) {
      cntp_code  = _ntp_urc_code;
      cntp_epoch = _ntp_urc_epoch;
      got_cntp   = true;
      _ntp_urc_ready = false;
      Serial.println("[NTP] SIM: +CNTP URC captured via mqtt_sim");
      LOG_INFO("NTP", "SIM: +CNTP URC captured via mqtt_sim");
      break;
    }
    esp_task_wdt_reset();
    vTaskDelay(pdMS_TO_TICKS(100));
  }

  if (got_cntp && cntp_code == 1 && cntp_epoch > 1700000000) {
    uint32_t ms = millis();
    int64_t offset_ms = (int64_t)cntp_epoch * 1000LL - (int64_t)ms;

    xSemaphoreTake(state_mutex, portMAX_DELAY);
    sys_state.ntp_epoch_offset_ms = offset_ms;
    sys_state.ntp_synced = true;
    xSemaphoreGive(state_mutex);

    Serial.printf("[NTP] SIM sync OK: epoch=%ld offset_ms=%lld\n", cntp_epoch, (long long)offset_ms);
    LOG_INFO("NTP", "SIM sync OK: epoch=%ld offset=%lldms", cntp_epoch, (long long)offset_ms);
    return true;
  }

  // CNTP failed — try AT+CCLK as fallback (network-synced modem clock)
  // AT+CCLK returns the modem's RTC time, which is set from the network
  // during registration. Less accurate than NTP but reliable on Cat-M.
  Serial.println("[NTP] SIM: CNTP failed, trying AT+CCLK fallback");
  LOG_INFO("NTP", "SIM: CNTP failed, trying AT+CCLK fallback");

  if (xSemaphoreTake(sim_at_mutex, pdMS_TO_TICKS(5000)) == pdTRUE) {
    const char* cclk = _sim_atReply("AT+CCLK?", 3000);
    xSemaphoreGive(sim_at_mutex);

    // Parse +CCLK: "yy/MM/dd,HH:mm:ss+TZ" or "yy/MM/dd,HH:mm:ss"
    // Example: +CCLK: "25/07/07,14:30:00+36"
    const char* q1 = strchr(cclk, '"');
    if (q1) {
      const char* q2 = strchr(q1 + 1, '"');
      if (q2 && q2 > q1 + 1) {
        char timebuf[32];
        size_t tlen = (size_t)(q2 - q1 - 1);
        if (tlen >= sizeof(timebuf)) tlen = sizeof(timebuf) - 1;
        memcpy(timebuf, q1 + 1, tlen);
        timebuf[tlen] = '\0';

        struct tm tm_buf;
        memset(&tm_buf, 0, sizeof(tm_buf));
        int tz_quarters = 0;
        int parsed = sscanf(timebuf, "%d/%d/%d,%d:%d:%d%d",
                            &tm_buf.tm_year, &tm_buf.tm_mon, &tm_buf.tm_mday,
                            &tm_buf.tm_hour, &tm_buf.tm_min, &tm_buf.tm_sec,
                            &tz_quarters);
        if (parsed >= 6) {
          tm_buf.tm_year += 2000 - 1900;  // "25" → 2025 - 1900 = 125
          tm_buf.tm_mon -= 1;  // months are 0-11
          tm_buf.tm_isdst = 0;  // no DST

          // Set timezone to UTC so mktime() interprets struct tm as UTC
          // (configTime may have set it to JST from WiFi NTP)
          setenv("TZ", "UTC0", 1);
          tzset();
          time_t utc_epoch = mktime(&tm_buf);

          // Adjust for timezone: CCLK time is in local timezone (e.g., JST = +36)
          // Since mktime() treats struct tm as UTC, we subtract the local offset
          // to get true UTC. e.g., 14:30 JST → mktime gives epoch of 14:30 UTC,
          // but actual UTC is 05:30, so subtract 9 hours (36 * 15min = 9h).
          int32_t tz_offset_s = tz_quarters * 15 * 60;
          utc_epoch -= tz_offset_s;

          if (utc_epoch > 1700000000) {
            uint32_t ms = millis();
            int64_t offset_ms = (int64_t)utc_epoch * 1000LL - (int64_t)ms;

            xSemaphoreTake(state_mutex, portMAX_DELAY);
            sys_state.ntp_epoch_offset_ms = offset_ms;
            sys_state.ntp_synced = true;
            xSemaphoreGive(state_mutex);

            Serial.printf("[NTP] SIM sync OK (CCLK): epoch=%ld offset_ms=%lld\n",
                          (long)utc_epoch, (long long)offset_ms);
            LOG_INFO("NTP", "SIM sync OK (CCLK): epoch=%ld offset=%lldms",
                     (long)utc_epoch, (long long)offset_ms);
            return true;
          }
        }
        Serial.printf("[NTP] SIM: CCLK parse failed: %s\n", timebuf);
        LOG_WARN("NTP", "SIM: CCLK parse failed: %s", timebuf);
      }
    }
    Serial.printf("[NTP] SIM: CCLK response: %.80s\n", cclk);
    LOG_WARN("NTP", "SIM: CCLK response: %.80s", cclk);
  }

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