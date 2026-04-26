// ============================================================
// ESP32 - RS485 Master untuk 8 Slave
// ============================================================

#define RS485_TX    17
#define RS485_RX    16
#define RS485_DERE  4
#define BAUD_RATE   460800
#define TIMEOUT_MS  50
#define NUM_SLAVES  8

HardwareSerial RS485(2);

// Daftar alamat slave
const uint8_t SLAVE_LIST[NUM_SLAVES] = {
  0x01, 0x02, 0x03, 0x04,
  0x05, 0x06, 0x07, 0x08
};

struct SensorData {
  float   suhu;
  float   humidity;
  int     tekanan;
  int     cahaya;
  int     counter;
  bool    online;      // ← tambahan: status koneksi
};

// Simpan data semua slave
SensorData slaveData[NUM_SLAVES];

uint16_t calcCRC(uint8_t* buf, uint8_t len) {
  uint16_t crc = 0xFFFF;
  for (uint8_t i = 0; i < len; i++) {
    crc ^= buf[i];
    for (uint8_t j = 0; j < 8; j++) {
      if (crc & 0x0001) crc = (crc >> 1) ^ 0xA001;
      else              crc >>= 1;
    }
  }
  return crc;
}

bool readSlave(uint8_t address, uint8_t startReg, uint8_t numRegs, uint16_t* outBuf) {
  uint8_t frame[8];
  frame[0] = address;
  frame[1] = 0x03;
  frame[2] = 0x00;
  frame[3] = startReg;
  frame[4] = 0x00;
  frame[5] = numRegs;
  uint16_t crc = calcCRC(frame, 6);
  frame[6] = crc & 0xFF;
  frame[7] = (crc >> 8) & 0xFF;

  while (RS485.available()) RS485.read();

  digitalWrite(RS485_DERE, HIGH);
  delayMicroseconds(10);
  RS485.write(frame, 8);
  RS485.flush();
  delayMicroseconds(20);
  digitalWrite(RS485_DERE, LOW);
  delayMicroseconds(50);

  uint8_t expectedLen = 5 + numRegs * 2;
  uint8_t resp[32];
  uint8_t idx     = 0;
  uint32_t start  = millis();

  while (millis() - start < TIMEOUT_MS) {
    if (RS485.available()) {
      resp[idx++] = RS485.read();
      if (idx >= expectedLen) break;
    }
  }

  if (idx < expectedLen) return false;

  uint16_t crcReceived = resp[idx-2] | (resp[idx-1] << 8);
  if (calcCRC(resp, idx - 2) != crcReceived) return false;

  for (uint8_t i = 0; i < numRegs; i++) {
    outBuf[i] = (resp[3 + i*2] << 8) | resp[3 + i*2 + 1];
  }
  return true;
}

void pollAllSlaves() {
  uint16_t rawData[5];

  for (uint8_t i = 0; i < NUM_SLAVES; i++) {
    uint8_t addr = SLAVE_LIST[i];

    if (readSlave(addr, 0, 5, rawData)) {
      slaveData[i].suhu     = rawData[0] / 10.0;
      slaveData[i].humidity = rawData[1] / 10.0;
      slaveData[i].tekanan  = rawData[2];
      slaveData[i].cahaya   = rawData[3];
      slaveData[i].counter  = rawData[4];
      slaveData[i].online   = true;
    } else {
      slaveData[i].online = false;
    }

    delay(50);  // jeda antar query
  }
}

void printAllData() {
  Serial.println("==============================");
  for (uint8_t i = 0; i < NUM_SLAVES; i++) {
    Serial.print("Slave 0x0");
    Serial.print(SLAVE_LIST[i], HEX);
    Serial.print(" : ");

    if (slaveData[i].online) {
      Serial.print(slaveData[i].suhu, 1);     Serial.print("C  ");
      Serial.print(slaveData[i].humidity, 1); Serial.print("%  ");
      Serial.print(slaveData[i].tekanan);     Serial.print("hPa  ");
      Serial.print("Cahaya=");  Serial.print(slaveData[i].cahaya);
      Serial.print("  Cnt=");   Serial.println(slaveData[i].counter);
    } else {
      Serial.println("OFFLINE");
    }
  }
  Serial.println("==============================\n");
}

void setup() {
  Serial.begin(115200);
  RS485.begin(BAUD_RATE, SERIAL_8N1, RS485_RX, RS485_TX);
  pinMode(RS485_DERE, OUTPUT);
  digitalWrite(RS485_DERE, LOW);
  delay(100);
  Serial.println("ESP32 Master - 8 Slave siap.\n");
}

void loop() {
  pollAllSlaves();
  printAllData();
  delay(50);  // jeda antar siklus polling penuh
}