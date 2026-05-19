/**
 * CIREN Sensor Controller — RS485 Plug-and-Play Test
 * ─────────────────────────────────────────────────
 * Hardware : ESP32 WROOM-32
 * Feature  : Auto-detect CIREN node di port mana saja (1–6)
 *            Pasang node → langsung terdeteksi
 *            Cabut node  → offline setelah timeout
 *
 * Pin mapping:
 * UART1 TX  = GPIO 4  → MUX Z (TX path)
 * UART1 RX  = GPIO 2  ← MUX Z (RX path)
 * MUX S0    = GPIO 18
 * MUX S1    = GPIO 19
 * MUX S2    = GPIO 16
 * DE/RE[1]  = GPIO 5
 * DE/RE[2]  = GPIO 17
 * DE/RE[3]  = GPIO 23
 * DE/RE[4]  = GPIO 25
 * DE/RE[5]  = GPIO 26
 * DE/RE[6]  = GPIO 27
 * ─────────────────────────────────────────────────
 */

#include <HardwareSerial.h>

// ─── RS485 / MUX pins ────────────────────────────
#define UART_TX    4
#define UART_RX    2
#define MUX_S0     18
#define MUX_S1     19
#define MUX_S2     33
const uint8_t DERE_PIN[6] = { 5, 13, 23, 25, 26, 27 };

// ─── Config ───────────────────────────────────────
#define NODE_BAUD            115200
#define PORT_MAX             6
#define PORT_POLL_WINDOW_MS  250
#define OFFLINE_TIMEOUT_MS   10000UL

// ─── CIREN frame protocol ─────────────────────────
#define FRAME_START       0xAA
#define FRAME_END         0x55
#define FRAME_SIZE        12
#define FRAME_SIZE_TYPED  13
#define FTYPE_DATA        0x01
#define FTYPE_HELLO       0x02
#define FTYPE_HEARTBEAT   0x03
#define FTYPE_DATA_TYPED  0x04
#define FTYPE_HB_TYPED    0x05
#define FTYPE_ERROR       0xFF

// ─── Sensor type IDs ──────────────────────────────
#define STYPE_TEMPERATURE  0x01
#define STYPE_HUMIDITY     0x02
#define STYPE_ACCEL_X      0x03
#define STYPE_ACCEL_Y      0x04
#define STYPE_ACCEL_Z      0x05
#define STYPE_GYRO_X       0x06
#define STYPE_GYRO_Y       0x07
#define STYPE_GYRO_Z       0x08
#define STYPE_PITCH        0x10
#define STYPE_ROLL         0x11
#define STYPE_YAW          0x12

// ─── Per-port state ───────────────────────────────
struct SensorPort {
  uint8_t  rx_buf[FRAME_SIZE_TYPED];
  uint8_t  rx_pos;
  uint8_t  last_stype;
  bool     online;
  uint32_t last_rx_ms;
};

SensorPort ports[PORT_MAX];
HardwareSerial NodeSerial(1);

// ─── Helpers ──────────────────────────────────────
const char* stype_name(uint8_t s) {
  switch (s) {
    case STYPE_TEMPERATURE: return "TEMP";
    case STYPE_HUMIDITY:    return "HUM";
    case STYPE_ACCEL_X:     return "ACCEL_X";
    case STYPE_ACCEL_Y:     return "ACCEL_Y";
    case STYPE_ACCEL_Z:     return "ACCEL_Z";
    case STYPE_GYRO_X:      return "GYRO_X";
    case STYPE_GYRO_Y:      return "GYRO_Y";
    case STYPE_GYRO_Z:      return "GYRO_Z";
    case STYPE_PITCH:       return "PITCH";
    case STYPE_ROLL:        return "ROLL";
    case STYPE_YAW:         return "YAW";
    default:                return "??";
  }
}

uint8_t crc8(const uint8_t* data, uint8_t len) {
  uint8_t crc = 0x00;
  for (uint8_t i = 0; i < len; i++) {
    crc ^= data[i];
    for (uint8_t b = 0; b < 8; b++)
      crc = (crc & 0x80) ? (crc << 1) ^ 0x07 : (crc << 1);
  }
  return crc;
}

bool is_valid_ftype(uint8_t ft) {
  return ft == FTYPE_DATA || ft == FTYPE_HELLO || ft == FTYPE_HEARTBEAT
      || ft == FTYPE_DATA_TYPED || ft == FTYPE_HB_TYPED || ft == FTYPE_ERROR;
}

// ─── MUX + RS485 helpers ──────────────────────────
void muxSelect(uint8_t portIdx) {
  digitalWrite(MUX_S0, (portIdx >> 0) & 0x01);
  digitalWrite(MUX_S1, (portIdx >> 1) & 0x01);
  digitalWrite(MUX_S2, (portIdx >> 2) & 0x01);
  delayMicroseconds(10);
}

