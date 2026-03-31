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
    // Some modems skip restart, try init instead
    if (!modem.init()) {
      Serial.println("[SIM] Modem init failed");
      // Continue anyway — modem may still respond
    }
  }

  String modemInfo = modem.getModemInfo();
  Serial.printf("[SIM] Modem: %s\n", modemInfo.c_str());

  String op = modem.getOperator();
  xSemaphoreTake(state_mutex, portMAX_DELAY);
  sys_state.sim_modem_ok = true;
  strncpy(sys_state.sim_operator, op.c_str(), sizeof(sys_state.sim_operator) - 1);
  xSemaphoreGive(state_mutex);

  for (;;) {
    // Re-connect GPRS if dropped
    if (!modem.isGprsConnected()) {
      Serial.println("[SIM] Connecting GPRS...");
      xSemaphoreTake(state_mutex, portMAX_DELAY);
      sys_state.sim_gprs = false;
      xSemaphoreGive(state_mutex);

      if (modem.gprsConnect(SIM_APN, SIM_USER, SIM_PASS)) {
        Serial.println("[SIM] GPRS connected");
        xSemaphoreTake(state_mutex, portMAX_DELAY);
        sys_state.sim_gprs = true;
        xSemaphoreGive(state_mutex);
      } else {
        Serial.println("[SIM] GPRS connect failed, retry in 60s");
        vTaskDelay(pdMS_TO_TICKS(SIM_RETRY_MS));
        continue;
      }
    }

    // Periodic signal quality update
    int8_t sig = (int8_t)modem.getSignalQuality();
    String op_now = modem.getOperator();
    xSemaphoreTake(state_mutex, portMAX_DELAY);
    sys_state.sim_signal = sig;
    sys_state.sim_gprs   = modem.isGprsConnected();
    strncpy(sys_state.sim_operator, op_now.c_str(), sizeof(sys_state.sim_operator) - 1);
    xSemaphoreGive(state_mutex);

    vTaskDelay(pdMS_TO_TICKS(SIM_SIGNAL_INT_MS));
  }
}