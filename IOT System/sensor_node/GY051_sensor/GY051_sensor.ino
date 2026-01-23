#include <Wire.h>
#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>

const char *DEVICE_ID = "Imu";

Adafruit_MPU6050 mpu;

void setup()
{
  Serial.begin(115200);
  Serial1.begin(9600);
  Wire.begin();

  if (!mpu.begin(0x68))
  { // try 0x69 if you changed AD0
    Serial.println("MPU6050 not found. Check wiring/power/I2C address.");
    while (1)
      delay(10);
  }

  // Optional: set ranges/filters
  mpu.setAccelerometerRange(MPU6050_RANGE_8_G);
  mpu.setGyroRange(MPU6050_RANGE_500_DEG);
  mpu.setFilterBandwidth(MPU6050_BAND_21_HZ);

  Serial.println("MPU6050 ready!");
  
  delay(50);
}

void loop()
{
  sensors_event_t a, g, temp;
  mpu.getEvent(&a, &g, &temp);

  Serial.print("Accel (m/s^2): ");
  Serial.print(a.acceleration.x);
  Serial.print(", ");
  Serial.print(a.acceleration.y);
  Serial.print(", ");
  Serial.print(a.acceleration.z);

  Serial.print(" | Gyro (rad/s): ");
  Serial.print(g.gyro.x);
  Serial.print(", ");
  Serial.print(g.gyro.y);
  Serial.print(", ");
  Serial.print(g.gyro.z);

  Serial.print(" | Temp (C): ");
  Serial.println(temp.temperature);

  Serial1.print("ID=");
  Serial1.print(DEVICE_ID);
  Serial1.print(";VAL=");
  Serial1.print(a.acceleration.x);
  Serial1.print(", ");
  Serial1.print(a.acceleration.y);
  Serial1.print(", ");
  Serial1.print(a.acceleration.z);
  Serial1.print("| ");
  Serial1.print(g.gyro.x);
  Serial1.print(", ");
  Serial1.print(g.gyro.y);
  Serial1.print(", ");
  Serial1.print(g.gyro.z);
  Serial1.print("| ");
  Serial1.println(temp.temperature);

  delay(50);
}
