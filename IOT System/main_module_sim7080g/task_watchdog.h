#pragma once
#include <Arduino.h>
#include <esp_task_wdt.h>
#include "ciren_config.h"
#include "ring_buffer.h"
#include "system_state.h"
#include "task_logger.h"

// Handle task untuk stack monitoring — diisi saat task dibuat
TaskHandle_t h_conn_mgr   = NULL;
TaskHandle_t h_espnow_rx  = NULL;
TaskHandle_t h_oled       = NULL;
TaskHandle_t h_publish    = NULL;
TaskHandle_t h_aggregator = NULL;
TaskHandle_t h_status     = NULL;
TaskHandle_t h_mqtt_sim   = NULL;    // CPU 1 — MQTT over SIM7080G
TaskHandle_t h_sim_mgr    = NULL;    // CPU 0 — SIM manager

// ── LoRa staleness recovery ────────────────────────────────────────────────
// task_lora.h didefinisikan setelah file ini di-include — forward declare saja.
// g_lora_last_iter_ms & h_lora didefinisikan di sana (extern di sini).
extern volatile uint32_t g_lora_last_iter_ms;
extern TaskHandle_t      h_lora;
void lora_reinit(void);
void task_lora(void *param);

#define LORA_STALE_MS 6000   // longgar di atas durasi RecieveFrame normal (~1000ms)

