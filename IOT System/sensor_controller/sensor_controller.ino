// ESP32_8port_UART_Hub_TwoColumnStatus_AutoUpdate.ino
// Perubahan: otomatis update ON/OFF tanpa perlu ganti page
// Tetap mempertahankan: port ID tagging, ESP-NOW forward, offline detection, 2-column display

#include <HardwareSerial.h>
#include <SoftwareSerial.h>
#include <WiFi.h>
#include <esp_now.h>
#include <EEPROM.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

// ----- HW UARTs -----
HardwareSerial U2(2);  // P1 (portId 1)
HardwareSerial U1(1);  // P2 (portId 2)

// ----- SW UARTs (9600 bps) -----
SoftwareSerial U3;  // P3 (portId 3)
SoftwareSerial U4;  // P4 (portId 4)
SoftwareSerial U5;  // P5 (portId 5)
SoftwareSerial U6;  // P6 (portId 6)
SoftwareSerial U7;  // P7 (portId 7)
SoftwareSerial U8;  // P8 (portId 8)

// Pin mapping
const int RX_P1 = 16;
const int RX_P2 = 25;
const int RX_P3 = 4;
const int RX_P4 = 27;
const int RX_P5 = 33;
const int RX_P6 = 34;
const int RX_P7 = 35;
const int RX_P8 = 39;

// Temporary buffers
String bufP1, bufP2, bufP3, bufP4, bufP5, bufP6, bufP7, bufP8;

// ========== GLOBALS ==========
int senderID = 1;
const int maxSenderID = 9;

// Timeout to consider a port OFFLINE (ms). Ubah sesuai kebutuhan.
const unsigned long OFFLINE_TIMEOUT_MS = 10000UL; // 10 detik

// ========== EEPROM ==========
#define EEPROM_SIZE 7
#define EEPROM_ID_ADDR 6  // ID stored at byte 6

// ========== DISPLAY / I2C PINOUTS ==========
#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
#define OLED_SDA 21
#define OLED_SCL 22
#define OLED_ADDR 0x3C

// ========== BUTTONS ==========
#define BUTTON_NEXT 12
#define BUTTON_INC  14

TwoWire WireOLED = TwoWire(1);
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &WireOLED, -1);

// MAC input UI
char macStr[13] = "000000000000";
int cursor = 0;
bool inputConfirmed = false;
bool macValid = false;
uint8_t currentMac[6];

// avoid render during I2C poll
volatile bool g_i2cPollBusy = false;

// Node tracking (8 ports)
bool nodeOnline[8] = { false, false, false, false, false, false, false, false };
unsigned long lastSeenMs[8] = { 0,0,0,0,0,0,0,0 };
String lastPayload[8]; // optional: last payload per port
int onlineCount = 0;   // jumlah port online

// Flag perubahan status (true bila ada ON/OFF berubah sejak terakhir)
volatile bool statusChanged = false;

// Display pages
#define PAGE_MAIN 0
#define PAGE_NODESTATUS 1
int displayPage = PAGE_MAIN; // global so other funcs know which page is active

// ========== FORWARD DECLS ==========
void initESPNow();
void addPeer(uint8_t* peerMac);
void sendTest(uint8_t* mac);
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

// --- Port descriptors (masukkan portId) ---
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
  { &U1, &bufP2, "P2", 2 }
};

SWPort swPorts[] = {
  { &U3, &bufP3, "P3", 3 },
  { &U4, &bufP4, "P4", 4 },
  { &U5, &bufP5, "P5", 5 },
  { &U6, &bufP6, "P6", 6 },
  { &U7, &bufP7, "P7", 7 },
  { &U8, &bufP8, "P8", 8 }
};

const int HW_PORT_COUNT = sizeof(hwPorts) / sizeof(hwPorts[0]);
const int SW_PORT_COUNT = sizeof(swPorts) / sizeof(swPorts[0]);

// Utility: recalc onlineCount from nodeOnline[]
void recalcOnlineCount() {
  int c = 0;
  for (int i = 0; i < 8; ++i) if (nodeOnline[i]) ++c;
  onlineCount = c;
}

// Handle incoming serial lines:
// - parse format "jenis sensor - value"
// - tag dengan PORT id
// - tampilkan ke Serial dan forward via ESP-NOW bila macValid
void handleLine(const char* portName, uint8_t portId, const String& line) {
  String t = line;
  t.trim();
  int dash = t.indexOf('-');
  String payload;

  if (dash >= 0) {
    String type = t.substring(0, dash);
    String val = t.substring(dash + 1);
    type.trim(); val.trim();

    payload = String("PORT=") + String(portId) + ";TYPE=" + type + ";VAL=" + val;
    Serial.printf("[%s:%d] TYPE=%s VAL=%s\n", portName, portId, type.c_str(), val.c_str());
  } else {
    // fallback ke RAW
    payload = String("PORT=") + String(portId) + ";RAW=" + t;
    Serial.printf("[%s:%d] RAW: %s\n", portName, portId, t.c_str());
  }

  // update tracking
  int idx = portId - 1;
  lastSeenMs[idx] = millis();

  // jika sebelumnya offline, tandai online dan set flag perubahan
  if (!nodeOnline[idx]) {
    nodeOnline[idx] = true;
    statusChanged = true;
    Serial.printf("Port P%d -> ONLINE\n", portId);
  }
  lastPayload[idx] = payload; // simpan (opsional)

  // Forward via ESP-NOW bila MAC tujuan valid
  if (macValid) sendToReceiver(payload);
}

