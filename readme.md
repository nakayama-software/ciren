# CIREN — Real-Time IoT Monitoring System

CIREN is a **plug-and-play, customizable real-time IoT monitoring system** with a 3-layer hardware architecture. It is designed for flexible sensor configurations and rapid deployment across diverse monitoring applications.

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Dashboard (React)  ◄──── WebSocket ────  Backend (Node.js + MongoDB)   │
│                                                │                         │
│                                           MQTT Broker                    │
│                                          (Mosquitto)                     │
│                                                │                         │
│                               ┌───── WiFi / LTE-M / 4G ─────┐           │
│                               │                              │           │
│                        Main Module                     Main Module       │
│                     (ESP32-S3 + SIM7080G)          (ESP32 + SIM7600x)    │
│                               │                              │           │
│                           ESP-NOW                        ESP-NOW         │
│                               │                              │           │
│               ┌───────────────┼───────────────┐             │           │
│        Sensor Ctrl 1   Sensor Ctrl 2   Sensor Ctrl N  ...               │
│         (ESP32)         (ESP32)         (ESP32)                          │
│            │               │               │                             │
│       ┌────┴────┐     ┌────┴────┐     ┌────┴────┐                       │
│    Node Node Node   Node Node Node   Node Node Node  (up to 8 per ctrl) │
│   (XIAO)(XIAO)(XIAO)                                                     │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Hardware Layers

### 1. Sensor Node
- **Hardware:** Seeeduino XIAO + 1 sensor
- **Communication:** Serial1 (UART) → Sensor Controller
- **Protocol:** CIREN Frame Protocol (12–13 byte framed messages with CRC8)
- **Supported sensors:**
  | Node | Sensor | Measurements |
  |------|--------|-------------|
  | `node_dht20` | DHT20 (I2C) | Temperature (°C), Humidity (%RH) |
  | `node_mpu6050` | MPU6050 (I2C) | Accel XYZ (m/s²), Gyro XYZ (rad/s), Pitch/Roll/Yaw (°) |

### 2. Sensor Controller
- **Hardware:** ESP32
- **Communication:** Serial (from up to 8 sensor nodes), ESP-NOW (to Main Module)
- **Capacity:** Up to 8 sensor node ports
- **Features:** Per-port upload throttle (configurable interval, persisted in NVS), sensor type change detection, HELLO handshake with Main Module

### 3. Main Module
- **Primary hardware (`main_module_014424`):** ESP32-S3 + SIM7080G (LTE-M) + TFT ILI9341 display + GPS via Raspberry Pi
- **Communication:** ESP-NOW (from controllers), WiFi or LTE-M MQTT (to server)
- **Fallback:** Automatically switches WiFi ↔ LTE-M based on availability
- **Display:** 6-page TFT status screen (Gateway, WiFi, SIM, GPS, Settings, SIM Control)
- **Portal:** WiFi setup portal on first boot (AP mode)

---

## Repository Structure

```
ciren/
├── IOT System/
│   ├── shared/                   # Common headers: frame protocol, ring buffer, FreeRTOS tasks
│   ├── new_main_module/
│   │   ├── main_module_014424/   # PRIMARY — ESP32-S3 + SIM7080G + TFT
│   │   ├── main_module_sim7080g/ # Variant — ESP32 + SIM7080G
│   │   └── main_module_sim7600x/ # Variant — ESP32 + SIM7600x (4G LTE)
│   ├── sensor_controller/        # ESP32 sensor controller firmware
│   ├── sensor_node/              # Sensor node firmware (node_dht20, node_mpu6050)
│   ├── IOT System - V1/          # Legacy V1 firmware (archived)
│   └── development/              # Experimental code (RS485 variant, SIM testing)
├── backend/                      # Node.js + Express + MongoDB + MQTT backend
├── frontend/                     # React + Vite + Tailwind dashboard
├── deploy/                       # Deployment scripts (local + VPS)
└── CLAUDE.md                     # AI assistant context
```

---

## CIREN Frame Protocol

Serial communication between sensor nodes and controllers uses a compact framed protocol with CRC8 error checking.

**Standard frame — 12 bytes** (single-value sensors):
```
Byte  0     : 0xAA  (start)
Byte  1     : ftype (frame type)
Bytes 2–5   : value (float32, little-endian)
Bytes 6–9   : ts    (uint32 millis(), little-endian)
Byte  10    : crc8  (CRC8 of bytes 1–9)
Byte  11    : 0x55  (end)
```

**Typed frame — 13 bytes** (multi-value sensors like IMU):
```
Byte  0     : 0xAA
Byte  1     : ftype (FTYPE_DATA_TYPED or FTYPE_HB_TYPED)
Byte  2     : stype (sensor type ID)
Bytes 3–6   : value (float32, little-endian)
Bytes 7–10  : ts    (uint32, little-endian)
Byte  11    : crc8  (CRC8 of bytes 1–10)
Byte  12    : 0x55
```

**Frame types:**
| Code | Name | Description |
|------|------|-------------|
| 0x01 | DATA | Single-value sensor reading |
| 0x02 | HELLO | Node registration (value = stype) |
| 0x03 | HEARTBEAT | Keep-alive with last value |
| 0x04 | DATA_TYPED | Multi-value reading with stype |
| 0x05 | HB_TYPED | Multi-value keep-alive |
| 0xFF | ERROR | Sensor error (value = error code) |
| 0xFE | STALE | Node offline (sent by controller) |

