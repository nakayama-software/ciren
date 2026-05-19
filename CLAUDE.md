# CIREN — Claude Context

## Project Overview

CIREN is a **plug-and-play, customizable real-time IoT monitoring system**. It has a 3-layer architecture:

1. **Sensor Node** — Seeeduino XIAO + 1 sensor. Reads sensor data and sends CIREN frames over Serial1 to the Sensor Controller.
2. **Sensor Controller** — ESP32 + up to 8 Sensor Nodes. Aggregates node data and forwards it to the Main Module over ESP-NOW.
3. **Main Module** — ESP32-S3 + Raspberry Pi + GPS + SIM modem. Receives ESP-NOW data from controllers, aggregates into MQTT, publishes to the backend server.

The backend (Node.js + MongoDB + MQTT broker) stores readings and serves the dashboard. The dashboard (React + Vite + Tailwind) is the user-facing control panel.

---

## Repository Layout

```
ciren/
├── IOT System/
│   ├── shared/                          # Shared .h files (ring buffer, frame protocol, tasks)
│   ├── new_main_module/
│   │   ├── main_module_014424/          # PRIMARY firmware — ESP32-S3 + SIM7080G (CatM) + TFT
│   │   ├── main_module_sim7080g/        # Variant — ESP32 + SIM7080G
│   │   └── main_module_sim7600x/        # Variant — ESP32 + SIM7600x (4G LTE)
│   ├── sensor_controller/               # ESP32 firmware — collects from up to 8 sensor nodes
│   ├── sensor_node/
│   │   ├── node_dht20/                  # Seeeduino XIAO + DHT20 (temp + humidity)
│   │   └── node_mpu6050/               # Seeeduino XIAO + MPU6050 (accel + gyro + euler)
│   ├── IOT System - V1/                 # Legacy V1 code (archived)
│   └── development/                     # Experimental / RS485 variants
├── backend/                             # Node.js + Express + MongoDB + MQTT
├── frontend/                            # React + Vite + Tailwind dashboard
├── deploy/                              # Deployment scripts
└── CLAUDE.md
```

---

## Hardware Components

### Main Module (primary: `main_module_014424`)
| Component | Model | Purpose |
|-----------|-------|---------|
| MCU | ESP32-S3 | Main controller, ESP-NOW receiver, WiFi/MQTT |
| Display | TFT ILI9341 2.4" 320×240 | Status display (6 pages) |
| SIM Modem | SIM7080G (M5STAMP CatM) | LTE-M fallback connectivity |
| GPS | via Raspberry Pi | Location data |
| Host | Raspberry Pi | Runs backend server + MQTT broker |

### Sensor Controller
| Component | Model | Purpose |
|-----------|-------|---------|
| MCU | ESP32 | Aggregates up to 8 sensor nodes via Serial |
| Communication | ESP-NOW | Sends data to Main Module |

### Sensor Nodes
| Node | Sensor | STYPE values |
|------|--------|-------------|
| `node_dht20` | DHT20 (I2C) | STYPE_TEMPERATURE (0x01), STYPE_HUMIDITY (0x02) |
| `node_mpu6050` | MPU6050 (I2C) | STYPE_ACCEL_X/Y/Z (0x03–0x05), STYPE_GYRO_X/Y/Z (0x06–0x08), STYPE_PITCH/ROLL/YAW (0x10–0x12) |

---

## Communication Stack

```
Sensor Node  ──Serial1 (UART)──►  Sensor Controller  ──ESP-NOW──►  Main Module ESP32-S3
                                                                           │
                                                                    WiFi (primary)
                                                                    LTE-M/4G (fallback)
                                                                           │
                                                                    MQTT Broker (Mosquitto)
                                                                           │
                                                                    Backend (Node.js)
                                                                           │
                                                                    WebSocket ──► Dashboard
```

---

## CIREN Frame Protocol

All sensor node → controller communication uses the CIREN Frame Protocol (defined in `shared/ciren_frame.h`).

**Standard frame (12 bytes):**
```
[0]    0xAA      start byte
[1]    ftype     frame type
[2-5]  value     float32 LE
[6-9]  ts        uint32 millis() LE
[10]   crc8      CRC8 of [1..9]
[11]   0x55      end byte
```

**Typed frame (13 bytes)** — for multi-value sensors:
```
[0]    0xAA
[1]    ftype     FTYPE_DATA_TYPED or FTYPE_HB_TYPED
[2]    stype     sensor type ID
[3-6]  value     float32 LE
[7-10] ts        uint32 LE
[11]   crc8      CRC8 of [1..10]
[12]   0x55
```

**Frame types:** DATA (0x01), HELLO (0x02), HEARTBEAT (0x03), DATA_TYPED (0x04), HB_TYPED (0x05), ERROR (0xFF), STALE (0xFE)

---

## Firmware Architecture (`main_module_014424`)

The firmware uses FreeRTOS with multiple tasks pinned to specific cores:

| Task | Core | Priority | Stack | Purpose |
|------|------|----------|-------|---------|
| `task_espnow_rx` | 0 | 5 | 5120 | Receive ESP-NOW frames from controllers |
| `task_conn_manager` | 0 | 4 | 5120 | WiFi connect, SIM fallback, 5-min probe |
| `sim_manager_task` | 0 | 4 | 4096 | SIM7080G AT command management |
| `task_aggregator` | 1 | 3 | 6144 | 10ms window dedup, ring buffer write |
| `task_publish` | 1 | 3 | 6144 | Ring buffer → MQTT publish |
| `task_watchdog` | 0 | 2 | 4096 | HW WDT reset, heap + HWM monitoring |
| `task_oled` | 0 | 2 | 8192 | TFT display + WiFi portal |
| `task_node_config` | 1 | 2 | 3072 | Per-node interval config delivery |
| `task_status` | 1 | 2 | 4096 | MQTT status/HELLO publish |
| `mqtt_sim_task` | 1 | 4 | 4096 | SIM7080G MQTT (AT+SMCONN/SMPUB/SMSUB) |

