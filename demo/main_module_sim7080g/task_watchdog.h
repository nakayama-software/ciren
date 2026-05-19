#pragma once
#include <Arduino.h>
#include "ciren_config.h"
#include "ring_buffer.h"
#include "system_state.h"

// Handle task untuk stack monitoring — diisi saat task dibuat
TaskHandle_t h_conn_mgr   = NULL;
TaskHandle_t h_espnow_rx  = NULL;
TaskHandle_t h_oled       = NULL;
TaskHandle_t h_publish    = NULL;
TaskHandle_t h_aggregator = NULL;
TaskHandle_t h_status     = NULL;

void task_watchdog(void* param) {
  for (;;) {
    vTaskDelay(pdMS_TO_TICKS(WD_CHECK_MS));

    float usage = rb_usage();
    if (usage > RB_WARN_THRESHOLD)
      Serial.printf("[WD] Ring buffer %.0f%% full\n", usage * 100);

    xSemaphoreTake(state_mutex, portMAX_DELAY);
    uint16_t errs = sys_state.err_counter;
    if (errs > 50) sys_state.err_counter = 0;
    xSemaphoreGive(state_mutex);

    Serial.printf("[WD] rb=%.0f%% err=%d connected=%s uptime=%lus\n",
      usage * 100, errs, state_is_connected() ? "yes" : "no", millis() / 1000);

    // ── Stack high-water mark — satu printf per task ──────────────────────
    UBaseType_t hwm_conn  = h_conn_mgr   ? uxTaskGetStackHighWaterMark(h_conn_mgr)   : 0;
    UBaseType_t hwm_rx    = h_espnow_rx  ? uxTaskGetStackHighWaterMark(h_espnow_rx)  : 0;
    UBaseType_t hwm_oled  = h_oled       ? uxTaskGetStackHighWaterMark(h_oled)       : 0;
    UBaseType_t hwm_pub   = h_publish    ? uxTaskGetStackHighWaterMark(h_publish)    : 0;
    UBaseType_t hwm_agg   = h_aggregator ? uxTaskGetStackHighWaterMark(h_aggregator) : 0;
    UBaseType_t hwm_stat  = h_status     ? uxTaskGetStackHighWaterMark(h_status)     : 0;
    UBaseType_t hwm_wd    = uxTaskGetStackHighWaterMark(NULL); // diri sendiri

    // Satu Serial.printf untuk semua — jauh lebih hemat stack daripada 7x printf
    Serial.printf("[WD] HWM(words) conn=%u rx=%u oled=%u pub=%u agg=%u stat=%u wd=%u\n",
                  hwm_conn, hwm_rx, hwm_oled, hwm_pub, hwm_agg, hwm_stat, hwm_wd);

    // Warning jika ada yang kritis (< 128 words = 512 bytes tersisa)
    if (hwm_conn  < 128) Serial.printf("[WD] WARN: conn_mgr   low stack! %u words\n", hwm_conn);
    if (hwm_rx    < 128) Serial.printf("[WD] WARN: espnow_rx  low stack! %u words\n", hwm_rx);
    if (hwm_oled  < 128) Serial.printf("[WD] WARN: oled       low stack! %u words\n", hwm_oled);
    if (hwm_pub   < 128) Serial.printf("[WD] WARN: publish    low stack! %u words\n", hwm_pub);
    if (hwm_agg   < 128) Serial.printf("[WD] WARN: aggregator low stack! %u words\n", hwm_agg);
    if (hwm_stat  < 128) Serial.printf("[WD] WARN: status     low stack! %u words\n", hwm_stat);
    if (hwm_wd    < 128) Serial.printf("[WD] WARN: watchdog   low stack! %u words\n", hwm_wd);
  }
}