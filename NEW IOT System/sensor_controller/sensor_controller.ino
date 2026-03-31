/**
 * CIREN Sensor Controller — Full Version
 * ─────────────────────────────────────────────────
 * Hardware  : ESP32 WROOM-32D
 * Display   : OLED SSD1306 128x64 (I2C)
 * Buttons   : BUTTON_NEXT (GPIO12), BUTTON_INC (GPIO14)
 * EEPROM    : simpan MAC main module + Sender ID
 *
 * ── Button behavior ──────────────────────────────
 * Saat boot (MAC belum ada):
 *   NEXT          → geser cursor ke karakter berikutnya
 *   INC           → increment hex char / increment Sender ID
 *   NEXT + INC    → konfirmasi & simpan MAC
 *
 * Saat running (MAC sudah ada):
 *   NEXT (singkat) → toggle PAGE_MAIN / PAGE_NODESTATUS
 *   INC (tahan >1s) → increment Sender ID, simpan EEPROM
 *   NEXT + INC saat boot → factory reset (MAC + ID)
 *   NEXT tahan saat boot  → reset MAC saja
 *
 * ── OLED pages ───────────────────────────────────
 * PAGE_MAIN:
 *   - MAC address main module
 *   - Sender ID
 *   - Jumlah node online (x/8)
 *
 * PAGE_NODESTATUS:
 *   - Status tiap port P1-P8 (On/Off)
 *
 * ── Frame protocol ───────────────────────────────
 * Sama dengan ciren_frame.h — binary 12/13 bytes
 *
 * ── Pin mapping ──────────────────────────────────
 * Port 1: UART1 RX=GPIO16
 * Port 2: UART2 RX=GPIO4
 * Port 3-8: SW Serial GPIO13,14,15,17,18,19
 *   ⚠ GPIO14 = BUTTON_INC, jadi PORT 4 (SW) tidak bisa
 *   dipakai bersamaan dengan button. Untuk 8 port penuh,
 *   ganti pin SW serial port 4 ke GPIO2 atau GPIO5.
 *
 * Library:
 *   EspSoftwareSerial by Dirk Kaar
 *   Adafruit SSD1306 + Adafruit GFX
 *
 * ─────────────────────────────────────────────────
 */

#define DEBUG

#include <HardwareSerial.h>
#include <SoftwareSerial.h>
#include <WiFi.h>
#include <esp_now.h>
#include <EEPROM.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <esp_wifi.h>

typedef struct {
  uint8_t type;
  uint8_t channel;
} __attribute__((packed)) HelloAck;

uint8_t active_channel  = 0;
bool    channel_synced  = false;

uint8_t  scan_channel      = 0;
uint32_t last_scan_switch  = 0;
#define  CHANNEL_SCAN_INTERVAL 300

// ─── Fail-streak re-sync ──────────────────────────
int espnow_fail_streak = 0;
#define MAX_FAIL_STREAK 5

// ─── UART instances ───────────────────────────────
HardwareSerial U2(2);  // Port 1
HardwareSerial U1(1);  // Port 2
SoftwareSerial U3, U4, U5, U6, U7, U8;

// ─── Pin RX mapping ───────────────────────────────
const int RX_P1 = 16;
const int RX_P2 = 4;
const int RX_P3 = 13;
const int RX_P4 = 2;
const int RX_P5 = 33;
const int RX_P6 = 34;
const int RX_P7 = 35;
const int RX_P8 = 26;

// ─── Config ───────────────────────────────────────
#define CTRL_ID_DEFAULT    1
#define MAX_SENDER_ID      9
#define NODE_BAUD          115200
#define SW_BAUD            115200
#define PORT_ACTIVE        2
#define PORT_MAX           8
#define OFFLINE_TIMEOUT_MS 10000UL
#define SEND_INTERVAL_MS   200UL

// ─── EEPROM ───────────────────────────────────────
#define EEPROM_SIZE    7
#define EEPROM_ID_ADDR 6

// ─── OLED ─────────────────────────────────────────
#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
#define OLED_SDA 21
#define OLED_SCL 22
#define OLED_ADDR 0x3C

// ─── Buttons ──────────────────────────────────────
#define BUTTON_NEXT 12
#define BUTTON_INC  14

