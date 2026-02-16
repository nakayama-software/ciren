#include <WiFi.h>
#include <esp_wifi.h>
#include <esp_now.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
#define OLED_RESET -1
#define I2C_ADDRESS 0x3C
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);

#define MAX_DEVICES 50
#define TIMEOUT_MS 6000

struct DeviceEntry {
  uint8_t mac[6];
  unsigned long lastSeen;
};

DeviceEntry knownDevices[MAX_DEVICES];
int deviceCount = 0;

int lastDisplayedActiveCount = -1;
char raspberrySerialStr[18];
uint8_t selfMac[6];

bool serverOnline = false;
unsigned long serverOnlineUntil = 0;
const unsigned long SERVER_OK_TTL = 8000;

String lastPayload[8];
bool nodeOnline[8] = { false };

#define MAX_SENDER_ID 9
#define FRAME_TTL_MS 3000

struct FrameAsm {
  bool inFrame = false;
  uint16_t cycle = 0;
  unsigned long startedAt = 0;
  String portLine[8];
  bool hasPort[8] = { false };
};

FrameAsm asmBySender[MAX_SENDER_ID + 1];

bool isSameMac(const uint8_t* a, const uint8_t* b) {
  return memcmp(a, b, 6) == 0;
}

int findDeviceIndex(const uint8_t* mac) {
  for (int i = 0; i < deviceCount; i++) {
    if (isSameMac(knownDevices[i].mac, mac)) return i;
  }
  return -1;
}

void addOrUpdateDevice(const uint8_t* mac) {
  if (isSameMac(mac, selfMac)) return;
  int index = findDeviceIndex(mac);
  if (index != -1) {
    knownDevices[index].lastSeen = millis();
  } else if (deviceCount < MAX_DEVICES) {
    memcpy(knownDevices[deviceCount].mac, mac, 6);
    knownDevices[deviceCount].lastSeen = millis();
    deviceCount++;
  }
}

void removeDevice(int index) {
  for (int i = index; i < deviceCount - 1; i++) knownDevices[i] = knownDevices[i + 1];
  deviceCount--;
}

int countActivePeers() {
  int c = 0;
  for (int i = 0; i < deviceCount; i++) {
    if (!isSameMac(knownDevices[i].mac, selfMac)) c++;
  }
  return c;
}

unsigned long lastSwitchTime = 0;
bool showingServerStatus = true;

void drawMacLine(uint8_t mac[6]) {
  for (int i = 0; i < 6; i++) {
    display.printf("%02X", mac[i]);
    if (i < 5) display.print(":");
  }
}

void updateDisplay(bool force = false) {
  static unsigned long lastUpdate = 0;
  bool serverIsOnlineNow = serverOnline && (millis() < serverOnlineUntil);
  int activePeers = countActivePeers();

  if (force || activePeers != lastDisplayedActiveCount || millis() - lastUpdate > 1000) {
    display.clearDisplay();
    display.setTextSize(1);
    display.setTextColor(WHITE);

    display.setCursor(0, 0);
    display.println("RASPBERRY ID:");
    display.setCursor(0, 12);
    display.println(raspberrySerialStr);

    display.setCursor(0, 24);
    display.println("MAC address:");
    display.setCursor(0, 36);
    drawMacLine(selfMac);

    if (millis() - lastSwitchTime > 3000) {
      showingServerStatus = !showingServerStatus;
      lastSwitchTime = millis();
    }

    display.setCursor(0, 48);
    if (showingServerStatus) {
      display.print("Server: ");
      display.println(serverIsOnlineNow ? "Online" : "Offline");
    } else {
      display.print("Active devices: ");
      display.println(activePeers);
    }

    display.display();
    lastDisplayedActiveCount = activePeers;
    lastUpdate = millis();
  }
}

/* ===== Section: Frame assembler helpers ===== */
int extractIntField(const String& s, const char* key) {
  String k = String("\"") + key + "\":";
  int p = s.indexOf(k);
  if (p < 0) return -1;
  p += k.length();
  int q = s.indexOf(",", p);
  if (q < 0) q = s.indexOf("}", p);
  if (q < 0) return -1;
  String v = s.substring(p, q);
  v.trim();
  return v.toInt();
}

bool extractPortLineFromPayload(const String& s, int port, String& outLine) {
  String tag = "p" + String(port) + "-";
  int a = s.indexOf(tag);
  if (a < 0) return false;
  int b = s.indexOf("\n", a);
  if (b < 0) b = s.length();
  outLine = s.substring(a, b);
  outLine.trim();
  return outLine.length() > 0;
}

void resetFrame(FrameAsm& fa) {
  fa.inFrame = false;
  fa.cycle = 0;
  fa.startedAt = 0;
  for (int i = 0; i < 8; i++) {
    fa.portLine[i] = "";
    fa.hasPort[i] = false;
  }
}

bool frameExpired(const FrameAsm& fa) {
  return fa.inFrame && (millis() - fa.startedAt > FRAME_TTL_MS);
}

