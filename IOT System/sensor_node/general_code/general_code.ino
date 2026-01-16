<<<<<<< HEAD

const char* DEVICE_ID = "us";  


const uint8_t PIN_TRIG = 4;
const uint8_t PIN_ECHO = 10;
=======
// XIAO SAMD21: TX=D6, RX=D7 (Serial1)
// const char* SensorType = "Ultrasonic";  // ubah per unit atau rakit dari UID
const char* SensorType = "Temperature";  // ubah per unit atau rakit dari UID
>>>>>>> 953068afb92ea3b82e975e5bb24adca037db264e

void setup() {
  Serial.begin(115200);

  Serial1.begin(9600);  

  pinMode(PIN_TRIG, OUTPUT);
  pinMode(PIN_ECHO, INPUT);
  digitalWrite(PIN_TRIG, LOW);

  delay(50);
}


float readUltrasonicCM() {

  digitalWrite(PIN_TRIG, LOW);
  delayMicroseconds(2);
  digitalWrite(PIN_TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(PIN_TRIG, LOW);

  long duration = pulseIn(PIN_ECHO, HIGH, 25000);

  if (duration == 0) {
    return -1.0; 
  }

  float distanceCm = (duration * 0.0343) / 2.0;
  return distanceCm;
}

void loop() {
  static uint32_t c = 0;
<<<<<<< HEAD

  float jarak = readUltrasonicCM();

  Serial.print("Count: ");
  Serial.print(c);
  Serial.print(" | Jarak: ");
  Serial.print(jarak);
  Serial.println(" cm");

  Serial1.print("ID=");
  Serial1.print(DEVICE_ID);
  Serial1.print(";VAL=");
  if (jarak < 0) {
    Serial1.println("NA");
  } else {
    Serial1.println(jarak, 2); // 2 angka desimal
  }

=======
  Serial1.print(SensorType);
  Serial1.print("-");
  Serial1.print("");
  Serial1.println(c++);
>>>>>>> 953068afb92ea3b82e975e5bb24adca037db264e
  delay(500);
}
