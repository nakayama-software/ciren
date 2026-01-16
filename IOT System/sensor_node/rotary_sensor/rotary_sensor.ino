#define PIN_CLK 4   // D3
#define PIN_DT  3   // D2

const char* DEVICE_ID = "rotary_sensor";

int lastCLK;
int steps = 0;

unsigned long lastSend = 0;
const unsigned long SEND_INTERVAL = 40; // ms (AMAN untuk 9600)

void setup() {
  Serial.begin(9600);
  Serial1.begin(9600);

  pinMode(PIN_CLK, INPUT_PULLUP);
  pinMode(PIN_DT, INPUT_PULLUP);

  lastCLK = digitalRead(PIN_CLK);

  Serial.println("KY-040 RP2040 READY");
}

void loop() {
  int clk = digitalRead(PIN_CLK);

  if (clk != lastCLK) {
    if (digitalRead(PIN_DT) != clk) {
      steps++;
    } else {
      steps--;
    }
  }

  lastCLK = clk;

  if (millis() - lastSend >= SEND_INTERVAL) {
    lastSend = millis();

    if (steps >= 0) {
      Serial1.print("ID=");
      Serial1.print(DEVICE_ID);
      Serial1.print(";VAL=CW,");
      Serial1.println(steps);
    } else {
      Serial1.print("ID=");
      Serial1.print(DEVICE_ID);
      Serial1.print(";VAL=CCW,");
      Serial1.println(steps);
    }

    Serial.print("Steps: ");
    Serial.println(steps);
  }
}
