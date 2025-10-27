// XIAO SAMD21: TX=D6, RX=D7 (Serial1)
const char* DEVICE_ID = "seedG";  // ubah per unit atau rakit dari UID

void setup() {
  Serial.begin(115200);
  // Tunggu USB max 1 detik saja; kalau tidak ada, lanjutkan headless
  unsigned long t0 = millis();
  while (!Serial && (millis() - t0 < 1000)) {}

  Serial1.begin(9600);  // UART ke ESP32
  delay(50);
}

void loop() {
  static uint32_t c = 0;
  Serial1.print("ID=");
  Serial1.print(DEVICE_ID);
  Serial1.print(";VAL=");
  Serial1.println(c++);
  delay(500);
}
