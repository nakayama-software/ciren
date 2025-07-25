#include <Wire.h>
#include <Adafruit_Sensor.h>
#include <Adafruit_BNO055.h>
#include <utility/imumaths.h>
#include <DHT.h>
#include <NewPing.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

// OLED Display
#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
#define OLED_RESET -1
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);

// Ultrasonic
#define TRIG_PIN 32
#define ECHO_PIN 33
#define MAX_DISTANCE 50
#define MIN_VALID_DISTANCE 3
#define MAX_VALID_DISTANCE 50

NewPing sonar(TRIG_PIN, ECHO_PIN, MAX_DISTANCE);

// DHT11
#define DHT_PIN 26
#define DHTTYPE DHT11
DHT dht(DHT_PIN, DHTTYPE);

// BNO055
#define BNO055_SAMPLERATE_DELAY_MS (1000)  // Kirim tiap 1 detik
Adafruit_BNO055 bno = Adafruit_BNO055(55, 0x28, &Wire);

// Buttons
#define BUTTON_INC 12
#define BUTTON_DEC 14

// Global Variables
uint8_t deviceID = 1;
uint8_t ultrasonic = 0;
int8_t temp = 0;
uint8_t hum = 0;
sensors_event_t event;

void setup() {
  Serial.begin(115200);
  while (!Serial) delay(10);

  dht.begin();
  pinMode(BUTTON_INC, INPUT_PULLUP);
  pinMode(BUTTON_DEC, INPUT_PULLUP);

  if (!bno.begin()) {
    Serial.println("BNO055 not detected!");
    while (1)
      ;
  }
  delay(1000);
  bno.setExtCrystalUse(true);

  if (!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    Serial.println(F("SSD1306 allocation failed"));
    while (1)
      ;
  }

  display.clearDisplay();
  display.setTextSize(2);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 0);
  display.println("Device ID");
  display.display();
}

void loop() {
  readUltrasonic();
  readDHT();
  bno.getEvent(&event);
  updateDeviceID();
  updateOLED();
  sendToSerial();  // Ganti dari sendToServer()

  delay(BNO055_SAMPLERATE_DELAY_MS);
}

void readUltrasonic() {
  const int samples = 5;
  uint8_t readings[samples];

  for (int i = 0; i < samples; i++) {
    delay(50);
    readings[i] = sonar.ping_cm();
  }

  // Urutkan array readings
  for (int i = 0; i < samples - 1; i++) {
    for (int j = i + 1; j < samples; j++) {
      if (readings[i] > readings[j]) {
        uint8_t temp = readings[i];
        readings[i] = readings[j];
        readings[j] = temp;
      }
    }
  }

  // Ambil nilai median (tengah)
  ultrasonic = readings[samples / 2];

  if (ultrasonic < MIN_VALID_DISTANCE || ultrasonic > MAX_VALID_DISTANCE) {
    ultrasonic = 0;  // nilai error
  }
}


void readDHT() {
  float t = dht.readTemperature();
  float h = dht.readHumidity();

  temp = isnan(t) ? 0 : (int8_t)t;
  hum = isnan(h) ? 0 : (uint8_t)h;
}

void updateDeviceID() {
  static uint32_t lastDebounceTime = 0;
  const uint32_t debounceDelay = 200;

  if (millis() - lastDebounceTime > debounceDelay) {
    if (digitalRead(BUTTON_INC) == LOW) {
      deviceID++;
      lastDebounceTime = millis();
    }
    if (digitalRead(BUTTON_DEC) == LOW) {
      if (deviceID > 1) deviceID--;
      lastDebounceTime = millis();
    }
  }
}

void updateOLED() {
  display.clearDisplay();
  display.setTextSize(2);
  display.setCursor(0, 0);
  display.print("ID: ");
  display.println(deviceID);

  display.setTextSize(1);
  display.setCursor(0, 20);
  display.print("T: ");
  display.print(temp);
  display.print("C H: ");
  display.print(hum);
  display.print("%");

  display.setCursor(0, 30);
  display.print("D: ");
  display.print(ultrasonic);
  display.println("cm");

  display.setCursor(0, 40);
  display.print("X:");
  display.print(event.orientation.x, 1);
  display.print(" Y:");
  display.print(event.orientation.y, 1);

  display.setCursor(0, 50);
  display.print("Z:");
  display.print(event.orientation.z, 1);

  display.display();
}

void sendToSerial() {
  String json = "{";
  json += "\"deviceID\":" + String(deviceID) + ",";
  json += "\"ultrasonic\":" + String(ultrasonic) + ",";
  json += "\"temp\":" + String(temp) + ",";
  json += "\"hum\":" + String(hum) + ",";
  json += "\"orientation\":{";
  json += "\"x\":" + String(event.orientation.x, 1) + ",";
  json += "\"y\":" + String(event.orientation.y, 1) + ",";
  json += "\"z\":" + String(event.orientation.z, 1);
  json += "}}\n";  // Newline penting untuk pembacaan di Raspi

  Serial.print(json);  // Kirim via Serial
}
