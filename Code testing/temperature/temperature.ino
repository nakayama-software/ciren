// ===== Seeeduino SAMD21 (I2C Slave) — Dummy "jenis-sensor-nilai" =====
#include <Wire.h>

// SAMD21 unique ID (4 x 32-bit)
#define UID0 0x0080A00C
#define UID1 0x0080A040
#define UID2 0x0080A044
#define UID3 0x0080A048

// === KONFIGURASI SENSOR (ganti sesuai node) ===
const char* SENSOR_NAME = "temperature"; // contoh: "ultrasonic", "temperature", "humidity", dsb.
// Batas nilai dummy (contoh ultrasonic dalam cm)
const int   SENSOR_MIN  = 10;
const int   SENSOR_MAX  = 40;
// ==============================================

volatile uint8_t  myAddr = 0x12;

// Buffer kirim (<=32 byte untuk aman di I2C)
volatile char     txBuf[32];
volatile uint8_t  txLen = 0;

uint16_t seq = 0;

// --- util hash UID --> alamat unik 0x08..0x77 ---
static uint32_t mix32(uint32_t x){
  x ^= x >> 16; x *= 0x7feb352d; x ^= x >> 15; x *= 0x846ca68b; x ^= x >> 16;
  return x;
}
uint8_t addrFromUID(){
  uint32_t u0 = *(volatile uint32_t*)UID0;
  uint32_t u1 = *(volatile uint32_t*)UID1;
  uint32_t u2 = *(volatile uint32_t*)UID2;
  uint32_t u3 = *(volatile uint32_t*)UID3;
  uint32_t h  = mix32(u0 ^ u1 ^ u2 ^ u3);
  uint8_t a   = 0x08 + (h % (0x78 - 0x08));  // 0x08..0x77
  if (a == 0x3C) a = 0x3D;                   // hindari bentrok OLED umum
  return a;
}

// --- bikin payload dummy: "jenis-nilai\n" ---
void makePayload() {
  // nilai integer dummy dalam rentang yang ditetapkan
  int value = SENSOR_MIN + (random(SENSOR_MAX - SENSOR_MIN + 1));

  // contoh payload: ultrasonic-123\n
  char buf[32];
  // pastikan total <=31 byte (tanpa terminator null), tambahkan newline biar master gampang parse
  int n = snprintf(buf, sizeof(buf), "%s-%d\n", SENSOR_NAME, value);
  if (n < 0) n = 0;
  if (n > 31) n = 31;

  // salin atomik ke buffer TX
  noInterrupts();
  memcpy((void*)txBuf, buf, n);
  txLen = (uint8_t)n;
  interrupts();
}

// --- handler I2C: kirim buffer yang sudah jadi ---
void onRequestHandler() {
  noInterrupts();
  uint8_t n = txLen;
  char local[32]; memcpy(local, (const void*)txBuf, n);
  interrupts();
  Wire.write((uint8_t*)local, n);
}

void setup() {
  // seed RNG: gabungan UID + waktu
  uint32_t u0 = *(volatile uint32_t*)UID0;
  uint32_t u1 = *(volatile uint32_t*)UID1;
  randomSeed(u0 ^ u1 ^ micros());

  myAddr = addrFromUID();
  Wire.begin(myAddr);           // start sebagai slave
  Wire.onRequest(onRequestHandler);

  makePayload(); // siapkan payload awal
}

void loop() {
  // Perbarui dummy tiap 150–300 ms (bebas); onRequest hanya kirim buffer terbaru
  static unsigned long last = 0;
  if (millis() - last > 200) {
    last = millis();
    makePayload();
  }
}
