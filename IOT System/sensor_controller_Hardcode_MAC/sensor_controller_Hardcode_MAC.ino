// ESP32_8port_UART_Hub_Heartbeat_NoI2C.ino
// - 8 port (2 HW UART + 6 SW UART)
// - Auto liveness per-port (timeout)
// - ALWAYS send JSON every interval:
//     * with ports     -> include "port-*" fields
//     * without ports  -> heartbeat only (no "port-*", ports_connected=0)
// - JSON meta: sensor_controller_id, controller_status, battery_level, signal_strength, ports_connected, ts
// - No I2C / OLED version
// - Fixed ESP-NOW receiver MAC: E8:9F:6D:55:BA:1C

#include <HardwareSerial.h>
#include <SoftwareSerial.h>
#include <WiFi.h>
#include <esp_now.h>
#include <EEPROM.h>

// ====== CONFIG: Hardcoded ESP-NOW receiver MAC ======
const uint8_t RECEIVER_MAC[6] = { 0xE8, 0x9F, 0x6D, 0x55, 0xBA, 0x1C };  // fixed receiver MAC

// ====== HW UARTs ======
HardwareSerial U2(2);  // P1
HardwareSerial U1(1);  // P2

// ====== SW UARTs (EspSoftwareSerial @9600) ======
SoftwareSerial U3;  // P3
SoftwareSerial U4;  // P4
SoftwareSerial U5;  // P5
SoftwareSerial U6;  // P6
SoftwareSerial U7;  // P7
SoftwareSerial U8;  // P8

// Pin mapping (RX only; TX = -1)
const int RX_P1 = 16;
const int RX_P2 = 25;
const int RX_P3 = 4;
const int RX_P4 = 27;
const int RX_P5 = 33;
const int RX_P6 = 34;
const int RX_P7 = 35;
const int RX_P8 = 26;

// Buffers per-port
String bufP1, bufP2, bufP3, bufP4, bufP5, bufP6, bufP7, bufP8;

// ========== GLOBALS ==========
int senderID = 1;                     
const int maxSenderID = 9;

const unsigned long OFFLINE_TIMEOUT_MS = 10000UL;
const unsigned long SEND_INTERVAL_MS = 2000UL;
unsigned long lastSendMs = 0;

// ========== EEPROM ==========
#define EEPROM_SIZE 7
#define EEPROM_ID_ADDR 6  

// ===== MAC state (hardcoded) =====
uint8_t currentMac[6];
bool macValid = false;

// ===== Node tracking (8 ports) =====
bool nodeOnline[8] = { false, false, false, false, false, false, false, false };
unsigned long lastSeenMs[8] = { 0,0,0,0,0,0,0,0 };
String lastPayload[8];
int onlineCount = 0;

// Flags
volatile bool statusChanged = false;
volatile bool payloadDirty = false;  

// ======= FORWARD DECL =======
void addPeer(uint8_t* peerMac);
void sendToReceiver(const String& msg);
void resetEEPROM();
int  loadSenderID();
void saveSenderID(int id);
bool readLine(Stream& s, String& buf, String& out);
void pollSerials();
void checkNodeTimeouts();
void recalcOnlineCount();
void maybeSendJson();

// ======== Port descriptors ========
struct HWPort { HardwareSerial* port; String* buffer; const char* name; uint8_t portId; };
struct SWPort { SoftwareSerial* port; String* buffer; const char* name; uint8_t portId; };

HWPort hwPorts[] = {
  { &U2, &bufP1, "P1", 1 },
  { &U1, &bufP2, "P2", 2 },
};
SWPort swPorts[] = {
  { &U3, &bufP3, "P3", 3 },
  { &U4, &bufP4, "P4", 4 },
  { &U5, &bufP5, "P5", 5 },
  { &U6, &bufP6, "P6", 6 },
  { &U7, &bufP7, "P7", 7 },
  { &U8, &bufP8, "P8", 8 },
};
const int HW_PORT_COUNT = sizeof(hwPorts) / sizeof(hwPorts[0]);
const int SW_PORT_COUNT = sizeof(swPorts) / sizeof(swPorts[0]);

