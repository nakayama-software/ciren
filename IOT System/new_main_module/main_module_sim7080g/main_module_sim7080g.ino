#include <Arduino.h>
#include <WiFi.h>
#include <Preferences.h>
#include <esp_mac.h>
#include <esp_task_wdt.h>
#include "ciren_config.h"
#include "ring_buffer.h"
#include "system_state.h"
#include "task_node_config.h"   
#include "task_espnow_rx.h"
#include "task_publish.h"
#include "task_aggregator.h"
#include "task_conn_manager.h"
#include "task_status.h"
#include "task_watchdog.h"
#include "task_btn_oled.h"
#include "task_sim_manager.h"
#include "task_mqtt_sim.h"
#include "task_logger.h"
#include "task_ntp.h"

// ─── Global definitions ───────────────────────────
SystemState sys_state;
SemaphoreHandle_t state_mutex = NULL;

Preferences prefs;

struct AppConfig
{
  char wifi_ssid[64];
  char wifi_pass[64];
  char mqtt_host[64];
  char conn_mode[8];
  bool sim_enabled;
  char sim_apn[64];
  char sim_apn_user[32];
  char sim_apn_pass[32];
  char device_id[32];
};
AppConfig cfg;

void load_config()
{
  prefs.begin("ciren", true);
  strncpy(cfg.wifi_ssid,    prefs.getString("ssid", "").c_str(),              sizeof(cfg.wifi_ssid));
  strncpy(cfg.wifi_pass,    prefs.getString("pass", "").c_str(),              sizeof(cfg.wifi_pass));
  strncpy(cfg.mqtt_host,    prefs.getString("mqtt_host", "118.22.31.254").c_str(), sizeof(cfg.mqtt_host));
  strncpy(cfg.conn_mode,    prefs.getString("conn_mode", "wifi").c_str(),     sizeof(cfg.conn_mode));
  cfg.sim_enabled = prefs.getBool("sim_en", true);
  strncpy(cfg.sim_apn,      prefs.getString("sim_apn",  "").c_str(),          sizeof(cfg.sim_apn));
  strncpy(cfg.sim_apn_user, prefs.getString("sim_user", "").c_str(),          sizeof(cfg.sim_apn_user));
  strncpy(cfg.sim_apn_pass, prefs.getString("sim_pass", "").c_str(),          sizeof(cfg.sim_apn_pass));
  strncpy(cfg.device_id,    prefs.getString("device_id", "").c_str(),         sizeof(cfg.device_id));
  prefs.end();
}

void save_config_defaults()
{
  prefs.begin("ciren", false);
  prefs.putString("mqtt_host", "118.22.31.254");
  if (!prefs.isKey("conn_mode")) prefs.putString("conn_mode", "wifi");
  if (!prefs.isKey("sim_en"))    prefs.putBool("sim_en", true);
  if (!prefs.isKey("sim_apn"))   prefs.putString("sim_apn", "soracom.io");
  prefs.end();
}

