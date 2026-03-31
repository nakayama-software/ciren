/**
 * CIREN Dummy Main Module — ESP-NOW Receiver
 * ─────────────────────────────────────────────────
 * Hardware : ESP32 apapun yang sudah ada
 * Role     : Terima ESP-NOW dari sensor controller,
 *            print ke Serial Monitor untuk verifikasi
 *
 * Cara pakai:
 *   1. Upload sketch ini ke ESP32
 *   2. Buka Serial Monitor — catat MAC address
 *   3. Isi MAIN_MODULE_MAC di sensor_controller.ino
 *   4. Upload sensor_controller ke ESP32-S3
 *   5. Lihat data di Serial Monitor sini
 */

#include <WiFi.h>
#include <esp_now.h>

typedef struct {
  uint8_t  ctrl_id;
  uint8_t  port_num;
  uint8_t  sensor_type;
  float    value;
  uint32_t timestamp_ms;
  uint8_t  ftype;
} __attribute__((packed)) EspNowPacket;

uint32_t total_rx = 0;

const char* stype_str(uint8_t s) {
  switch(s) {
    case 0x01: return "TEMP(C)";
    case 0x02: return "HUM(%RH)";
    case 0x03: return "AX(m/s2)";
    case 0x04: return "AY(m/s2)";
    case 0x05: return "AZ(m/s2)";
    case 0x06: return "GX(rad/s)";
    case 0x07: return "GY(rad/s)";
    case 0x08: return "GZ(rad/s)";
    default:   return "??";
  }
}

const char* ftype_str(uint8_t f) {
  switch(f) {
    case 0x01: return "DATA";
    case 0x02: return "HELLO";
    case 0x03: return "HB";
    case 0x04: return "DATA";
    case 0x05: return "HB";
    case 0xFE: return "STALE";
    case 0xFF: return "ERR";
    default:   return "??";
  }
}

void on_data_recv(const esp_now_recv_info_t* info,
                  const uint8_t* data, int len) {
  if (len != sizeof(EspNowPacket)) {
    Serial.printf("[WARN] size mismatch got=%d exp=%d\n",
      len, (int)sizeof(EspNowPacket));
    return;
  }

  EspNowPacket pkt;
  memcpy(&pkt, data, sizeof(pkt));
  total_rx++;

  Serial.printf("[#%lu] ctrl=%d p=%d | [%s][%s] %.4f",
    total_rx, pkt.ctrl_id, pkt.port_num,
    ftype_str(pkt.ftype), stype_str(pkt.sensor_type),
    pkt.value);

  if (pkt.ftype == 0x02)
    Serial.printf(" ← NEW NODE");
  else if (pkt.ftype == 0xFE)
    Serial.printf(" ← STALE");
  else if (pkt.ftype == 0xFF)
    Serial.printf(" ← ERROR");

  Serial.println();
}

void setup() {
  Serial.begin(115200);
  while (!Serial && millis() < 3000);

  Serial.println("════════════════════════════════");
  Serial.println("CIREN Dummy Main Module");
  Serial.println("════════════════════════════════");

  WiFi.mode(WIFI_STA);
  WiFi.disconnect();

  Serial.print("MAC: ");
  Serial.println(WiFi.macAddress());
  Serial.println();
  Serial.println(">>> Copy MAC ke MAIN_MODULE_MAC di sensor_controller.ino <<<");
  Serial.println("────────────────────────────────");

  if (esp_now_init() != ESP_OK) {
    Serial.println("[ESPNOW] Init FAILED!");
    while(1) delay(1000);
  }

  esp_now_register_recv_cb(on_data_recv);
  Serial.println("Waiting for data...");
}

void loop() {
  static uint32_t last_stats = 0;
  if (millis() - last_stats >= 30000) {
    last_stats = millis();
    Serial.printf("[STATS] rx=%lu uptime=%lus\n",
      total_rx, millis()/1000);
  }
}
