// ============================================================
// Seeeduino XIAO - RS485 Slave dengan Dummy Data
// Pin: TX=6 (Serial1), RX=7 (Serial1), DE/RE=2
// Ganti SLAVE_ADDRESS: 0x01 untuk unit 1, 0x02 untuk unit 2
// ============================================================

#define SLAVE_ADDRESS  0x05   // <<< GANTI 0x02 untuk unit ke-2

#define RS485_DERE  2
#define BAUD_RATE   460800

// 5 register dummy: suhu, kelembaban, tekanan, cahaya, counter
uint16_t holdingRegister[5] = { 0 };

// Simulasi dummy data
float suhu     = 25.0;
float humidity = 60.0;
int   tekanan  = 1013;
int   cahaya   = 500;
int   counter  = 0;

uint16_t calcCRC(uint8_t* buf, uint8_t len) {
  uint16_t crc = 0xFFFF;
  for (uint8_t i = 0; i < len; i++) {
    crc ^= buf[i];
    for (uint8_t j = 0; j < 8; j++) {
      if (crc & 0x0001) crc = (crc >> 1) ^ 0xA001;
      else crc >>= 1;
    }
  }
  return crc;
}

void updateDummyData() {
  // Suhu: naik turun antara 20.0 - 35.0 C (dikali 10, jadi 200-350)
  suhu += random(-5, 6) * 0.1;
  suhu = constrain(suhu, 20.0, 35.0);
  holdingRegister[0] = (uint16_t)(suhu * 10);  // contoh: 25.3C → 253

  // Kelembaban: 40 - 90 %
  humidity += random(-3, 4) * 0.5;
  humidity = constrain(humidity, 40.0, 90.0);
  holdingRegister[1] = (uint16_t)(humidity * 10);  // contoh: 65.5% → 655

  // Tekanan: 990 - 1030 hPa
  tekanan += random(-2, 3);
  tekanan = constrain(tekanan, 990, 1030);
  holdingRegister[2] = (uint16_t)tekanan;

  // Cahaya: 0 - 1023 (simulasi ADC)
  cahaya += random(-20, 21);
  cahaya = constrain(cahaya, 0, 1023);
  holdingRegister[3] = (uint16_t)cahaya;

  // Counter: increment terus
  counter++;
  holdingRegister[4] = (uint16_t)(counter % 65535);
}

void sendResponse(uint8_t startReg, uint8_t numRegs) {
  uint8_t byteCount = numRegs * 2;
  uint8_t respLen   = 5 + byteCount;
  uint8_t resp[32];

  resp[0] = SLAVE_ADDRESS;
  resp[1] = 0x03;
  resp[2] = byteCount;

  for (uint8_t i = 0; i < numRegs; i++) {
    resp[3 + i*2]     = holdingRegister[startReg + i] >> 8;
    resp[3 + i*2 + 1] = holdingRegister[startReg + i] & 0xFF;
  }

  uint16_t crc = calcCRC(resp, respLen - 2);
  resp[respLen - 2] = crc & 0xFF;
  resp[respLen - 1] = (crc >> 8) & 0xFF;

 digitalWrite(RS485_DERE, HIGH);
delayMicroseconds(20);   // naikan dari 100 → 200
Serial1.write(resp, respLen);
Serial1.flush();
delayMicroseconds(50);   // naikan dari 100 → 500
digitalWrite(RS485_DERE, LOW);
}

void handleRequest(uint8_t* buf, uint8_t len) {
  if (len < 8) return;
  if (buf[0] != SLAVE_ADDRESS) return;

  uint16_t crcReceived = buf[len-2] | (buf[len-1] << 8);
  uint16_t crcCalc     = calcCRC(buf, len - 2);
  if (crcReceived != crcCalc) {
    Serial.println("CRC error, request diabaikan");
    return;
  }

  if (buf[1] == 0x03) {
    uint8_t startReg = (buf[2] << 8) | buf[3];
    uint8_t numRegs  = (buf[4] << 8) | buf[5];

    // Validasi range register
    if (startReg + numRegs > 5) {
      Serial.println("Register out of range");
      return;
    }

    sendResponse(startReg, numRegs);

    Serial.print("[Slave 0x0");
    Serial.print(SLAVE_ADDRESS, HEX);
    Serial.print("] Respon dikirim | Suhu=");
    Serial.print(suhu, 1);
    Serial.print("C Hum=");
    Serial.print(humidity, 1);
    Serial.print("% Tek=");
    Serial.print(tekanan);
    Serial.print("hPa Cahaya=");
    Serial.print(cahaya);
    Serial.print(" Counter=");
    Serial.println(counter);
  }
}

void setup() {
  Serial.begin(9600);
  Serial1.begin(BAUD_RATE);
  pinMode(RS485_DERE, OUTPUT);
  digitalWrite(RS485_DERE, LOW);

  // Test kirim manual saat boot
  delay(50);
  Serial.println("Tes kirim Serial1...");
  digitalWrite(RS485_DERE, HIGH);
  delayMicroseconds(200);
  Serial1.print("XIAO ALIVE");
  Serial1.flush();
  delayMicroseconds(500);
  digitalWrite(RS485_DERE, LOW);
  Serial.println("Selesai.");
}

void loop() {
  static uint8_t  rxBuf[32];
  static uint8_t  rxIdx   = 0;
  static uint32_t lastByte = 0;
  static uint32_t lastUpdate = 0;

  // Update dummy data setiap 2 detik
  if (millis() - lastUpdate > 50) {
    updateDummyData();
    lastUpdate = millis();
  }

  while (Serial1.available()) {
    rxBuf[rxIdx++] = Serial1.read();
    lastByte = millis();
    if (rxIdx >= 32) rxIdx = 0;
  }

  if (rxIdx > 0 && millis() - lastByte > 5) {
    handleRequest(rxBuf, rxIdx);
    rxIdx = 0;
  }
}