// ─── Frame processing ─────────────────────────────
void process_frame(uint8_t portIdx, uint8_t* buf, uint8_t len) {
  uint8_t ftype    = buf[1];
  float   value;
  uint8_t stype    = 0;
  bool    is_typed = (ftype == FTYPE_DATA_TYPED || ftype == FTYPE_HB_TYPED);

  if (is_typed && len == FRAME_SIZE_TYPED) {
    stype = buf[2];
    memcpy(&value, &buf[3], 4);
  } else if (!is_typed && len == FRAME_SIZE) {
    memcpy(&value, &buf[2], 4);
  } else return;

  SensorPort& port = ports[portIdx];
  port.last_rx_ms  = millis();

  if (ftype == FTYPE_HELLO) {
    stype = (uint8_t)value;
    if (!port.online) {
      port.online = true;
      Serial.printf("[P%d] ONLINE  sensor=%s\n", portIdx + 1, stype_name(stype));
    }
    return;
  }

  if (!port.online) {
    port.online = true;
    Serial.printf("[P%d] ONLINE  (via data)\n", portIdx + 1);
  }

  if (is_typed) port.last_stype = stype;
  else          stype = port.last_stype;

  Serial.printf("[P%d] %s = %.2f\n", portIdx + 1, stype_name(stype), value);
}

void parse_byte(uint8_t portIdx, uint8_t b) {
  SensorPort& port = ports[portIdx];

  if (port.rx_pos == 0) {
    if (b != FRAME_START) return;
    port.rx_buf[0] = b;
    port.rx_pos    = 1;
    return;
  }
  if (port.rx_pos == 1) {
    if (!is_valid_ftype(b)) {
      port.rx_pos = 0;
      if (b == FRAME_START) { port.rx_buf[0] = b; port.rx_pos = 1; }
      return;
    }
    port.rx_buf[1] = b;
    port.rx_pos    = 2;
    return;
  }

  port.rx_buf[port.rx_pos++] = b;

  uint8_t ft       = port.rx_buf[1];
  uint8_t expected = (ft == FTYPE_DATA_TYPED || ft == FTYPE_HB_TYPED)
                     ? FRAME_SIZE_TYPED : FRAME_SIZE;
  if (port.rx_pos < expected) return;

  port.rx_pos = 0;
  if (port.rx_buf[expected - 1] != FRAME_END) return;

  uint8_t exp_crc = crc8(&port.rx_buf[1], expected - 3);
  if (exp_crc != port.rx_buf[expected - 2]) {
    Serial.printf("[P%d] CRC fail\n", portIdx + 1);
    return;
  }

  process_frame(portIdx, port.rx_buf, expected);
}

// ─── Poll satu port ───────────────────────────────
void pollPort(uint8_t portIdx) {
  // Nonaktifkan receiver semua port kecuali yang dipoll
  // DE/RE HIGH → RO high-Z → tidak ada sinyal bocor lewat MUX
  for (uint8_t i = 0; i < PORT_MAX; i++)
    digitalWrite(DERE_PIN[i], (i == portIdx) ? LOW : HIGH);

  muxSelect(portIdx);
  delay(1);  // settle + pastikan byte in-transit sudah masuk buffer
  while (NodeSerial.available()) NodeSerial.read();
  ports[portIdx].rx_pos = 0;  // buang partial frame dari window sebelumnya

  uint32_t deadline = millis() + PORT_POLL_WINDOW_MS;
  while (millis() < deadline) {
    while (NodeSerial.available())
      parse_byte(portIdx, (uint8_t)NodeSerial.read());
  }
}

// ─── Timeout check ────────────────────────────────
void checkTimeouts() {
  static uint32_t last_check = 0;
  if (millis() - last_check < 2000) return;
  last_check = millis();

  for (int i = 0; i < PORT_MAX; i++) {
    if (!ports[i].online) continue;
    if (millis() - ports[i].last_rx_ms > OFFLINE_TIMEOUT_MS) {
      ports[i].online = false;
      Serial.printf("[P%d] OFFLINE (timeout)\n", i + 1);
    }
  }
}

// ─── Setup ────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(200);

  pinMode(MUX_S0, OUTPUT);
  pinMode(MUX_S1, OUTPUT);
  pinMode(MUX_S2, OUTPUT);
  muxSelect(0);

  for (uint8_t i = 0; i < PORT_MAX; i++) {
    pinMode(DERE_PIN[i], OUTPUT);
    digitalWrite(DERE_PIN[i], LOW);
  }

  NodeSerial.begin(NODE_BAUD, SERIAL_8N1, UART_RX, UART_TX);

  for (int i = 0; i < PORT_MAX; i++) {
    ports[i].rx_pos     = 0;
    ports[i].last_stype = 0;
    ports[i].online     = false;
    ports[i].last_rx_ms = millis();
  }

  Serial.println("CIREN RS485 — Plug-and-Play Test");
  Serial.println("Pasang node ke port mana saja (1-6).\n");
}

// ─── Loop ─────────────────────────────────────────
void loop() {
  for (int i = 0; i < PORT_MAX; i++)
    pollPort(i);

  checkTimeouts();
}
