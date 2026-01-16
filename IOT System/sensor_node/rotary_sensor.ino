const char* DEVICE_ID = "rotary_sensor";

#define PIN_CLK 3   // D3
#define PIN_DT  2   // D2

int lastCLK;

void setup() {
  Serial.begin(115200);
  while (!Serial) delay(10);

  pinMode(PIN_CLK, INPUT_PULLUP);
  pinMode(PIN_DT, INPUT_PULLUP);

  lastCLK = digitalRead(PIN_CLK);

  Serial.println("KY-040 RP2040 READY");
}

void loop() {
  int clk = digitalRead(PIN_CLK);

  if (clk != lastCLK) {
    if (digitalRead(PIN_DT) != clk) {
      Serial.println("CW");
    } else {
      Serial.println("CCW");
    }
  }

  lastCLK = clk;
}
