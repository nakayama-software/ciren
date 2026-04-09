# CIREN — Project Context & Progress
> Baca file ini saat memulai session baru. Berisi semua keputusan teknis, progress, dan konteks sistem.
> Last updated: 2026-04-09

---

## Apa itu CIREN

Sistem IoT monitoring plug-and-play dan customizable. Terdiri dari:

- **Main Module**: ESP32 + GPS + SIM card (TinyGSM). Terima data dari sensor controller via ESP-NOW, kirim ke server via WiFi atau SIM (MQTT).
- **Sensor Controller**: ESP32 + 1–8 sensor node. Kumpulkan data dari sensor node via UART serial, kirim ke main module via ESP-NOW.
- **Sensor Node**: Seeeduino XIAO + 1 sensor. Monitor dan kirim data ke sensor controller via UART serial (binary frame protocol).
- **Backend**: Node.js + MongoDB + MQTT subscriber + WebSocket broadcast.
- **Frontend**: React + Tailwind CSS + Chart.js. Dashboard realtime dengan auth JWT.

---

## Struktur Folder

```
ciren/
├── NEW IOT System/
│   ├── new_main_module/main_module_014424/   ← firmware main module (ESP32)
│   └── sensor_controller/                    ← firmware sensor controller (ESP32)
├── new dashboard-frontend/                   ← React frontend
├── new_Server/                               ← Node.js backend
└── CLAUDE.md
```

---

## Arsitektur Teknis

### Binary Frame Protocol (sensor node → sensor controller)
```
[0xAA][LENGTH][FTYPE][PAYLOAD...][CRC8][0x55]
```
Frame types:
- `0x01` FTYPE_DATA — data sensor tanpa type
- `0x02` FTYPE_HELLO — node announce diri
- `0x03` FTYPE_HEARTBEAT
- `0x04` FTYPE_DATA_TYPED — data dengan sensor_type field
- `0x05` FTYPE_HB_TYPED
- `0xFE` FTYPE_STALE — data lama
- `0xFF` FTYPE_ERROR

### Sensor Types
- `0x01` Temperature, `0x02` Humidity, `0x03-0x08` IMU (accel/gyro xyz)
- `0x09` Ultrasonic, `0x0A` DS18B20, `0x0B` Voltage, `0x0C` Current
- `0x0D` Light, `0x0E` Pressure, `0x0F` Infrared, `0x10-0x12` Euler (pitch/roll/yaw)
- `0x13` Rotary

### Sensor Controller — Pin Mapping (ESP32)
```cpp
// Hardware UART
RX_P1 = 16, RX_P2 = 17
// SoftwareSerial
RX_P3 = 26, RX_P4 = 32,  // RX_P4 dulu 14 → difix ke 32 (konflik BUTTON_INC)
RX_P5 = 18, RX_P6 = 19,
RX_P7 = 22, RX_P8 = 23
PORT_ACTIVE = 8  // semua port aktif untuk plug and play
```

### Main Module — GPIO (ESP32)
```cpp
TFT_CS=5, TFT_DC=2, TFT_RST=4, TFT_MOSI=23, TFT_CLK=18
BUTTON_DEC=33, BUTTON_INC=14, BUTTON_SEL=27
SIM_RX=16, SIM_TX=17
GPS_RX=34, GPS_TX=12 (GPS read-only, no TX needed)
```

### Device ID Strategy
- Auto-generate dari MAC address: `MM-XXYYZZ` (3 byte terakhir MAC)
- Disimpan di NVS (Preferences) saat pertama boot
- Bisa di-override user via portal web
- Prefix `"MM"` dari `DEVICE_ID_PREFIX` di `ciren_config_014424.h`

### MQTT Topics (dynamic, built at runtime)
```cpp
ciren/data/{device_id}
ciren/status/{device_id}
ciren/hello/{device_id}
ciren/config/{device_id}
ciren/server/heartbeat  // satu-satunya yang static
```

### Koneksi Mode
1. **WiFi** — esp-mqtt library
2. **SIM** — TinyGSM + raw MQTT manual over TCP
- APN bisa dikonfigurasi via web portal (thread-safe dengan mutex)

### Web Portal (AP Mode)
- Aktif saat tekan tombol SEL di main module
- SSID: `CIREN-{device_id}`
- Password: `ci-{4 byte MAC}` (dynamic)
- IP: `192.168.4.1`
- Form: WiFi SSID/pass, MQTT host/port, Device ID, APN/user/pass

---

## Backend (new_Server/)

### Stack
- Node.js + Express + Mongoose (MongoDB) + MQTT.js + ws (WebSocket)

### Endpoints
```
POST /api/auth/login
POST /api/auth/register
GET  /api/stats              ← public, no auth (untuk login page)
GET  /api/user/devices
POST /api/user/devices
DELETE /api/user/devices/:id
GET  /api/devices
GET  /api/devices/:id
GET  /api/devices/:id/data/latest
GET  /api/devices/:id/data/history?ctrl_id=&port_num=&hours=&sensor_type=
```

### WebSocket
- Port 3001
- Auth via query string: `ws://host:3001?token=JWT`
- Ping/keepalive setiap 30 detik
- Broadcast: `sensor_data`, `device_status`, `node_status`

