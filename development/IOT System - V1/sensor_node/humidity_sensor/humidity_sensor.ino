#include <DHT.h>

#define DHTPIN 4
#define DHTTYPE DHT11
DHT dht(DHTPIN, DHTTYPE);

const char* DEVICE_ID = "hum_temp";

void setup() {
  Serial.begin(115200);
  Serial1.begin(9600);
  dht.begin();
  delay(50);
}

void loop() {
  float humidity = dht.readHumidity();
  float temperature = dht.readTemperature();

  if (isnan(humidity) || isnan(temperature)) {
    Serial.println("Gagal membaca dari sensor DHT!");
    delay(2000);
    return;
  }

  Serial.print("ID=");
  Serial.print(DEVICE_ID);
  Serial.print(";VAL=");
  Serial.print(temperature);
  Serial.print(",");
  Serial.println(humidity);

  Serial1.print("ID=");
  Serial1.print(DEVICE_ID);
  Serial1.print(";VAL=");
  Serial1.print(temperature);
  Serial1.print(",");
  Serial1.println(humidity);

  delay(2000);
}

