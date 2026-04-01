#pragma once

#define DEVICE_ID          "MM-001"
#define FW_VERSION         "1.0.0"

// ── TFT SPI 2.4" 320×240 (ILI9341) — ESP32-S3 ──────────────────────────────
// Eksplisit SPI pins (ESP32-S3 tidak punya GPIO22-32, tidak ada pin23 klasik)
// Gunakan SPI2/FSPI dengan pin bebas:
#define PIN_TFT_SCK        12    // SPI Clock
#define PIN_TFT_MOSI       11    // SPI MOSI (Master Out)
#define PIN_TFT_MISO       13    // SPI MISO (-1 jika tidak disambung)
#define PIN_TFT_CS         10    // Chip Select
#define PIN_TFT_DC         9     // Data/Command
#define PIN_TFT_RST        8     // Reset
#define TFT_WIDTH          320
#define TFT_HEIGHT         240
#define TFT_ROTATION       1     // landscape (USB port on left)

// ── Button ──────────────────────────────────────────────────────────────────
// GPIO 0 = BOOT button pada ESP32-S3, active-LOW, internal pullup
#define PIN_BTN            0

#define PIN_MODEM_RX       16
#define PIN_MODEM_TX       17
#define MODEM_BAUD         115200

#define RB_SIZE            128
#define AGG_WINDOW_MS      10

#define WIFI_TIMEOUT_MS    15000
#define WIFI_COOLDOWN_MS   20000
#define RECONNECT_DELAY_1  1000
#define RECONNECT_DELAY_2  2000
#define RECONNECT_DELAY_3  4000

#define MQTT_PORT          1883
#define MQTT_QOS           1     // untuk HELLO/STATUS (penting, harus delivered)
#define SIM_MQTT_QOS       MQTT_QOS
#define MQTT_QOS_DATA      0     // untuk sensor data (high-freq, fire-and-forget)
#define MQTT_KEEPALIVE     60

#define BTN_HOLD_MS        5000
#define BTN_DEBOUNCE_MS    30

#define TFT_REFRESH_MS     200    // display refresh interval
#define OLED_REFRESH_MS    TFT_REFRESH_MS   // compat alias
#define OLED_TOTAL_PAGES   6

#define PAGE_GATEWAY       0
#define PAGE_WIFI          1
#define PAGE_SIM           2
#define PAGE_GPS           3
#define PAGE_SETTINGS      4
#define PAGE_SIM_CTRL      5

#define PORTAL_PASS        "setup1234"
#define PORTAL_PORT        80

#define GPS_POLL_MS        60000
#define GPS_STALE_MS       120000
#define SIM_BOOT_WAIT_MS   8000
#define SIM_RETRY_MS       60000
#define SIM_SIGNAL_INT_MS  15000

#define PRIO_RX            5
#define PRIO_CONN          4
#define PRIO_AGG           3
#define PRIO_PUBLISH       3
#define PRIO_GPS           3
#define PRIO_WATCHDOG      2
#define PRIO_OLED          2
#define PRIO_CONFIG        2
#define PRIO_STATUS        2

// ── Stack sizes ───────────────────────────────────────────────────────────────
// Riwayat crash & fix:
//   Crash 1-2: task_oled overflow saat portal aktif          → 4096→8192
//   Crash 1-2: task_conn_mgr overflow saat wifi_recover      → 4096→5120
//   Crash 1-2: espnow_recv_cb di WiFi task (fixed stack IDF) → pindah ke queue
//   Crash 3:   task_watchdog overflow akibat 7x Serial.printf → 2048→4096
//              + ganti ke 1x printf + stored handles
#define STACK_RX           5120   // was 4096
#define STACK_CONN         5120   // was 4096
#define STACK_AGG          6144
#define STACK_PUBLISH      6144
#define STACK_GPS          3072
#define STACK_WATCHDOG     4096   // was 2048 — HWM monitor butuh ruang printf
#define STACK_OLED         8192   // was 4096 — portal HTML builder
#define STACK_CONFIG       3072
#define STACK_STATUS       4096   // stat HWM was 652/3072 (21%) — naikkan headroom
#define STACK_SIM_MGR      4096
#define STACK_MQTT_SIM     4096

#define STYPE_TEMPERATURE  0x01
#define STYPE_HUMIDITY     0x02
#define STYPE_ACCEL_X      0x03
#define STYPE_ACCEL_Y      0x04
#define STYPE_ACCEL_Z      0x05
#define STYPE_GYRO_X       0x06
#define STYPE_GYRO_Y       0x07
#define STYPE_GYRO_Z       0x08
#define STYPE_DISTANCE     0x09
#define STYPE_TEMP_1WIRE   0x0A
#define STYPE_PITCH        0x10
#define STYPE_ROLL         0x11
#define STYPE_YAW          0x12

#define FTYPE_DATA         0x01
#define FTYPE_HELLO        0x02
#define FTYPE_HEARTBEAT    0x03
#define FTYPE_DATA_TYPED   0x04
#define FTYPE_HB_TYPED     0x05
#define FTYPE_ERROR        0xFF
#define FTYPE_STALE        0xFE

#define TOPIC_DATA         "ciren/data/" DEVICE_ID
#define TOPIC_STATUS       "ciren/status/" DEVICE_ID
#define TOPIC_HELLO        "ciren/hello/" DEVICE_ID
#define TOPIC_CONFIG       "ciren/config/" DEVICE_ID

#define WD_CHECK_MS        30000
#define RB_WARN_THRESHOLD  0.8f