// SW-420
const char* DEVICE_ID = "vibration";

int vibrationPin = 0;  // Pin connected to SW-420 DO

void setup() {
  Serial.begin(115200);
  Serial1.begin(9600);
  pinMode(vibrationPin, INPUT);
  delay(50);
}

void loop() {
  int vibrationState = digitalRead(vibrationPin);  

  if (vibrationState == HIGH) {
    Serial.println("No vibration.");
    Serial1.print("ID="); 
    Serial1.print(DEVICE_ID);
    Serial1.println(";VAL=False");
  } else {
    Serial.println("Vibration detected!");
    Serial1.print("ID=");
    Serial1.print(DEVICE_ID);
    Serial1.println(";VAL=True");
  }

  delay(50);  
}
