// ===== ESP32 Master (robust) =====
#include <Wire.h>
#include "esp_log.h"

#define I2C_SDA    21
#define I2C_SCL    22
#define I2C_CLOCK  100000

#define MAX_NODES  16
#define MISS_MAX   3         // consecutive failures before marking offline
#define RESCAN_MS  5000      // rescan every 5s

uint8_t  nodes[MAX_NODES];
uint8_t  misses[MAX_NODES];
bool     online[MAX_NODES];
int      nodeCount = 0;

uint32_t lastScan = 0;

bool sameAddr(uint8_t a, uint8_t b) { return a == b; }

int indexOf(uint8_t addr) {
  for (int i = 0; i < nodeCount; i++) if (nodes[i] == addr) return i;
  return -1;
}

void addOrMarkOnline(uint8_t addr) {
  int idx = indexOf(addr);
  if (idx < 0 && nodeCount < MAX_NODES) {
    nodes[nodeCount]  = addr;
    misses[nodeCount] = 0;
    online[nodeCount] = true;
    nodeCount++;
    Serial.printf("[I2C] + Online 0x%02X\n", addr);
  } else if (idx >= 0) {
    if (!online[idx]) Serial.printf("[I2C] ^ Back Online 0x%02X\n", addr);
    online[idx] = true;
    misses[idx] = 0;
  }
}

void markOffline(int idx) {
  if (idx < 0 || idx >= nodeCount) return;
  if (online[idx]) Serial.printf("[I2C] - Offline 0x%02X\n", nodes[idx]);
  online[idx] = false;
}

bool ping(uint8_t addr) {
  Wire.beginTransmission(addr);
  uint8_t err = Wire.endTransmission(true); // true=send STOP
  return (err == 0);
}

// read up to maxLen bytes, return actual count
int readInto(uint8_t addr, uint8_t *buf, size_t maxLen) {
  int n = Wire.requestFrom((int)addr, (int)maxLen, (int)true);
  for (int i = 0; i < n; i++) buf[i] = Wire.read();
  return n; // 0 if NACK or no data
}

void scanBusOnce() {
  for (uint8_t a = 0x08; a <= 0x77; a++) {
    // Supaya tidak berisik, kita batasi scan ke alamat yang umum dipakai oleh node kita.
    // Jika ingin full-scan, biarkan seperti ini.
    if (ping(a)) addOrMarkOnline(a);
  }
}

void periodicRescan() {
  if (millis() - lastScan < RESCAN_MS) return;
  lastScan = millis();

  // Cari device baru / yang balik online
  scanBusOnce();

  // Hapus entri yang sudah lama offline? (opsional)
  // Di sini kita biarkan tetap tercatat (online=false) agar log rapi.
}

void i2cBusRecover() {
  // Recovery jika bus terkunci (jarang, tapi aman disiapkan)
  Wire.end(); // matikan driver dulu
  pinMode(I2C_SCL, INPUT_PULLUP);
  pinMode(I2C_SDA, INPUT_PULLUP);
  delay(2);

  // Jika SDA low, clock SCL sampai SDA release (maks 16 pulsa)
  if (digitalRead(I2C_SDA) == LOW) {
    pinMode(I2C_SCL, OUTPUT);
    for (int i = 0; i < 16 && digitalRead(I2C_SDA) == LOW; i++) {
      digitalWrite(I2C_SCL, HIGH); delayMicroseconds(5);
      digitalWrite(I2C_SCL, LOW);  delayMicroseconds(5);
    }
    // STOP condition: SDA naik saat SCL high
    digitalWrite(I2C_SCL, HIGH); delayMicroseconds(5);
    pinMode(I2C_SDA, OUTPUT);
    digitalWrite(I2C_SDA, LOW);  delayMicroseconds(5);
    digitalWrite(I2C_SDA, HIGH); delayMicroseconds(5);
  }

  // Re-init I2C
  Wire.begin(I2C_SDA, I2C_SCL, I2C_CLOCK);
}

void setup() {
  Serial.begin(115200);
  delay(300);

  // (Opsional) Kurangi kebisingan log error I2C dari ESP-IDF
  esp_log_level_set("i2c",        ESP_LOG_WARN);
  esp_log_level_set("i2c.master", ESP_LOG_WARN);

  Wire.begin(I2C_SDA, I2C_SCL, I2C_CLOCK);
  Wire.setTimeOut(20); // cepat gagal kalau ada masalah

  Serial.println("[I2C] Initial scan...");
  scanBusOnce();
}

void loop() {
  periodicRescan();

  for (int i = 0; i < nodeCount; i++) {
    if (!online[i]) continue;

    uint8_t addr = nodes[i];

    // 1) Presence check singkat
    if (!ping(addr)) {
      if (++misses[i] >= MISS_MAX) markOffline(i);
      continue;
    }

    // 2) Safe read (maks 32B)
    uint8_t buf[32];
    int n = readInto(addr, buf, sizeof(buf));
    if (n <= 0) {
      if (++misses[i] >= MISS_MAX) markOffline(i);
      continue;
    }

    // 3) Sukses baca: reset miss counter, print hanya data valid
    misses[i] = 0;

    // Pastikan printable: kita ubah ke String berdasarkan n byte yang diterima
    String s; s.reserve(n);
    for (int k = 0; k < n; k++) {
      char c = (char)buf[k];
      // Filter karakter non-printable (opsional)
      if (c >= 32 && c <= 126) s += c;
    }
    if (s.length()) {
      Serial.printf("0x%02X -> %s\n", addr, s.c_str());
    } else {
      // kalau payload biner/non-ascii, cetak hex ringkas
      Serial.printf("0x%02X -> [%d bytes]\n", addr, n);
    }
  }

  // (Opsional) Recovery jika bus terasa ‘stuck’
  // Bisa dideteksi via timeout besar & tak ada device online sama sekali
  // Contoh sederhana:
  static uint32_t lastOk = millis();
  bool anyOnline = false;
  for (int i = 0; i < nodeCount; i++) if (online[i]) { anyOnline = true; break; }
  if (anyOnline) lastOk = millis();
  if (!anyOnline && (millis() - lastOk > 3000)) {
    Serial.println("[I2C] Bus recover...");
    i2cBusRecover();
    lastOk = millis();
  }

  delay(200); // jeda kecil
}
