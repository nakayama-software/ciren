// Seeeduino XIAO SAMD21 voltage reader for up to ~120V DC
// Divider: Rtop = 360k, Rbottom = 10k

const int ADC_PIN = A0;

const float VREF = 3.3;        // ADC reference assumed ~3.3V (VDD)
const int ADC_MAX = 4095;      // 12-bit

const float RTOP = 300000.0;
const float RBOT = 6800.0;

// Optional calibration factor (tune with a multimeter)
float CAL = 1.000;

float readVoltage()
{
  // average a bunch of samples
  long sum = 0;
  const int N = 100;
  for (int i = 0; i < N; i++) {
    sum += analogRead(ADC_PIN);
  }
  float adc = (float)sum / N;

  float vout = (adc * VREF) / ADC_MAX;
  float vin  = vout * (RTOP + RBOT) / RBOT;

  return vin * CAL;
}

void setup() {
  Serial.begin(115200);
  analogReadResolution(12);
}

void loop() {
  float vin = readVoltage();
  Serial.print("Vin = ");
  Serial.print(vin, 2);
  Serial.println(" V");
  delay(50);
}
