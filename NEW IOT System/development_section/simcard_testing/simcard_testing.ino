#define TINY_GSM_MODEM_SIM7600

#ifndef TINY_GSM_RX_BUFFER
#define TINY_GSM_RX_BUFFER 1024
#endif

#include <TinyGsmClient.h>
#include <HardwareSerial.h>

#define MODEM_RX_PIN 16
#define MODEM_TX_PIN 17
#define MODEM_BAUD   115200

HardwareSerial SerialAT(2);

TinyGsm modem(SerialAT);
TinyGsmClient simClient(modem);

// APN settings
const char APN[]       = "ppsim.jp";
const char GPRS_USER[] = "pp@sim";
const char GPRS_PASS[] = "jpn";

// server test
const char server[] = "example.com";
const int port = 80;

void setup() {

  Serial.begin(115200);
  delay(3000);

  Serial.println("Starting SIM7600 test...");

  SerialAT.begin(MODEM_BAUD, SERIAL_8N1, MODEM_RX_PIN, MODEM_TX_PIN);

  delay(3000);

  Serial.println("Restart modem...");
  modem.restart();

  // cek SIM
  if (modem.getSimStatus() != SIM_READY) {
    Serial.println("SIM card not ready");
    return;
  }

  Serial.println("SIM OK");

  // cek signal
  Serial.print("Signal strength: ");
  Serial.println(modem.getSignalQuality());

  // connect network
  Serial.println("Waiting network...");
  if (!modem.waitForNetwork()) {
    Serial.println("Network failed");
    return;
  }

  Serial.println("Network connected");

  // connect internet
  Serial.println("Connecting GPRS...");
  if (!modem.gprsConnect(APN, GPRS_USER, GPRS_PASS)) {
    Serial.println("GPRS failed");
    return;
  }

  Serial.println("GPRS connected");

  // enable GPS
  Serial.println("Enabling GPS...");
  modem.enableGPS();
}

void loop() {

  Serial.println("================================");

  // ======================
  // TEST INTERNET
  // ======================

  Serial.println("Testing internet...");

  if (!simClient.connect(server, port)) {
    Serial.println("Connection failed");
  } 
  else {

    Serial.println("Connected to server");

    simClient.println("GET / HTTP/1.0");
    simClient.println("Host: example.com");
    simClient.println("Connection: close");
    simClient.println();

    while (simClient.connected() || simClient.available()) {

      if (simClient.available()) {
        char c = simClient.read();
        Serial.print(c);
      }

    }

    simClient.stop();

    Serial.println();
    Serial.println("Internet test finished");
  }

  // ======================
  // TEST GPS
  // ======================

  float lat, lon, speed, alt;
  int vsat, usat;
  float accuracy;
  int year, month, day, hour, min, sec;

  Serial.println("Reading GPS...");

  if (modem.getGPS(&lat, &lon, &speed, &alt,
                   &vsat, &usat, &accuracy,
                   &year, &month, &day,
                   &hour, &min, &sec)) {

    Serial.println("GPS FIX!");

    Serial.print("Latitude: ");
    Serial.println(lat, 6);

    Serial.print("Longitude: ");
    Serial.println(lon, 6);

    Serial.print("Satellites: ");
    Serial.println(vsat);

  } 
  else {

    Serial.println("Waiting GPS signal...");
  }

  delay(10000);
}