// ─── Pages ────────────────────────────────────────
#define PAGE_MAIN       0
#define PAGE_NODESTATUS 1

// ─── Frame protocol ───────────────────────────────
#define FRAME_START      0xAA
#define FRAME_END        0x55
#define FRAME_SIZE       12
#define FRAME_SIZE_TYPED 13
#define FTYPE_DATA       0x01
#define FTYPE_HELLO      0x02
#define FTYPE_HEARTBEAT  0x03
#define FTYPE_DATA_TYPED 0x04
#define FTYPE_HB_TYPED   0x05
#define FTYPE_ERROR      0xFF
#define FTYPE_STALE      0xFE
#define STYPE_TEMPERATURE 0x01
#define STYPE_HUMIDITY    0x02
#define STYPE_ACCEL_X     0x03
#define STYPE_ACCEL_Y     0x04
#define STYPE_ACCEL_Z     0x05
#define STYPE_GYRO_X      0x06
#define STYPE_GYRO_Y      0x07
#define STYPE_GYRO_Z      0x08
#define STYPE_PITCH       0x10
#define STYPE_ROLL        0x11
#define STYPE_YAW         0x12

bool is_valid_ftype(uint8_t ft) {
  return ft == FTYPE_DATA || ft == FTYPE_HELLO || ft == FTYPE_HEARTBEAT
      || ft == FTYPE_DATA_TYPED || ft == FTYPE_HB_TYPED || ft == FTYPE_ERROR;
}

uint8_t crc8(const uint8_t* data, uint8_t len) {
  uint8_t crc = 0x00;
  for (uint8_t i = 0; i < len; i++) {
    crc ^= data[i];
    for (uint8_t b = 0; b < 8; b++)
      crc = (crc & 0x80) ? (crc << 1) ^ 0x07 : (crc << 1);
  }
  return crc;
}

// ─── ESP-NOW payload ──────────────────────────────
typedef struct {
  uint8_t  ctrl_id;
  uint8_t  port_num;
  uint8_t  sensor_type;
  float    value;
  uint32_t timestamp_ms;
  uint8_t  ftype;
} __attribute__((packed)) EspNowPacket;

// ─── Port state ───────────────────────────────────
struct SensorPort {
  uint8_t  port_num;
  Stream*  stream;
  uint8_t  rx_buf[FRAME_SIZE_TYPED];
  uint8_t  rx_pos;
  uint8_t  sensor_type;
  float    last_value;
  uint32_t last_rx_ms;
  bool     active;
  bool     enabled;
};

SensorPort ports[PORT_MAX];

// ─── Global state ─────────────────────────────────
int    senderID       = CTRL_ID_DEFAULT;
bool   macValid       = false;
bool   inputConfirmed = false;
uint8_t currentMac[6];
char   macStr[13]    = "000000000000";
int    macCursor     = 0;

bool     nodeOnline[8]  = { false };
uint32_t lastSeenMs[8]  = { 0 };
int      onlineCount    = 0;
bool     statusChanged  = false;

int      displayPage = PAGE_MAIN;
uint32_t lastSendMs  = 0;

// ─── OLED ─────────────────────────────────────────
TwoWire        WireOLED = TwoWire(1);
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &WireOLED, -1);

// ─── Forward declarations ─────────────────────────
void process_frame(SensorPort& port, uint8_t* buf, uint8_t len);
void parse_byte(SensorPort& port, uint8_t b);
void init_port(int idx, Stream* stream);
void watchdog_check();
void send_to_main(uint8_t port_num, uint8_t ftype,
                  uint8_t stype, float value, uint32_t ts);
void drawMainScreen();
void drawNodeStatusPage();
void showMACEntry();
void showMessage(const char* l1, const char* l2);
void printMacFormatted(const char* raw, int cursorIdx);
char nextHexChar(char c);
void hexToBytes(char* str, uint8_t* mac);
void bytesToHex(uint8_t* mac, char* out);
void saveMAC(uint8_t* mac, int id);
void loadMAC(uint8_t* mac);
bool isValidMAC(uint8_t* mac);
void resetEEPROM();
int  loadSenderID();
void saveSenderID(int id);
void recalcOnlineCount();
void addPeer(uint8_t* mac);
void reset_peer_channel();   // ← FIX: deklarasi baru

