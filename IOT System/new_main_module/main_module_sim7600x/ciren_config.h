#pragma once

#define DEVICE_ID_PREFIX   "MM"     // prefix untuk auto-generated device ID
#define FW_VERSION         "1.0.0-sim7600x"

// ── TFT SPI 2.4" 320×240 (ILI9341) — ESP32-S3 ──────────────────────────────
#define PIN_TFT_SCK        12    // SPI Clock
#define PIN_TFT_MOSI       11    // SPI MOSI (Master Out)
#define PIN_TFT_MISO       13    // SPI MISO (-1 jika tidak disambung)
#define PIN_TFT_CS         10    // Chip Select
#define PIN_TFT_DC          9    // Data/Command
#define PIN_TFT_RST         8    // Reset
#define TFT_WIDTH          320
#define TFT_HEIGHT         240
#define TFT_ROTATION       1     // landscape (USB port on left)

// ── Button ──────────────────────────────────────────────────────────────────
#define PIN_BTN            4

// ── SIM7600X (Waveshare) ────────────────────────────────────────────────────
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
#define MQTT_KEEPALIVE     30     // reduced from 60 for faster disconnect detection

#define BTN_HOLD_MS        5000
#define BTN_DEBOUNCE_MS    30

#define TFT_REFRESH_MS     200    // display refresh interval
#define OLED_REFRESH_MS    TFT_REFRESH_MS   // compat alias
#define OLED_TOTAL_PAGES   6

#define PAGE_GATEWAY       0
#define PAGE_WIFI          1
#define PAGE_SIM           2
#define PAGE_GPS           3
#define PAGE_SETTINGS       4
#define PAGE_SIM_CTRL      5

#define PORTAL_PASS        "setup1234"
#define PORTAL_PORT         80

#define GPS_POLL_MS        5000
#define GPS_STALE_MS       120000
#define SIM_BOOT_WAIT_MS   8000
#define SIM_RETRY_MS        60000
#define SIM_SIGNAL_INT_MS  30000

#define PRIO_RX            5
#define PRIO_CONN          4
#define PRIO_AGG           3
#define PRIO_PUBLISH       3
#define PRIO_GPS           2
#define PRIO_WATCHDOG      2
#define PRIO_OLED          2
#define PRIO_CONFIG        2
#define PRIO_STATUS        2

// ── Stack sizes ───────────────────────────────────────────────────────────────
#define STACK_RX           5120
#define STACK_CONN         5120
#define STACK_AGG          6144
#define STACK_PUBLISH      6144
#define STACK_GPS          3072
#define STACK_WATCHDOG     4096
#define STACK_OLED         8192
#define STACK_CONFIG       3072
#define STACK_STATUS       4096
#define STACK_SIM_MGR      4096
#define STACK_MQTT_SIM     6144

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

#define TOPIC_SERVER_HB    "ciren/server/heartbeat"

#define SERVER_HB_TIMEOUT_MS  60000

#define WD_CHECK_MS        30000
#define RB_WARN_THRESHOLD  0.8f

#define CTRL_TIMEOUT_MS    15000
#define MAX_CTRL_IDS       16

// ── Node interval config ──────────────────────────────────────────────────────
#define FTYPE_CONFIG        0x10
#define FTYPE_CONFIG_ACK    0x11
#define MAX_NODE_CONFIGS    72
#define NODE_CONFIG_ACK_MS  600
#define NODE_CONFIG_RETRIES 3

// ── ESP-NOW fixed channel ────────────────────────────────────────────────────
#define ESPNOW_FIXED_CHANNEL  1

// ── SIM7600X (Waveshare LTE) ─────────────────────────────────────────────────
// LTE bands for Japan (NTT Docomo / SoftBank / KDDI)
#define SIM_LTE_BANDS        "1,3,8,18,19,26,28"

// ── SIM7600X AT+CMQTT* client index ──────────────────────────────────────────
#define SIM_MQTT_CLIENT_IDX  0