// ========== setup / loop ==========
void setup() {
  Serial.begin(115200);

  // HW UART
  U2.begin(9600, SERIAL_8N1, RX_P1, -1);  // P1
  U1.begin(9600, SERIAL_8N1, RX_P2, -1);  // P2

  // SW UART (EspSoftwareSerial)
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
    while (1) ;
  }
  display.setTextSize(1);
  display.setTextWrap(false);
  display.clearDisplay();
  display.setTextColor(WHITE);

  // WiFi & ESP-NOW
  WiFi.mode(WIFI_STA);
  initESPNow();

  // Reset EEPROM (kombinasi tombol saat startup)
  bool resetPressed = (digitalRead(BUTTON_NEXT) == LOW && digitalRead(BUTTON_INC) == LOW);
  if (resetPressed) {
    delay(800);
    if (digitalRead(BUTTON_NEXT) == LOW && digitalRead(BUTTON_INC) == LOW) {
      resetEEPROM();
      senderID = 1;
      showMessage("Reset OK", "MAC & ID cleared");
      Serial.println("EEPROM reset by startup buttons");
      delay(1500);
    }
  }
  if (digitalRead(BUTTON_NEXT) == LOW) {
    delay(800);
    if (digitalRead(BUTTON_NEXT) == LOW) {
      resetEEPROM();
      showMessage("MAC reset", "Hold released...");
      Serial.println("EEPROM reset by single button A hold");
      delay(1500);
    }
  }

  // Load MAC dari EEPROM
  uint8_t storedMac[6];
  loadMAC(storedMac);

  Serial.println("EEPROM content at startup:");
  for (int i = 0; i < EEPROM_SIZE; i++) {
    Serial.printf(" EEPROM[%d]=0x%02X\n", i, EEPROM.read(i));
  }

  if (isValidMAC(storedMac)) {
    memcpy(currentMac, storedMac, 6);
    addPeer(currentMac);
    sendTest(currentMac);
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

  // init lastSeen to 0 (already done by initializer), nodeOnline false
  recalcOnlineCount();
  Serial.println("ESP32 8-port UART hub siap.");
}

// Centralized polling
void pollSerials() {
  String line;
  // HW ports
  for (int i = 0; i < HW_PORT_COUNT; ++i) {
    if (readLine(*hwPorts[i].port, *hwPorts[i].buffer, line)) {
      handleLine(hwPorts[i].name, hwPorts[i].portId, line);
    }
  }
  // SW ports: each must listen() before read
  for (int i = 0; i < SW_PORT_COUNT; ++i) {
    swPorts[i].port->listen();
    if (readLine(*swPorts[i].port, *swPorts[i].buffer, line)) {
      handleLine(swPorts[i].name, swPorts[i].portId, line);
    }
  }
}

// Check timeouts and update nodeOnline[]. When we mark OFFLINE -> set statusChanged flag.
void checkNodeTimeouts() {
  unsigned long now = millis();
  for (int i = 0; i < 8; ++i) {
    if (nodeOnline[i]) {
      if (now - lastSeenMs[i] > OFFLINE_TIMEOUT_MS) {
        nodeOnline[i] = false;
        statusChanged = true;
        Serial.printf("Port P%d -> OFFLINE (timeout)\n", i + 1);
      }
    }
  }
}

// ========== loop utama ==========
void loop() {
  String line;

  // === MAC Entry UI ===
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

      Serial.print("Saved MAC: ");
      for (int i = 0; i < 6; i++) {
        Serial.printf("%02X", currentMac[i]);
        if (i < 5) Serial.print(":");
      }
      Serial.println();
      Serial.printf("Saved senderID = %d\n", senderID);

      drawMainScreen();
      delay(800);
      return;
    }

    // cursor/inc
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

  // UI page toggle (short press NEXT)
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

  // Long-press INC untuk ganti senderID
  static unsigned long idPressStart = 0;
  if (digitalRead(BUTTON_INC) == LOW) {
    if (idPressStart == 0) idPressStart = millis();
    if (millis() - idPressStart > 1000) {
      senderID = (senderID % maxSenderID) + 1;
      saveSenderID(senderID);
      drawMainScreen();
      Serial.println("Sender ID changed to: " + String(senderID));
      delay(500);
      idPressStart = 0;
    }
  } else idPressStart = 0;

  // Poll serials (this will update lastSeen & nodeOnline on receive)
  pollSerials();

  // Check timeouts and mark offline if perlu
  checkNodeTimeouts();

  // Jika ada perubahan status -> recalc count + redraw sesuai halaman aktif
  if (statusChanged) {
    recalcOnlineCount();
    if (displayPage == PAGE_NODESTATUS) {
      drawNodeStatusPage();
    } else {
      // update main screen summary (Nodes: X/8)
      drawMainScreen();
    }
    statusChanged = false;
  }

  // small yield
  delay(0);
}