// ─── ESP-NOW helpers ──────────────────────────────

/**
 * FIX A: Reset channel peer ke 0 saat mulai re-sync.
 * Peer dengan channel=0 mengikuti channel radio saat ini,
 * sehingga tidak terjadi "Peer channel != home channel".
 */
void reset_peer_channel() {
  if (!macValid) return;
  if (!esp_now_is_peer_exist(currentMac)) return;
  esp_now_peer_info_t peer = {};
  memcpy(peer.peer_addr, currentMac, 6);
  peer.channel = 0;   // ikuti channel radio
  peer.encrypt = false;
  esp_now_mod_peer(&peer);
#ifdef DEBUG
  Serial.println("[SYNC] peer channel reset to 0 (follow radio)");
#endif
}

void on_data_sent(const uint8_t* mac, esp_now_send_status_t status) {
  if (status != ESP_NOW_SEND_SUCCESS) {
    espnow_fail_streak++;
#ifdef DEBUG
    Serial.printf("[ESPNOW] send FAIL (streak=%d)\n", espnow_fail_streak);
#endif
    // FIX C: reset peer channel sebelum mulai scan ulang
    if (channel_synced && espnow_fail_streak >= MAX_FAIL_STREAK) {
      Serial.println("[ESPNOW] too many failures — re-syncing channel");
      channel_synced = false;
      espnow_fail_streak = 0;
      reset_peer_channel();   // ← peer ikut channel radio, bukan channel lama
    }
  } else {
    espnow_fail_streak = 0;
  }
}

void on_data_recv(const uint8_t* mac, const uint8_t* data, int len) {
  if (len != sizeof(HelloAck)) return;

  HelloAck ack;
  memcpy(&ack, data, sizeof(ack));
  if (ack.type != 0xAC) return;

  active_channel = ack.channel;
  channel_synced = true;
  espnow_fail_streak = 0;   // reset streak saat sync berhasil

  // Lock ke channel yang diterima dari main module
  esp_wifi_set_promiscuous(true);
  esp_wifi_set_channel(active_channel, WIFI_SECOND_CHAN_NONE);
  esp_wifi_set_promiscuous(false);

  scan_channel = active_channel;

  // Update peer dengan channel yang sudah dikunci
  esp_now_peer_info_t peer = {};
  memcpy(peer.peer_addr, currentMac, 6);
  peer.channel = active_channel;
  peer.encrypt = false;
  if (esp_now_is_peer_exist(currentMac)) {
    esp_now_mod_peer(&peer);
  } else {
    esp_now_add_peer(&peer);
  }

  Serial.printf("[SYNC] Locked to channel %d\n", active_channel);
  Serial.printf("[HELLO_ACK] channel=%d, peer updated\n", active_channel);
}

/**
 * FIX B: Tidak kirim data sensor saat !channel_synced.
 * Mengirim ke peer saat scan berpindah channel akan selalu gagal
 * dengan error "Peer channel != home channel".
 */
void send_to_main(uint8_t port_num, uint8_t ftype,
                  uint8_t stype, float value, uint32_t ts) {
  if (!macValid)       return;
  if (!channel_synced) return;   // ← jangan kirim saat sedang re-sync

  EspNowPacket pkt;
  pkt.ctrl_id      = senderID;
  pkt.port_num     = port_num;
  pkt.sensor_type  = stype;
  pkt.value        = value;
  pkt.timestamp_ms = ts;
  pkt.ftype        = ftype;
  esp_now_send(currentMac, (uint8_t*)&pkt, sizeof(pkt));
}

void addPeer(uint8_t* mac) {
  esp_now_peer_info_t peer = {};
  memcpy(peer.peer_addr, mac, 6);
  peer.channel = 0;   // channel=0: ikuti radio saat scan
  peer.encrypt = false;
  if (esp_now_add_peer(&peer) != ESP_OK)
    Serial.println("[ESPNOW] add peer failed");
}

