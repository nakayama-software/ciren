#include <HardwareSerial.h>
#include <SoftwareSerial.h>
#include <WiFi.h>
#include <esp_now.h>
#include <EEPROM.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

HardwareSerial U2(2);
HardwareSerial U1(1);

SoftwareSerial U3;
SoftwareSerial U4;
SoftwareSerial U5;
SoftwareSerial U6;
SoftwareSerial U7;
SoftwareSerial U8;

const int RX_P1 = 16;
const int RX_P2 = 25;
const int RX_P3 = 4;
const int RX_P4 = 27;
const int RX_P5 = 33;
const int RX_P6 = 34;
const int RX_P7 = 35;
const int RX_P8 = 26;

String bufP1, bufP2, bufP3, bufP4, bufP5, bufP6, bufP7, bufP8;

int senderID = 1;
const int maxSenderID = 9;

const unsigned long OFFLINE_TIMEOUT_MS = 10000UL;
const unsigned long SEND_INTERVAL_MS = 2000UL;
unsigned long lastSendMs = 0;

#define EEPROM_SIZE 7
#define EEPROM_ID_ADDR 6

#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
#define OLED_SDA 21
#define OLED_SCL 22
#define OLED_ADDR 0x3C

#define BUTTON_NEXT 12
#define BUTTON_INC 14

TwoWire WireOLED = TwoWire(1);
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &WireOLED, -1);

char macStr[13] = "000000000000";
int cursor = 0;
bool inputConfirmed = false;
bool macValid = false;
uint8_t currentMac[6];

volatile bool g_i2cPollBusy = false;

bool nodeOnline[8] = { false, false, false, false, false, false, false, false };
unsigned long lastSeenMs[8] = { 0, 0, 0, 0, 0, 0, 0, 0 };
String lastPayload[8];
int onlineCount = 0;

volatile bool statusChanged = false;
volatile bool payloadDirty = false;

#define PAGE_MAIN 0
#define PAGE_NODESTATUS 1
int displayPage = PAGE_MAIN;

void initESPNow();
void addPeer(uint8_t* peerMac);
void sendToReceiver(const String& msg);
char nextHexChar(char c);
void hexToBytes(char* str, uint8_t* mac);
void bytesToHex(uint8_t* mac, char* strOut);
void saveMAC(uint8_t* mac, int id);
void loadMAC(uint8_t* mac);
bool isValidMAC(uint8_t* mac);
void resetEEPROM();
int loadSenderID();
void saveSenderID(int id);

void drawMainScreen();
void drawNodeStatusPage();
void showMACEntry();
void showMessage(const char* line1, const char* line2);
void printMacFormatted(const char* raw, int cursorIndex);

bool readLine(Stream& s, String& buf, String& out);
void pollSerials();
void checkNodeTimeouts();
void recalcOnlineCount();

void maybeSendJson();

String buildDataJsonForPorts(const int* ports, int portCount, int seq, int tot);
void sendDataJsonAutoSplit();

struct HWPort {
  HardwareSerial* port;
  String* buffer;
  const char* name;
  uint8_t portId;
};

struct SWPort {
  SoftwareSerial* port;
  String* buffer;
  const char* name;
  uint8_t portId;
};

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

void recalcOnlineCount() {
  int c = 0;
  for (int i = 0; i < 8; ++i) if (nodeOnline[i]) ++c;
  onlineCount = c;
}

static String normalizeKV(const String& line) {
  String t = line;
  t.trim();
  int dash = t.indexOf('-');
  if (dash < 0) {
    t.replace(' ', '_');
    return t;
  }
  String jenis = t.substring(0, dash);
  String value = t.substring(dash + 1);
  jenis.trim();
  value.trim();
  jenis.replace(' ', '_');
  value.replace(' ', '_');
  return jenis + "-" + value;
}

int readBatteryPercent() {
  return 78;
}