**Hardware Watchdog:** 180s timeout (`HW_WDT_TIMEOUT_S`). Registered tasks: `task_watchdog`, `task_conn_manager`, `mqtt_sim_task`. Heap auto-restart at < 20KB (`HEAP_RESTART_THRESHOLD`).

**ESP-NOW fixed channel:** Channel 1 (`ESPNOW_FIXED_CHANNEL`) — used in SIM mode to avoid ESP-NOW breaking when WiFi radio scans. Re-pinned after every WiFi probe failure.

**Connectivity modes:**
- `wifi` mode: WiFi connected, MQTT over WiFi (via `esp-mqtt` IDF component)
- `sim` mode: WiFi unavailable, MQTT over SIM7080G AT commands (AT+SMCONF/SMCONN/SMPUB/SMSUB)

---

## MQTT Topic Structure

All topics are device-specific, built at runtime from `sys_state.device_id`:
- `ciren/{device_id}/data` — sensor readings (QoS 0)
- `ciren/{device_id}/hello` — device online announcement
- `ciren/{device_id}/status` — periodic system status
- `ciren/{device_id}/config` — inbound config from server (node intervals)
- `ciren/server/heartbeat` — server liveness (shared, not device-specific)

---

## Per-Node Upload Interval System

Users can configure a per-port upload rate (default 500ms, 200ms for IMU) from the dashboard.

**Flow:**
```
Dashboard NodeIntervalModal
  → POST /api/devices/:id/node-config {ctrl_id, port_num, interval_ms}
  → Server: NodeConfig.findOneAndUpdate() + MQTT publish to topic_config
  → Main Module: nc_set() → NVS Preferences + ESP-NOW FTYPE_CONFIG broadcast
  → Sensor Controller: apply interval, save to NVS, send FTYPE_CONFIG_ACK
  → Main Module: nc_on_ack() → mark delivered
```

Resync on reboot: `resendNodeConfigs(deviceId)` called on device HELLO (debounced 10s).

---

## Backend

**Stack:** Node.js + Express + MongoDB (Mongoose) + Mosquitto MQTT + WebSocket (`ws`)

**Key files:**
- `backend/src/index.js` — entry point, MQTT client init, Express setup
- `backend/src/api/routes.js` — REST endpoints (devices, readings, node-config, verify)
- `backend/src/mqtt/handler.js` — MQTT message handler (device HELLO, sensor data, heartbeat)
- `backend/src/websocket/ws.js` — WebSocket broadcast to dashboard clients
- `backend/src/models/` — Mongoose models: Device, SensorReading, NodeConfig, User

**Models:**
- `Device` — device_id, conn_mode, last_seen, location, sim_enabled
- `SensorReading` — device_id, ctrl_id, port_num, stype, value, timestamp
- `NodeConfig` — device_id, ctrl_id, port_num, interval_ms
- `User` — username, password (bcrypt), role

**Running:**
```bash
cd backend && npm run dev   # dev with nodemon
cd backend && npm start     # production
```

---

## Frontend (Dashboard)

**Stack:** React 19 + Vite + Tailwind CSS 4 + Chart.js + Recharts + Three.js + Leaflet

**Key components:**
- `DevicePanel.jsx` — device list, online status
- `ControllerDetailView.jsx` — per-controller sensor layout, interval badge
- `SensorNodeCard.jsx` — individual sensor display
- `NodeIntervalModal.jsx` — set per-port upload interval, delivery status
- `ThresholdModal.jsx` — alert threshold configuration
- `HistoryModal.jsx` — historical chart with export
- `ExportModal.jsx` — CSV/JSON export
- `LeafletMap.jsx` — GPS location map
- `LabelManager.jsx` — custom port labels

**Running:**
```bash
cd frontend && npm run dev    # dev server (Vite)
cd frontend && npm run build  # production build → frontend/dist/
```

---

## Deployment

Local deployment uses a Caddyfile reverse proxy + Cloudflare Tunnel for HTTPS.
- `deploy/run-local.sh` — start backend + frontend + Caddy
- `deploy/deploy.sh` — VPS deploy script
- `.cloudflared/` — Cloudflare Tunnel config

---

## Key Constraints & Gotchas

1. **ESP-NOW + WiFi channel conflict** — when WiFi is not associated (SIM mode), channel defaults to 0. Must call `esp_wifi_set_channel(ESPNOW_FIXED_CHANNEL, WIFI_SECOND_CHAN_NONE)` to keep ESP-NOW working. Re-pin after every WiFi probe failure.

2. **SIM7080G URC format** — `+SMSUB:` sends topic + JSON payload on the SAME line (not separate lines as documented). Parser uses `{`/`}` delimiters to extract payload from the header line.

3. **ESP-NOW peer registration** — must register/update peer on ALL incoming packet types, not just HELLO. After a main module reboot, controllers may only send data frames and never re-HELLO, leaving no registered peers.

4. **Static buffers in MQTT hot path** — `_smq_drain()` and `_smq_pub()` use `static char[]` buffers to avoid heap fragmentation (called every 100ms).

5. **Sensor port hotswap** — sensors on ports can change at runtime. Sensor controller detects stype change and resets the interval to the type-appropriate default.

6. **task_node_config and sim_manager_task are NOT registered with the hardware watchdog** — they can hang undetected. The other 3 registered tasks will keep resetting the WDT.