// ======== Helpers ========
void recalcOnlineCount() {
  int c = 0;
  for (int i = 0; i < 8; ++i)
    if (nodeOnline[i]) ++c;
  onlineCount = c;
}

static String normalizeKV(const String& line) {
  String t = line; t.trim();
  int dash = t.indexOf('-');
  if (dash < 0) { t.replace(' ', '_'); return t; }
  String jenis = t.substring(0, dash);
  String value = t.substring(dash + 1);
  jenis.trim(); value.trim();
  jenis.replace(' ', '_'); value.replace(' ', '_');
  return jenis + "-" + value;
}

int readBatteryPercent() { return 78; }
int readLinkRssi() { return -55; }

void handleLine(const char* portName, uint8_t portId, const String& line) {
  String norm = normalizeKV(line);
  Serial.printf("[%s:%d] %s\n", portName, portId, norm.c_str());
  int idx = portId - 1;
  lastSeenMs[idx] = millis();
  if (!nodeOnline[idx]) {
    nodeOnline[idx] = true;
    statusChanged = true;
    Serial.printf("Port P%d -> ONLINE\n", portId);
  }
  lastPayload[idx] = norm;
  payloadDirty = true;
}

// ========== setup ==========
void setup() {
  Serial.begin(115200);
  U2.begin(9600, SERIAL_8N1, RX_P1, -1);
  U1.begin(9600, SERIAL_8N1, RX_P2, -1);
  U3.begin(9600, SWSERIAL_8N1, RX_P3, -1, false, 256);
  U4.begin(9600, SWSERIAL_8N1, RX_P4, -1, false, 256);
  U5.begin(9600, SWSERIAL_8N1, RX_P5, -1, false, 256);
  U6.begin(9600, SWSERIAL_8N1, RX_P6, -1, false, 256);
  U7.begin(9600, SWSERIAL_8N1, RX_P7, -1, false, 256);
  U8.begin(9600, SWSERIAL_8N1, RX_P8, -1, false, 256);

  EEPROM.begin(EEPROM_SIZE);

  WiFi.mode(WIFI_STA);
  if (esp_now_init() != ESP_OK) {
    Serial.println("ESP-NOW Init failed");
    while (1) { delay(10); }
  }

  // Hardcode receiver MAC
  memcpy(currentMac, RECEIVER_MAC, 6);
  addPeer(currentMac);
  macValid = true;

  int loaded = loadSenderID();
  if (loaded >= 1 && loaded <= maxSenderID) senderID = loaded;

  Serial.println();
  Serial.print("Using HARDCODED peer MAC: ");
  for (int i = 0; i < 6; i++) { Serial.printf("%02X", currentMac[i]); if (i < 5) Serial.print(":"); }
  Serial.println();
  Serial.printf("SenderID = %d\n", senderID);
  Serial.println("ESP32 8-port UART hub ready.");
}

// ========== loop ==========
void loop() {
  pollSerials();
  checkNodeTimeouts();

  if (statusChanged) {
    recalcOnlineCount();
    statusChanged = false;
  }

  maybeSendJson();
  delay(0);
}

// ====== Serial polling ======
bool readLine(Stream& s, String& buf, String& out) {
  while (s.available()) {
    char c = (char)s.read();
    if (c == '\r') continue;
    if (c == '\n') { out = buf; buf = ""; out.trim(); return out.length(); }
    buf += c;
    if (buf.length() > 200) buf = "";
  }
  return false;
}

