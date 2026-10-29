/**
 * CIREN Sensor Node — SHT45 (Temperature + Humidity)
 * ─────────────────────────────────────────────────
 * Hardware : Seeeduino XIAO SAMD21
 * Sensor   : Sensirion SHT45 via I2C (address 0x44)
 * Output   : 2 typed frame per cycle (temp + humidity), shared timestamp
 *
 * Reuses STYPE_TEMPERATURE / STYPE_HUMIDITY — same STYPE IDs as node_dht20.
 * The backend/dashboard key sensor readings off STYPE (the physical
 * quantity), not sensor model, so an SHT45 node is a drop-in alternative to
 * a DHT20 node wherever one is deployed — no controller/backend changes
 * needed (see sensor_node/readme.md "Adding a New Sensor Type", step 5: not
 * applicable here since no new STYPE is introduced).
 *
 * Wiring:
 *   SHT45 VCC → XIAO 3.3V (SHT45 is NOT 5V tolerant — do not wire to 5V)
 *   SHT45 GND → XIAO GND
 *   SHT45 SDA → XIAO SDA (D4)
 *   SHT45 SCL → XIAO SCL (D5)
 *   XIAO TX (D6) → Sensor controller RX
 *
 * Serial:
 *   Serial1 → sensor controller (TX=D6 RX=D7) baud 115200
 *   Serial  → debug USB ke PC (aktif saat #define DEBUG)
 *
 * Library yang WAJIB diinstall:
 *   "Adafruit SHT4x Library" by Adafruit — search "SHT4x adafruit" di Library Manager
 *   Dependencies (Library Manager akan minta install juga): "Adafruit Unified Sensor", "Adafruit BusIO"
 *
 * Catatan kalibrasi: belum ada data kalibrasi lapangan untuk SHT45 (beda
 * dengan node_dht20 yang punya fit kalibrasi khusus untuk unit DHT20-nya di
 * MM-A21D2C) — sensor ini mengirim raw reading apa adanya. SHT45 datasheet
 * Sensirion mengklaim akurasi ±1.0°C / ±1.0%RH tanpa kalibrasi tambahan,
 * jadi ini dianggap cukup untuk sekarang. Kalau nanti ada data referensi
 * lapangan, tambahkan fit yang sama polanya seperti TEMP_CAL_* di
 * node_dht20.ino (dengan taper di tepi rentang fit, bukan cutoff keras).
 */

#define DEBUG

#include <Wire.h>
#include <Adafruit_SHT4x.h>
#include <Adafruit_Sensor.h>
#include "ciren_frame.h"

// ─── Config ───────────────────────────────────────
// SHT45 sendiri tidak punya batas minimum antar-pembacaan sekeras DHT20
// (high-precision single-shot conversion ~8ms per datasheet Sensirion) —
// interval ini dipilih supaya konsisten dengan node_dht20 di fleet yang
// sama, bukan karena keterbatasan hardware SHT45.
#define SAMPLE_INTERVAL_MS    2000
#define HEARTBEAT_INTERVAL_MS 5000
#define TEMP_THRESHOLD        0.0f   // demo: always send
#define HUM_THRESHOLD         0.0f   // demo: always send

Adafruit_SHT4x sht4 = Adafruit_SHT4x();

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
  Serial.println("SHT45 node starting...");
#endif

  Wire.begin();

  if (!sht4.begin()) {
#ifdef DEBUG
    Serial.println("[ERR] SHT45 not found — check wiring/address (0x44)");
#endif
    // Keep retrying in loop() via ciren_error() instead of halting here —
    // same "degrade, don't hang" philosophy as the rest of the fleet.
  }

  // High precision = lowest noise, ~8ms conversion time (acceptable at our
  // multi-second sample interval). No heater — this is an ambient T/RH
  // sensor, not a condensation-prone application.
  sht4.setPrecision(SHT4X_HIGH_PRECISION);
  sht4.setHeater(SHT4X_NO_HEATER);

  delay(100);  // settle after begin()

  // Beritahu controller: node ini punya 2 tipe data
  ciren_hello(STYPE_TEMPERATURE);
  delay(2);
  ciren_hello(STYPE_HUMIDITY);

#ifdef DEBUG
  Serial.println("SHT45 ready.");
#endif
}

// ─── Loop ─────────────────────────────────────────
void loop() {
  uint32_t now = millis();

  if (now - last_sample_ms < SAMPLE_INTERVAL_MS) return;
  last_sample_ms = now;

  // Baca sensor — getEvent() mengisi dua sensors_event_t sekaligus dari satu
  // konversi SHT45, jadi temp & humidity otomatis punya waktu ukur yang sama.
  sensors_event_t humidity_evt, temp_evt;
  if (!sht4.getEvent(&humidity_evt, &temp_evt)) {
    ciren_error(ERR_SENSOR_FAIL);
#ifdef DEBUG
    Serial.println("[ERR] SHT45 getEvent() failed");
#endif
    return;
  }

  float temp = temp_evt.temperature;
  float hum  = humidity_evt.relative_humidity;

  if (temp < -40.0f || temp > 125.0f || hum < 0.0f || hum > 100.0f) {
    ciren_error(ERR_OUT_OF_RANGE);
    return;
  }

  bool temp_changed = fabsf(temp - last_temp) >= TEMP_THRESHOLD;
  bool hum_changed  = fabsf(hum  - last_hum)  >= HUM_THRESHOLD;

  if (temp_changed || hum_changed) {
    uint32_t shared_ts = now;   // one conversion, one timestamp — see ciren_send_typed_ts()
    ciren_data_typed_ts(STYPE_TEMPERATURE, temp, shared_ts);
    delay(2);
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
    uint32_t shared_ts = now;
    ciren_heartbeat_typed_ts(STYPE_TEMPERATURE, temp, shared_ts);
    delay(2);
    ciren_heartbeat_typed_ts(STYPE_HUMIDITY, hum, shared_ts);
    last_hb_ms = now;

#ifdef DEBUG
    Serial.println("[HB] no change");
#endif
  }
}