// ─── Debug helpers ────────────────────────────────
#ifdef DEBUG
const char* stype_str(uint8_t s) {
  switch (s) {
    case STYPE_TEMPERATURE: return "TEMP";
    case STYPE_HUMIDITY:    return "HUM";
    case STYPE_ACCEL_X:     return "AX";
    case STYPE_ACCEL_Y:     return "AY";
    case STYPE_ACCEL_Z:     return "AZ";
    case STYPE_GYRO_X:      return "GX";
    case STYPE_GYRO_Y:      return "GY";
    case STYPE_GYRO_Z:      return "GZ";
    case STYPE_PITCH:       return "PITCH";
    case STYPE_ROLL:        return "ROLL";
    case STYPE_YAW:         return "YAW";
    default:                return "??";
  }
}
const char* ftype_str(uint8_t f) {
  switch (f) {
    case FTYPE_DATA:       return "DATA";
    case FTYPE_HELLO:      return "HELLO";
    case FTYPE_HEARTBEAT:  return "HB";
    case FTYPE_DATA_TYPED: return "DATA";
    case FTYPE_HB_TYPED:   return "HB";
    case FTYPE_ERROR:      return "ERR";
    case FTYPE_STALE:      return "STALE";
    default:               return "??";
  }
}
#endif

// ─── Frame processing ─────────────────────────────
void process_frame(SensorPort& port, uint8_t* buf, uint8_t len) {
  uint8_t ftype = buf[1];
  float   value;
  uint32_t ts;
  uint8_t stype   = 0;
  bool is_typed   = (ftype == FTYPE_DATA_TYPED || ftype == FTYPE_HB_TYPED);

  if (is_typed && len == FRAME_SIZE_TYPED) {
    stype = buf[2];
    memcpy(&value, &buf[3], 4);
    memcpy(&ts,    &buf[7], 4);
  } else if (!is_typed && len == FRAME_SIZE) {
    memcpy(&value, &buf[2], 4);
    memcpy(&ts,    &buf[6], 4);
  } else return;

  int idx = port.port_num - 1;
  lastSeenMs[idx]   = millis();
  port.last_rx_ms   = millis();

  if (ftype == FTYPE_HELLO) {
    uint8_t announced = (uint8_t)value;
    if (!port.active) {
      port.sensor_type = announced;
      port.active      = true;
    }
    if (!nodeOnline[idx]) {
      nodeOnline[idx] = true;
      statusChanged   = true;
    }
#ifdef DEBUG
    Serial.printf("[P%d] HELLO stype=0x%02X (%s)\n",
                  port.port_num, announced, stype_str(announced));
#endif
    send_to_main(port.port_num, FTYPE_HELLO, announced, (float)announced, millis());
    return;
  }

  if (!nodeOnline[idx]) {
    nodeOnline[idx] = true;
    statusChanged   = true;
  }

  if (is_typed) port.sensor_type = stype;
  else          stype            = port.sensor_type;
  port.last_value = value;

#ifdef DEBUG
  Serial.printf("[P%d][%s][%s] %.4f\n",
                port.port_num, ftype_str(ftype), stype_str(stype), value);
#endif

  send_to_main(port.port_num, ftype, stype, value, ts);
}

void parse_byte(SensorPort& port, uint8_t b) {
  if (port.rx_pos == 0) {
    if (b != FRAME_START) return;
    port.rx_buf[0] = b;
    port.rx_pos    = 1;
    return;
  }
  if (port.rx_pos == 1) {
    if (!is_valid_ftype(b) && b != 0xFF) {
      port.rx_pos = 0;
      if (b == FRAME_START) {
        port.rx_buf[0] = b;
        port.rx_pos    = 1;
      }
      return;
    }
    port.rx_buf[1] = b;
    port.rx_pos    = 2;
    return;
  }
  port.rx_buf[port.rx_pos++] = b;

  uint8_t expected = FRAME_SIZE;
  uint8_t ft = port.rx_buf[1];
  if (ft == FTYPE_DATA_TYPED || ft == FTYPE_HB_TYPED)
    expected = FRAME_SIZE_TYPED;
  if (port.rx_pos < expected) return;

  port.rx_pos = 0;
  if (port.rx_buf[expected - 1] != FRAME_END) {
#ifdef DEBUG
    Serial.printf("[P%d] bad end\n", port.port_num);
#endif
    return;
  }
  uint8_t exp_crc = crc8(&port.rx_buf[1], expected - 3);
  uint8_t act_crc = port.rx_buf[expected - 2];
  if (exp_crc != act_crc) {
#ifdef DEBUG
    Serial.printf("[P%d] CRC fail exp=0x%02X got=0x%02X\n",
                  port.port_num, exp_crc, act_crc);
#endif
    return;
  }
  process_frame(port, port.rx_buf, expected);
}

