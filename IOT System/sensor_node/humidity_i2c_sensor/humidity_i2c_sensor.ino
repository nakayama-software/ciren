#include <Wire.h>
#include <DHT20.h>

const char* DEVICE_ID = "humidity";
DHT20 dht20;

void setup()
{
  Serial.begin(115200);
  Serial1.begin(9600);

  unsigned long start = millis();
  while (!Serial && millis() - start < 2000) { }

  Wire.begin();
  Wire.setClock(100000);   

  if (!dht20.begin())
  {
    Serial.println("DHT20 not detected");
    Serial1.println("ID=humidity_i2c;VAL=init_err");
    while (1);
  }

  Serial.println("DHT20 initialized");
  Serial1.println("ID=humidity_i2c;VAL=boot_ok");
}

void loop()
{
  int status = dht20.read();
  delay(20); 

  if (status == DHT20_OK)
  {
    float t = dht20.getTemperature();
    float h = dht20.getHumidity();

    Serial.print("Temperature: ");
    Serial.print(t);
    Serial.print(" °C | Humidity: ");
    Serial.print(h);
    Serial.println(" %");

    Serial1.print("ID=");
    Serial1.print(DEVICE_ID);
    Serial1.print(";VAL=");
    Serial1.print(t);
    Serial1.print(",");
    Serial1.println(h);
  }
  else
  {
    Serial.print("DHT20 read error: ");
    Serial.println(status);

    Serial1.print("ID=");
    Serial1.print(DEVICE_ID);
    Serial1.print(";VAL=err(");
    Serial1.print(status);
    Serial1.println(")");
  }

  delay(2000); 
}
