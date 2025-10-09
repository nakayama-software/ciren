#include <WiFi.h>
#include <esp_now.h>
#include <EEPROM.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

// OLED
#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
#define OLED_ADDR 0x3C
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, -1);

// EEPROM
#define EEPROM_SIZE 7
#define EEPROM_ID_ADDR 6  // ID stored at byte 6

// Button pins
#define BUTTON_NEXT 12
#define BUTTON_INC 14

// Global variable
int senderID = 1;  // default
const int maxSenderID = 9;

unsigned long lastUartDataTime = 0;
unsigned long heartbeatInterval = 2000;  // Kirim heartbeat jika tidak ada data UART selama 2 detik


// MAC input UI
char macStr[13] = "000000000000";
int cursor = 0;
bool inputConfirmed = false;
bool macValid = false;

unsigned long lastPingTime = 0;
const unsigned long pingInterval = 2000;  // in milliseconds
uint8_t currentMac[6];                    // active target MAC

void setup() {
  Serial.begin(115200);
  EEPROM.begin(EEPROM_SIZE);
  pinMode(BUTTON_NEXT, INPUT_PULLUP);
  pinMode(BUTTON_INC, INPUT_PULLUP);

  if (!display.begin(SSD1306_SWITCHCAPVCC, OLED_ADDR)) {
    Serial.println("OLED failed");
    while (1)
      ;
  }

  display.clearDisplay();
  display.setTextColor(WHITE);
  WiFi.mode(WIFI_STA);
  initESPNow();

  bool resetPressed = digitalRead(BUTTON_NEXT) == LOW && digitalRead(BUTTON_INC) == LOW;
  if (resetPressed) {
    delay(800);
    if (digitalRead(BUTTON_NEXT) == LOW && digitalRead(BUTTON_INC) == LOW) {
      resetEEPROM();
      senderID = 1;
      showMessage("Reset OK", "MAC & ID cleared");
      delay(1500);
    }
  }

  // RESET MAC if Button A is held at startup
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
  if (isValidMAC(storedMac)) {
    memcpy(currentMac, storedMac, 6);  // << ADD THIS
    addPeer(currentMac);
    sendTest(currentMac);
    char hexOut[13];
    bytesToHex(currentMac, hexOut);
    showMessage("MAC address receiver:", hexOut);

    macValid = true;

    senderID = loadSenderID();  // Ensure we load senderID
  } else {
    showMACEntry();  // open UI
  }

  // Display MAC address and Sender ID after loading from EEPROM
  if (macValid) {
    display.clearDisplay();
    display.setCursor(0, 0);
    display.println("MAC receiver:");

    display.setCursor(0, 15);
    for (int i = 0; i < 6; i++) {
      display.printf("%02X", currentMac[i]);
      if (i < 5) display.print(":");
    }

    display.setCursor(0, 35);
    display.print("Sender ID: ");
    display.println(String(senderID));

    display.display();
  }
}


