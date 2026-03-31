/**
 * CIREN Sensor Node — MPU6050 IMU (High Speed)
 * ─────────────────────────────────────────────────
 * Hardware  : Seeeduino XIAO SAMD21
 * Sensor    : MPU6050 via I2C (0x68)
 * Output    : pitch, roll, yaw (deg) via complementary filter
 *             + raw accel & gyro untuk fallback
 * Target    : 100Hz, latency minimal untuk 3D viz
 *
 * Kenapa kirim euler angles bukan raw 6-axis:
 *   - 3 nilai per frame vs 6 frame per cycle
 *   - Filter noise dilakukan di node (lebih dekat ke sensor)
 *   - Browser langsung pakai angle tanpa hitung lagi
 *   - Latency end-to-end lebih rendah
 *
 * Wiring:
 *   GY-521 VCC → XIAO 3.3V
 *   GY-521 GND → XIAO GND
 *   GY-521 SDA → XIAO SDA (D4)
 *   GY-521 SCL → XIAO SCL (D5)
 *   GY-521 AD0 → GND (addr 0x68)
 *   XIAO TX (D6) → Sensor controller RX
 *
 * Library: Adafruit MPU6050 + Adafruit Unified Sensor
 */

#define DEBUG  // comment out untuk production

#include <Wire.h>
#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>
#include "ciren_frame.h"

// ─── Config ───────────────────────────────────────
#define SAMPLE_INTERVAL_US   10000  // 10ms = 100Hz (filter rate)
#define SEND_INTERVAL_MS        50  // 50ms = 20Hz  (MQTT/UART send rate)
#define HEARTBEAT_INTERVAL_MS 5000
// Complementary filter alpha: 0.96 = 96% gyro, 4% accel
// Naikkan alpha untuk lebih smooth (lebih percaya gyro)
// Turunkan untuk lebih responsive ke perubahan posisi cepat
#define CF_ALPHA  0.96f

Adafruit_MPU6050 mpu;

// ─── Euler angles (output filter) ─────────────────
float pitch = 0.0f;  // rotasi X (nose up/down)
float roll  = 0.0f;  // rotasi Y (tilt kiri/kanan)
float yaw   = 0.0f;  // rotasi Z (putar kiri/kanan)
// Catatan: yaw dari gyro saja (tidak ada magnetometer)
// Akan drift seiring waktu — acceptable untuk visualisasi

// ─── State ────────────────────────────────────────
uint32_t last_sample_us  = 0;
uint32_t last_send_ms    = 0;
uint32_t last_hb_ms      = 0;
uint32_t last_print_ms   = 0;
float    last_pitch      = -9999.0f;
float    last_roll       = -9999.0f;
float    last_yaw        = -9999.0f;
bool     mpu_ready       = false;

// ─── Complementary filter ─────────────────────────
// Gabungkan accel (posisi absolut, noisy) dan
// gyro (perubahan halus, drift) untuk orientation stabil
void complementary_filter(float ax, float ay, float az,
                           float gx, float gy, float gz,
                           float dt) {
  // Accel-based angle (absolute, noisy)
  float accel_pitch = atan2f(ay, sqrtf(ax*ax + az*az)) * 180.0f / PI;
  float accel_roll  = atan2f(-ax, az) * 180.0f / PI;

  // Gyro integration (smooth, drifts)
  pitch += gy * dt;  // gy di library Adafruit = rotasi sumbu Y (pitch)
  roll  += gx * dt;  // gx = rotasi sumbu X (roll)
  yaw   += gz * dt;  // gz = rotasi sumbu Z (yaw)

  // Complementary filter merge
  pitch = CF_ALPHA * pitch + (1.0f - CF_ALPHA) * accel_pitch;
  roll  = CF_ALPHA * roll  + (1.0f - CF_ALPHA) * accel_roll;
  // Yaw tidak ada referensi absolut dari accel, biarkan gyro saja
  // (akan drift ~1-2 deg/menit, cukup untuk visualisasi)
}