**Sensor type IDs:**
| Code | Name | Unit | Sensor |
|------|------|------|--------|
| 0x01 | STYPE_TEMPERATURE | °C | DHT20 |
| 0x02 | STYPE_HUMIDITY | %RH | DHT20 |
| 0x03–0x05 | STYPE_ACCEL_X/Y/Z | m/s² | MPU6050 |
| 0x06–0x08 | STYPE_GYRO_X/Y/Z | rad/s | MPU6050 |
| 0x09 | STYPE_DISTANCE | cm | HC-SR04 |
| 0x0A | STYPE_TEMP_1WIRE | °C | DS18B20 |
| 0x10–0x12 | STYPE_PITCH/ROLL/YAW | ° | MPU6050 |

---

## Backend

**Stack:** Node.js + Express + MongoDB (Mongoose) + Mosquitto MQTT + WebSocket (`ws`)

**REST API (key endpoints):**
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/devices` | List all devices |
| GET | `/api/devices/:id` | Device details + latest readings |
| GET | `/api/devices/:id/data/history` | Historical sensor readings |
| GET | `/api/devices/:id/node-config` | Per-node interval configs |
| POST | `/api/devices/:id/node-config` | Set per-node upload interval |
| GET | `/api/devices/:id/node-config/verify` | Compare configured vs observed interval |
| POST | `/api/auth/login` | JWT authentication |

**Data models:**
- `Device` — device_id, conn_mode, last_seen, location, sim_enabled
- `SensorReading` — device_id, ctrl_id, port_num, stype, value, timestamp
- `NodeConfig` — device_id, ctrl_id, port_num, interval_ms
- `User` — username, hashed password, role

**Running:**
```bash
cd backend
npm install
cp .env.example .env   # configure MONGODB_URI, MQTT_HOST, JWT_SECRET
npm run dev            # development (nodemon)
npm start              # production
```

---

## Frontend (Dashboard)

**Stack:** React 19 + Vite + Tailwind CSS 4 + Chart.js + Recharts + Three.js + Leaflet

**Key features:**
- Real-time sensor data via WebSocket
- Per-controller and per-port sensor view
- Historical data charts with configurable time range
- CSV / JSON data export
- Per-port upload interval configuration with delivery status feedback
- Alert threshold configuration
- GPS location map (Leaflet)
- Custom port label management
- English / Japanese UI language toggle

**Running:**
```bash
cd frontend
npm install
npm run dev       # dev server at http://localhost:5173
npm run build     # production build → frontend/dist/
```

---

## Local Deployment

```bash
# Start backend
cd backend && npm start

# Start frontend dev server (or serve dist/ with Caddy)
cd frontend && npm run dev

# Or use deploy scripts
./deploy/run-local.sh
```

A `Caddyfile` is provided for reverse-proxy + HTTPS. Cloudflare Tunnel config is in `.cloudflared/` for public HTTPS without port forwarding.

---

## Per-Node Upload Interval

Each sensor port can have an independent upload rate, configurable from the dashboard.

**Default intervals:**
- Standard sensors (temperature, humidity, distance): 500ms
- IMU sensors (MPU6050, pitch/roll/yaw): 200ms

**Configuration flow:**
1. Dashboard → `POST /api/devices/:id/node-config`
2. Server stores in MongoDB and publishes to `ciren/{device_id}/config` via MQTT
3. Main Module receives config, stores in NVS, sends `FTYPE_CONFIG` frame via ESP-NOW to target controller
4. Sensor Controller stores interval in NVS, sends `FTYPE_CONFIG_ACK`
5. Dashboard shows green delivery badge when ACK received

Configs are automatically re-sent to controllers after any device reboot.

---

## Firmware Stability Notes

The main module firmware (`main_module_014424`) includes several hardening measures:

- **Hardware watchdog** (180s timeout) — registered tasks reset it every loop cycle; triggers `esp_restart()` on hang
- **Heap monitoring** — auto-restart if free heap < 20KB
- **Static MQTT buffers** — `_smq_drain()` and `_smq_pub()` use `static char[]` to avoid heap fragmentation from frequent String allocations
- **Stack HWM logging** — watchdog task logs stack high-water marks for all tracked tasks every 30s
- **WiFi probe throttled to 5 minutes** in SIM mode — frequent WiFi.begin() calls were disrupting the fixed ESP-NOW radio channel
- **ESP-NOW peer registration on all packet types** — ensures config frames can be delivered even after a main module reboot where no HELLO was received

---

## Firmware Variants

| Variant | MCU | Modem | Status |
|---------|-----|-------|--------|
| `main_module_014424` | ESP32-S3 | SIM7080G (LTE-M) | **Primary (active development)** |
| `main_module_sim7080g` | ESP32 | SIM7080G | Maintained |
| `main_module_sim7600x` | ESP32 | SIM7600x (4G) | Maintained |

The `shared/` directory contains the canonical versions of all task headers. Per-variant directories contain copies that may have variant-specific adjustments.