### MongoDB
- TTL index 30 hari di SensorReading
- Compound index: `{ device_id, ctrl_id, port_num, sensor_type, server_ts }`
- Rate limiting: 50 msg/s per device di MQTT handler

### File penting
```
src/index.js          ← entry point, route setup
src/mqtt/handler.js   ← MQTT subscriber + rate limiting
src/websocket/ws.js   ← WebSocket server + JWT auth
src/api/stats.js      ← public stats endpoint
src/api/auth.js       ← login/register
src/api/routes.js     ← device/data endpoints
src/api/userRoutes.js ← user device management
src/models/Device.js
src/models/SensorReading.js
src/middleware/auth.js
```

---

## Frontend (new dashboard-frontend/)

### Stack
- React + Vite + Tailwind CSS + Chart.js + Leaflet (peta)
- Dark/light mode, JP/EN i18n

### Halaman
- `LoginPage.jsx` — login + stats card (activeDevices, dataPoints, uptime) fetch dari `/api/stats`
- `RegisterPage.jsx`
- `DeviceManagementPage.jsx` — tambah/hapus device dari akun
- `App.jsx` — dashboard utama + routing

### Komponen penting
```
components/
  ControllerDetailView.jsx  ← tampilan detail per controller + threshold alerts
  SensorNodeCard.jsx        ← routing ke card spesifik per sensor type
  DeviceStatusCard.jsx      ← status main module
  LeafletMap.jsx            ← peta GPS
  MultiSensorView.jsx       ← modal multi-sensor feed
  ThresholdModal.jsx        ← set min/max threshold per sensor (NEW)
  charts/
    LineChartModal.jsx      ← history chart dengan range picker 1h/6h/24h/7d (NEW)
    IMU3DModal.jsx
    RotaryChartModal.jsx
  sensors/
    HumTempCard.jsx, TemperatureCard.jsx, VoltageCard.jsx, ...

utils/
  sensors.js      ← getSensorInfo, getReadingKey, isIMUSensor, dll
  thresholds.js   ← get/set/clear threshold di localStorage (NEW)
  useIsDark.js    ← hook dark mode detection
  translation.js  ← i18n strings

lib/
  api.js          ← semua API calls + auth helpers
```

### Fitur yang sudah ada
- Realtime via WebSocket (reconnect otomatis)
- Loading skeleton saat fetch awal
- History range picker: 1h / 6h / 24h / 7d
- Threshold alert per sensor (localStorage, ring merah + badge saat out of range)
- Export data
- Reset port data
- Alias/label per controller
- IMU 3D view

### Design decisions
- Warna aksen: **emerald** (bukan cyan)
- Tidak ada backdrop-blur / glassmorphism — solid card backgrounds
- Focus ring: emerald-500
- Tidak ada orb/gradient background blur

---

## Keputusan Teknis Penting

| Keputusan | Pilihan | Alasan |
|-----------|---------|--------|
| Device ID | MAC-based auto-generate | Unique per unit, tidak perlu config manual |
| Koneksi sensor node → controller | UART serial (wired) | Reliable, simpel |
| Koneksi controller → main module | ESP-NOW (wireless) | No pairing, broadcast-friendly |
| Koneksi main module → server | WiFi/SIM MQTT | Dual mode untuk flexibility lapangan |
| Topologi RS485 (jika dipakai) | Star/point-to-point | Match arsitektur current, plug and play natural |
| Terminasi RS485 | Hardwire di PCB | Point-to-point, user tidak perlu config |
| Auth | JWT Bearer token | Stateless, mudah di WebSocket juga |
| Data storage | MongoDB TTL 30 hari | Auto-cleanup, tidak perlu cron job |

---

## RS485 Discussion (untuk upgrade jarak jauh)

Jika ingin extend jarak kabel sensor node > 5 meter:
- Tambah chip **MAX485** di setiap sensor node (DE=VCC, RE=VCC — simplex TX only)
- Tambah chip **MAX485** di setiap port sensor controller (DE=GND, RE=GND — simplex RX only)
- Kabel: twisted pair 3-wire (A, B, GND)
- Terminasi 120Ω hardwire di PCB kedua sisi
- **Tidak perlu ubah firmware** — MAX485 transparan ke UART
- Topologi: star (point-to-point per port), bukan multi-drop
- Keunggulan utama: noise immunity (differential signaling), bukan hanya jarak

---

## Status Saat Ini (2026-04-09)

### Selesai
- [x] Firmware main module: device ID, dynamic topics, APN portal, fixes
- [x] Firmware sensor controller: pin fix, PORT_ACTIVE=8
- [x] Backend: JWT WS auth, rate limiting, stats endpoint, compound index
- [x] Frontend: stats cards, skeleton loading, range picker, threshold alerts, visual cleanup
- [x] MongoDB security hardening (saran diberikan untuk VPS Windows)

### Belum dilakukan
- [ ] Flash firmware ke hardware dan test di device nyata
- [ ] MongoDB security di-apply di VPS Windows (bind IP, enable auth, firewall)
- [ ] Deploy frontend/backend ke production server
- [ ] PCB design untuk RS485 (jika dibutuhkan)

---

## Cara Recall di PC Lain

Saat mulai session baru di PC lain, katakan:
> "baca .claude/context.md dan lanjutkan dari sana"

Claude akan membaca file ini dan memiliki konteks penuh tanpa perlu dijelaskan ulang.
