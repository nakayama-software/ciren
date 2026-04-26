# CIREN Backend

Node.js + Express REST API and MQTT bridge for the CIREN IoT monitoring system.

## Stack

- **Runtime:** Node.js
- **Framework:** Express
- **Database:** MongoDB via Mongoose
- **MQTT Broker:** Mosquitto (external process)
- **MQTT Client:** `mqtt` npm package
- **WebSocket:** `ws` npm package (real-time push to dashboard)
- **Auth:** JWT (`jsonwebtoken`) + bcrypt (`bcryptjs`)

## Source Layout

```
backend/src/
├── index.js           # Entry point — Express setup, MQTT client init, WS server
├── api/
│   ├── routes.js      # Main REST routes (devices, readings, node-config, verify)
│   ├── auth.js        # Auth routes (login, register)
│   ├── stats.js       # Aggregate stats endpoint
│   └── userRoutes.js  # User management routes
├── models/
│   ├── Device.js      # Device registry (device_id, conn_mode, location, sim_enabled)
│   ├── SensorReading.js # Time-series sensor readings
│   ├── NodeConfig.js  # Per-port upload interval config
│   └── User.js        # User accounts
├── mqtt/
│   └── handler.js     # MQTT message router (device HELLO, sensor data, heartbeat, node config ACK)
├── websocket/
│   └── ws.js          # WebSocket broadcast — pushes updates to connected dashboard clients
├── middleware/        # Auth middleware (JWT verification)
└── utils/            # Shared utilities
```

## Key REST Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/login` | Authenticate user, returns JWT |
| GET | `/api/devices` | List all registered devices |
| GET | `/api/devices/:id` | Device detail + latest readings per port |
| GET | `/api/devices/:id/data/history` | Historical readings (queryable by time range, stype) |
| GET | `/api/devices/:id/node-config` | Get per-port interval configs |
| POST | `/api/devices/:id/node-config` | Set upload interval for a port |
| GET | `/api/devices/:id/node-config/verify` | Compare configured interval vs observed upload rate |

## MQTT Topics (consumed by backend)

| Topic | Direction | Content |
|-------|-----------|---------|
| `ciren/{device_id}/hello` | Device → Server | Device online, triggers config resync |
| `ciren/{device_id}/data` | Device → Server | Sensor readings (JSON array) |
| `ciren/{device_id}/status` | Device → Server | System status (heap, uptime, RSSI, etc.) |
| `ciren/server/heartbeat` | Server → Device | Server liveness (published every 30s) |
| `ciren/{device_id}/config` | Server → Device | Node interval config commands |

## Running

```bash
npm install
cp .env.example .env    # set MONGODB_URI, MQTT_HOST, JWT_SECRET, PORT
npm run dev             # development — nodemon auto-reload
npm start               # production
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `MONGODB_URI` | MongoDB connection string |
| `MQTT_HOST` | Mosquitto broker host (default: `localhost`) |
| `MQTT_PORT` | Mosquitto broker port (default: `1883`) |
| `JWT_SECRET` | Secret key for JWT signing |
| `PORT` | HTTP server port (default: `3000`) |
