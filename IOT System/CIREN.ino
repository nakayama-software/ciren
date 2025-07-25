#include <Wire.h>
#include <Adafruit_Sensor.h>
#include <Adafruit_BNO055.h>
#include <utility/imumaths.h>
#include <DHT.h>
#include <NewPing.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

// OLED display width and height, in pixels
#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64

// OLED reset pin (or -1 if sharing Arduino reset)
#define OLED_RESET -1
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);

// Ultrasonic Sensor Pins
#define TRIG_PIN 32
#define ECHO_PIN 33
#define MAX_DISTANCE 50

// DHT11 Pin
#define DHT_PIN 26
#define DHTTYPE DHT11
DHT dht(DHT_PIN, DHTTYPE);

// Button Pins
#define BUTTON_INC 12
#define BUTTON_DEC 14

// Global Variables
uint8_t deviceID = 1;
uint8_t ultrasonic = 0;
int8_t temp = 0;
uint8_t hum = 0;

// BNO055 Sample Rate
#define BNO055_SAMPLERATE_DELAY_MS (100)

// BNO055 Setup
Adafruit_BNO055 bno = Adafruit_BNO055(55, 0x28, &Wire);

// Ultrasonic sensor
NewPing sonar(TRIG_PIN, ECHO_PIN, MAX_DISTANCE);

// Make the orientation event global so OLED can access
sensors_event_t event;

void setup(void)
{
  Serial.begin(115200);
  while (!Serial) delay(10); // Wait for serial port

  dht.begin();

  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);

  pinMode(BUTTON_INC, INPUT_PULLUP);
  pinMode(BUTTON_DEC, INPUT_PULLUP);

  if (!bno.begin())
  {
    Serial.println("Ooops, no BNO055 detected... Check your wiring or I2C ADDR!");
    while (1);
  }

  delay(1000);
  bno.setExtCrystalUse(true);

  if (!display.begin(SSD1306_SWITCHCAPVCC, 0x3C))
  {
    Serial.println(F("SSD1306 allocation failed"));
    for (;;);
  }

  display.clearDisplay();
  display.setTextSize(2);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0,0);
  display.println("Device ID");
  display.display();
}

void loop(void)
{
  // Read sensors
  readUltrasonic();
  readDHT();

  // Get orientation
  bno.getEvent(&event);

  // Output to Serial
  Serial.print(deviceID);
  Serial.print("|");
  Serial.print(ultrasonic);
  Serial.print("|");
  Serial.print(temp);
  Serial.print("|");
  Serial.print(hum);
  Serial.print("|");
  Serial.print(event.orientation.x, 2);
  Serial.print("|");
  Serial.print(event.orientation.y, 2);
  Serial.print("|");
  Serial.println(event.orientation.z, 2);

  // Handle button presses
  updateDeviceID();

  // Update OLED display
  updateOLED();

  delay(BNO055_SAMPLERATE_DELAY_MS);
}

void readUltrasonic() {
  delay(50);
  ultrasonic = sonar.ping_cm();
}

void readDHT() {
  float t = dht.readTemperature();
  float h = dht.readHumidity();

  if (isnan(t)) {
    temp = 0;
  } else {
    temp = (int8_t)t;
  }

  if (isnan(h)) {
    hum = 0;
  } else {
    hum = (uint8_t)h;
  }
}

void updateDeviceID() {
  static uint32_t lastDebounceTime = 0;
  const uint32_t debounceDelay = 200; // milliseconds

  if (millis() - lastDebounceTime > debounceDelay) {
    if (digitalRead(BUTTON_INC) == LOW) {
      deviceID++;
      lastDebounceTime = millis();
    }
    if (digitalRead(BUTTON_DEC) == LOW) {
      if (deviceID > 1) {
        deviceID--;
      }
      lastDebounceTime = millis();
    }
  }
}

void updateOLED() {
  display.clearDisplay();

  display.setTextSize(2);
  display.setCursor(0,0);
  display.print("ID: ");
  display.println(deviceID);

  display.setTextSize(1);
  display.setCursor(0, 20);
  display.print("T:");
  display.print(temp);
  display.print("C H:");
  display.print(hum);
  display.print("%");

  display.setCursor(0, 30);
  display.print("D:");
  display.print(ultrasonic);
  display.println("cm");

  display.setCursor(0, 40);
  display.print("X:");
  display.print(event.orientation.x,1);
  display.print(" Y:");
  display.print(event.orientation.y,1);

  display.setCursor(0, 50);
  display.print("Z:");
  display.print(event.orientation.z,1);

  display.display();
}