// ========== ESP-NOW & EEPROM helpers ==========
void initESPNow() {
  if (esp_now_init() != ESP_OK) {
    Serial.println("ESP-NOW Init failed");
    while (1) ;
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

void sendTest(uint8_t* mac) {
  const char* msg = "Hello from sender!";
  esp_err_t result = esp_now_send(mac, (uint8_t*)msg, strlen(msg));
  if (result == ESP_OK) Serial.println("Sent!");
  else Serial.println("Send failed");
}

void sendToReceiver(const String& msg) {
  if (!macValid) {
    Serial.println("MAC tujuan belum valid - tidak mengirim.");
    return;
  }
  esp_err_t result = esp_now_send(currentMac, (uint8_t*)msg.c_str(), msg.length());
  Serial.print("Forwarding -> ");
  Serial.print(msg);
  Serial.print(" to: ");
  for (int i = 0; i < 6; i++) {
    Serial.printf("%02X", currentMac[i]);
    if (i < 5) Serial.print(":");
  }
  Serial.println(result == ESP_OK ? " ✅ Success" : " ❌ Failed");
}

char nextHexChar(char c) {
  if (c >= '0' && c < '9') return c + 1;
  if (c == '9') return 'A';
  if (c >= 'A' && c < 'F') return c + 1;
  return '0';
}

void hexToBytes(char* str, uint8_t* mac) {
  for (int i = 0; i < 6; i++) {
    char byteStr[3] = { str[i * 2], str[i * 2 + 1], '\0' };
    mac[i] = strtoul(byteStr, NULL, 16);
  }
}

void bytesToHex(uint8_t* mac, char* strOut) {
  for (int i = 0; i < 6; i++) sprintf(strOut + i * 2, "%02X", mac[i]);
  strOut[12] = '\0';
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
  for (int i = 0; i < 6; i++) if (mac[i] != 0xFF) { allFF = false; break; }
  return !allFF;
}

void resetEEPROM() {
  for (int i = 0; i < EEPROM_SIZE; i++) EEPROM.write(i, 0xFF);
  EEPROM.commit();
}

int loadSenderID() {
  int id = EEPROM.read(EEPROM_ID_ADDR);
  if (id < 1 || id > 9) return 1;
  return id;
}

void saveSenderID(int id) {
  EEPROM.write(EEPROM_ID_ADDR, id);
  EEPROM.commit();
}

// ========== UI functions ==========
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
  display.print("/");
  display.print(8);
  if (!g_i2cPollBusy) display.display();
}

void drawNodeStatusPage() {
  // Two-column layout (left: ports 1..4, right: ports 5..8)
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextWrap(false);
  display.setCursor(0, 0);
  display.println("Node Status:");

  const int leftX = 0;
  const int rightX = 64; // midpoint of 128px display
  const int startY = 12;
  const int rowGap = 12;

  // Left column: ports 1..4
  for (int r = 0; r < 4; ++r) {
    int portIdx = r; // 0..3
    int y = startY + r * rowGap;
    display.setCursor(leftX, y);
    display.print("P");
    display.print(portIdx + 1);
    display.print(": ");
    display.print(nodeOnline[portIdx] ? "On " : "Off");
  }

  // Right column: ports 5..8
  for (int r = 0; r < 4; ++r) {
    int portIdx = r + 4; // 4..7
    int y = startY + r * rowGap;
    display.setCursor(rightX, y);
    display.print("P");
    display.print(portIdx + 1);
    display.print(": ");
    display.print(nodeOnline[portIdx] ? "On " : "Off");
  }

  if (!g_i2cPollBusy) display.display();
}

void showMACEntry() {
  display.clearDisplay();
  display.setCursor(0, 0);
  display.println("Input MAC:");
  printMacFormatted(macStr, cursor);
  if (!g_i2cPollBusy) display.display();
}

void showMessage(const char* line1, const char* line2) {
  display.clearDisplay();
  display.setCursor(0, 0);
  display.println(line1);
  display.setCursor(0, 20);
  display.println(line2);
  if (!g_i2cPollBusy) display.display();
}

void printMacFormatted(const char* raw, int cursorIndex) {
  display.setCursor(0, 10);
  for (int i = 0; i < 12; i++) {
    if (i == cursorIndex) display.print("[");
    display.print(raw[i]);
    if (i == cursorIndex) display.print("]");
    if (i % 2 == 1 && i != 11) display.print(":");
    else display.print(" ");
  }
  display.setCursor(0, 42);
  display.print("Sender ID: ");
  if (cursorIndex == 12) display.print("[");
  display.print(senderID);
  if (cursorIndex == 12) display.print("]");
}

// Non-blocking readLine
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
    if (buf.length() > 200) buf = "";  // guard jika tanpa newline
  }
  return false;
}
