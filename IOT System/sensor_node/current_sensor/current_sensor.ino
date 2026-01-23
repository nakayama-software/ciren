#include <ACS712-driver.h>
const char* DEVICE_ID = "current";

ACS712 sensor(A0, 3.3, 4095);

void setup() {
  Serial.begin(115200);
  Serial1.begin(9600);
  analogReadResolution(12);

  sensor.setSensitivity(0.066);  // 66 mV/A for ACS712-30A

  Serial.println("=== Calibration ===");
  Serial.println("Remove all load from ACS712!");
  Serial.println("Wait for 5 seconds...");
  delay(5000);

  int zeroPoint = sensor.calibrate();
  Serial.print("Zero Point: ");
  Serial.println(zeroPoint);

  Serial.println("=== Calibration finish ===");
  Serial.println("Connect load.");
  delay(2000);
}

void loop() {
  float current = sensor.readCurrentDC();

  Serial.print("Current: ");
  Serial.print(abs(current), 2);  // Gunakan abs() untuk nilai absolut
  Serial.println(" A");

  Serial1.print("ID=");
  Serial1.print(DEVICE_ID);
  Serial1.print(";VAL=");
  Serial1.println(abs(current), 2);  // Gunakan abs() untuk nilai absolut

  delay(500);
}