// ─── Port & node management ───────────────────────
void init_port(int idx, Stream* stream) {
  ports[idx].port_num    = idx + 1;
  ports[idx].stream      = stream;
  ports[idx].rx_pos      = 0;
  ports[idx].sensor_type = 0;
  ports[idx].last_value  = 0;
  ports[idx].last_rx_ms  = millis();
  ports[idx].active      = false;
  ports[idx].enabled     = (stream != nullptr) && (idx < PORT_ACTIVE);
}

void recalcOnlineCount() {
  int c = 0;
  for (int i = 0; i < 8; i++)
    if (nodeOnline[i]) c++;
  onlineCount = c;
}

void watchdog_check() {
  static uint32_t last_wd = 0;
  if (millis() - last_wd < 5000) return;
  last_wd = millis();

  for (int i = 0; i < PORT_ACTIVE; i++) {
    if (!nodeOnline[i]) continue;
    uint32_t idle = millis() - lastSeenMs[i];
    if (idle > OFFLINE_TIMEOUT_MS) {
      nodeOnline[i]  = false;
      statusChanged  = true;
#ifdef DEBUG
      Serial.printf("[P%d] OFFLINE (timeout %lums)\n", i + 1, idle);
#endif
      send_to_main(i + 1, FTYPE_STALE, ports[i].sensor_type, 0, millis());
    }
  }
  if (statusChanged) recalcOnlineCount();
}

// ─── EEPROM helpers ───────────────────────────────
void saveMAC(uint8_t* mac, int id) {
  for (int i = 0; i < 6; i++) EEPROM.write(i, mac[i]);
  EEPROM.write(EEPROM_ID_ADDR, id);
  EEPROM.commit();
}
void loadMAC(uint8_t* mac) {
  for (int i = 0; i < 6; i++) mac[i] = EEPROM.read(i);
}
bool isValidMAC(uint8_t* mac) {
  for (int i = 0; i < 6; i++)
    if (mac[i] != 0xFF) return true;
  return false;
}
void resetEEPROM() {
  for (int i = 0; i < EEPROM_SIZE; i++) EEPROM.write(i, 0xFF);
  EEPROM.commit();
}
int loadSenderID() {
  int id = EEPROM.read(EEPROM_ID_ADDR);
  return (id < 1 || id > MAX_SENDER_ID) ? 1 : id;
}
void saveSenderID(int id) {
  EEPROM.write(EEPROM_ID_ADDR, id);
  EEPROM.commit();
}

// ─── Button helpers ───────────────────────────────
char nextHexChar(char c) {
  if (c >= '0' && c < '9') return c + 1;
  if (c == '9')             return 'A';
  if (c >= 'A' && c < 'F') return c + 1;
  return '0';
}
void hexToBytes(char* str, uint8_t* mac) {
  for (int i = 0; i < 6; i++) {
    char b[3] = { str[i * 2], str[i * 2 + 1], '\0' };
    mac[i] = strtoul(b, NULL, 16);
  }
}
void bytesToHex(uint8_t* mac, char* out) {
  for (int i = 0; i < 6; i++) sprintf(out + i * 2, "%02X", mac[i]);
  out[12] = '\0';
}

// ─── OLED draw functions ──────────────────────────
void drawMainScreen() {
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextWrap(false);
  display.setTextColor(WHITE);

  display.setCursor(0, 0);
  display.println("MAC receiver:");
  display.setCursor(0, 12);
  for (int i = 0; i < 6; i++) {
    display.printf("%02X", currentMac[i]);
    if (i < 5) display.print(":");
  }

  display.setCursor(0, 30);
  display.print("Sender ID: ");
  display.print(senderID);

  display.setCursor(0, 48);
  display.print("Nodes: ");
  display.print(onlineCount);
  display.print("/8");

  display.display();
}