void loop() {
  // === MAC Entry UI ===
  if (!inputConfirmed && !macValid) {
    if (digitalRead(BUTTON_NEXT) == LOW && digitalRead(BUTTON_INC) == LOW) {
      uint8_t mac[6];
      hexToBytes(macStr, mac);
      memcpy(currentMac, mac, 6);
      saveMAC(mac, senderID);
      addPeer(mac);
      inputConfirmed = true;

      char hexOut[13];
      bytesToHex(mac, hexOut);
      showMessage("Saved:", ("ID " + String(senderID) + " / " + hexOut).c_str());
      delay(1500);

      display.clearDisplay();
      display.setCursor(0, 0);
      display.println("MAC receiver:");
      display.setCursor(0, 15);
      for (int i = 0; i < 6; i++) {
        display.printf("%02X", mac[i]);
        if (i < 5) display.print(":");
      }
      display.setCursor(0, 35);
      display.print("Sender ID: ");
      display.println(String(senderID));
      display.display();
    }

    // Handle cursor and MAC entry UI
    if (digitalRead(BUTTON_NEXT) == LOW) {
      cursor = (cursor + 1) % 13;
      delay(200);
    }

    if (digitalRead(BUTTON_INC) == LOW) {
      if (cursor < 12) {
        macStr[cursor] = nextHexChar(macStr[cursor]);
      } else if (cursor == 12) {
        senderID = (senderID % maxSenderID) + 1;
      }
      delay(200);
    }

    showMACEntry();
    return;
  }

  // === After MAC is confirmed ===
  if (macValid || inputConfirmed) {
    // === Handle Sender ID long-press ===
    static unsigned long idPressStart = 0;
    if (digitalRead(BUTTON_INC) == LOW) {
      if (idPressStart == 0) idPressStart = millis();
      if (millis() - idPressStart > 1000) {
        senderID = (senderID % maxSenderID) + 1;
        saveSenderID(senderID);

        display.setCursor(0, 35);
        display.fillRect(0, 35, 128, 10, BLACK);
        display.print("Sender ID: ");
        display.println(String(senderID));
        display.display();

        Serial.println("Sender ID changed to: " + String(senderID));
        delay(1000);
        idPressStart = 0;
      }
    } else {
      idPressStart = 0;
    }

    // === Handle UART input from microcontroller ===
    if (true) {
      String uartData = "{\"temp\": 26.7, \"hum\": 58.2, \"id\": " + String(senderID) + "}";
      sendToReceiver(uartData);
      lastUartDataTime = millis();
      delay(500);  // Biar tidak spam terus-menerus
    }

    // if (Serial.available()) {
    //   String uartData = Serial.readStringUntil('\n');
    //   sendToReceiver(uartData);
    //   lastUartDataTime = millis();
    // }

    // === Send HEARTBEAT only if idle from UART ===
    // if (millis() - lastUartDataTime >= heartbeatInterval) {
    //   String hb = "HB_ID" + String(senderID);
    //   sendToReceiver(hb);
    //   lastUartDataTime = millis();
    // }
  }
}

void sendToReceiver(String msg) {
  esp_err_t result = esp_now_send(currentMac, (uint8_t*)msg.c_str(), msg.length());

  Serial.print("Sending \"");
  Serial.print(msg);
  Serial.print("\" to: ");
  for (int i = 0; i < 6; i++) {
    Serial.printf("%02X", currentMac[i]);
    if (i < 5) Serial.print(":");
  }
  Serial.println(result == ESP_OK ? " ✅ Success" : " ❌ Failed");
}


// ===========================

void initESPNow() {
  if (esp_now_init() != ESP_OK) {
    Serial.println("ESP-NOW Init failed");
    while (1)
      ;
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
  for (int i = 0; i < 6; i++) {
    sprintf(strOut + i * 2, "%02X", mac[i]);
  }
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
  for (int i = 0; i < 6; i++) {
    if (mac[i] != 0xFF && mac[i] != 0x00) return true;
  }
  return false;
}

void resetEEPROM() {
  for (int i = 0; i < EEPROM_SIZE; i++) EEPROM.write(i, 0xFF);
  EEPROM.commit();
}

int loadSenderID() {
  int id = EEPROM.read(EEPROM_ID_ADDR);  // Read sender ID from EEPROM
  if (id < 1 || id > 9) return 1;        // If invalid, return default ID 1
  return id;
}

void printMacFormatted(const char* raw, int cursorIndex) {
  display.setCursor(0, 10);
  for (int i = 0; i < 12; i++) {
    if (i == cursorIndex) display.print("[");
    display.print(raw[i]);
    if (i == cursorIndex) display.print("]");
    else display.print("");

    if (i % 2 == 1 && i != 11) display.print(":");
    else display.print(" ");
  }

  // Tambahkan jarak antar baris
  display.setCursor(0, 42);  // sebelumnya 30
  display.print("Sender ID: ");
  if (cursorIndex == 12) display.print("[");
  display.print(senderID);
  if (cursorIndex == 12) display.print("]");
}

void saveSenderID(int id) {
  EEPROM.write(EEPROM_ID_ADDR, id);  // Store sender ID at the specific EEPROM address
  EEPROM.commit();                   // Ensure the data is written to EEPROM
}

void showMACEntry() {
  display.clearDisplay();
  display.setCursor(0, 0);
  display.println("Input MAC:");
  printMacFormatted(macStr, cursor);
  display.display();
}

void showMessage(const char* line1, const char* line2) {
  display.clearDisplay();
  display.setCursor(0, 0);
  display.println(line1);
  display.setCursor(0, 20);
  display.println(line2);
  display.display();
}