// ─── Setup ────────────────────────────────────────
void setup()
{
  Serial.begin(115200);
  delay(500);

  state_mutex = xSemaphoreCreateMutex();

  state_init();
  rb_init();
  publish_queue_init();
  log_queue_init();

  btn_oled_init();

  save_config_defaults();
  load_config();

  strncpy(sys_state.conn_mode,    cfg.conn_mode,    sizeof(sys_state.conn_mode));
  strncpy(sys_state.mqtt_host,    cfg.mqtt_host,    sizeof(sys_state.mqtt_host));
  sys_state.sim_enabled = cfg.sim_enabled;
  strncpy(sys_state.sim_apn,      cfg.sim_apn,      sizeof(sys_state.sim_apn));
  strncpy(sys_state.sim_apn_user, cfg.sim_apn_user, sizeof(sys_state.sim_apn_user));
  strncpy(sys_state.sim_apn_pass, cfg.sim_apn_pass, sizeof(sys_state.sim_apn_pass));

  
  if (strlen(cfg.device_id) > 0) {
    strncpy(sys_state.device_id, cfg.device_id, sizeof(sys_state.device_id));
  } else {
    uint8_t mac[6];
    esp_read_mac(mac, ESP_MAC_WIFI_STA);
    snprintf(sys_state.device_id, sizeof(sys_state.device_id),
             "%s-%02X%02X%02X", DEVICE_ID_PREFIX, mac[3], mac[4], mac[5]);
    prefs.begin("ciren", false);
    prefs.putString("device_id", sys_state.device_id);
    prefs.end();
    Serial.printf("[SETUP] Generated Device ID: %s\n", sys_state.device_id);
  }
  state_build_topics(); 

  Serial.printf("CIREN Main Module %s\n", FW_VERSION);
  Serial.printf("Device   : %s\n", sys_state.device_id);
  Serial.printf("WiFi SSID: %s\n", cfg.wifi_ssid);
  Serial.printf("MQTT Host: %s\n", cfg.mqtt_host);
  LOG_INFO("SETUP", "Config: SSID=%s MQTT=%s:%d", cfg.wifi_ssid, cfg.mqtt_host, MQTT_PORT);
  LOG_INFO("SETUP", "CIREN Main Module %s booted, device_id=%s", FW_VERSION, sys_state.device_id);

  sim_manager_init();
  mqtt_sim_init();

  // ── Task Watchdog Timer ────────────────────────────────────────────────────
  // 15s timeout — if any subscribed task fails to feed, system panics and reboots.
  // This ensures automatic recovery from task hangs (e.g., mutex deadlock, infinite loop).
  esp_task_wdt_init(15, true);   // panic=true → reboot on timeout
  esp_task_wdt_add(NULL);         // subscribe the setup/loop task
  LOG_INFO("SETUP", "Task Watchdog initialized (15s timeout, panic on timeout)");

  nc_init();
  esp_task_wdt_reset();   // feed WD after init phases

  WiFi.mode(WIFI_STA);
  WiFi.disconnect();

  esp_task_wdt_reset();   // feed WD before ESP-NOW init
  if (esp_now_init() != ESP_OK)
  {
    LOG_ERROR("SETUP", "ESP-NOW init failed — cannot receive sensor data");
    Serial.println("[FATAL] esp_now_init failed");
    while (1)
      delay(1000);
  }
  esp_now_register_recv_cb(espnow_recv_cb);
  Serial.println("[ESP-NOW] Init OK");
  LOG_INFO("SETUP", "ESP-NOW initialized OK");

  if (strlen(cfg.wifi_ssid) == 0)
  {
    // No WiFi credentials — auto-start portal; SIM becomes primary connection
    Serial.println("[SETUP] No WiFi credentials — auto-starting portal, SIM as primary");
    LOG_WARN("SETUP", "No WiFi credentials — portal started, SIM as primary");
    portal_start(&prefs);
    esp_task_wdt_reset();   // feed WD after portal start
    xSemaphoreTake(state_mutex, portMAX_DELAY);
    strncpy(sys_state.conn_mode, "sim", sizeof(sys_state.conn_mode));
    xSemaphoreGive(state_mutex);
  }
  else
  {
    // WiFi credentials exist — init conn_manager and start WiFi connection task
    conn_manager_init(cfg.wifi_ssid, cfg.wifi_pass, cfg.mqtt_host);
    xTaskCreatePinnedToCore(task_conn_manager, "conn_mgr", STACK_CONN, NULL, PRIO_CONN, &h_conn_mgr, 0);
  }

  // All other tasks start regardless of WiFi state
  esp_task_wdt_reset();   // feed WD before creating tasks

  // Core 0: IO + display
  xTaskCreatePinnedToCore(task_espnow_rx,   "espnow_rx", STACK_RX,      NULL,   PRIO_RX,       &h_espnow_rx,  0);
  xTaskCreatePinnedToCore(task_watchdog,    "watchdog",  STACK_WATCHDOG,NULL,   PRIO_WATCHDOG, NULL,          0);
  xTaskCreatePinnedToCore(task_oled,        "oled",      STACK_OLED,    &prefs, PRIO_OLED,     &h_oled,       0);
  xTaskCreatePinnedToCore(sim_manager_task, "sim_mgr",   STACK_SIM_MGR, NULL,   PRIO_CONN,     NULL,          0);

  // Core 1: data processing
  xTaskCreatePinnedToCore(task_publish,     "publish",    STACK_PUBLISH,  NULL, PRIO_PUBLISH, &h_publish,    1);
  xTaskCreatePinnedToCore(task_aggregator,  "aggregator", STACK_AGG,      NULL, PRIO_AGG,     &h_aggregator, 1);
  xTaskCreatePinnedToCore(task_status,      "status",     STACK_STATUS,   NULL, PRIO_STATUS,  &h_status,     1);
  xTaskCreatePinnedToCore(mqtt_sim_task,    "mqtt_sim",   STACK_MQTT_SIM, NULL, PRIO_CONN,    NULL,          1);
  xTaskCreatePinnedToCore(task_logger,     "logger",     STACK_LOGGER,   NULL, PRIO_LOGGER,  NULL,          1);
  xTaskCreatePinnedToCore(task_node_config, "node_cfg",   STACK_CONFIG,   NULL, PRIO_CONFIG,  NULL,          1);
  xTaskCreatePinnedToCore(task_ntp,        "ntp",         4096,           NULL, PRIO_STATUS,  NULL,          1);

  Serial.println("All tasks started.");
  LOG_INFO("SETUP", "All tasks started, entering main loop");
}

void loop()
{
  // loopTask is subscribed to TWDT — must feed periodically.
  // All real work runs in FreeRTOS tasks; loop() just keeps the
  // Arduino framework task alive and feeds the watchdog.
  esp_task_wdt_reset();
  vTaskDelay(pdMS_TO_TICKS(5000));
}
