#include <HardwareSerial.h>
#include <WiFi.h>
#include <HTTPClient.h>

#define RXD2 16
#define TXD2 17

HardwareSerial &xiaoSerial = Serial2;

// Wi-Fi credentials
const char* ssid = "Niw_3Fg";
const char* password = "niw041713f";

// API endpoint
String apiUrl = "http://192.168.103.217/Ciren/temporary/send_data.php";  // Change this to your API URL

struct SensorData {
  String type;
  String value;
};

std::vector<SensorData> ultrasonicSensors;

void setup() {
  Serial.begin(115200);
  xiaoSerial.begin(9600, SERIAL_8N1, RXD2, TXD2);

  // Connect to Wi-Fi
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(1000);
    Serial.println("Connecting to WiFi...");
  }
  Serial.println("Connected to WiFi");

  Serial.println("ESP32 siap menerima data ultrasonic...");
}

void loop() {
  static unsigned long lastPrintTime = 0;
  static const unsigned long interval = 1000; // Update tiap 1 detik

  if (xiaoSerial.available()) {
    String msg = xiaoSerial.readStringUntil('\n');
    msg.trim();

    if (msg.startsWith("[ultrasonic]")) {
      String val = msg.substring(String("[ultrasonic]").length());

      // Tambah ke list ultrasonic
      SensorData data;
      data.type = "ultrasonic";
      data.value = val;
      ultrasonicSensors.push_back(data);
    }
  }

  // Tiap 1 detik, cetak data dan kosongkan buffer
  if (millis() - lastPrintTime > interval) {
    lastPrintTime = millis();

    int total = ultrasonicSensors.size();

    if (total == 1) {
      Serial.println("ultrasonic:" + ultrasonicSensors[0].value + "cm");
      sendDataToAPI("ultrasonic", ultrasonicSensors[0].value);  // Send data to API
    } else if (total > 1) {
      // Cetak secara terbalik (yang terakhir datang jadi ultrasonic1)
      for (int i = total - 1; i >= 0; --i) {
        Serial.println("ultrasonic" + String(total - i) + ":" + ultrasonicSensors[i].value + "cm");
        sendDataToAPI("ultrasonic-" + String(total - i), ultrasonicSensors[i].value);  // Send data to API
      }
    }

    ultrasonicSensors.clear();
  }
}

// Function to send sensor data to the API
void sendDataToAPI(String sensorName, String distance) {
  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;

    http.begin(apiUrl);  // API URL
    http.addHeader("Content-Type", "application/json");

    // Prepare the JSON payload
    String payload = "{\"sensor_name\":\"" + sensorName + "\",\"distance\":\"" + distance + "\"}";

    // Send POST request
    int httpResponseCode = http.POST(payload);

    // Print response code
    if (httpResponseCode > 0) {
      String response = http.getString();
      Serial.println("Response code: " + String(httpResponseCode));
      Serial.println("Response: " + response);
    } else {
      Serial.println("Error in sending POST request");
    }

    // End the HTTP connection
    http.end();
  } else {
    Serial.println("Error: Not connected to WiFi");
  }
}