void drawNodeStatusPage() {
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextWrap(false);
  display.setTextColor(WHITE);

  display.setCursor(0, 0);
  display.println("Node Status:");

  const int leftX = 0, rightX = 64, startY = 12, rowGap = 12;
  for (int r = 0; r < 4; r++) {
    display.setCursor(leftX, startY + r * rowGap);
    display.printf("P%d: %s", r + 1, nodeOnline[r] ? "On " : "Off");
  }
  for (int r = 0; r < 4; r++) {
    display.setCursor(rightX, startY + r * rowGap);
    display.printf("P%d: %s", r + 5, nodeOnline[r + 4] ? "On " : "Off");
  }
  display.display();
}

void printMacFormatted(const char* raw, int cursorIdx) {
  char line1[16], line2[16];
  snprintf(line1, sizeof(line1), "%c%c:%c%c:%c%c",
           raw[0], raw[1], raw[2], raw[3], raw[4], raw[5]);
  snprintf(line2, sizeof(line2), "%c%c:%c%c:%c%c",
           raw[6], raw[7], raw[8], raw[9], raw[10], raw[11]);

  const int x0 = 0, y1 = 14, y2 = y1 + 14, charW = 6, charH = 8;

  display.setCursor(x0, y1);
  display.print(line1);
  display.setCursor(x0, y2);
  display.print(line2);

  if (cursorIdx >= 0 && cursorIdx < 12) {
    int nibble      = cursorIdx;
    int pairIdx     = nibble / 2;
    int nibbleInPair= nibble % 2;
    bool topRow     = (pairIdx < 3);
    int charPosInLine = (pairIdx % 3) * 3 + nibbleInPair;
    int x = x0 + charPosInLine * charW;
    int y = topRow ? y1 : y2;
    char ch = topRow ? line1[charPosInLine] : line2[charPosInLine];
    display.fillRect(x - 1, y - 1, charW, charH + 2, WHITE);
    display.setTextColor(BLACK);
    display.setCursor(x, y);
    display.write(ch);
    display.setTextColor(WHITE);
  }

  display.setCursor(0, y2 + 14);
  display.print("Sender ID: ");
  if (cursorIdx == 12) {
    int xSID = display.getCursorX();
    int ySID = y2 + 14;
    char buf[4];
    snprintf(buf, sizeof(buf), "%d", senderID);
    int px = strlen(buf) * charW;
    display.fillRect(xSID - 1, ySID - 1, px, charH + 2, WHITE);
    display.setTextColor(BLACK);
    display.print(buf);
    display.setTextColor(WHITE);
  } else {
    display.print(senderID);
  }
}

void showMACEntry() {
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(WHITE);
  display.setCursor(0, 0);
  display.println("Input MAC:");
  printMacFormatted(macStr, macCursor);
  display.setCursor(0, 56);
  display.print("NEXT=Move  INC=Edit");
  display.display();
}

void showMessage(const char* l1, const char* l2) {
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(WHITE);
  display.setCursor(0, 0);
  display.println(l1);
  display.setCursor(0, 20);
  display.println(l2);
  display.display();
}

