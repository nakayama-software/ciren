// ESP32: 8-port UART hub, gaya mirip program kamu
#include <HardwareSerial.h>
#include <SoftwareSerial.h>

// ----- HW UARTs -----
HardwareSerial U2(2);         // UART2 -> P1
HardwareSerial U1(1);         // UART1 -> P2

// ----- SW UARTs (9600 bps) -----
SoftwareSerial U3;  // P3
SoftwareSerial U4;  // P4
SoftwareSerial U5;  // P5
SoftwareSerial U6;  // P6
SoftwareSerial U7;  // P7
SoftwareSerial U8;  // P8

// Pin mapping
const int RX_P1 = 16, TX_P1 = 17;   // HW Serial2
const int RX_P2 = 25, TX_P2 = 26;   // HW Serial1
const int RX_P3 = 4,  TX_P3 = 2;    // SW
const int RX_P4 = 27, TX_P4 = 14;   // SW
const int RX_P5 = 33, TX_P5 = 32;   // SW
const int RX_P6 = 34, TX_P6 = 13;   // SW (RX-only pin OK)
const int RX_P7 = 35, TX_P7 = 21;   // SW (RX-only pin OK)
const int RX_P8 = 39, TX_P8 = 22;   // SW (RX-only pin OK)

// Buffer per port
String acc1, acc2, acc3, acc4, acc5, acc6, acc7, acc8;

// Utility: baca satu baris dari Stream (non-blocking)
bool readLine(Stream& s, String& buf, String& out) {
  while (s.available()) {
    char c = (char)s.read();
    if (c == '\r') continue;
    if (c == '\n') { out = buf; buf = ""; out.trim(); return out.length(); }
    buf += c;
    if (buf.length() > 200) buf = "";   // guard jika tanpa newline
  }
  return false;
}

// Parse "ID=xxx;VAL=yyy"
void handleLine(const char* portName, const String& line) {
  int i1 = line.indexOf("ID=");
  int i2 = line.indexOf(";VAL=");
  if (i1 >= 0 && i2 > i1) {
    String id  = line.substring(i1 + 3, i2);
    String val = line.substring(i2 + 5);
    Serial.printf("[%s] ID=%s VAL=%s\n", portName, id.c_str(), val.c_str());
  } else {
    Serial.printf("[%s] RAW: %s\n", portName, line.c_str());
  }
}

void setup() {
  Serial.begin(115200);

  // HW UART
  U2.begin(9600, SERIAL_8N1, RX_P1, TX_P1);   // P1
  U1.begin(9600, SERIAL_8N1, RX_P2, TX_P2);   // P2

  // SW UART (EspSoftwareSerial)
  U3.begin(9600, SWSERIAL_8N1, RX_P3, TX_P3, false, 256);  // P3
  U4.begin(9600, SWSERIAL_8N1, RX_P4, TX_P4, false, 256);  // P4
  U5.begin(9600, SWSERIAL_8N1, RX_P5, TX_P5, false, 256);  // P5
  U6.begin(9600, SWSERIAL_8N1, RX_P6, TX_P6, false, 256);  // P6
  U7.begin(9600, SWSERIAL_8N1, RX_P7, TX_P7, false, 256);  // P7
  U8.begin(9600, SWSERIAL_8N1, RX_P8, TX_P8, false, 256);  // P8

  Serial.println("ESP32 8-port UART hub siap.");
}

void loop() {
  String line;

  // HW UART (tidak perlu .listen())
  if (readLine(U2, acc1, line)) handleLine("P1", line);
  if (readLine(U1, acc2, line)) handleLine("P2", line);

  // SW UART: aktifkan listener port yg dibaca, lalu baca cepat
  U3.listen(); if (readLine(U3, acc3, line)) handleLine("P3", line);
  U4.listen(); if (readLine(U4, acc4, line)) handleLine("P4", line);
  U5.listen(); if (readLine(U5, acc5, line)) handleLine("P5", line);
  U6.listen(); if (readLine(U6, acc6, line)) handleLine("P6", line);
  U7.listen(); if (readLine(U7, acc7, line)) handleLine("P7", line);
  U8.listen(); if (readLine(U8, acc8, line)) handleLine("P8", line);

  // beri napas ke scheduler supaya SW UART tidak kelaparan
  delay(0);
}
