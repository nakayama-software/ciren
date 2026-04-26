# Sensor Node Firmware

Seeeduino XIAO firmware for the sensor node layer. Reads sensor data and sends CIREN frames to the Sensor Controller via Serial1.

## Hardware

- **MCU:** Seeeduino XIAO (SAMD21 / nRF52840 / ESP32-C3 depending on variant)
- **Sensor:** 1 sensor per node (I2C or analog)
- **Upstream:** Serial1 (UART TX) → Sensor Controller RX pin

## Available Nodes

### `node_dht20`
- **Sensor:** DHT20 (I2C, address 0x38)
- **Output:** Temperature (°C) + Humidity (%RH)
- **Frame type:** `FTYPE_DATA_TYPED` with shared timestamp for both values
- **STYPE:** `STYPE_TEMPERATURE` (0x01), `STYPE_HUMIDITY` (0x02)

### `node_mpu6050`
- **Sensor:** MPU6050 (I2C, address 0x68)
- **Output:** Acceleration XYZ (m/s²), Gyro XYZ (rad/s), Pitch/Roll/Yaw (°)
- **Frame type:** `FTYPE_DATA_TYPED` — one frame per axis per cycle
- **STYPE:** `STYPE_ACCEL_X/Y/Z` (0x03–0x05), `STYPE_GYRO_X/Y/Z` (0x06–0x08), `STYPE_PITCH/ROLL/YAW` (0x10–0x12)

## Sensor Node Lifecycle

1. **Boot:** Send `FTYPE_HELLO` frame with `value = (float)primary_stype` to identify sensor type
2. **Loop:** Read sensor → send `FTYPE_DATA_TYPED` frames
3. **Heartbeat:** Send `FTYPE_HB_TYPED` when no new data (keep-alive)
4. **Error:** Send `FTYPE_ERROR` on sensor read failure (I2C timeout, out-of-range, etc.)

## Adding a New Sensor Type

1. Add `STYPE_*` constant to `shared/ciren_frame.h`
2. Create a new node directory under `sensor_node/`
3. Copy `ciren_frame.h` into the node directory
4. Use `ciren_data_typed(stype, value)` or `ciren_data_typed_ts(stype, value, ts)` to send readings
5. Register the new STYPE in `sensor_controller.ino` for type-appropriate default interval

## CIREN Frame Protocol

All frames are sent over Serial1 at the configured baud rate (typically 115200). See `shared/ciren_frame.h` for the full protocol definition and helper functions.

## Flashing

Use Arduino IDE with the appropriate board package for your XIAO variant. Open the `.ino` file in the node directory. Copy `ciren_frame.h` into the same directory if not already present.
