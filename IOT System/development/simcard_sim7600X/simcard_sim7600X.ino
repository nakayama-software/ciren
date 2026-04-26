// ─────────────────────────────────────────────────────────────────────────────
// SIM7600G-H Serial Passthrough — kirim AT command manual via Serial Monitor
// Set Serial Monitor to "115200" baud + "Both NL & CR"
// ─────────────────────────────────────────────────────────────────────────────

#include <Arduino.h>

#define PIN_MODEM_RX    16
#define PIN_MODEM_TX    17
#define MODEM_BAUD      115200

static HardwareSerial& _ser = Serial2;

void setup() {
  Serial.begin(115200);
  delay(2000);
  Serial.println("\n=== SIM7600 Serial Passthrough ===");
  Serial.println("Type AT commands in Serial Monitor (Both NL & CR)");
  Serial.println("=====================================\n");

  _ser.begin(MODEM_BAUD, SERIAL_8N1, PIN_MODEM_RX, PIN_MODEM_TX);
  delay(3000);

  // Quick init
  _ser.println("AT");
  delay(500);
  while (_ser.available()) Serial.write(_ser.read());
  _ser.println("ATE0");
  delay(500);
  while (_ser.available()) Serial.write(_ser.read());
  Serial.println("\n[Ready]\n");
}

void loop() {
  // PC → Modem
  if (Serial.available()) {
    String cmd = Serial.readStringUntil('\n');
    cmd.trim();
    if (cmd.length() > 0) {
      _ser.println(cmd);
    }
  }

  // Modem → PC
  while (_ser.available()) {
    Serial.write(_ser.read());
  }
}