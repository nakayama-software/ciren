# Main Module Firmware

ESP32-based main module firmware. Receives sensor data from Sensor Controllers via ESP-NOW and forwards it to the backend server via WiFi MQTT or LTE cellular.

## Variants

| Directory | MCU | Modem | Display | Status |
|-----------|-----|-------|---------|--------|
| `main_module_014424` | ESP32-S3 | SIM7080G (LTE-M / NB-IoT) | TFT ILI9341 2.4" | **Primary (active development)** |
| `main_module_sim7080g` | ESP32 | SIM7080G | OLED SSD1306 | Maintained |
| `main_module_sim7600x` | ESP32 | SIM7600x (4G LTE) | OLED SSD1306 | Maintained |

The `shared/` directory contains the canonical version of all shared task headers. Per-variant directories may contain variant-specific copies.

## Primary Variant: `main_module_014424`

### Hardware Pinout (ESP32-S3)

| Pin | Function |
|-----|----------|
| GPIO 12 | TFT SCK |
| GPIO 11 | TFT MOSI |
| GPIO 13 | TFT MISO |
| GPIO 10 | TFT CS |
| GPIO 9 | TFT DC |
| GPIO 8 | TFT RST |
| GPIO 4 | Button (active-LOW) |
| GPIO 16 | SIM modem RX |
| GPIO 17 | SIM modem TX |

### FreeRTOS Task Architecture

| Task | Core | Purpose |
|------|------|---------|
| `task_espnow_rx` | 0 | Receive ESP-NOW frames from controllers, peer registration |
| `task_conn_manager` | 0 | WiFi connection, SIM fallback, 5-min WiFi probe |
| `sim_manager_task` | 0 | SIM7080G AT commands (GPRS, signal, SMS) |
| `task_aggregator` | 1 | 10ms dedup window, ring buffer write |
| `task_publish` | 1 | Ring buffer → MQTT publish |
| `task_watchdog` | 0 | HW WDT reset, heap monitoring, stack HWM logging |
| `task_oled` (task_btn_oled) | 0 | TFT display, button handling, WiFi portal |
| `task_node_config` | 1 | Per-node interval config delivery and retry |
| `task_status` | 1 | MQTT HELLO and status publish |
| `mqtt_sim_task` | 1 | SIM7080G MQTT (AT+SMCONN/SMPUB/SMSUB) |

### Connectivity

The device tries WiFi first. If WiFi is unavailable at boot, it falls back to LTE-M via SIM7080G.

In SIM mode, WiFi is probed every 5 minutes. If WiFi comes back, it switches automatically. The ESP-NOW radio channel is fixed at `ESPNOW_FIXED_CHANNEL=1` in SIM mode to prevent the radio from scanning and breaking ESP-NOW.

### Flashing

Use Arduino IDE or PlatformIO with ESP32-S3 board support. Open `main_module_014424.ino`. All `.h` files in the same directory are included automatically.

Required Arduino libraries:
- `TFT_eSPI` (configured for ILI9341)
- `ArduinoJson`
- `esp-mqtt` (IDF component, included via ESP32 Arduino core)
- `Preferences` (built-in)

### Display Pages

| Page | Content |
|------|---------|
| 0 — Gateway | Device ID, conn mode, server status, active controllers |
| 1 — WiFi | SSID, RSSI, IP address |
| 2 — SIM | Signal strength, GPRS status, operator |
| 3 — GPS | Latitude, longitude, altitude, fix status |
| 4 — Settings | Firmware version, uptime, heap |
| 5 — SIM Control | Manual SIM operations |

Hold the button for 5 seconds to reset WiFi credentials and enter portal mode.
