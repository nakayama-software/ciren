#ifndef CIREN_FRAME_H
#define CIREN_FRAME_H

#include <Arduino.h>

// ═══════════════════════════════════════════════════
//  CIREN Frame Protocol v1
//
//  Standard frame (12 bytes):
//    [0]     0xAA
//    [1]     ftype
//    [2-5]   value   float32 LE
//    [6-9]   ts      uint32 millis() LE
//    [10]    crc8    CRC8 of [1..9]
//    [11]    0x55
//
//  Typed frame (13 bytes) — multi-value node:
//    [0]     0xAA
//    [1]     ftype   FTYPE_DATA_TYPED / FTYPE_HB_TYPED
//    [2]     stype   STYPE_*
//    [3-6]   value   float32 LE
//    [7-10]  ts      uint32 LE
//    [11]    crc8    CRC8 of [1..10]
//    [12]    0x55
// ═══════════════════════════════════════════════════

#define FRAME_SIZE        12
#define FRAME_SIZE_TYPED  13
#define FRAME_START       0xAA
#define FRAME_END         0x55

// ─── Frame types ──────────────────────────────────
#define FTYPE_DATA        0x01
#define FTYPE_HELLO       0x02  // value = (float)stype
#define FTYPE_HEARTBEAT   0x03  // value = last reading
#define FTYPE_DATA_TYPED  0x04  // multi-value, includes stype
#define FTYPE_HB_TYPED    0x05  // heartbeat multi-value
#define FTYPE_ERROR       0xFF  // value = (float)error_code
#define FTYPE_STALE       0xFE  // node offline — dikirim controller ke main module

// ─── Sensor type IDs ──────────────────────────────
#define STYPE_TEMPERATURE  0x01  // degC    (DHT20)
#define STYPE_HUMIDITY     0x02  // %RH     (DHT20)
#define STYPE_ACCEL_X      0x03  // m/s2    (MPU6050)
#define STYPE_ACCEL_Y      0x04  // m/s2    (MPU6050)
#define STYPE_ACCEL_Z      0x05  // m/s2    (MPU6050)
#define STYPE_GYRO_X       0x06  // rad/s   (MPU6050)
#define STYPE_GYRO_Y       0x07  // rad/s   (MPU6050)
#define STYPE_GYRO_Z       0x08  // rad/s   (MPU6050)
#define STYPE_DISTANCE     0x09  // cm      (HC-SR04)
#define STYPE_TEMP_1WIRE   0x0A  // degC    (DS18B20)
#define STYPE_PITCH        0x10  // deg     (MPU6050 euler)
#define STYPE_ROLL         0x11  // deg     (MPU6050 euler)
#define STYPE_YAW          0x12  // deg     (MPU6050 euler)

// ─── Error codes ──────────────────────────────────
#define ERR_SENSOR_FAIL    0x01
#define ERR_OUT_OF_RANGE   0x02
#define ERR_I2C_TIMEOUT    0x03

// ─── CRC8 ─────────────────────────────────────────
inline uint8_t ciren_crc8(const uint8_t* data, uint8_t len) {
  uint8_t crc = 0x00;
  for (uint8_t i = 0; i < len; i++) {
    crc ^= data[i];
    for (uint8_t b = 0; b < 8; b++)
      crc = (crc & 0x80) ? (crc << 1) ^ 0x07 : (crc << 1);
  }
  return crc;
}

// ─── Standard frame → Serial1 ─────────────────────
inline void ciren_send(uint8_t ftype, float value) {
  uint8_t  f[FRAME_SIZE];
  uint32_t ts = millis();
  f[0] = FRAME_START;  f[1] = ftype;
  memcpy(&f[2], &value, 4);
  memcpy(&f[6], &ts,    4);
  f[10] = ciren_crc8(&f[1], 9);
  f[11] = FRAME_END;
  Serial1.write(f, FRAME_SIZE);
}

// ─── Typed frame → Serial1 ────────────────────────
inline void ciren_send_typed(uint8_t ftype, uint8_t stype, float value) {
  uint8_t  f[FRAME_SIZE_TYPED];
  uint32_t ts = millis();
  f[0] = FRAME_START;  f[1] = ftype;  f[2] = stype;
  memcpy(&f[3], &value, 4);
  memcpy(&f[7], &ts,    4);
  f[11] = ciren_crc8(&f[1], 10);
  f[12] = FRAME_END;
  Serial1.write(f, FRAME_SIZE_TYPED);
}

// ─── Typed frame with shared timestamp ────────────
// For multi-value nodes (e.g., DHT20 temp+humidity) that need identical timestamps
inline void ciren_send_typed_ts(uint8_t ftype, uint8_t stype, float value, uint32_t ts) {
  uint8_t  f[FRAME_SIZE_TYPED];
  f[0] = FRAME_START;  f[1] = ftype;  f[2] = stype;
  memcpy(&f[3], &value, 4);
  memcpy(&f[7], &ts,    4);
  f[11] = ciren_crc8(&f[1], 10);
  f[12] = FRAME_END;
  Serial1.write(f, FRAME_SIZE_TYPED);
}

// ─── Standard wrappers ────────────────────────────
inline void ciren_data(float v)       { ciren_send(FTYPE_DATA,      v); }
inline void ciren_hello(uint8_t s)    { ciren_send(FTYPE_HELLO,     (float)s); }
inline void ciren_heartbeat(float v)  { ciren_send(FTYPE_HEARTBEAT, v); }
inline void ciren_error(uint8_t e)    { ciren_send(FTYPE_ERROR,     (float)e); }

// ─── Typed wrappers ───────────────────────────────
inline void ciren_data_typed(uint8_t s, float v)            { ciren_send_typed(FTYPE_DATA_TYPED, s, v); }
inline void ciren_heartbeat_typed(uint8_t s, float v)       { ciren_send_typed(FTYPE_HB_TYPED,   s, v); }
inline void ciren_data_typed_ts(uint8_t s, float v, uint32_t ts)      { ciren_send_typed_ts(FTYPE_DATA_TYPED, s, v, ts); }
inline void ciren_heartbeat_typed_ts(uint8_t s, float v, uint32_t ts) { ciren_send_typed_ts(FTYPE_HB_TYPED,   s, v, ts); }

#endif