void pollSerials() {
  String line;
  for (int i = 0; i < HW_PORT_COUNT; ++i) {
    if (readLine(*hwPorts[i].port, *hwPorts[i].buffer, line)) {
      handleLine(hwPorts[i].name, hwPorts[i].portId, line);
    }
  }
  for (int i = 0; i < SW_PORT_COUNT; ++i) {
    swPorts[i].port->listen();
    if (readLine(*swPorts[i].port, *swPorts[i].buffer, line)) {
      handleLine(swPorts[i].name, swPorts[i].portId, line);
    }
  }
}

// ====== Node liveness ======
void checkNodeTimeouts() {
  unsigned long now = millis();
  for (int i = 0; i < 8; ++i) {
    if (nodeOnline[i] && (now - lastSeenMs[i] > OFFLINE_TIMEOUT_MS)) {
      nodeOnline[i] = false;
      statusChanged = true;
      payloadDirty = true;
      Serial.printf("Port P%d -> OFFLINE (timeout)\n", i + 1);
    }
  }
}

// ====== ESPNOW helpers ======
void addPeer(uint8_t* peerMac) {
  esp_now_peer_info_t peer = {};
  memcpy(peer.peer_addr, peerMac, 6);
  peer.channel = 0;
  peer.encrypt = false;
  if (esp_now_add_peer(&peer) != ESP_OK) {
    Serial.println("Add peer failed");
  }
}

void sendToReceiver(const String& msg) {
  if (!macValid) return;
  esp_err_t result = esp_now_send(currentMac, (uint8_t*)msg.c_str(), msg.length());
  Serial.print("JSON -> ");
  Serial.print(msg);
  Serial.print(" => ");
  Serial.println(result == ESP_OK ? "✅ OK" : "❌ FAIL");
}

// ====== JSON builders ======
String buildHeartbeatJson() {
  int batt = readBatteryPercent();
  int rssi = readLinkRssi();
  char buf[200];
  unsigned long ts = millis() / 1000;
  snprintf(buf, sizeof(buf),
           "{\"sensor_controller_id\":%d,"
           "\"controller_status\":\"online\","
           "\"battery_level\":%d,"
           "\"signal_strength\":%d,"
           "\"ports_connected\":0,"
           "\"ts\":%lu}",
           senderID, batt, rssi, ts);
  return String(buf);
}

String buildDataJson() {
  int batt = readBatteryPercent();
  int rssi = readLinkRssi();
  String s;
  s.reserve(256);
  s = "{\"sensor_controller_id\":";
  s += String(senderID);
  s += ",\"controller_status\":\"online\"";
  s += ",\"battery_level\":";
  s += batt;
  s += ",\"signal_strength\":";
  s += rssi;
  s += ",\"ports_connected\":";
  s += onlineCount;
  s += ",\"ts\":";
  s += String(millis() / 1000);
  for (int i = 0; i < 8; ++i) {
    if (!nodeOnline[i]) continue;
    if (lastPayload[i].length() == 0) continue;
    s += ",\"port-";
    s += String(i + 1);
    s += "\":\"";
    String v = lastPayload[i];
    v.replace("\"", "\\\"");
    s += v;
    s += "\"";
  }
  s += "}";
  return s;
}

void maybeSendJson() {
  unsigned long now = millis();
  bool timeToSend = (now - lastSendMs >= SEND_INTERVAL_MS);
  if (!timeToSend && !payloadDirty) return;
  if (!macValid) return;
  String json = (onlineCount > 0) ? buildDataJson() : buildHeartbeatJson();
  sendToReceiver(json);
  lastSendMs = now;
  payloadDirty = false;
}

// ====== EEPROM (only sender ID) ======
void resetEEPROM() { for (int i = 0; i < EEPROM_SIZE; i++) EEPROM.write(i, 0xFF); EEPROM.commit(); }
int loadSenderID() { int id = EEPROM.read(EEPROM_ID_ADDR); return (id < 1 || id > 9) ? senderID : id; }
void saveSenderID(int id) { EEPROM.write(EEPROM_ID_ADDR, id); EEPROM.commit(); }
