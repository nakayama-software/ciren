# Sensor Controller Firmware

ESP32 firmware for the Sensor Controller layer. Collects CIREN frame data from up to 8 Sensor Nodes via UART and forwards it to the Main Module via ESP-NOW.

## Hardware

- **MCU:** ESP32
- **Sensor node ports:** Up to 8 (one UART port per sensor node via Serial port or software serial)
- **Upstream:** ESP-NOW to Main Module

## Responsibilities

1. Receive CIREN frames from each connected sensor node on its assigned port
2. Apply per-port upload throttle (configurable interval, default 500ms / 200ms for IMU)
3. Detect sensor type (STYPE) from HELLO frames; auto-reset interval on sensor swap
4. Forward data, heartbeat, and error frames to Main Module via ESP-NOW
5. Respond to `FTYPE_CONFIG` frames from Main Module with `FTYPE_CONFIG_ACK`
6. Persist interval config to NVS (`Preferences`) — survives reboot

## ESP-NOW Frame Types (Controller ↔ Main Module)

| Type | Code | Direction | Description |
|------|------|-----------|-------------|
| HELLO | 0x02 | Controller → Main | Controller registration / reboot notification |
| DATA / DATA_TYPED | 0x01 / 0x04 | Controller → Main | Sensor readings |
| HEARTBEAT / HB_TYPED | 0x03 / 0x05 | Controller → Main | Keep-alive |
| ERROR | 0xFF | Controller → Main | Sensor error |
| STALE | 0xFE | Controller → Main | Sensor node offline |
| FTYPE_CONFIG | 0x10 | Main → Controller | Set port interval |
| FTYPE_CONFIG_ACK | 0x11 | Controller → Main | Config applied confirmation |

## Per-Port Throttle

Each port maintains a `last_forward_ms` timestamp. When a new reading arrives, it is buffered. It is only forwarded to the Main Module when `millis() - last_forward_ms >= port_interval_ms`. This limits the upstream bandwidth while keeping the sensor node loop rate unconstrained.

- Default interval: 500ms (standard sensors), 200ms (IMU sensors)
- ERROR frames bypass the throttle and are forwarded immediately
- Interval is overridden by `FTYPE_CONFIG` from Main Module, stored in NVS
- On sensor type change (HELLO with different STYPE), interval resets to type-appropriate default

## Controller ID

Each controller has a unique `ctrl_id` (1–N). This is hardcoded in the firmware config. The controller includes `ctrl_id` in every ESP-NOW packet so the Main Module can route data correctly.

## Flashing

Use Arduino IDE with ESP32 board support. Open `sensor_controller.ino`.