// ─── Setup ────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(200);

  // ── UART ──
  U2.begin(NODE_BAUD, SERIAL_8N1, RX_P1, -1);
  U1.begin(NODE_BAUD, SERIAL_8N1, RX_P2, -1);

  if (PORT_ACTIVE >= 3) U3.begin(SW_BAUD, SWSERIAL_8N1, RX_P3, -1, false, 256);
  if (PORT_ACTIVE >= 4) U4.begin(SW_BAUD, SWSERIAL_8N1, RX_P4, -1, false, 256);
  if (PORT_ACTIVE >= 5) U5.begin(SW_BAUD, SWSERIAL_8N1, RX_P5, -1, false, 256);
  if (PORT_ACTIVE >= 6) U6.begin(SW_BAUD, SWSERIAL_8N1, RX_P6, -1, false, 256);
  if (PORT_ACTIVE >= 7) U7.begin(SW_BAUD, SWSERIAL_8N1, RX_P7, -1, false, 256);
  if (PORT_ACTIVE >= 8) U8.begin(SW_BAUD, SWSERIAL_8N1, RX_P8, -1, false, 256);

  init_port(0, &U2);
  init_port(1, &U1);
  init_port(2, PORT_ACTIVE >= 3 ? (Stream*)&U3 : nullptr);
  init_port(3, PORT_ACTIVE >= 4 ? (Stream*)&U4 : nullptr);
  init_port(4, PORT_ACTIVE >= 5 ? (Stream*)&U5 : nullptr);
  init_port(5, PORT_ACTIVE >= 6 ? (Stream*)&U6 : nullptr);
  init_port(6, PORT_ACTIVE >= 7 ? (Stream*)&U7 : nullptr);
  init_port(7, PORT_ACTIVE >= 8 ? (Stream*)&U8 : nullptr);

  // ── EEPROM ──
  EEPROM.begin(EEPROM_SIZE);

  // ── Buttons ──
  pinMode(BUTTON_NEXT, INPUT_PULLUP);
  pinMode(BUTTON_INC,  INPUT_PULLUP);

  // ── OLED ──
  WireOLED.begin(OLED_SDA, OLED_SCL, 400000);
  if (!display.begin(SSD1306_SWITCHCAPVCC, OLED_ADDR)) {
    Serial.println("OLED failed");
    while (1);
  }
  display.setTextSize(1);
  display.setTextWrap(false);
  display.setTextColor(WHITE);
  display.clearDisplay();

  // ── WiFi + ESP-NOW ──
  WiFi.mode(WIFI_STA);
  WiFi.disconnect();

  if (esp_now_init() != ESP_OK) {
    showMessage("ESP-NOW", "Init FAILED!");
    while (1);
  }

  esp_wifi_set_promiscuous(true);
  esp_wifi_set_channel(1, WIFI_SECOND_CHAN_NONE);
  esp_wifi_set_promiscuous(false);

  esp_now_register_send_cb(on_data_sent);
  esp_now_register_recv_cb(on_data_recv);

  // ── Boot: cek factory reset (both buttons) ──
  if (digitalRead(BUTTON_NEXT) == LOW && digitalRead(BUTTON_INC) == LOW) {
    delay(800);
    if (digitalRead(BUTTON_NEXT) == LOW && digitalRead(BUTTON_INC) == LOW) {
      resetEEPROM();
      senderID = 1;
      showMessage("Reset OK", "MAC & ID cleared");
      delay(1500);
    }
  }

  // ── Boot: cek reset MAC saja (NEXT saja) ──
  if (digitalRead(BUTTON_NEXT) == LOW && digitalRead(BUTTON_INC) == HIGH) {
    delay(800);
    if (digitalRead(BUTTON_NEXT) == LOW) {
      resetEEPROM();
      showMessage("MAC reset", "Re-enter MAC...");
      delay(1500);
    }
  }

  // ── Load MAC dari EEPROM ──
  uint8_t storedMac[6];
  loadMAC(storedMac);

  if (isValidMAC(storedMac)) {
    memcpy(currentMac, storedMac, 6);
    addPeer(currentMac);   // channel=0 dulu, update setelah sync
    senderID      = loadSenderID();
    macValid      = true;
    inputConfirmed= true;
    recalcOnlineCount();
    drawMainScreen();
    Serial.print("Loaded MAC: ");
    for (int i = 0; i < 6; i++) {
      Serial.printf("%02X", currentMac[i]);
      if (i < 5) Serial.print(":");
    }
    Serial.printf("\nSender ID: %d\n", senderID);
  } else {
    showMACEntry();
  }

  if (macValid) {
    EspNowPacket hello_pkt;
    hello_pkt.ctrl_id      = senderID;
    hello_pkt.port_num     = 0;
    hello_pkt.sensor_type  = 0;
    hello_pkt.value        = (float)senderID;
    hello_pkt.timestamp_ms = millis();
    hello_pkt.ftype        = FTYPE_HELLO;
    esp_now_send(currentMac, (uint8_t*)&hello_pkt, sizeof(hello_pkt));
    Serial.println("[HELLO] Sent to main module");
  }

  Serial.println("CIREN Sensor Controller ready.");
}