// ─── Setup ────────────────────────────────────────
void setup() {
  Serial1.begin(115200);  // ke sensor controller

#ifdef DEBUG
  Serial.begin(115200);
  while (!Serial && millis() < 3000);
  Serial.println("MPU6050 node (high speed) starting...");
#endif

  Wire.begin();
  // Naikkan I2C clock ke 400kHz (Fast Mode) untuk kurangi
  // waktu baca sensor dari ~2ms jadi ~0.5ms
  Wire.setClock(400000);

  if (!mpu.begin(0x68)) {
#ifdef DEBUG
    Serial.println("[ERR] MPU6050 not found!");
#endif
    while (1) {
      ciren_error(ERR_I2C_TIMEOUT);
      delay(2000);
    }
  }

  // Range setting:
  // RANGE_8_G: cukup untuk deteksi orientasi dan gerakan normal
  // RANGE_500_DEG: cukup untuk gerakan cepat tangan
  mpu.setAccelerometerRange(MPU6050_RANGE_8_G);
  mpu.setGyroRange(MPU6050_RANGE_500_DEG);
  // Filter bandwidth lebih rendah = lebih smooth tapi lebih lag
  // 44Hz = balance antara smooth dan responsive
  mpu.setFilterBandwidth(MPU6050_BAND_44_HZ);

  mpu_ready = true;

  // HELLO: 3 tipe data (pitch, roll, yaw)
  // Pakai STYPE custom untuk euler angles
  ciren_hello(0x10);  // 0x10 = STYPE_PITCH
  delay(2);
  ciren_hello(0x11);  // 0x11 = STYPE_ROLL
  delay(2);
  ciren_hello(0x12);  // 0x12 = STYPE_YAW

#ifdef DEBUG
  Serial.println("MPU6050 ready. Running at 100Hz.");
  Serial.println("Output: pitch, roll, yaw (deg)");
#endif
}

// ─── Loop ─────────────────────────────────────────
void loop() {
  uint32_t now_us = micros();

  // Interval check dengan micros() untuk presisi lebih tinggi
  if (now_us - last_sample_us < SAMPLE_INTERVAL_US) return;
  float dt = (now_us - last_sample_us) / 1000000.0f;  // detik
  last_sample_us = now_us;

  // Baca sensor
  sensors_event_t a, g, temp;
  mpu.getEvent(&a, &g, &temp);

  // Konversi gyro rad/s → deg/s untuk filter
  float gx_deg = g.gyro.x * 180.0f / PI;
  float gy_deg = g.gyro.y * 180.0f / PI;
  float gz_deg = g.gyro.z * 180.0f / PI;

  // Update complementary filter
  complementary_filter(
    a.acceleration.x, a.acceleration.y, a.acceleration.z,
    gx_deg, gy_deg, gz_deg, dt
  );

  // Kirim ke controller hanya setiap SEND_INTERVAL_MS (20Hz)
  // Filter tetap jalan 100Hz untuk akurasi complementary filter
  uint32_t now_ms = millis();
  if (now_ms - last_send_ms >= SEND_INTERVAL_MS) {
    last_send_ms = now_ms;
    // UART 115200, 13 bytes = ~1.1ms per frame, 3 frame = ~3.3ms
    ciren_data_typed(STYPE_PITCH, pitch);
    ciren_data_typed(STYPE_ROLL,  roll);
    ciren_data_typed(STYPE_YAW,   yaw);
  }

  // Wrap yaw ke [-180, 180] untuk cegah drift overflow
  if (yaw > 180.0f)  yaw -= 360.0f;
  if (yaw < -180.0f) yaw += 360.0f;

#ifdef DEBUG
  // Print max 10Hz di debug supaya Serial tidak bottleneck
  if (now_ms - last_print_ms >= 100) {
    last_print_ms = now_ms;
    Serial.printf("P:%.1f R:%.1f Y:%.1f\n", pitch, roll, yaw);
  }
#endif
}
