void setup() {
  Serial1.begin(9600);
}

void loop() {
  // Ganti ini dengan pembacaan sensor ultrasonic sebenarnya
  int distance = 111111; // Simulasi jarak cm

  Serial.print("[ultrasonic]");
  Serial.println(distance);

  Serial1.print("[ultrasonic]");
  Serial1.println(distance);

  delay(1000); // Kirim setiap 1 detik
}
