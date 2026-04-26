const char* DEVICE_ID = "voltage";

const int ADC_PIN = A0;

const float VREF = 3.3;
const int ADC_MAX = 4095;

const float RTOP = 300000.0;
const float RBOT = 6800.0;

float CAL = 1.000;

float readVoltage()
{
  long sum = 0;
  const int N = 100;
  for (int i = 0; i < N; i++)
  {
    sum += analogRead(ADC_PIN);
  }
  float adc = (float)sum / N;

  float vout = (adc * VREF) / ADC_MAX;
  float vin = vout * (RTOP + RBOT) / RBOT;

  return vin * CAL;
}

void setup()
{
  Serial.begin(115200);
  Serial1.begin(9600);
  analogReadResolution(12);
  delay(50);
}

void loop()
{
  float vin = readVoltage();
  Serial.print("Vin = ");
  Serial.print(vin, 2);
  Serial.println(" V");

  Serial1.print("ID=");
  Serial1.print(DEVICE_ID);
  Serial1.print(";VAL=");
  Serial1.println(vin,2);
  delay(50);
}
