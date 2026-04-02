#include <Arduino.h>
#include <WiFi.h>
#include <Preferences.h>
#include "ciren_config_014424.h"
#include "ring_buffer_014424.h"
#include "system_state_014424.h"
#include "task_espnow_rx_014424.h"
#include "task_publish_014424.h"
#include "task_aggregator_014424.h"
#include "task_conn_manager_014424.h"
#include "task_status_014424.h"
#include "task_watchdog_014424.h"
#include "task_btn_oled_014424.h"
#include "task_sim_manager_014424.h"
#include "task_mqtt_sim_014424.h"

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
};
AppConfig cfg;

void load_config()
{
  prefs.begin("ciren", true);
  strncpy(cfg.wifi_ssid, prefs.getString("ssid", "").c_str(), sizeof(cfg.wifi_ssid));
  strncpy(cfg.wifi_pass, prefs.getString("pass", "").c_str(), sizeof(cfg.wifi_pass));
  strncpy(cfg.mqtt_host, prefs.getString("mqtt_host", "192.168.103.241").c_str(), sizeof(cfg.mqtt_host));
  strncpy(cfg.conn_mode, prefs.getString("conn_mode", "wifi").c_str(), sizeof(cfg.conn_mode));
  cfg.sim_enabled = prefs.getBool("sim_en", true);
  prefs.end();
}

void save_config_defaults()
{
  prefs.begin("ciren", false);
  if (!prefs.isKey("mqtt_host"))
  {
    prefs.putString("mqtt_host", "192.168.103.241");
    prefs.putString("conn_mode", "wifi");
    prefs.putBool("sim_en", true);
  }
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

  btn_oled_init();

  // Force update mqtt_host — hapus 5 baris ini setelah upload pertama
  prefs.begin("ciren", false);
  prefs.putString("mqtt_host", "192.168.103.241");
  prefs.end();

  save_config_defaults();
  load_config();

  strncpy(sys_state.conn_mode, cfg.conn_mode, sizeof(sys_state.conn_mode));
  sys_state.sim_enabled = cfg.sim_enabled;

  Serial.printf("CIREN Main Module %s\n", FW_VERSION);
  Serial.printf("Device   : %s\n", DEVICE_ID);
  Serial.printf("WiFi SSID: %s\n", cfg.wifi_ssid);
  Serial.printf("MQTT Host: %s\n", cfg.mqtt_host);

  // Initialize SIM-related tasks
  sim_manager_init();
  mqtt_sim_init();

  // WiFi harus STA mode sebelum esp_now_init
  WiFi.mode(WIFI_STA);
  WiFi.disconnect();

  if (esp_now_init() != ESP_OK)
  {
    Serial.println("[FATAL] esp_now_init failed");
    while (1)
      delay(1000);
  }
  esp_now_register_recv_cb(espnow_recv_cb);
  Serial.println("[ESP-NOW] Init OK");

  if (strlen(cfg.wifi_ssid) == 0)
  {
    // No WiFi credentials — auto-start portal; SIM becomes primary connection
    Serial.println("[SETUP] No WiFi credentials — auto-starting portal, SIM as primary");
    portal_start(&prefs);
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

  Serial.println("All tasks started.");
}

void loop()
{
  vTaskDelay(portMAX_DELAY);
}
