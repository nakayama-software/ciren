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
#define TIMEOUT_MS 5000  // 5 seconds timeout

struct DeviceEntry {
  uint8_t mac[6];
  unsigned long lastSeen;
};

DeviceEntry knownDevices[MAX_DEVICES];
int deviceCount = 0;
int lastDisplayedCount = -1;

char raspberrySerialStr[18];  // To store Raspberry Pi's serial number
uint8_t selfMac[6];           // MAC address of this ESP32

// ════════════════════════════════════════════
// 📦 Utility Functions
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
  int index = findDeviceIndex(mac);
  if (index != -1) {
    knownDevices[index].lastSeen = millis();  // update existing
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

// ════════════════════════════════════════════
// 🖥️ OLED Display
unsigned long lastSwitchTime = 0;
bool showingServerStatus = true;  // Start by showing server status

void updateDisplayIfChanged() {
  static unsigned long lastUpdate = 0;
  if (deviceCount != lastDisplayedCount || millis() - lastUpdate > 1000) {
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
    for (int i = 0; i < 6; i++) {
      display.printf("%02X", selfMac[i]);
      if (i < 5) display.print(":");
    }

    // Status/Device count toggle
    if (millis() - lastSwitchTime > 3000) {
      showingServerStatus = !showingServerStatus;
      lastSwitchTime = millis();
    }

    display.setCursor(0, 48);
    if (showingServerStatus) {
      display.print("Server: ");
      display.println("Offline");
    } else {
      display.print("Active devices: ");
      display.println(deviceCount);
    }

    display.display();
    lastDisplayedCount = deviceCount;
    lastUpdate = millis();
  }
}

// ════════════════════════════════════════════
// 📥 ESP-NOW Receive Callback
void onDataReceive(const esp_now_recv_info* recvInfo, const uint8_t* data, int len) {
  // Tampilkan ke Serial (terhubung ke Raspberry Pi via USB)
  Serial.print("ESP-NOW msg from: ");
  for (int i = 0; i < 6; i++) {
    Serial.printf("%02X", recvInfo->src_addr[i]);
    if (i < 5) Serial.print(":");
  }
  Serial.println();

  Serial.print("Data: ");
  for (int i = 0; i < len; i++) {
    Serial.print((char)data[i]);
  }
  Serial.println(); // Ini penting agar baris berakhir (untuk parsing di Raspberry Pi)

  // Kirim JSON atau data mentah ke Raspberry Pi
  Serial.print("[FOR_PI] ");
  for (int i = 0; i < len; i++) Serial.print((char)data[i]);
  Serial.println();  // Tambahkan newline agar RPi bisa membaca dengan readlines()

  addOrUpdateDevice(recvInfo->src_addr);
  updateDisplayIfChanged();
}



// ════════════════════════════════════════════
// 🔌 Setup
void getSelfMac() {
  esp_wifi_get_mac(WIFI_IF_STA, selfMac);
}

void setup() {
  Serial.begin(115200);
  WiFi.mode(WIFI_STA);
  getSelfMac();

  if (!display.begin(SSD1306_SWITCHCAPVCC, I2C_ADDRESS)) {
    Serial.println("OLED failed");
    while (1)
      ;
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
    while (1)
      ;
  }

  esp_now_register_recv_cb(onDataReceive);

  updateDisplayIfChanged();
  Serial.println("Receiver ready. Waiting for data...");
}

// ════════════════════════════════════════════
// 🔁 Loop
void loop() {
  unsigned long now = millis();
  bool changed = false;

  // Clean up old devices
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

  // Receive via USB Serial (from Raspberry Pi)
  if (Serial.available()) {
    int len = Serial.readBytesUntil('\n', raspberrySerialStr, sizeof(raspberrySerialStr) - 1);
    raspberrySerialStr[len] = '\0';
    Serial.print("Received from USB: ");
    Serial.println(raspberrySerialStr);

    addOrUpdateDevice(selfMac);
    updateDisplayIfChanged();
  }


  if (changed) {
    updateDisplayIfChanged();
  }

  delay(100);
}
