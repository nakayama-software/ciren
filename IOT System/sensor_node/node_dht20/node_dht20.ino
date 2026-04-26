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
#define SAMPLE_INTERVAL_MS    1000
#define HEARTBEAT_INTERVAL_MS 5000
#define TEMP_THRESHOLD        0.1f   // degC
#define HUM_THRESHOLD         0.5f   // %RH

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
  float hum  = dht.getHumidity();

  // Validasi
  if (temp < -40.0f || temp > 85.0f || hum < 0.0f || hum > 100.0f) {
    ciren_error(ERR_OUT_OF_RANGE);
    return;
  }

  bool temp_changed = fabsf(temp - last_temp) >= TEMP_THRESHOLD;
  bool hum_changed  = fabsf(hum  - last_hum)  >= HUM_THRESHOLD;

  if (temp_changed || hum_changed) {
    uint32_t shared_ts = millis();
    ciren_data_typed_ts(STYPE_TEMPERATURE, temp, shared_ts);
    ciren_data_typed_ts(STYPE_HUMIDITY, hum, shared_ts);
    last_temp  = temp;
    last_hum   = hum;
    last_hb_ms = now;

#ifdef DEBUG
    Serial.print("Temp: "); Serial.print(temp, 2);
    Serial.print(" C | Hum: "); Serial.print(hum, 1);
    Serial.println(" %RH");
#endif

  } else if (now - last_hb_ms >= HEARTBEAT_INTERVAL_MS) {
    uint32_t shared_ts = millis();
    ciren_heartbeat_typed_ts(STYPE_TEMPERATURE, temp, shared_ts);
    ciren_heartbeat_typed_ts(STYPE_HUMIDITY, hum, shared_ts);
    last_hb_ms = now;

#ifdef DEBUG
    Serial.println("[HB] no change");
#endif
  }
}
