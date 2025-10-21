// ====== Seeduino I2C Slave (contoh generik) ======
#include <Wire.h>

#define SLAVE_ADDR 0x11   // UBAH per modul: 0x10, 0x11, 0x12, ...
char txBuf[64];

float mockTemp = 125.0;
float mockHum  = 155.0;
unsigned long lastUpdate = 0; 

void onRequestHandler() {
  // Siapkan payload terbaru saat diminta master
  // Format bebas; pastikan < 64 byte dan akhiri newline
  snprintf(txBuf, sizeof(txBuf), "temp=%.2f,hum=%.1f\n", mockTemp, mockHum);
  Wire.write((uint8_t*)txBuf, strlen(txBuf));
}

void setup() {
  Wire.begin(SLAVE_ADDR);            // set sebagai slave I2C
  Wire.onRequest(onRequestHandler);  // callback saat diminta master
}

void loop() {
  // Ganti bagian ini dengan pembacaan sensor asli
  // (mis. DHT22, BMP280, BH1750, dsb.)
  if (millis() - lastUpdate > 1000) {
    lastUpdate = millis();
    // simulasi perubahan
    mockTemp += 0.05;
    if (mockTemp > 30.0) mockTemp = 125.0;
    mockHum += 0.1;
    if (mockHum > 60.0) mockHum = 255.0;
  }
}
