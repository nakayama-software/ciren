// =======================
// ESP32 Receiver Firmware
// =======================
#include <WiFi.h>
#include <esp_wifi.h>
#include <esp_now.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

// OLED config
#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
#define OLED_RESET -1
#define I2C_ADDRESS 0x3C
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);

// Device tracking
#define MAX_DEVICES 50
#define TIMEOUT_MS 6000  // 6s timeout (sedikit di atas heartbeat 5s agar tidak balapan)

struct DeviceEntry {
  uint8_t mac[6];
  unsigned long lastSeen;
};

DeviceEntry knownDevices[MAX_DEVICES];
int deviceCount = 0;

// untuk menghindari redraw berlebihan
int lastDisplayedActiveCount = -1;

// Raspberry Pi serial (untuk ditampilkan)
char raspberrySerialStr[18];   // maks 17 + null
uint8_t selfMac[6];            // MAC ESP32 ini

// Status server dari heartbeat Pi
bool serverOnline = false;
unsigned long serverOnlineUntil = 0;
const unsigned long SERVER_OK_TTL = 8000; // “Online” hingga 8s sejak heartbeat terakhir

// ────────────────────────────────
// Utils
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
  // Jangan pernah memasukkan diri sendiri
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
  for (int i = index; i < deviceCount - 1; i++) {
    knownDevices[i] = knownDevices[i + 1];
  }
  deviceCount--;
}

int countActivePeers() {
  int c = 0;
  for (int i = 0; i < deviceCount; i++) {
    if (!isSameMac(knownDevices[i].mac, selfMac)) c++;
  }
  return c;
}

// ────────────────────────────────
// OLED
unsigned long lastSwitchTime = 0;
bool showingServerStatus = true;  // toggle tiap 3 detik

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

    // Raspberry Pi Serial Number
    display.setCursor(0, 0);
    display.println("RASPBERRY ID:");
    display.setCursor(0, 12);
    display.println(raspberrySerialStr);

    // MAC address
    display.setCursor(0, 24);
    display.println("MAC address:");
    display.setCursor(0, 36);
    drawMacLine(selfMac);

    // Toggle status vs device count
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

// ────────────────────────────────
// ESP-NOW Receive Callback
void onDataReceive(const esp_now_recv_info* recvInfo, const uint8_t* data, int len) {
  // Baca MAC pengirim
  Serial.print("ESP-NOW msg from: ");
  for (int i = 0; i < 6; i++) {
    Serial.printf("%02X", recvInfo->src_addr[i]);
    if (i < 5) Serial.print(":");
  }
  Serial.println();

  // Salin payload ke buffer char, paksa null-terminated
  static char jsonBuf[300]; // aman untuk payload JSON pendek
  int copyLen = min(len, (int)sizeof(jsonBuf) - 1);
  memcpy(jsonBuf, data, copyLen);
  jsonBuf[copyLen] = '\0';

  // Logging ringkas
  Serial.print("Data: ");
  Serial.println(jsonBuf);

  // Hanya forward kalau kelihatannya JSON object (dimulai '{' dan berakhir '}')
  // Ini mencegah noise string lain ikut dikirim ke Pi.
  String s = String(jsonBuf);
  s.trim();
  bool looksJsonObject = s.length() >= 2 && s[0] == '{' && s[s.length() - 1] == '}';

  if (looksJsonObject) {
    Serial.print("[FOR_PI] ");
    Serial.println(s); // satu baris JSON valid
  } else {
    Serial.println("[WARN] Dropped non-JSON payload");
  }

  // Update daftar device dari ESP-NOW packet
  addOrUpdateDevice(recvInfo->src_addr);
  updateDisplay();
}

// ────────────────────────────────
// Setup
void getSelfMac() {
  esp_wifi_get_mac(WIFI_IF_STA, selfMac);
}

void setup() {
  Serial.begin(115200);
  raspberrySerialStr[0] = '\0';  // tampilan awal rapi

  WiFi.mode(WIFI_STA);
  getSelfMac();

  if (!display.begin(SSD1306_SWITCHCAPVCC, I2C_ADDRESS)) {
    Serial.println("OLED failed");
    while (1);
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
    while (1);
  }

  esp_now_register_recv_cb(onDataReceive);

  updateDisplay(true);
  Serial.println("Receiver ready. Waiting for data...");
}

// ────────────────────────────────
// Loop
void loop() {
  unsigned long now = millis();
  bool changed = false;

  // Hapus device yang timeout
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

  // Baca per baris dari USB Serial: bisa berisi Raspberry ID atau heartbeat tag
  if (Serial.available()) {
    char lineBuf[64];
    int rlen = Serial.readBytesUntil('\n', lineBuf, sizeof(lineBuf) - 1);
    if (rlen < 0) rlen = 0;
    lineBuf[rlen] = '\0';

    if (strstr(lineBuf, "[SVROK]")) {
      serverOnline = true;
      serverOnlineUntil = millis() + SERVER_OK_TTL;
    } else if (strstr(lineBuf, "[SVRERR]")) {
      serverOnline = false; // langsung offline saat error eksplisit
    } else {
      // Anggap ini adalah Raspberry ID (batasi panjang 17 char untuk OLED)
      strncpy(raspberrySerialStr, lineBuf, sizeof(raspberrySerialStr) - 1);
      raspberrySerialStr[sizeof(raspberrySerialStr) - 1] = '\0';
    }

    updateDisplay();
  }

  if (changed) updateDisplay();

  delay(100);
}