int readLinkRssi() {
  return -55;
}

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
  pinMode(BUTTON_NEXT, INPUT_PULLUP);
  pinMode(BUTTON_INC, INPUT_PULLUP);

  WireOLED.begin(OLED_SDA, OLED_SCL, 400000);
  if (!display.begin(SSD1306_SWITCHCAPVCC, OLED_ADDR)) {
    Serial.println("OLED failed");
    while (1);
  }

  display.setTextSize(1);
  display.setTextWrap(false);
  display.clearDisplay();
  display.setTextColor(WHITE);

  WiFi.mode(WIFI_STA);
  if (esp_now_init() != ESP_OK) {
    Serial.println("ESP-NOW Init failed");
    while (1);
  }

  bool resetPressed = (digitalRead(BUTTON_NEXT) == LOW && digitalRead(BUTTON_INC) == LOW);
  if (resetPressed) {
    delay(800);
    if (digitalRead(BUTTON_NEXT) == LOW && digitalRead(BUTTON_INC) == LOW) {
      resetEEPROM();
      senderID = 1;
      showMessage("Reset OK", "MAC & ID cleared");
      delay(1500);
    }
  }

  if (digitalRead(BUTTON_NEXT) == LOW) {
    delay(800);
    if (digitalRead(BUTTON_NEXT) == LOW) {
      resetEEPROM();
      showMessage("MAC reset", "Hold released...");
      delay(1500);
    }
  }

  uint8_t storedMac[6];
  loadMAC(storedMac);

  Serial.println("EEPROM content at startup:");
  for (int i = 0; i < EEPROM_SIZE; i++) {
    Serial.printf(" EEPROM[%d]=0x%02X\n", i, EEPROM.read(i));
  }

  if (isValidMAC(storedMac)) {
    memcpy(currentMac, storedMac, 6);
    addPeer(currentMac);
    senderID = loadSenderID();
    macValid = true;

    Serial.print("Loaded MAC: ");
    for (int i = 0; i < 6; i++) {
      Serial.printf("%02X", currentMac[i]);
      if (i < 5) Serial.print(":");
    }
    Serial.println();
    Serial.printf("Loaded senderID = %d\n", senderID);
    drawMainScreen();
  } else {
    showMACEntry();
  }

  recalcOnlineCount();
  Serial.println("ESP32 8-port UART hub ready.");
}

void loop() {
  if (!inputConfirmed && !macValid) {
    if (digitalRead(BUTTON_NEXT) == LOW && digitalRead(BUTTON_INC) == LOW) {
      uint8_t mac[6];
      hexToBytes(macStr, mac);
      memcpy(currentMac, mac, 6);
      saveMAC(mac, senderID);
      saveSenderID(senderID);
      addPeer(mac);
      macValid = true;
      inputConfirmed = true;
      drawMainScreen();
      delay(800);
      return;
    }

    if (digitalRead(BUTTON_NEXT) == LOW) {
      cursor = (cursor + 1) % 13;
      delay(200);
    }

    if (digitalRead(BUTTON_INC) == LOW) {
      if (cursor < 12) macStr[cursor] = nextHexChar(macStr[cursor]);
      else if (cursor == 12) { senderID = (senderID % maxSenderID) + 1; }
      delay(200);
    }

    showMACEntry();
    return;
  }

  static int prevNext = HIGH;
  static unsigned long nextPressTime = 0;
  int curNext = digitalRead(BUTTON_NEXT);

  if (prevNext == HIGH && curNext == LOW) nextPressTime = millis();
  else if (prevNext == LOW && curNext == HIGH) {
    unsigned long dur = millis() - nextPressTime;
    if (dur < 800) {
      displayPage = (displayPage == PAGE_MAIN) ? PAGE_NODESTATUS : PAGE_MAIN;
      if (displayPage == PAGE_MAIN) drawMainScreen();
      else drawNodeStatusPage();
      delay(120);
    }
  }
  prevNext = curNext;

  static unsigned long idPressStart = 0;
  if (digitalRead(BUTTON_INC) == LOW) {
    if (idPressStart == 0) idPressStart = millis();
    if (millis() - idPressStart > 1000) {
      senderID = (senderID % maxSenderID) + 1;
      saveSenderID(senderID);
      drawMainScreen();
      payloadDirty = true;
      delay(500);
      idPressStart = 0;
    }
  } else idPressStart = 0;

  pollSerials();
  checkNodeTimeouts();

  if (statusChanged) {
    recalcOnlineCount();
    if (displayPage == PAGE_NODESTATUS) drawNodeStatusPage();
    else drawMainScreen();
    statusChanged = false;
  }

  maybeSendJson();
  delay(0);
}

