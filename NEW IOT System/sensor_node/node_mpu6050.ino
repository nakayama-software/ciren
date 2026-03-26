/**
 * CIREN Sensor Node — MPU6050 (6-axis IMU)
 * ─────────────────────────────────────────────────
 * Hardware : Seeeduino XIAO SAMD21
 * Sensor   : InvenSense MPU6050 via I2C (address 0x68)
 * Output   : 6 typed frame per cycle (ax ay az gx gy gz)
 *
 * Wiring:
 *   GY-521 VCC → XIAO 3.3V
 *   GY-521 GND → XIAO GND
 *   GY-521 SDA → XIAO SDA (D4)
 *   GY-521 SCL → XIAO SCL (D5)
 *   GY-521 AD0 → GND (address 0x68)
 *
 * Serial:
 *   Serial1 → sensor controller (TX=D6 RX=D7) baud 115200
 *   Serial  → debug USB ke PC (aktif saat #define DEBUG)
 *
 * Library yang diinstall:
 *   "Adafruit MPU6050" + "Adafruit Unified Sensor"
 */

#define DEBUG

#include <Wire.h>
#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>
#include "ciren_frame.h"

// ─── Config ───────────────────────────────────────
#define SAMPLE_INTERVAL_MS    50     // 20Hz
#define HEARTBEAT_INTERVAL_MS 5000
#define ACCEL_THRESHOLD       0.05f  // m/s2
#define GYRO_THRESHOLD        0.01f  // rad/s

Adafruit_MPU6050 mpu;

// ─── State ────────────────────────────────────────
float    last_ax = 0, last_ay = 0, last_az = 0;
float    last_gx = 0, last_gy = 0, last_gz = 0;
uint32_t last_sample_ms = 0;
uint32_t last_hb_ms     = 0;

// ─── Setup ────────────────────────────────────────
void setup() {
  Serial1.begin(115200);

#ifdef DEBUG
  Serial.begin(115200);
  while (!Serial && millis() < 3000);
  Serial.println("MPU6050 node starting...");
#endif

  Wire.begin();

  if (!mpu.begin(0x68)) {
#ifdef DEBUG
    Serial.println("[ERR] MPU6050 not found!");
#endif
    while (1) {
      ciren_error(ERR_I2C_TIMEOUT);
      delay(2000);
    }
  }

  // Setting sama dengan kode aslimu
  mpu.setAccelerometerRange(MPU6050_RANGE_8_G);
  mpu.setGyroRange(MPU6050_RANGE_500_DEG);
  mpu.setFilterBandwidth(MPU6050_BAND_21_HZ);

  // HELLO: 6 frame untuk 6 tipe data
  uint8_t stypes[6] = {
    STYPE_ACCEL_X, STYPE_ACCEL_Y, STYPE_ACCEL_Z,
    STYPE_GYRO_X,  STYPE_GYRO_Y,  STYPE_GYRO_Z
  };
  for (uint8_t i = 0; i < 6; i++) {
    ciren_hello(stypes[i]);
    delay(2);
  }

#ifdef DEBUG
  Serial.println("MPU6050 ready.");
#endif
}

// ─── Kirim 6 frame sekaligus ──────────────────────
void send_all_data(float ax, float ay, float az,
                   float gx, float gy, float gz) {
  ciren_data_typed(STYPE_ACCEL_X, ax); delay(2);
  ciren_data_typed(STYPE_ACCEL_Y, ay); delay(2);
  ciren_data_typed(STYPE_ACCEL_Z, az); delay(2);
  ciren_data_typed(STYPE_GYRO_X,  gx); delay(2);
  ciren_data_typed(STYPE_GYRO_Y,  gy); delay(2);
  ciren_data_typed(STYPE_GYRO_Z,  gz);
}

void send_all_hb(float ax, float ay, float az,
                 float gx, float gy, float gz) {
  ciren_heartbeat_typed(STYPE_ACCEL_X, ax); delay(2);
  ciren_heartbeat_typed(STYPE_ACCEL_Y, ay); delay(2);
  ciren_heartbeat_typed(STYPE_ACCEL_Z, az); delay(2);
  ciren_heartbeat_typed(STYPE_GYRO_X,  gx); delay(2);
  ciren_heartbeat_typed(STYPE_GYRO_Y,  gy); delay(2);
  ciren_heartbeat_typed(STYPE_GYRO_Z,  gz);
}

// ─── Loop ─────────────────────────────────────────
void loop() {
  uint32_t now = millis();

  if (now - last_sample_ms < SAMPLE_INTERVAL_MS) return;
  last_sample_ms = now;

  sensors_event_t a, g, temp;
  mpu.getEvent(&a, &g, &temp);

  float ax = a.acceleration.x;
  float ay = a.acceleration.y;
  float az = a.acceleration.z;
  float gx = g.gyro.x;
  float gy = g.gyro.y;
  float gz = g.gyro.z;

  // Validasi (MPU6050_RANGE_8_G = ±78.4 m/s2, RANGE_500_DEG = ±8.73 rad/s)
  if (fabsf(ax) > 80.0f || fabsf(ay) > 80.0f || fabsf(az) > 80.0f ||
      fabsf(gx) > 9.0f  || fabsf(gy) > 9.0f  || fabsf(gz) > 9.0f) {
    ciren_error(ERR_OUT_OF_RANGE);
    return;
  }

  bool accel_changed = fabsf(ax - last_ax) >= ACCEL_THRESHOLD ||
                       fabsf(ay - last_ay) >= ACCEL_THRESHOLD ||
                       fabsf(az - last_az) >= ACCEL_THRESHOLD;
  bool gyro_changed  = fabsf(gx - last_gx) >= GYRO_THRESHOLD  ||
                       fabsf(gy - last_gy) >= GYRO_THRESHOLD  ||
                       fabsf(gz - last_gz) >= GYRO_THRESHOLD;

  if (accel_changed || gyro_changed) {
    send_all_data(ax, ay, az, gx, gy, gz);
    last_ax = ax; last_ay = ay; last_az = az;
    last_gx = gx; last_gy = gy; last_gz = gz;
    last_hb_ms = now;

#ifdef DEBUG
    Serial.print("A: ");
    Serial.print(ax,3); Serial.print(", ");
    Serial.print(ay,3); Serial.print(", ");
    Serial.print(az,3);
    Serial.print(" | G: ");
    Serial.print(gx,4); Serial.print(", ");
    Serial.print(gy,4); Serial.print(", ");
    Serial.println(gz,4);
#endif

  } else if (now - last_hb_ms >= HEARTBEAT_INTERVAL_MS) {
    send_all_hb(ax, ay, az, gx, gy, gz);
    last_hb_ms = now;

#ifdef DEBUG
    Serial.println("[HB] no change");
#endif
  }
}