// ─── Loop ─────────────────────────────────────────
void loop() {

  static uint32_t last_hello_ms = 0;

  // ── Channel scan + HELLO saat belum sync ─────────
  if (macValid && !channel_synced) {

    if (millis() - last_scan_switch > CHANNEL_SCAN_INTERVAL) {
      last_scan_switch = millis();

      scan_channel++;
      if (scan_channel > 13) scan_channel = 1;

      esp_wifi_set_promiscuous(true);
      esp_wifi_set_channel(scan_channel, WIFI_SECOND_CHAN_NONE);
      esp_wifi_set_promiscuous(false);

      delay(10);

      Serial.printf("[SCAN] channel=%d\n", scan_channel);
    }

    if (millis() - last_hello_ms > 500) {
      last_hello_ms = millis();

      EspNowPacket hello_pkt;
      hello_pkt.ctrl_id      = senderID;
      hello_pkt.port_num     = 0;
      hello_pkt.sensor_type  = 0;
      hello_pkt.value        = (float)senderID;
      hello_pkt.timestamp_ms = millis();
      hello_pkt.ftype        = FTYPE_HELLO;
      esp_now_send(currentMac, (uint8_t*)&hello_pkt, sizeof(hello_pkt));

      Serial.println("[HELLO] Scanning...");
    }
  }

  // ── MODE: INPUT MAC ──────────────────────────────
  if (!inputConfirmed && !macValid) {
    if (digitalRead(BUTTON_NEXT) == LOW && digitalRead(BUTTON_INC) == LOW) {
      uint8_t mac[6];
      hexToBytes(macStr, mac);
      memcpy(currentMac, mac, 6);
      saveMAC(mac, senderID);
      saveSenderID(senderID);
      addPeer(mac);
      macValid      = true;
      inputConfirmed= true;
      drawMainScreen();

      EspNowPacket hello_pkt;
      hello_pkt.ctrl_id      = senderID;
      hello_pkt.port_num     = 0;
      hello_pkt.sensor_type  = 0;
      hello_pkt.value        = (float)senderID;
      hello_pkt.timestamp_ms = millis();
      hello_pkt.ftype        = FTYPE_HELLO;
      esp_now_send(currentMac, (uint8_t*)&hello_pkt, sizeof(hello_pkt));
      Serial.println("[HELLO] Sent after MAC confirmed");

      delay(800);
      return;
    }
    if (digitalRead(BUTTON_NEXT) == LOW) {
      macCursor = (macCursor + 1) % 13;
      showMACEntry();
      delay(200);
      return;
    }
    if (digitalRead(BUTTON_INC) == LOW) {
      if (macCursor < 12) {
        macStr[macCursor] = nextHexChar(macStr[macCursor]);
      } else {
        senderID = (senderID % MAX_SENDER_ID) + 1;
      }
      showMACEntry();
      delay(200);
      return;
    }
    return;
  }

  // ── MODE: RUNNING ────────────────────────────────

  // NEXT singkat → toggle halaman
  static int prevNext = HIGH;
  static uint32_t nextPressMs = 0;
  int curNext = digitalRead(BUTTON_NEXT);
  if (prevNext == HIGH && curNext == LOW) nextPressMs = millis();
  if (prevNext == LOW  && curNext == HIGH) {
    if (millis() - nextPressMs < 800) {
      displayPage = (displayPage == PAGE_MAIN) ? PAGE_NODESTATUS : PAGE_MAIN;
      (displayPage == PAGE_MAIN) ? drawMainScreen() : drawNodeStatusPage();
      delay(120);
    }
  }
  prevNext = curNext;

  // INC tahan >1s → increment Sender ID
  static uint32_t idPressStart = 0;
  if (digitalRead(BUTTON_INC) == LOW) {
    if (idPressStart == 0) idPressStart = millis();
    if (millis() - idPressStart > 1000) {
      senderID = (senderID % MAX_SENDER_ID) + 1;
      saveSenderID(senderID);
      drawMainScreen();
      delay(500);
      idPressStart = 0;
    }
  } else {
    idPressStart = 0;
  }

  // ── Baca semua port UART ──────────────────────────
  for (int i = 0; i < PORT_ACTIVE; i++) {
    if (!ports[i].enabled || !ports[i].stream) continue;
    while (ports[i].stream->available()) {
      uint8_t b = (uint8_t)ports[i].stream->read();
      parse_byte(ports[i], b);
    }
  }

  // ── Watchdog node timeout ─────────────────────────
  watchdog_check();

  // ── Update display jika ada perubahan ─────────────
  if (statusChanged) {
    recalcOnlineCount();
    (displayPage == PAGE_MAIN) ? drawMainScreen() : drawNodeStatusPage();
    statusChanged = false;
  }

  yield();
}