void onDataReceive(const uint8_t* mac_addr, const uint8_t* data, int len) {
  Serial.print("ESP-NOW msg from: ");
  for (int i = 0; i < 6; i++) {
    Serial.printf("%02X", mac_addr[i]);
    if (i < 5) Serial.print(":");
  }
  Serial.println();

  static char jsonBuf[300];
  int copyLen = min(len, (int)sizeof(jsonBuf) - 1);
  memcpy(jsonBuf, data, copyLen);
  jsonBuf[copyLen] = '\0';

  Serial.print("Data: ");
  Serial.println(jsonBuf);

  String s = String(jsonBuf);
  s.trim();

  if (!(s.startsWith("{") && s.endsWith("}"))) {
    Serial.println("[WARN] Dropped non-JSON payload");
    addOrUpdateDevice(mac_addr);
    updateDisplay();
    return;
  }

  int senderId = extractIntField(s, "sender_id");
  int cycle = extractIntField(s, "cycle");
  int port = extractIntField(s, "port");

  if (senderId < 1 || senderId > MAX_SENDER_ID || port < 1 || port > 8 || cycle < 0) {
    Serial.println("[WARN] Bad sender_id/port/cycle; dropped");
    addOrUpdateDevice(mac_addr);
    updateDisplay();
    return;
  }

  FrameAsm& fa = asmBySender[senderId];

  if (frameExpired(fa)) {
    Serial.printf("[WARN] Frame timeout sid=%d cycle=%u, dropped\n", senderId, fa.cycle);
    resetFrame(fa);
  }

  bool hasStart = (s.indexOf("@sensor_data_start") >= 0);
  bool hasEnd = (s.indexOf("@sensor_data_end") >= 0);

  if (hasStart || port == 1) {
    if (fa.inFrame && fa.cycle != (uint16_t)cycle) {
      resetFrame(fa);
    }
    fa.inFrame = true;
    fa.cycle = (uint16_t)cycle;
    fa.startedAt = millis();
    for (int i = 0; i < 8; i++) {
      fa.portLine[i] = "";
      fa.hasPort[i] = false;
    }
  }

  if (!fa.inFrame) {
    Serial.printf("[WARN] sid=%d got port=%d but no frame start yet; ignored\n", senderId, port);
    addOrUpdateDevice(mac_addr);
    updateDisplay();
    return;
  }

  if (fa.cycle != (uint16_t)cycle) {
    Serial.printf("[WARN] sid=%d cycle mismatch active=%u got=%d; ignored\n", senderId, fa.cycle, cycle);
    addOrUpdateDevice(mac_addr);
    updateDisplay();
    return;
  }

  String line;
  if (extractPortLineFromPayload(s, port, line)) {
    fa.portLine[port - 1] = line;
    fa.hasPort[port - 1] = true;

    int idx = port - 1;
    if (line.indexOf("null-null") == -1) {
      lastPayload[idx] = line;
      nodeOnline[idx] = true;
    } else {
      lastPayload[idx] = "null-null";
      nodeOnline[idx] = false;
    }
  } else {
    Serial.printf("[WARN] sid=%d cycle=%u port=%d missing p-line\n", senderId, fa.cycle, port);
  }

  if (hasEnd || port == 8) {
    String block;
    block.reserve(300);
    for (int p = 1; p <= 8; p++) {
      if (fa.hasPort[p - 1] && fa.portLine[p - 1].length() > 0) {
        block += fa.portLine[p - 1];
      } else {
        block += "p" + String(p) + "-null-null";
      }
      block += "\n";
    }

    Serial.print("sensorID:");
    Serial.println(senderId);
    Serial.println("@sensor_data_start");
    Serial.print(block);
    Serial.println("@sensor_data_end");

    Serial.printf("[OK] flushed sid=%d cycle=%u\n", senderId, fa.cycle);
    resetFrame(fa);

    updateDisplay();
  }

  addOrUpdateDevice(mac_addr);
  updateDisplay();
}

void getSelfMac() {
  esp_wifi_get_mac(WIFI_IF_STA, selfMac);
}

void setup() {
  Serial.begin(115200);
  raspberrySerialStr[0] = '\0';

  WiFi.mode(WIFI_STA);
  getSelfMac();

  if (!display.begin(SSD1306_SWITCHCAPVCC, I2C_ADDRESS)) {
    Serial.println("OLED failed");
    while (1) {}
  }

  display.clearDisplay();
  display.setTextColor(WHITE);
  display.setCursor(0, 0);
  display.println("Initializing...");
  display.display();

  if (esp_now_init() != ESP_OK) {
    Serial.println("ESP-NOW init failed");
    display.clearDisplay();
    display.println("ESP-NOW Init Failed");
    display.display();
    while (1) {}
  }

  esp_now_register_recv_cb(onDataReceive);
  updateDisplay(true);
}

void loop() {
  unsigned long now = millis();
  bool changed = false;

  for (int i = 0; i < deviceCount;) {
    if (now - knownDevices[i].lastSeen > TIMEOUT_MS) {
      Serial.print("[TIMEOUT] Removed: ");
      for (int j = 0; j < 6; j++) {
        Serial.printf("%02X", knownDevices[i].mac[j]);
        if (j < 5) Serial.print(":");
      }
      Serial.println();
      removeDevice(i);
      changed = true;
    } else {
      i++;
    }
  }

  if (Serial.available()) {
    char lineBuf[64];
    size_t rlen = Serial.readBytesUntil('\n', lineBuf, sizeof(lineBuf) - 1);
    lineBuf[rlen] = '\0';

    String line(lineBuf);
    line.trim();

    if (line.length() == 0) {
    } else if (line.indexOf("[SVROK]") >= 0) {
      serverOnline = true;
      serverOnlineUntil = millis() + SERVER_OK_TTL;
    } else if (line.indexOf("[SVRERR]") >= 0) {
      serverOnline = false;
    } else {
      if (line.length() >= 8) {
        strncpy(raspberrySerialStr, line.c_str(), sizeof(raspberrySerialStr) - 1);
        raspberrySerialStr[sizeof(raspberrySerialStr) - 1] = '\0';
      }
    }

    updateDisplay();
  }

  if (changed) updateDisplay();
  delay(100);
}