void task_watchdog(void* param) {
  // Subscribe this task to the Task Watchdog Timer
  esp_task_wdt_add(NULL);

  static uint8_t _wd_log_counter = 0;
  for (;;) {
    esp_task_wdt_reset();   // feed the watchdog — must reset within TWDT_TIMEOUT_MS
    vTaskDelay(pdMS_TO_TICKS(WD_CHECK_MS));

    float usage = rb_usage();
    if (usage > RB_WARN_THRESHOLD) {
      Serial.printf("[WD] Ring buffer %.0f%% full\n", usage * 100);
      LOG_WARN("WD", "Ring buffer %.0f%% full", usage * 100);
    }

    xSemaphoreTake(state_mutex, portMAX_DELAY);
    uint16_t errs = sys_state.err_counter;
    if (errs > 50) sys_state.err_counter = 0;
    int8_t sim_signal = sys_state.sim_signal;   // CSQ, -1 if never polled yet
    bool   sim_gprs   = sys_state.sim_gprs;
    xSemaphoreGive(state_mutex);

    // ── LoRa staleness recovery ──────────────────────────────────────────────
    // RecieveFrame() bisa hang total (kemungkinan noise/EMI dari modem SIM saat
    // radio seluler aktif). task_lora sengaja TIDAK subscribe ke Task Watchdog
    // sendiri (biar hang di situ tidak crash seluruh device) — jadi supervisi
    // dilakukan manual di sini: kalau task_lora tidak lapor progres selama
    // LORA_STALE_MS, restart cuma UART + task LoRa-nya, bukan seluruh device.
    if (h_lora != NULL && g_lora_last_iter_ms != 0 &&
        (millis() - g_lora_last_iter_ms) > LORA_STALE_MS) {
      Serial.println("[WD] LoRa stale — restarting task_lora + UART");
      LOG_WARN("WD", "LoRa stale >%dms — restarting", LORA_STALE_MS);
      vTaskDelete(h_lora);
      h_lora = NULL;
      lora_reinit();
      g_lora_last_iter_ms = millis();   // reset penanda supaya tidak langsung re-trigger
      xTaskCreatePinnedToCore(task_lora, "lora", 4096, NULL, PRIO_STATUS, &h_lora, 1);
    }

    Serial.printf("[WD] rb=%.0f%% err=%d connected=%s uptime=%lus\n",
      usage * 100, errs, state_is_connected() ? "yes" : "no", millis() / 1000);

    // ── Stack high-water mark — satu printf per task ──────────────────────
    UBaseType_t hwm_conn  = h_conn_mgr   ? uxTaskGetStackHighWaterMark(h_conn_mgr)   : 0;
    UBaseType_t hwm_rx    = h_espnow_rx  ? uxTaskGetStackHighWaterMark(h_espnow_rx)  : 0;
    UBaseType_t hwm_oled  = h_oled       ? uxTaskGetStackHighWaterMark(h_oled)       : 0;
    UBaseType_t hwm_pub   = h_publish    ? uxTaskGetStackHighWaterMark(h_publish)    : 0;
    UBaseType_t hwm_agg   = h_aggregator ? uxTaskGetStackHighWaterMark(h_aggregator) : 0;
    UBaseType_t hwm_stat  = h_status     ? uxTaskGetStackHighWaterMark(h_status)     : 0;
    UBaseType_t hwm_msq   = h_mqtt_sim   ? uxTaskGetStackHighWaterMark(h_mqtt_sim)   : 0;
    UBaseType_t hwm_sim   = h_sim_mgr    ? uxTaskGetStackHighWaterMark(h_sim_mgr)    : 0;
    UBaseType_t hwm_wd    = uxTaskGetStackHighWaterMark(NULL); // diri sendiri

    // Satu Serial.printf untuk semua — jauh lebih hemat stack daripada 7x printf
    Serial.printf("[WD] HWM conn=%u rx=%u oled=%u pub=%u agg=%u stat=%u msim=%u sim=%u wd=%u\n",
                  hwm_conn, hwm_rx, hwm_oled, hwm_pub, hwm_agg, hwm_stat, hwm_msq, hwm_sim, hwm_wd);

    // Warning jika ada yang kritis (< 128 words = 512 bytes tersisa)
    // Guard with handle != NULL — NULL handle reports 0 but the task was simply not started
    if (h_conn_mgr   && hwm_conn  < 128) { Serial.printf("[WD] WARN: conn_mgr   low stack! %u\n", hwm_conn); LOG_ERROR("WD", "conn_mgr low stack! %u", hwm_conn); }
    if (h_espnow_rx  && hwm_rx    < 128) { Serial.printf("[WD] WARN: espnow_rx  low stack! %u\n", hwm_rx); LOG_ERROR("WD", "espnow_rx low stack! %u", hwm_rx); }
    if (h_oled       && hwm_oled  < 128) { Serial.printf("[WD] WARN: oled       low stack! %u\n", hwm_oled); LOG_ERROR("WD", "oled low stack! %u", hwm_oled); }
    if (h_publish    && hwm_pub   < 128) { Serial.printf("[WD] WARN: publish    low stack! %u\n", hwm_pub); LOG_ERROR("WD", "publish low stack! %u", hwm_pub); }
    if (h_aggregator && hwm_agg   < 128) { Serial.printf("[WD] WARN: aggregator low stack! %u\n", hwm_agg); LOG_ERROR("WD", "aggregator low stack! %u", hwm_agg); }
    if (h_status     && hwm_stat  < 128) { Serial.printf("[WD] WARN: status     low stack! %u\n", hwm_stat); LOG_ERROR("WD", "status low stack! %u", hwm_stat); }
    if (h_mqtt_sim   && hwm_msq   < 128) { Serial.printf("[WD] WARN: mqtt_sim   low stack! %u\n", hwm_msq); LOG_ERROR("WD", "mqtt_sim low stack! %u", hwm_msq); }
    if (h_sim_mgr    && hwm_sim   < 128) { Serial.printf("[WD] WARN: sim_mgr    low stack! %u\n", hwm_sim); LOG_ERROR("WD", "sim_mgr low stack! %u", hwm_sim); }
    if (hwm_wd    < 128) { Serial.printf("[WD] WARN: watchdog   low stack! %u\n", hwm_wd); LOG_ERROR("WD", "watchdog low stack! %u", hwm_wd); }

    _wd_log_counter++;
    if (_wd_log_counter >= 5) {
      _wd_log_counter = 0;
      uint32_t uptime_s = millis() / 1000;
      // sim_signal/sim_gprs logged every cycle here (not just on FAIR/UNKNOWN
      // transition in task_sim_manager.h) so a continuous CSQ timeline exists
      // for correlating future long outages with signal quality — previously
      // only transition events were logged, which went silent during a sustained
      // bad-signal episode (no new transition = no new log line).
      LOG_INFO("WD", "rb=%d%% err=%d conn=%s up=%lus sig=%d pdp=%s",
               (int)(usage * 100), errs, state_is_connected() ? "yes" : "no", uptime_s,
               (int)sim_signal, sim_gprs ? "up" : "down");
    }
  }
}