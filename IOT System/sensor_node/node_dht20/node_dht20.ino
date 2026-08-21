/**
 * CIREN Sensor Node — DHT20 (Temperature + Humidity)
 * ─────────────────────────────────────────────────
 * Hardware : Seeeduino XIAO SAMD21
 * Sensor   : ASAIR DHT20 via I2C (address 0x38)
 * Output   : 2 typed frame per cycle (temp + humidity)
 *
 * Wiring:
 *   DHT20 VCC → XIAO 3.3V
 *   DHT20 GND → XIAO GND
 *   DHT20 SDA → XIAO SDA (D4)
 *   DHT20 SCL → XIAO SCL (D5)
 *
 * Serial:
 *   Serial1 → sensor controller (TX=D6 RX=D7) baud 115200
 *   Serial  → debug USB ke PC (aktif saat #define DEBUG)
 *
 * Library yang WAJIB diinstall:
 *   "DHT20" by Rob Tillaart — search "DHT20 tillaart" di Library Manager
 *   BUKAN "DHT sensor library" by Adafruit (itu untuk DHT11/DHT22)
 */

#define DEBUG

#include <Wire.h>
#include "DHT20.h"        // library by Rob Tillaart, bukan Adafruit
#include "ciren_frame.h"

// ─── Config ───────────────────────────────────────
#define SAMPLE_INTERVAL_MS    2000   // DHT20 needs >=1s between reads, else read() fails with status -15
#define HEARTBEAT_INTERVAL_MS 5000
#define TEMP_THRESHOLD        0.0f   // demo: always send
#define HUM_THRESHOLD         0.0f   // demo: always send

// Temperature calibration vs RABLISS reference thermometer (video-based),
// device MM-A21D2C, 2026-08-05, n=129, R²=0.878: T_corrected = A * T_raw + B
// Fitted only over raw readings 30.53-46.04°C — outside that range the fit
// extrapolates and has been observed to make readings WORSE (a 26.4°C raw
// reading, well below range, calibrated to 27.8°C against a 25.9°C
// reference — raw was already closer). Only apply within the fitted range.
#define TEMP_CAL_A            0.6569f
#define TEMP_CAL_B            10.4592f
#define TEMP_CAL_MIN_RAW      30.53f
#define TEMP_CAL_MAX_RAW      46.04f
// Taper width beyond MIN/MAX over which the correction fades out linearly to
// zero, instead of switching off instantly at the boundary. The correction's
// size grows toward the top of the fitted range (slope 0.657 < 1), so a hard
// on/off cutoff right at 46.04 caused a ~5.3°C output jump for a ~0.1°C raw
// change straddling the boundary. Tapering removes that discontinuity.
#define TEMP_CAL_TAPER        3.0f

DHT20 dht;  // DHT20 library by Tillaart — address 0x38 sudah default

// ─── State ────────────────────────────────────────
float    last_temp      = -999.0f;
float    last_hum       = -999.0f;
uint32_t last_sample_ms = 0;
uint32_t last_hb_ms     = 0;

// ─── Setup ────────────────────────────────────────
void setup() {
  Serial1.begin(115200);  // ke sensor controller

#ifdef DEBUG
  Serial.begin(115200);   // debug ke PC via USB
  while (!Serial && millis() < 3000);
  Serial.println("DHT20 node starting...");
#endif

  Wire.begin();
  dht.begin();
  delay(500);  // DHT20 butuh warm-up

  // Beritahu controller: node ini punya 2 tipe data
  ciren_hello(STYPE_TEMPERATURE);
  delay(2);
  ciren_hello(STYPE_HUMIDITY);

#ifdef DEBUG
  Serial.println("DHT20 ready.");
#endif
}

// ─── Loop ─────────────────────────────────────────
void loop() {
  uint32_t now = millis();

  if (now - last_sample_ms < SAMPLE_INTERVAL_MS) return;
  last_sample_ms = now;

  // Baca sensor
  int status = dht.read();
  if (status != DHT20_OK) {
    ciren_error(ERR_SENSOR_FAIL);
#ifdef DEBUG
    Serial.print("[ERR] DHT20 read status: "); Serial.println(status);
#endif
    return;
  }

  float temp = dht.getTemperature();
  float tempBeforeCalibrate = temp;
  float hum  = dht.getHumidity();

  if (temp < -40.0f || temp > 85.0f || hum < 0.0f || hum > 100.0f) {
    ciren_error(ERR_OUT_OF_RANGE);
    return;
  }

  // Weight = 1.0 inside the fitted range, fading linearly to 0.0 over
  // TEMP_CAL_TAPER degrees beyond either edge, then fully raw beyond that.
  float calWeight = 1.0f;
  if (temp < TEMP_CAL_MIN_RAW) {
    float under = TEMP_CAL_MIN_RAW - temp;
    calWeight = (under >= TEMP_CAL_TAPER) ? 0.0f : 1.0f - (under / TEMP_CAL_TAPER);
  } else if (temp > TEMP_CAL_MAX_RAW) {
    float over = temp - TEMP_CAL_MAX_RAW;
    calWeight = (over >= TEMP_CAL_TAPER) ? 0.0f : 1.0f - (over / TEMP_CAL_TAPER);
  }
  float tempCalibrated = TEMP_CAL_A * temp + TEMP_CAL_B;
  temp = calWeight * tempCalibrated + (1.0f - calWeight) * temp;
  bool calibrated = calWeight > 0.0f;

  bool temp_changed = fabsf(temp - last_temp) >= TEMP_THRESHOLD;
  bool hum_changed  = fabsf(hum  - last_hum)  >= HUM_THRESHOLD;

  if (temp_changed || hum_changed) {
    ciren_data_typed(STYPE_TEMPERATURE, temp);
    delay(2);
    ciren_data_typed(STYPE_HUMIDITY, hum);
    last_temp  = temp;
    last_hum   = hum;
    last_hb_ms = now;

#ifdef DEBUG
    Serial.print("Temp Initial : "); Serial.print(tempBeforeCalibrate, 2);
    Serial.print(" | Temp: "); Serial.print(temp, 2);
    Serial.print(" (cal "); Serial.print(calWeight * 100.0f, 0); Serial.print("%)");
    Serial.print(" C | Hum: "); Serial.print(hum, 1);
    Serial.println(" %RH");
#endif

  } else if (now - last_hb_ms >= HEARTBEAT_INTERVAL_MS) {
    ciren_heartbeat_typed(STYPE_TEMPERATURE, temp);
    delay(2);
    ciren_heartbeat_typed(STYPE_HUMIDITY, hum);
    last_hb_ms = now;

#ifdef DEBUG
    Serial.println("[HB] no change");
#endif
  }
}