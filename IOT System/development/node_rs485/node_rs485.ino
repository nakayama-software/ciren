// ============================================================
// Seeeduino XIAO — RS485 CIREN Sensor Node
// Bisa dipasang di port mana saja (1–6)
// Controller mendeteksi otomatis via HELLO frame
//
// Pin: TX=6 (Serial1), RX=7 (Serial1), DE/RE=2
// ============================================================

#define RS485_DERE  2
#define BAUD_RATE   115200

// ─── CIREN frame protocol ─────────────────────────────────
#define FRAME_START       0xAA
#define FRAME_END         0x55
#define FTYPE_HELLO       0x02
#define FTYPE_DATA_TYPED  0x04
#define STYPE_TEMPERATURE 0x01
#define STYPE_HUMIDITY    0x02

// ─── Timing ───────────────────────────────────────────────
#define SEND_INTERVAL_MS   200    // kirim data tiap 200ms
#define HELLO_INTERVAL_MS  10000  // re-announce tiap 10s (untuk hot-plug)

// ─── Dummy sensor data ────────────────────────────────────
float temperature = 25.0;
float humidity    = 60.0;

// ─── CRC8 ─────────────────────────────────────────────────
uint8_t crc8(const uint8_t* data, uint8_t len) {
  uint8_t crc = 0x00;
  for (uint8_t i = 0; i < len; i++) {
    crc ^= data[i];
    for (uint8_t b = 0; b < 8; b++)
      crc = (crc & 0x80) ? (crc << 1) ^ 0x07 : (crc << 1);
  }
  return crc;
}

// ─── Kirim HELLO frame (12 bytes) ─────────────────────────
// Dipakai controller untuk mendeteksi tipe sensor di port ini
void sendHello(uint8_t stype) {
  uint8_t  frame[12];
  uint32_t ts    = (uint32_t)millis();
  float    value = (float)stype;

  frame[0]  = FRAME_START;
  frame[1]  = FTYPE_HELLO;
  memcpy(&frame[2], &value, 4);
  memcpy(&frame[6], &ts,    4);
  frame[10] = crc8(&frame[1], 9);
  frame[11] = FRAME_END;

  digitalWrite(RS485_DERE, HIGH);
  delayMicroseconds(100);
  Serial1.write(frame, 12);
  Serial1.flush();
  delayMicroseconds(100);
  digitalWrite(RS485_DERE, LOW);
}

// ─── Kirim DATA_TYPED frame (13 bytes) ────────────────────
void sendTyped(uint8_t stype, float value) {
  uint8_t  frame[13];
  uint32_t ts = (uint32_t)millis();

  frame[0]  = FRAME_START;
  frame[1]  = FTYPE_DATA_TYPED;
  frame[2]  = stype;
  memcpy(&frame[3], &value, 4);
  memcpy(&frame[7], &ts,    4);
  frame[11] = crc8(&frame[1], 10);
  frame[12] = FRAME_END;

  digitalWrite(RS485_DERE, HIGH);
  delayMicroseconds(100);
  Serial1.write(frame, 13);
  Serial1.flush();
  delayMicroseconds(100);
  digitalWrite(RS485_DERE, LOW);
}

void updateDummyData() {
  temperature += random(-5, 6) * 0.1f;
  temperature  = constrain(temperature, 20.0f, 35.0f);
  humidity    += random(-3, 4) * 0.5f;
  humidity     = constrain(humidity, 40.0f, 90.0f);
}

// ─── Setup ────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  Serial1.begin(BAUD_RATE);
  pinMode(RS485_DERE, OUTPUT);
  digitalWrite(RS485_DERE, LOW);
  delay(500);

  Serial.println("CIREN RS485 Node ready.");
  Serial.println("Plug into any port — controller auto-detects.");

  // Announce sensor types supaya controller tahu isi port ini
  sendHello(STYPE_TEMPERATURE);
  delay(10);
  sendHello(STYPE_HUMIDITY);

  Serial.println("[HELLO] Temperature + Humidity announced.");
}

// ─── Loop ─────────────────────────────────────────────────
void loop() {
  static uint32_t lastSend  = 0;
  static uint32_t lastHello = 0;

  uint32_t now = millis();

  // Re-announce periodically — controller bisa detect ulang
  // jika di-restart atau node dipindah port
  if (now - lastHello >= HELLO_INTERVAL_MS) {
    sendHello(STYPE_TEMPERATURE);
    delay(10);
    sendHello(STYPE_HUMIDITY);
    lastHello = now;
    Serial.println("[HELLO] Re-announced.");
  }

  // Push sensor data
  if (now - lastSend >= SEND_INTERVAL_MS) {
    updateDummyData();

    sendTyped(STYPE_TEMPERATURE, temperature);
    delay(5);
    sendTyped(STYPE_HUMIDITY, humidity);

    lastSend = now;
    Serial.printf("[DATA] Temp=%.1f C  Hum=%.1f %%\n", temperature, humidity);
  }
}