bool readLine(Stream& s, String& buf, String& out) {
  while (s.available()) {
    char c = (char)s.read();
    if (c == '\r') continue;
    if (c == '\n') {
      out = buf;
      buf = "";
      out.trim();
      return out.length();
    }
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

void initESPNow() {
  if (esp_now_init() != ESP_OK) {
    Serial.println("ESP-NOW Init failed");
    while (1);
  }
}

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

  if (msg.length() > 240) {
    Serial.printf("JSON too long (%d). Not sent.\n", msg.length());
    return;
  }

  esp_err_t result = esp_now_send(currentMac, (uint8_t*)msg.c_str(), msg.length());
  Serial.print("Forwarding JSON -> ");
  Serial.print(msg);
  Serial.print(" => ");
  Serial.printf("len=%d result=%d\n", msg.length(), (int)result);
}

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

String buildDataJsonForPorts(const int* ports, int portCount, int seq, int tot) {
  int batt = readBatteryPercent();
  int rssi = readLinkRssi();
  unsigned long ts = millis() / 1000;

  String s;
  s.reserve(240);

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
  s += String(ts);
  s += ",\"seq\":";
  s += String(seq);
  s += ",\"tot\":";
  s += String(tot);

  for (int k = 0; k < portCount; ++k) {
    int i = ports[k];
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

void sendDataJsonAutoSplit() {
  if (!macValid) return;

  int ports[8];
  int cnt = 0;
  for (int i = 0; i < 8; ++i) {
    if (nodeOnline[i] && lastPayload[i].length() > 0) ports[cnt++] = i;
  }

  if (cnt == 0) {
    sendToReceiver(buildHeartbeatJson());
    return;
  }

  {
    String one = buildDataJsonForPorts(ports, cnt, 1, 1);
    if (one.length() <= 240) {
      sendToReceiver(one);
      return;
    }
  }

  int portsPerPkt = 4;
  while (portsPerPkt >= 1) {
    int tot = (cnt + portsPerPkt - 1) / portsPerPkt;
    bool allSent = true;
    int seq = 1;

    for (int start = 0; start < cnt; start += portsPerPkt) {
      int nThis = cnt - start;
      if (nThis > portsPerPkt) nThis = portsPerPkt;

      String pkt = buildDataJsonForPorts(&ports[start], nThis, seq, tot);
      if (pkt.length() > 240) {
        allSent = false;
        break;
      }

      sendToReceiver(pkt);
      seq++;
      delay(10);
    }

    if (allSent) return;
    portsPerPkt--;
  }

  Serial.println("ERROR: payload too long even with 1 port per packet.");
}

void maybeSendJson() {
  unsigned long now = millis();
  bool timeToSend = (now - lastSendMs >= SEND_INTERVAL_MS);
  if (!timeToSend && !payloadDirty) return;
  if (!macValid) return;

  if (onlineCount == 0) {
    sendToReceiver(buildHeartbeatJson());
  } else {
    String json = buildDataJson();
    if (json.length() <= 240) {
      sendToReceiver(json);
    } else {
      sendDataJsonAutoSplit();
    }
  }

  lastSendMs = now;
  payloadDirty = false;
}

char nextHexChar(char c) {
  if (c >= '0' && c < '9') return c + 1;
  if (c == '9') return 'A';
  if (c >= 'A' && c < 'F') return c + 1;
  return '0';
}

void hexToBytes(char* str, uint8_t* mac) {
  for (int i = 0; i < 6; i++) {
    char b[3] = { str[i * 2], str[i * 2 + 1], '\0' };
    mac[i] = strtoul(b, NULL, 16);
  }
}

void bytesToHex(uint8_t* mac, char* out) {
  for (int i = 0; i < 6; i++) sprintf(out + i * 2, "%02X", mac[i]);
  out[12] = '\0';
}

void saveMAC(uint8_t* mac, int id) {
  for (int i = 0; i < 6; i++) EEPROM.write(i, mac[i]);
  EEPROM.write(EEPROM_ID_ADDR, id);
  EEPROM.commit();
}

void loadMAC(uint8_t* mac) {
  for (int i = 0; i < 6; i++) mac[i] = EEPROM.read(i);
}

bool isValidMAC(uint8_t* mac) {
  bool allFF = true;
  for (int i = 0; i < 6; i++) {
    if (mac[i] != 0xFF) { allFF = false; break; }
  }
  return !allFF;
}

void resetEEPROM() {
  for (int i = 0; i < EEPROM_SIZE; i++) EEPROM.write(i, 0xFF);
  EEPROM.commit();
}

int loadSenderID() {
  int id = EEPROM.read(EEPROM_ID_ADDR);
  return (id < 1 || id > 9) ? 1 : id;
}

void saveSenderID(int id) {
  EEPROM.write(EEPROM_ID_ADDR, id);
  EEPROM.commit();
}

void drawMainScreen() {
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextWrap(false);
  display.setCursor(0, 0);
  display.println("MAC receiver:");
  display.setCursor(0, 12);

  for (int i = 0; i < 6; i++) {
    display.printf("%02X", currentMac[i]);
    if (i < 5) display.print(":");
  }

  display.setCursor(0, 30);
  display.print("Sender ID: ");
  display.print(senderID);

  display.setCursor(0, 48);
  display.print("Nodes: ");
  display.print(onlineCount);
  display.print("/8");

  if (!g_i2cPollBusy) display.display();
}

void drawNodeStatusPage() {
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextWrap(false);
  display.setCursor(0, 0);
  display.println("Node Status:");

  const int leftX = 0, rightX = 64, startY = 12, rowGap = 12;

  for (int r = 0; r < 4; ++r) {
    int idx = r, y = startY + r * rowGap;
    display.setCursor(leftX, y);
    display.print("P");
    display.print(idx + 1);
    display.print(": ");
    display.print(nodeOnline[idx] ? "On " : "Off");
  }

  for (int r = 0; r < 4; ++r) {
    int idx = r + 4, y = startY + r * rowGap;
    display.setCursor(rightX, y);
    display.print("P");
    display.print(idx + 1);
    display.print(": ");
    display.print(nodeOnline[idx] ? "On " : "Off");
  }

  if (!g_i2cPollBusy) display.display();
}

void printMacFormatted(const char* raw, int cursorIndex) {
  char line1[16], line2[16];
  snprintf(line1, sizeof(line1), "%c%c:%c%c:%c%c", raw[0], raw[1], raw[2], raw[3], raw[4], raw[5]);
  snprintf(line2, sizeof(line2), "%c%c:%c%c:%c%c", raw[6], raw[7], raw[8], raw[9], raw[10], raw[11]);

  const int x0 = 0, y1 = 14, y2 = y1 + 14, charW = 6, charH = 8;

  display.setCursor(x0, y1);
  display.print(line1);
  display.setCursor(x0, y2);
  display.print(line2);

  if (cursorIndex >= 0 && cursorIndex < 12) {
    int nibble = cursorIndex;
    int pairIdx = nibble / 2;
    int nibbleInPair = nibble % 2;
    bool topRow = (pairIdx < 3);
    int charPosInLine = (pairIdx % 3) * 3 + nibbleInPair;

    int x = x0 + charPosInLine * charW;
    int y = topRow ? y1 : y2;
    char ch = topRow ? line1[charPosInLine] : line2[charPosInLine];

    display.fillRect(x - 1, y - 1, charW, charH + 2, WHITE);
    display.setTextColor(BLACK);
    display.setCursor(x, y);
    display.write(ch);
    display.setTextColor(WHITE);
  }

  display.setCursor(0, y2 + 14);
  display.print("Sender ID: ");
  if (cursorIndex == 12) {
    int xSID = display.getCursorX(), ySID = y2 + 14;
    char sidBuf[8];
    snprintf(sidBuf, sizeof(sidBuf), "%d", senderID);
    int sidPixels = strlen(sidBuf) * charW;

    display.fillRect(xSID - 1, ySID - 1, sidPixels, charH + 2, WHITE);
    display.setTextColor(BLACK);
    display.print(sidBuf);
    display.setTextColor(WHITE);
  } else {
    display.print(senderID);
  }
}

void showMACEntry() {
  display.clearDisplay();
  display.setCursor(0, 0);
  display.println("Input MAC (2-line):");
  printMacFormatted(macStr, cursor);
  display.setCursor(0, 56);
  display.print("NEXT=Move  INC=Edit");
  if (!g_i2cPollBusy) display.display();
}

void showMessage(const char* l1, const char* l2) {
  display.clearDisplay();
  display.setCursor(0, 0);
  display.println(l1);
  display.setCursor(0, 20);
  display.println(l2);
  if (!g_i2cPollBusy) display.display();
}
