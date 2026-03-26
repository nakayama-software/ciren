/*******************************************************
 * ESP32 Gateway — Merged v1
 * Base: esp32_connection_module_4 (ESP-NOW + HTTP queue)
 * Merged: esp32_connection_module_2 (5-page OLED, button,
 *         SIM state machine, portal animation)
 *
 * Fitur:
 *   - ESP-NOW receiver dengan frame assembly (~~ separator)
 *   - 5-page OLED: Gateway / WiFi / SIM / GPS / Settings
 *   - Button GPIO 18: tekan singkat = ganti page, hold 5s = portal
 *   - SIM7600G-H: state machine + GPS polling
 *   - WiFi provisioning portal (SoftAP)
 *   - HTTP job queue: POST sensor-data + raspi-data
 *   - Backhaul: WiFi utama, SIM fallback
 *******************************************************/

#define TINY_GSM_MODEM_SIM7600
#ifndef TINY_GSM_RX_BUFFER
#define TINY_GSM_RX_BUFFER 1024
#endif

#include <WiFi.h>
#include <WiFiClient.h>
#include <WebServer.h>
#include <Preferences.h>
#include <esp_wifi.h>
#include <esp_now.h>
#include <HardwareSerial.h>
#include <TinyGsmClient.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

// =====================================================
// OLED
// =====================================================
#define OLED_ADDR   0x3C
#define OLED_W      128
#define OLED_H      64
#define OLED_RESET  -1
Adafruit_SSD1306 oled(OLED_W, OLED_H, &Wire, OLED_RESET);

// =====================================================
// BUTTON
// =====================================================
#define BTN_PIN 18

// =====================================================
// MODEM
// =====================================================
#define MODEM_RX_PIN 16
#define MODEM_TX_PIN 17
#define MODEM_BAUD   115200
HardwareSerial SerialAT(2);
TinyGsm        modem(SerialAT);
TinyGsmClient  simClient(modem);
WiFiClient     wifiClient;

// =====================================================
// NETWORK CONFIG
// =====================================================
const char APN[]         = "vmobile.jp";
const char GPRS_USER[]   = "";
const char GPRS_PASS[]   = "";
const char SERVER_HOST[] = "118.22.31.249";
const int  SERVER_PORT   = 3000;
const char SENSOR_PATH[] = "/api/sensor-data";
const char GATEWAY_PATH[]= "/api/raspi-data";
const char PORTAL_PASS[] = "setup1234";

// ── Aktifkan/nonaktifkan modul SIM+GPS ──
// Nilai default — bisa di-toggle lewat button hold di page SIM Control
// dan disimpan ke NVS agar persist setelah reboot
bool simEnabled = true;

// =====================================================
// ENUMS
// =====================================================
enum WifiState { WS_IDLE, WS_CONNECTING, WS_CONNECTED, WS_FAILED };
enum SimState  { SS_IDLE, SS_WAITING, SS_AT_CHECK, SS_NETWORK, SS_GPRS, SS_READY, SS_FAILED };
enum BtnAction { BA_NONE, BA_SHORT, BA_HOLD5 };
enum BackhaulType { BACKHAUL_NONE = 0, BACKHAUL_WIFI, BACKHAUL_CELL };

// =====================================================
// TIMING CONSTANTS
// =====================================================
const unsigned long GPS_POLL_MS           = 60000;
const unsigned long GATEWAY_POST_INTERVAL_MS = 60000;
const unsigned long HTTP_RETRY_INTERVAL_MS   = 0; // no throttle — jaringan lokal, POST secepat mungkin
const unsigned long PEER_TIMEOUT_MS          = 6000;
const unsigned long FRAME_TTL_MS            = 3000;
const unsigned long GPS_STALE_MS            = 120000;
const unsigned long WIFI_SCAN_CACHE_MS      = 15000;
const unsigned long SS_BOOT_WAIT_MS         = 8000;
const unsigned long SS_RETRY_MS             = 60000;
const unsigned long SS_SIGNAL_INT_MS        = 15000;
const unsigned long WS_TIMEOUT_MS           = 15000;
const unsigned long WS_COOLDOWN_MS          = 20000;
const unsigned long HOLD_MS                 = 5000;

// =====================================================
// OLED PAGES
// =====================================================
const int TOTAL_PAGES   = 6;
const int SETTINGS_PAGE = 4;
const int SIM_PAGE      = 5;

// =====================================================
// STRUCTS — semua dideklarasikan di sini agar tersedia
// sebelum fungsi-fungsi yang memakainya
// =====================================================

// HTTP — pending slot (latest-wins, no queue)
// Sensor data: POST langsung saat frame complete, tidak antri.
// Gateway snapshot tetap pakai slot terpisah agar tidak overwrite sensor data.
// Kalau POST sedang berlangsung dan frame baru datang → overwrite pending,
// frame lama yang di-POST tetap selesai, frame baru jadi giliran berikutnya.
int           lastStatusCode = -1;
bool          lastPostOk     = false;

// ── Non-blocking HTTP via FreeRTOS task ───────────────────────────────────
// Core 0 (loop): terima ESP-NOW, assembly frame, tulis ke slot
// Core 1 (httpTask): ambil slot, POST ke server — tidak blocking Core 0
// Latest-wins: kalau frame baru datang sebelum POST selesai → overwrite slot
// Gateway snapshot pakai slot terpisah agar tidak overwrite sensor data
struct PostSlot {
  volatile bool ready;
  char path[32];
  char body[1200];
  portMUX_TYPE mux;
};
PostSlot      sensorSlot  = {false, "", "", portMUX_INITIALIZER_UNLOCKED};
PostSlot      gatewaySlot = {false, "", "", portMUX_INITIALIZER_UNLOCKED};
TaskHandle_t  httpTaskHandle = nullptr;

int           jobCount = 0; // untuk tampilan OLED

// Sensor Frame Assembly
#define MAX_SENDER_ID 9
struct FrameAsm {
  bool inFrame = false;
  unsigned long startedAt = 0;
  String portLine[8];
  bool hasPort[8] = {false};
};
struct ParsedPortLine {
  bool valid = false, isNull = true;
  String sensorType, value;
};
FrameAsm asmBySender[MAX_SENDER_ID + 1];

// Device Tracking
#define MAX_DEVICES 50
struct DeviceEntry { uint8_t mac[6]; unsigned long lastSeen; };
DeviceEntry knownDevices[MAX_DEVICES];
int deviceCount = 0;

// ESP-NOW RX Queue
#define ESPNOW_QUEUE_SIZE    64  // burst mode: sender kirim tanpa delay, butuh buffer besar
#define ESPNOW_MAX_DATA_LEN 300
struct EspNowPacket { uint8_t mac[6]; uint16_t len; char data[ESPNOW_MAX_DATA_LEN]; };
EspNowPacket  espNowQueue[ESPNOW_QUEUE_SIZE];
volatile int  espNowQHead = 0, espNowQTail = 0, espNowQCount = 0;
portMUX_TYPE  espNowQMux = portMUX_INITIALIZER_UNLOCKED;

// =====================================================
// GATEWAY ID
// =====================================================
char    gwId[13]  = {0};
uint8_t gwMac[6]  = {0};

void initGwId() {
  esp_wifi_get_mac(WIFI_IF_STA, gwMac);
  snprintf(gwId, sizeof(gwId), "%02X%02X%02X%02X%02X%02X",
           gwMac[0], gwMac[1], gwMac[2], gwMac[3], gwMac[4], gwMac[5]);
}

String macToString(const uint8_t *mac) {
  char buf[18];
  snprintf(buf, sizeof(buf), "%02X:%02X:%02X:%02X:%02X:%02X",
           mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
  return String(buf);
}

String uptimeStr() {
  unsigned long s = millis() / 1000, m = s / 60; s %= 60;
  unsigned long h = m / 60; m %= 60;
  char buf[12];
  snprintf(buf, sizeof(buf), "%02lu:%02lu:%02lu", h, m, s);
  return String(buf);
}

// =====================================================
// NVS / WiFi CREDENTIALS
// =====================================================
Preferences prefs;
String nvsSsid = "", nvsPass = "";

bool nvsLoad() {
  prefs.begin("netcfg", true);
  nvsSsid    = prefs.getString("ssid", "");
  nvsPass    = prefs.getString("pass", "");
  simEnabled = prefs.getBool("sim_en", true); // default true
  prefs.end();
  return nvsSsid.length() > 0;
}

void nvsSetSimEnabled(bool val) {
  simEnabled = val;
  prefs.begin("netcfg", false);
  prefs.putBool("sim_en", val);
  prefs.end();
  Serial.printf("[SIM] simEnabled=%s saved to NVS\n", val ? "true" : "false");
}
void nvsSave(const String &ssid, const String &pass) {
  prefs.begin("netcfg", false);
  prefs.putString("ssid", ssid);
  prefs.putString("pass", pass);
  prefs.end();
  nvsSsid = ssid; nvsPass = pass;
}
void nvsClear() {
  prefs.begin("netcfg", false);
  prefs.clear();
  prefs.end();
  delay(200);
  nvsSsid = ""; nvsPass = "";
  Serial.println("[NVS] Credentials cleared");
}

// =====================================================
// WIFI STATE MACHINE
// =====================================================
WifiState     wsState      = WS_IDLE;
unsigned long wsStartMs    = 0, wsRetryMs = 0;
int           wsRssi       = 0;
String        wsIp         = "";
uint8_t       wifiChannel  = 1; // channel WiFi aktif — diupdate saat connect

void wifiTick() {
  if (nvsSsid.length() == 0) return;
  switch (wsState) {
    case WS_IDLE:
      if (WiFi.status() != WL_CONNECTED) {
        WiFi.begin(nvsSsid.c_str(), nvsPass.length() ? nvsPass.c_str() : nullptr);
        wsState = WS_CONNECTING; wsStartMs = millis(); wsIp = "";
        Serial.print("[WIFI] Connecting: "); Serial.println(nvsSsid);
      } else { wsState = WS_CONNECTED; wsIp = WiFi.localIP().toString(); wsRssi = WiFi.RSSI(); }
      break;
    case WS_CONNECTING:
      if (WiFi.status() == WL_CONNECTED) {
        wsState     = WS_CONNECTED;
        wsIp        = WiFi.localIP().toString();
        wsRssi      = WiFi.RSSI();
        wifiChannel = (uint8_t)WiFi.channel();
        Serial.print("[WIFI] Connected IP="); Serial.print(wsIp);
        Serial.printf(" ch=%d\n", wifiChannel);
      } else if (millis() - wsStartMs > WS_TIMEOUT_MS) {
        WiFi.disconnect(false); wsState = WS_FAILED;
        wsRetryMs = millis() + WS_COOLDOWN_MS; wsIp = "";
        Serial.println("[WIFI] Timeout");
      }
      break;
    case WS_CONNECTED:
      if (WiFi.status() == WL_CONNECTED) {
        static unsigned long lr = 0;
        if (millis() - lr > 5000) { wsRssi = WiFi.RSSI(); lr = millis(); }
      } else {
        if (wifiClient.connected()) wifiClient.stop();
        wsState = WS_FAILED; wsRetryMs = millis() + 3000; wsIp = "";
        Serial.println("[WIFI] Disconnected");
      }
      break;
    case WS_FAILED:
      if (millis() >= wsRetryMs) { wsState = WS_IDLE; }
      break;
  }
}

bool wifiReady() { return wsState == WS_CONNECTED && WiFi.status() == WL_CONNECTED; }

const char *wifiStateStr() {
  switch (wsState) {
    case WS_IDLE:       return "Idle";
    case WS_CONNECTING: return "Connecting...";
    case WS_CONNECTED:  return "Connected";
    case WS_FAILED:     return "Retrying...";
    default:            return "Unknown";
  }
}

// =====================================================
// AT HELPER
// =====================================================
void flushAt() { while (SerialAT.available()) SerialAT.read(); }

bool atSend(const char *cmd, String &resp, uint32_t tms = 2000) {
  flushAt();
  SerialAT.print(cmd); SerialAT.print("\r\n");
  resp = "";
  unsigned long t = millis();
  while (millis() - t < tms) {
    while (SerialAT.available()) resp += (char)SerialAT.read();
    if (resp.indexOf("OK\r\n") >= 0 || resp.indexOf("ERROR\r\n") >= 0) break;
    taskYIELD();
  }
  return resp.indexOf("OK") >= 0;
}

// =====================================================
// GPS
// =====================================================
struct GpsData {
  bool hasFix = false;
  double lat = 0.0, lon = 0.0;
  float alt = 0.0f, speed = 0.0f;
  String isoTs = "";
  unsigned long fixMs = 0;
};

GpsData       gps;
unsigned long lastGpsPollMs = 0;

bool ddmmToDecimal(const String &raw, double &out) {
  if (raw.length() < 4) return false;
  double v = raw.toDouble();
  if (v == 0.0) return false;
  int deg = (int)(v / 100);
  out = deg + (v - deg * 100.0) / 60.0;
  return true;
}

bool parseGpsInfo(const String &resp) {
  int pos = resp.indexOf("+CGPSINFO:");
  if (pos < 0) return false;
  int eol = resp.indexOf('\n', pos);
  String line = (eol >= 0) ? resp.substring(pos, eol) : resp.substring(pos);
  line.trim();
  int colon = line.indexOf(':');
  if (colon < 0) return false;
  String payload = line.substring(colon + 1); payload.trim();
  String parts[10]; int cnt = 0, st = 0;
  for (int i = 0; i <= (int)payload.length() && cnt < 10; i++)
    if (i == (int)payload.length() || payload[i] == ',')
      { parts[cnt++] = payload.substring(st, i); st = i + 1; }
  if (cnt < 8) return false;
  if (parts[0].length() == 0 || parts[2].length() == 0) { gps.hasFix = false; return false; }
  double lat = 0, lon = 0;
  if (!ddmmToDecimal(parts[0], lat)) return false;
  if (!ddmmToDecimal(parts[2], lon)) return false;
  String ns = parts[1]; ns.trim();
  String ew = parts[3]; ew.trim();
  if (ns.equalsIgnoreCase("S")) lat = -lat;
  if (ew.equalsIgnoreCase("W")) lon = -lon;
  gps.hasFix = true; gps.lat = lat; gps.lon = lon;
  gps.alt = parts[6].toFloat(); gps.speed = parts[7].toFloat();
  gps.fixMs = millis();
  String ddmmyy = parts[4]; ddmmyy.trim();
  String hhmmss = parts[5]; hhmmss.trim();
  if (ddmmyy.length() == 6 && hhmmss.length() >= 6)
    gps.isoTs = "20" + ddmmyy.substring(4,6) + "-" + ddmmyy.substring(2,4) + "-" + ddmmyy.substring(0,2)
              + "T" + hhmmss.substring(0,2) + ":" + hhmmss.substring(2,4) + ":" + hhmmss.substring(4,6) + "Z";
  else gps.isoTs = "";
  Serial.printf("[GPS] Fix: lat=%.6f lon=%.6f alt=%.1f\n", gps.lat, gps.lon, gps.alt);
  return true;
}

bool hasRecentGpsFix() { return gps.hasFix && (millis() - gps.fixMs <= GPS_STALE_MS); }

// =====================================================
// SIM STATE MACHINE
// =====================================================
SimState      ssState    = SS_IDLE;
unsigned long ssTimerMs  = 0;
bool          simModemOk = false;
bool          simGprs    = false;
int           simSignal  = 0;
String        simOperator= "";

void simTick() {
  switch (ssState) {
    case SS_IDLE:
      ssTimerMs = millis(); ssState = SS_WAITING;
      Serial.printf("[SIM] Boot wait %lus...\n", SS_BOOT_WAIT_MS / 1000);
      break;
    case SS_WAITING:
      if (millis() - ssTimerMs >= SS_BOOT_WAIT_MS) {
        if (wsState == WS_CONNECTING) { ssTimerMs = millis() - SS_BOOT_WAIT_MS + 3000; return; }
        ssState = SS_AT_CHECK;
      }
      break;
    case SS_AT_CHECK: {
      if (wsState == WS_CONNECTING) return;
      String r; bool ok = false;
      for (int i = 0; i < 3; i++) { if (atSend("AT", r, 2000)) { ok = true; break; } delay(300); }
      if (!ok) { Serial.println("[SIM] No response"); ssTimerMs = millis(); ssState = SS_FAILED; break; }
      atSend("ATE0", r, 1500);
      atSend("AT+CGPS=1", r, 3000);
      simModemOk = true;
      simOperator = modem.getOperator();
      Serial.print("[SIM] Modem OK. Op="); Serial.println(simOperator);
      ssState = SS_NETWORK;
      break;
    }
    case SS_NETWORK:
      if (modem.isNetworkConnected()) { Serial.println("[SIM] Network OK"); ssState = SS_GPRS; }
      break;
    case SS_GPRS:
      if (!modem.isGprsConnected()) {
        Serial.print("[SIM] GPRS APN="); Serial.println(APN);
        if (!modem.gprsConnect(APN, GPRS_USER, GPRS_PASS))
          { Serial.println("[SIM] GPRS failed"); ssTimerMs = millis(); ssState = SS_FAILED; break; }
      }
      simGprs = true;
      Serial.println("[SIM] GPRS connected");
      ssState = SS_READY;
      break;
    case SS_READY:
      if (!modem.isGprsConnected()) {
        simGprs = false; Serial.println("[SIM] GPRS dropped"); ssState = SS_GPRS; break;
      }
      { static unsigned long ls = 0;
        if (millis() - ls > SS_SIGNAL_INT_MS) { simSignal = modem.getSignalQuality(); ls = millis(); } }
      break;
    case SS_FAILED:
      if (millis() - ssTimerMs >= SS_RETRY_MS) {
        simModemOk = false; simGprs = false; ssState = SS_AT_CHECK;
        Serial.println("[SIM] Retrying...");
      }
      break;
  }
}

bool simIsReady() { return ssState == SS_READY; }

const char *simStateStr() {
  switch (ssState) {
    case SS_IDLE:     return "Idle";
    case SS_WAITING:  return "Boot wait...";
    case SS_AT_CHECK: return "AT check...";
    case SS_NETWORK:  return "Registering...";
    case SS_GPRS:     return "GPRS connect...";
    case SS_READY:    return "Ready";
    case SS_FAILED:   return "Failed (retry)";
    default:          return "Unknown";
  }
}

void gpsPoll() {
  if (millis() - lastGpsPollMs < GPS_POLL_MS) return;
  lastGpsPollMs = millis();
  if (!simModemOk) return;
  if (simClient.connected()) return;
  Serial.println("[GPS] Polling...");
  String resp;
  if (atSend("AT+CGPSINFO", resp, 3000))
    { if (!parseGpsInfo(resp)) Serial.println("[GPS] No fix"); }
  else Serial.println("[GPS] AT failed");
}

// =====================================================
// BACKHAUL
// =====================================================
BackhaulType bestBackhaul() {
  if (wifiReady()) return BACKHAUL_WIFI;
  if (simIsReady()) return BACKHAUL_CELL;
  return BACKHAUL_NONE;
}

Client *pickClient(BackhaulType bh) {
  if (bh == BACKHAUL_WIFI) return &wifiClient;
  if (bh == BACKHAUL_CELL) return &simClient;
  return nullptr;
}

// =====================================================
// HTTP JOB QUEUE
// =====================================================


// ── Tulis ke sensor slot (Core 0, non-blocking) ─────────────────────────
// Latest-wins: overwrite kalau slot masih penuh
void setPendingSensor(const String &path, const String &body) {
  if (body.length() >= 1200) return;
  portENTER_CRITICAL(&sensorSlot.mux);
  strncpy(sensorSlot.path, path.c_str(), sizeof(sensorSlot.path)-1);
  strncpy(sensorSlot.body, body.c_str(), sizeof(sensorSlot.body)-1);
  sensorSlot.ready = true;
  portEXIT_CRITICAL(&sensorSlot.mux);
}

void setPendingGateway(const String &path, const String &body) {
  if (body.length() >= 1200) return;
  portENTER_CRITICAL(&gatewaySlot.mux);
  strncpy(gatewaySlot.path, path.c_str(), sizeof(gatewaySlot.path)-1);
  strncpy(gatewaySlot.body, body.c_str(), sizeof(gatewaySlot.body)-1);
  gatewaySlot.ready = true;
  portEXIT_CRITICAL(&gatewaySlot.mux);
}

bool enqueueJob(const String &path, const String &body) {
  setPendingGateway(path, body);
  return true;
}

// ── HTTP Task (Core 1) ────────────────────────────────────────────────────
// Jalan terus di background, ambil slot kalau ada, POST ke server
// Core 0 tidak pernah blocking untuk HTTP
void httpTask(void *param) {
  for (;;) {
    // Cek sensor slot dulu (prioritas lebih tinggi)
    bool hasSensor = false;
    char spath[32], sbody[1200];
    portENTER_CRITICAL(&sensorSlot.mux);
    if (sensorSlot.ready) {
      strncpy(spath, sensorSlot.path, sizeof(spath));
      strncpy(sbody, sensorSlot.body, sizeof(sbody));
      sensorSlot.ready = false;
      hasSensor = true;
    }
    portEXIT_CRITICAL(&sensorSlot.mux);

    if (hasSensor) {
      // Skip POST kalau tidak ada backhaul — langsung drop, tidak blocking
      if (bestBackhaul() != BACKHAUL_NONE) {
        String body(sbody);
        int sc = -1; String resp;
        bool ok = httpPost(spath, body, sc, resp);
        lastStatusCode = sc; lastPostOk = ok;
      }
      // Data loss kalau no backhaul — intentional, prioritas kecepatan
    }

    // Cek gateway slot
    bool hasGw = false;
    char gpath[32], gbody[1200];
    portENTER_CRITICAL(&gatewaySlot.mux);
    if (gatewaySlot.ready) {
      strncpy(gpath, gatewaySlot.path, sizeof(gpath));
      strncpy(gbody, gatewaySlot.body, sizeof(gbody));
      gatewaySlot.ready = false;
      hasGw = true;
    }
    portEXIT_CRITICAL(&gatewaySlot.mux);

    if (hasGw) {
      String body(gbody);
      int sc = -1; String resp;
      httpPost(gpath, body, sc, resp);
    }

    vTaskDelay(1 / portTICK_PERIOD_MS); // yield minimal
  }
}

// postNow tidak dipakai lagi — kept untuk kompatibilitas
bool postNow(const char *path, const String &body) {
  setPendingSensor(String(path), body);
  return true;
}

bool httpPost(const char *path, const String &body, int &statusCode, String &respSnippet) {
  BackhaulType bh = bestBackhaul();
  Client *c = pickClient(bh);
  if (!c) { statusCode = -1; return false; } // no backhaul — silent drop

  // Persistent keep-alive: flush sisa response lama, reconnect hanya jika putus
  // Connection: close menyebabkan TCP handshake baru (~500ms) di setiap POST
  if (c->connected()) {
    while (c->available()) c->read(); // flush stale data
  } else {
    c->stop();
    Serial.printf("[HTTP] connect %s:%d via %s\n", SERVER_HOST, SERVER_PORT,
                  bh == BACKHAUL_WIFI ? "WiFi" : "SIM");
    if (!c->connect(SERVER_HOST, SERVER_PORT)) {
      Serial.println("[HTTP] connect failed"); statusCode = -1; return false;
    }
  }

  c->printf("POST %s HTTP/1.1\r\n", path);
  c->printf("Host: %s:%d\r\n", SERVER_HOST, SERVER_PORT);
  c->print("Content-Type: application/json\r\n");
  c->printf("Content-Length: %d\r\n", (int)body.length());
  // keep-alive: koneksi dipertahankan, tidak perlu TCP handshake tiap POST
  c->print("Connection: keep-alive\r\n\r\n");
  c->print(body);

  statusCode = -1; respSnippet = "";
  bool gotSt = false, hdrDone = false;
  String line;
  // Timeout total 3 detik, idle timeout 200ms (lokal harusnya <10ms)
  unsigned long dl = millis(), to = millis() + 3000;

  while (millis() < to) {
    while (c->available()) {
      char ch = c->read(); dl = millis();
      if (!hdrDone) {
        line += ch;
        if (line.endsWith("\r\n")) {
          String one = line; one.trim();
          if (!gotSt && one.startsWith("HTTP/")) {
            int sp = one.indexOf(' ');
            if (sp >= 0) { statusCode = one.substring(sp+1, sp+4).toInt(); gotSt = true; }
          }
          if (one.length() == 0) hdrDone = true;
          line = "";
        }
      } else { if (respSnippet.length() < 200) respSnippet += ch; }
    }
    if (gotSt && hdrDone && !c->available()) break; // response complete
    if (bh != BACKHAUL_WIFI && !c->connected() && !c->available()) break;
    if (gotSt && millis() - dl > 500) break; // idle timeout 500ms (server public butuh lebih lama)
    taskYIELD(); // yield ke scheduler, tidak delay
  }
  // Tutup koneksi hanya untuk SIM (tidak support keep-alive dengan baik)
  if (bh == BACKHAUL_CELL) c->stop();
  Serial.printf("[HTTP] status=%d\n", statusCode);
  return gotSt && statusCode >= 200 && statusCode < 300;
}

// processPending: tidak dipakai lagi — httpTask di Core 1 yang handle POST
// Dipanggil di loop() tapi tidak melakukan apa-apa
void processPending() {
  // HTTP ditangani oleh httpTask (Core 1) — Core 0 tidak blocking untuk POST
}

// =====================================================
// SENSOR PAYLOAD
// =====================================================


String jsonEscape(const String &s) {
  String out; out.reserve(s.length() + 8);
  for (size_t i = 0; i < s.length(); i++) {
    char c = s[i];
    switch (c) {
      case '"':  out += "\\\""; break;
      case '\\': out += "\\\\"; break;
      case '\n': out += "\\n";  break;
      case '\r': out += "\\r";  break;
      default:   out += c;      break;
    }
  }
  return out;
}

bool isSameMac(const uint8_t *a, const uint8_t *b) { return memcmp(a, b, 6) == 0; }

int extractIntField(const String &s, const char *key) {
  String k = "\"" + String(key) + "\":";
  int p = s.indexOf(k); if (p < 0) return -1;
  p += k.length();
  int q = s.indexOf(",", p); if (q < 0) q = s.indexOf("}", p); if (q < 0) return -1;
  String v = s.substring(p, q); v.trim(); return v.toInt();
}

bool extractPortLineFromPayload(const String &s, int port, String &outLine) {
  String tag = "p" + String(port) + "-";
  int a = s.indexOf(tag); if (a < 0) return false;
  // Support ~~ (format baru, aman untuk IMU yang pakai | dalam nilai)
  // dan \n (format lama) sebagai separator
  int bTilde = s.indexOf("~~", a), bN = s.indexOf("\n", a);
  int b;
  if (bTilde < 0 && bN < 0) b = s.length();
  else if (bTilde < 0)      b = bN;
  else if (bN < 0)          b = bTilde;
  else                      b = min(bTilde, bN);
  outLine = s.substring(a, b); outLine.trim();
  while (outLine.length() > 0 &&
         (outLine[outLine.length()-1] == '"' || outLine[outLine.length()-1] == '}'))
    outLine = outLine.substring(0, outLine.length()-1);
  return outLine.length() > 0;
}

void resetFrame(FrameAsm &fa) {
  fa.inFrame = false; fa.startedAt = 0;
  for (int i = 0; i < 8; i++) { fa.portLine[i] = ""; fa.hasPort[i] = false; }
}

bool frameExpired(const FrameAsm &fa) {
  return fa.inFrame && (millis() - fa.startedAt > FRAME_TTL_MS);
}

ParsedPortLine parsePortLine(const String &line, int expectedPort) {
  ParsedPortLine out;
  String prefix = "p" + String(expectedPort) + "-";
  if (!line.startsWith(prefix)) return out;
  String rest = line.substring(prefix.length()); rest.trim();
  if (rest.length() == 0) return out;
  if (rest == "null-null") { out.valid = true; out.isNull = true; return out; }
  if (rest.startsWith("ID=")) {
    int sep = rest.indexOf(";VAL=");
    if (sep > 0) {
      out.valid = true; out.isNull = false;
      out.sensorType = rest.substring(3, sep);
      out.value = rest.substring(sep + 5);
      out.sensorType.trim(); out.value.trim();
      return out;
    }
  }
  int idx = rest.indexOf('-');
  if (idx >= 0) {
    out.valid = true; out.isNull = false;
    out.sensorType = rest.substring(0, idx);
    out.value = rest.substring(idx + 1);
    out.sensorType.trim(); out.value.trim();
  }
  return out;
}

String buildSensorPayloadJson(int senderId, const FrameAsm &fa) {
  String json; json.reserve(1200);
  json += "{\"sensor_controller_id\":\""; json += String(senderId);
  json += "\",\"raspberry_serial_id\":\""; json += gwId;
  json += "\",\"datas\":[";
  for (int p = 1; p <= 8; p++) {
    ParsedPortLine pp;
    if (fa.hasPort[p-1]) pp = parsePortLine(fa.portLine[p-1], p);
    if (p > 1) json += ",";
    json += "{\"port_number\":"; json += String(p); json += ",\"sensor_type\":";
    if (!pp.valid || pp.isNull) json += "null,\"value\":null}";
    else {
      json += "\""; json += jsonEscape(pp.sensorType);
      json += "\",\"value\":\""; json += jsonEscape(pp.value); json += "\"}";
    }
  }
  json += "]}";
  return json;
}

String buildGatewayPayloadJson() {
  String json; json.reserve(320);
  json += "{\"raspberry_serial_id\":\""; json += gwId; json += "\",\"datas\":[";
  json += "{\"temperature\":null}";
  if (hasRecentGpsFix()) {
    json += ",{\"altitude\":"; json += String(gps.alt, 1);
    json += ",\"latitude\":";  json += String(gps.lat, 6);
    json += ",\"longitude\":"; json += String(gps.lon, 6);
    if (gps.isoTs.length() > 0) { json += ",\"timestamp_gps\":\""; json += gps.isoTs; json += "\""; }
    json += "}";
  }
  json += "]}";
  return json;
}

unsigned long lastGatewaySnapshotMs = 0; // diinit di setup() setelah boot

void enqueueGatewaySnapshotIfDue() {
  if (millis() - lastGatewaySnapshotMs < GATEWAY_POST_INTERVAL_MS) return;
  lastGatewaySnapshotMs = millis();
  setPendingGateway(GATEWAY_PATH, buildGatewayPayloadJson());
  Serial.println("[QUEUE] Gateway snapshot enqueued");
}

// =====================================================
// DEVICE TRACKING
// =====================================================


int findDeviceIndex(const uint8_t *mac) {
  for (int i = 0; i < deviceCount; i++) if (isSameMac(knownDevices[i].mac, mac)) return i;
  return -1;
}
void addOrUpdateDevice(const uint8_t *mac) {
  if (isSameMac(mac, gwMac)) return;
  int idx = findDeviceIndex(mac);
  if (idx >= 0) { knownDevices[idx].lastSeen = millis(); return; }
  if (deviceCount < MAX_DEVICES) {
    memcpy(knownDevices[deviceCount].mac, mac, 6);
    knownDevices[deviceCount].lastSeen = millis(); deviceCount++;
  }
}
void removeDevice(int i) {
  for (int j = i; j < deviceCount - 1; j++) knownDevices[j] = knownDevices[j+1]; deviceCount--;
}
void removeTimedOutPeers() {
  unsigned long now = millis();
  for (int i = 0; i < deviceCount;)
    if (now - knownDevices[i].lastSeen > PEER_TIMEOUT_MS) removeDevice(i); else i++;
}
int countActivePeers() {
  int c = 0;
  for (int i = 0; i < deviceCount; i++) if (!isSameMac(knownDevices[i].mac, gwMac)) c++;
  return c;
}

// =====================================================
// ESP-NOW RX QUEUE
// =====================================================


void enqueueEspNowPacket(const uint8_t *mac, const uint8_t *data, int len) {
  if (len <= 0) return;
  portENTER_CRITICAL_ISR(&espNowQMux);
  if (espNowQCount < ESPNOW_QUEUE_SIZE) {
    int sl = espNowQTail;
    memcpy(espNowQueue[sl].mac, mac, 6);
    int cp = min(len, ESPNOW_MAX_DATA_LEN - 1);
    memcpy(espNowQueue[sl].data, data, cp);
    espNowQueue[sl].data[cp] = '\0'; espNowQueue[sl].len = cp;
    espNowQTail = (espNowQTail + 1) % ESPNOW_QUEUE_SIZE; espNowQCount++;
  }
  portEXIT_CRITICAL_ISR(&espNowQMux);
}

bool popEspNowPacket(EspNowPacket &out) {
  bool ok = false;
  portENTER_CRITICAL(&espNowQMux);
  if (espNowQCount > 0) {
    out = espNowQueue[espNowQHead];
    espNowQHead = (espNowQHead + 1) % ESPNOW_QUEUE_SIZE; espNowQCount--; ok = true;
  }
  portEXIT_CRITICAL(&espNowQMux);
  return ok;
}

#if defined(ESP_ARDUINO_VERSION_MAJOR) && (ESP_ARDUINO_VERSION_MAJOR >= 3)
void onEspNowRecv(const esp_now_recv_info_t *info, const uint8_t *data, int len)
{ enqueueEspNowPacket(info->src_addr, data, len); }
#else
void onEspNowRecv(const uint8_t *mac_addr, const uint8_t *data, int len)
{ enqueueEspNowPacket(mac_addr, data, len); }
#endif

void processOneSensorMessage(const uint8_t *mac_addr, const String &s) {
  addOrUpdateDevice(mac_addr);
  if (!(s.startsWith("{") && s.endsWith("}"))) return;

  int senderId = extractIntField(s, "sender_id");
  int port     = extractIntField(s, "port");
  if (senderId < 1 || senderId > MAX_SENDER_ID || port < 1 || port > 8) return;

  FrameAsm &fa = asmBySender[senderId];

  bool hasStart = (s.indexOf("@sensor_data_start") >= 0);
  bool hasEnd   = (s.indexOf("@sensor_data_end")   >= 0);

  // Reset frame saat start atau port=1
  if (hasStart || port == 1) {
    fa.inFrame = true; fa.startedAt = millis();
    for (int i = 0; i < 8; i++) { fa.portLine[i] = ""; fa.hasPort[i] = false; }
  }
  // Auto-start kalau belum ada frame (port=1 ter-drop)
  if (!fa.inFrame) {
    fa.inFrame = true; fa.startedAt = millis();
    for (int i = 0; i < 8; i++) { fa.portLine[i] = ""; fa.hasPort[i] = false; }
  }

  // Simpan port line — tidak peduli cycle berapa
  String line;
  if (extractPortLineFromPayload(s, port, line)) {
    fa.portLine[port-1] = line; fa.hasPort[port-1] = true;
  }

  // POST saat end atau port=8
  if (hasEnd || port == 8) {
    setPendingSensor(SENSOR_PATH, buildSensorPayloadJson(senderId, fa));
    resetFrame(fa);
  }
}

// Kirim HELLO_ACK ke sender — konfirmasi handshake berhasil
void sendHelloAck(const uint8_t *destMac, const String &s) {
  int sidPos = s.indexOf("\"sender_id\":");
  int sid = sidPos >= 0 ? s.substring(sidPos + 12).toInt() : 0;

  // Tambah peer ESP-NOW kalau belum ada
  if (!esp_now_is_peer_exist(destMac)) {
    esp_now_peer_info_t peer = {};
    memcpy(peer.peer_addr, destMac, 6);
    peer.channel = 0; peer.encrypt = false;
    esp_now_add_peer(&peer);
  }

  // Gunakan wifiChannel yang disimpan saat WiFi connect
  // Ini lebih reliable dari WiFi.channel() atau esp_wifi_get_channel()
  // yang bisa return 0 tergantung timing
  uint8_t ch = wifiChannel;
  if (ch == 0) {
    // Fallback: coba baca langsung
    wifi_second_chan_t sec = WIFI_SECOND_CHAN_NONE;
    esp_wifi_get_channel(&ch, &sec);
    if (ch == 0) ch = 1;
  }

  char ack[96];
  snprintf(ack, sizeof(ack),
           "{\"type\":\"HELLO_ACK\",\"channel\":%d,\"gw_id\":\"%s\",\"ready\":1}",
           ch, gwId);
  Serial.printf("[HS] HELLO_ACK sid=%d ch=%d len=%d payload=%s\n", sid, ch, (int)strlen(ack), ack);
  esp_err_t r = esp_now_send(destMac, (uint8_t*)ack, strlen(ack));
  Serial.printf("[HS] send r=%d\n", (int)r);
}

void processEspNowInbox() {
  EspNowPacket pkt;
  while (popEspNowPacket(pkt)) {
    String s(pkt.data); s.trim();
    Serial.print("[ESPNOW] from "); Serial.print(macToString(pkt.mac));
    Serial.print(" -> "); Serial.println(s);

    // Handle HELLO handshake terpisah — tidak punya field port/cycle
    if (s.indexOf("\"type\":\"HELLO\"") >= 0) {
      sendHelloAck(pkt.mac, s);
      addOrUpdateDevice(pkt.mac);
      continue;
    }

    processOneSensorMessage(pkt.mac, s);
  }
}

void setupEspNow() {
  if (esp_now_init() != ESP_OK) {
    Serial.println("[ESPNOW] Init FAILED");
    oled.clearDisplay(); oled.setCursor(0,0); oled.println("ESP-NOW failed"); oled.display();
    while (1) delay(1000);
  }
  esp_now_register_recv_cb(onEspNowRecv);
  Serial.println("[ESPNOW] Init OK");
}

// =====================================================
// PORTAL
// =====================================================
WebServer     portalServer(80);
bool          portalActive  = false;
bool          rebootPending = false;
unsigned long rebootAtMs    = 0;
String        portalSsid    = "";
String        cachedScan    = "";
unsigned long lastScanMs    = 0;

String htmlEsc(const String &s) {
  String o; o.reserve(s.length() + 8);
  for (size_t i = 0; i < s.length(); i++) {
    char c = s[i];
    if (c == '&') o += "&amp;"; else if (c == '<') o += "&lt;";
    else if (c == '>') o += "&gt;"; else if (c == '"') o += "&quot;"; else o += c;
  }
  return o;
}

String buildScanHtml() {
  int n = WiFi.scanNetworks();
  String h = "<div style='margin:8px 0'><b>Jaringan tersedia</b><br>";
  if (n <= 0) h += "Tidak ada.<br>";
  else for (int i = 0; i < n; i++) {
    h += "<label style='display:block;padding:5px 0'><input type='radio' name='ssid' value='"
         + htmlEsc(WiFi.SSID(i)) + "'> ";
    h += htmlEsc(WiFi.SSID(i)) + " (RSSI " + String(WiFi.RSSI(i)) + ")</label>";
  }
  WiFi.scanDelete(); h += "</div>"; return h;
}

String buildPortalPage(const String &msg = "", bool ok = false) {
  String h;
  h += "<!doctype html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>Gateway WiFi Setup</title></head>";
  h += "<body style='font-family:sans-serif;max-width:600px;margin:20px auto;padding:0 12px'>";
  h += "<h2>Gateway WiFi Setup</h2><p><b>ID:</b> " + htmlEsc(String(gwId)) + "</p>";
  if (msg.length()) {
    h += "<div style='padding:10px;border-radius:6px;margin:10px 0;background:";
    h += ok ? "#e7f7e7;color:#145214" : "#fdeaea;color:#7a1010";
    h += "'>" + htmlEsc(msg) + "</div>";
  }
  h += "<form method='POST' action='/save'>" + cachedScan;
  h += "<p><a href='/refresh' style='font-size:13px'>Refresh daftar</a></p>";
  h += "<div style='margin:8px 0'><b>SSID manual</b><br><input name='ssid_m' placeholder='Ketik SSID' style='width:100%;padding:7px'></div>";
  h += "<div style='margin:8px 0'><b>Password</b><br><input type='password' name='pass' placeholder='WiFi Password' style='width:100%;padding:7px'></div>";
  h += "<button type='submit' style='padding:10px 18px'>Save &amp; Reboot</button></form>";
  h += "<form method='POST' action='/clear' style='margin-top:16px'><button style='padding:8px 14px;background:#eee'>Remove Credential</button></form>";
  if (nvsSsid.length()) h += "<p style='color:#666;margin-top:12px'><b>Saved:</b> " + htmlEsc(nvsSsid) + "</p>";
  h += "</body></html>"; return h;
}

void portalHandleRoot()    { portalServer.send(200, "text/html", buildPortalPage()); }
void portalHandleRefresh() { cachedScan = buildScanHtml(); portalServer.sendHeader("Location", "/"); portalServer.send(302, "text/plain", ""); }
void portalHandleSave() {
  String ssid = portalServer.arg("ssid"), ssidM = portalServer.arg("ssid_m"), pass = portalServer.arg("pass");
  ssid.trim(); ssidM.trim(); pass.trim();
  if (ssid.length() == 0) ssid = ssidM;
  if (ssid.length() == 0) { portalServer.send(400, "text/html", buildPortalPage("SSID kosong.", false)); return; }
  nvsSave(ssid, pass);
  portalServer.send(200, "text/html", buildPortalPage("Saved! Reboot in 2s...", true));
  rebootPending = true; rebootAtMs = millis() + 2000;
}
void portalHandleClear() {
  nvsClear();
  portalServer.send(200, "text/html", buildPortalPage("Credential Removed. Reboot...", true));
  rebootPending = true; rebootAtMs = millis() + 2000;
}

void portalLoadingAnimation() {
  auto frame = [](int pct, const char *m1, const char *m2) {
    oled.clearDisplay(); oled.setTextSize(1); oled.setTextColor(WHITE);
    oled.setCursor(0,8); oled.println(m1); oled.setCursor(0,22); oled.println(m2);
    oled.drawRect(0,38,128,12,WHITE); int f=(pct*126)/100; if(f>0) oled.fillRect(1,39,f,10,WHITE);
    oled.display();
  };
  for (int p=0; p<=40; p+=4) { frame(p,"WiFi Setup","Preparing..."); delay(40); }
  for (int p=40; p<=75; p+=3) { frame(p,"WiFi Setup","Scanning..."); delay(30); }
}

void portalReadyAnimation(const String &ap) {
  for (int p=75; p<=100; p+=5) {
    oled.clearDisplay(); oled.setTextSize(1); oled.setTextColor(WHITE);
    oled.setCursor(0,8); oled.println("WiFi Setup Ready!");
    oled.drawRect(0,22,128,12,WHITE); int f=(p*126)/100; if(f>0) oled.fillRect(1,23,f,10,WHITE);
    oled.setCursor(0,40); oled.print("AP: "); oled.println(ap);
    oled.setCursor(0,52); oled.println("192.168.4.1"); oled.display(); delay(40);
  }
  delay(800);
}

void portalStart() {
  portalLoadingAnimation();
  wsState = WS_IDLE;
  String suffix = String(gwId);
  portalSsid = "GW-" + suffix.substring(suffix.length() - 4);
  WiFi.disconnect(); delay(50);
  WiFi.mode(WIFI_AP_STA);
  WiFi.softAPConfig(IPAddress(192,168,4,1), IPAddress(192,168,4,1), IPAddress(255,255,255,0));
  WiFi.softAP(portalSsid.c_str(), PORTAL_PASS, 1, 0, 4);
  cachedScan = buildScanHtml();
  portalServer.on("/", HTTP_GET, portalHandleRoot);
  portalServer.on("/save", HTTP_POST, portalHandleSave);
  portalServer.on("/clear", HTTP_POST, portalHandleClear);
  portalServer.on("/refresh", HTTP_GET, portalHandleRefresh);
  portalServer.onNotFound(portalHandleRoot);
  portalServer.begin();
  portalReadyAnimation(portalSsid);
  portalActive = true;
  Serial.print("[PORTAL] AP: "); Serial.print(portalSsid);
  Serial.print(" Pass: "); Serial.println(PORTAL_PASS);
}

void portalTick() {
  if (portalActive) portalServer.handleClient();
  if (rebootPending && millis() >= rebootAtMs) ESP.restart();
}

// =====================================================
// BUTTON
// =====================================================
bool          btnWasDown = false;
unsigned long btnPressMs = 0;

BtnAction btnTick() {
  static unsigned long debounceMs = 0;
  bool down = (digitalRead(BTN_PIN) == LOW);
  BtnAction act = BA_NONE;
  if (down && !btnWasDown) {
    if (millis() - debounceMs > 30) { // debounce 30ms
      btnWasDown = true; btnPressMs = millis();
    }
    debounceMs = millis();
  }
  if (!down && btnWasDown) {
    unsigned long held = millis() - btnPressMs; btnWasDown = false;
    if (held >= HOLD_MS) act = BA_HOLD5;
    else if (held >= 30) act = BA_SHORT; // minimal 30ms agar tidak false trigger
  }
  return act;
}
unsigned long btnHeldMs() { return btnWasDown ? millis() - btnPressMs : 0; }

// =====================================================
// OLED 5-PAGE DISPLAY
// =====================================================
int oledPage = 0;

void oledSetup() {
  if (!oled.begin(SSD1306_SWITCHCAPVCC, OLED_ADDR)) {
    Serial.println("[OLED] Failed"); while (1) delay(1000);
  }
  oled.clearDisplay(); oled.setTextColor(WHITE); oled.setTextSize(1);
  oled.setCursor(0,0); oled.println("Booting..."); oled.display();
}

void oledPBar(int x, int y, int w, int h, float pct) {
  oled.drawRect(x,y,w,h,WHITE); int f=(int)(pct*(float)(w-2)); if(f>0) oled.fillRect(x+1,y+1,f,h-2,WHITE);
}

void oledPageDots() {
  for (int i = 0; i < TOTAL_PAGES; i++) {
    int px = 128 - (TOTAL_PAGES - i) * 7;
    if (i == oledPage) oled.fillRect(px, 0, 5, 4, WHITE);
    else oled.drawRect(px, 0, 5, 4, WHITE);
  }
}

void oledDraw() {
  oled.clearDisplay(); oled.setTextSize(1); oled.setTextColor(WHITE);
  unsigned long heldMs = btnHeldMs();

  bool onActionPage = (oledPage == SETTINGS_PAGE || oledPage == SIM_PAGE);
  if (onActionPage && heldMs >= 1000) {
    float pct = min(1.0f, (float)heldMs / (float)HOLD_MS);
    oled.setCursor(0,2); oled.println("Hold to confirm...");
    oledPBar(0,18,128,12,pct);
    if (oledPage == SETTINGS_PAGE)
      oled.setCursor(0,38), oled.println(portalActive ? "Release = Reset WiFi" : "Release = WiFi Setup");
    else // SIM_PAGE
      oled.setCursor(0,38), oled.printf("Release = SIM %s", simEnabled ? "DISABLE" : "ENABLE");
    oled.setCursor(0,52);
    float rem = max(0.0f, ((float)HOLD_MS - (float)heldMs) / 1000.0f);
    oled.printf("%.1f s remaining", rem);
    oled.display(); return;
  }

  oledPageDots();

  switch (oledPage) {
    case 0: { // Gateway
      oled.setCursor(0,8); oled.println("Gateway");
      oled.setCursor(0,20); oled.print("ID: "); oled.println(gwId);
      oled.setCursor(0,32); oled.print("MAC:");
      for (int i=0;i<6;i++) { oled.printf("%02X",gwMac[i]); if(i<5) oled.print(":"); }
      oled.setCursor(0,44); oled.print("Up: "); oled.println(uptimeStr());
      oled.setCursor(0,56); oled.printf("Peers:%d POST:%s", countActivePeers(), lastPostOk?"OK":"--");
      break;
    }
    case 1: { // WiFi
      oled.setCursor(0,8); oled.println("WiFi");
      if (nvsSsid.length() == 0) {
        oled.setCursor(0,22); oled.println("No credentials");
        oled.setCursor(0,36); oled.println("Go to page 4 to setup");
      } else {
        String s = nvsSsid.length() > 14 ? nvsSsid.substring(0,14) + ".." : nvsSsid;
        oled.setCursor(0,20); oled.print("SSID: "); oled.println(s);
        oled.setCursor(0,32); oled.print("State: "); oled.println(wifiStateStr());
        if (wifiReady()) {
          oled.setCursor(0,44); oled.print("IP: "); oled.println(wsIp);
          oled.setCursor(0,56); oled.print("RSSI: "); oled.print(wsRssi); oled.println("dBm");
        } else {
          oled.setCursor(0,44); oled.println("Fallback: SIM");
        }
      }
      break;
    }
    case 2: { // SIM
      oled.setCursor(0,8); oled.println("SIM7600G-H");
      if (!simEnabled) {
        oled.setCursor(0,20); oled.println("Module disabled");
        oled.setCursor(0,32); oled.println("Set simEnabled=true");
        oled.setCursor(0,44); oled.println("to enable SIM+GPS");
        break;
      }
      oled.setCursor(0,20); oled.print("State: "); oled.println(simStateStr());
      if (simModemOk) {
        String op = simOperator.length() > 13 ? simOperator.substring(0,13) : simOperator;
        oled.setCursor(0,32); oled.print("Op: "); oled.println(op);
        oled.setCursor(0,44); oled.print("Sig:"); oled.print(simSignal); oled.print("/31 GPRS:"); oled.println(simGprs?"ON":"OFF");
        oled.setCursor(0,56); oled.print("APN: "); oled.println(APN);
      }
      break;
    }
    case 3: { // GPS
      oled.setCursor(0,8); oled.println("GPS");
      if (!simEnabled) {
        oled.setCursor(0,20); oled.println("SIM module disabled");
        oled.setCursor(0,36); oled.println("GPS not available");
        break;
      }
      if (!simModemOk) { oled.setCursor(0,22); oled.println("SIM not ready"); break; }
      if (!gps.hasFix) {
        oled.setCursor(0,20); oled.println("No fix");
        oled.setCursor(0,32); oled.println("Ensure GPS antenna");
        oled.setCursor(0,44); oled.println("is connected &");
        oled.setCursor(0,56); oled.println("outdoors");
      } else {
        oled.setCursor(0,20); oled.printf("Lat: %.5f", gps.lat);
        oled.setCursor(0,32); oled.printf("Lon: %.5f", gps.lon);
        oled.setCursor(0,44); oled.print("Alt: "); oled.print(gps.alt,1); oled.println("m");
        oled.setCursor(0,56); oled.printf("Fix: %lus ago", (millis()-gps.fixMs)/1000);
      }
      break;
    }
    case 4: { // Settings
      oled.setCursor(0,8); oled.println("WiFi Settings");
      if (portalActive) {
        oled.setCursor(0,22); oled.print("AP: "); oled.println(portalSsid);
        oled.setCursor(0,34); oled.print("PW: "); oled.println(PORTAL_PASS);
        oled.setCursor(0,46); oled.println("192.168.4.1");
      } else if (nvsSsid.length() == 0) {
        oled.setCursor(0,22); oled.println("No credentials");
        oled.setCursor(0,36); oled.println("Hold 5s = WiFi Setup");
      } else {
        String s = nvsSsid.length() > 14 ? nvsSsid.substring(0,14) + ".." : nvsSsid;
        oled.setCursor(0,20); oled.print("SSID: "); oled.println(s);
        oled.setCursor(0,32); oled.print("WiFi: "); oled.println(wifiReady() ? "Connected" : wifiStateStr());
        oled.setCursor(0,44); oled.println("Hold 5s = Change WiFi");
      }
      // POST status pojok kanan atas
      oled.fillRect(90,0,38,6,BLACK); oled.setCursor(90,0);
      if (lastStatusCode == 200) oled.println("POST:OK");
      else if (lastStatusCode > 0) oled.printf("POST:%d", lastStatusCode);
      else oled.println("POST:--");
      break;
    }
    case 5: { // SIM Control
      oled.setCursor(0,8); oled.println("SIM Control");
      oled.setCursor(0,20);
      oled.print("Status: ");
      if (simEnabled) {
        oled.println("ENABLED");
        oled.setCursor(0,32); oled.print("Modem: "); oled.println(simStateStr());
        oled.setCursor(0,44); oled.print("GPRS: "); oled.println(simGprs ? "ON" : "OFF");
      } else {
        oled.println("DISABLED");
        oled.setCursor(0,32); oled.println("Modul is Inactive");
        oled.setCursor(0,44); oled.println("Hold 5s = Enable");
      }
      oled.setCursor(0,56);
      oled.printf("Hold 5s = %s", simEnabled ? "Disable SIM" : "Enable SIM");
      break;
    }
  }
  oled.display();
}

// =====================================================
// SETUP
// =====================================================
void setup() {
  Serial.begin(115200); delay(500);
  Serial.println("\n=== ESP32 Gateway Merged v1 ===");

  oledSetup();
  pinMode(BTN_PIN, INPUT_PULLUP);

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(false);
  initGwId();
  Serial.print("[GW] ID: "); Serial.println(gwId);

  setupEspNow();

  SerialAT.begin(MODEM_BAUD, SERIAL_8N1, MODEM_RX_PIN, MODEM_TX_PIN);

  nvsLoad();
  if (nvsSsid.length() > 0) {
    Serial.print("[WIFI] Saved SSID: "); Serial.println(nvsSsid);
    wsState = WS_IDLE;
  } else {
    Serial.println("[WIFI] No credentials");
  }

  for (int i = 0; i <= MAX_SENDER_ID; i++) resetFrame(asmBySender[i]);

  // Snapshot awal gateway — kirim sekali saat boot, lalu tiap 60 detik
  lastGatewaySnapshotMs = millis(); // reset timer agar tidak langsung trigger lagi
  setPendingGateway(GATEWAY_PATH, buildGatewayPayloadJson());

  Serial.println("[SIM] State machine starting...");

  // Start HTTP task di Core 1 — POST tidak pernah blocking Core 0
  xTaskCreatePinnedToCore(httpTask, "httpTask", 8192, nullptr, 1, &httpTaskHandle, 1);
  Serial.println("[HTTP] Task started on Core 1");

  oledDraw();
}

// =====================================================
// LOOP
// =====================================================
void loop() {
  portalTick();

  BtnAction act = btnTick();
  if (act == BA_SHORT) {
    oledPage = (oledPage + 1) % TOTAL_PAGES;
    Serial.printf("[BTN] Page -> %d\n", oledPage);
  } else if (act == BA_HOLD5 && oledPage == SETTINGS_PAGE) {
    if (!portalActive) {
      Serial.println("[BTN] Hold 5s — starting portal");
      portalStart();
    } else {
      Serial.println("[BTN] Hold 5s (portal active) — reset WiFi");
      nvsClear();
      oled.clearDisplay(); oled.setTextSize(1); oled.setTextColor(WHITE);
      oled.setCursor(0,18); oled.println("WiFi credentials");
      oled.setCursor(0,32); oled.println("Removed!");
      oled.setCursor(0,48); oled.println("Rebooting...");
      oled.display(); delay(1500); ESP.restart();
    }
  } else if (act == BA_HOLD5 && oledPage == SIM_PAGE) {
    // Toggle SIM enable/disable, simpan ke NVS, reboot agar state machine clean
    bool newVal = !simEnabled;
    nvsSetSimEnabled(newVal);
    oled.clearDisplay(); oled.setTextSize(1); oled.setTextColor(WHITE);
    oled.setCursor(0,10); oled.println("SIM Module:");
    oled.setCursor(0,26); oled.printf("-> %s", newVal ? "ENABLED" : "DISABLED");
    oled.setCursor(0,44); oled.println("Rebooting...");
    oled.display(); delay(1500); ESP.restart();
  }

  if (!portalActive) wifiTick();
  if (simEnabled) simTick();
  if (simEnabled) gpsPoll();

  // Drain semua paket ESP-NOW DULU sebelum POST apapun
  // Ini mencegah paket drop akibat POST blocking inbox processing
  processEspNowInbox();
  removeTimedOutPeers();
  enqueueGatewaySnapshotIfDue();
  // POST sensor + gateway SETELAH inbox kosong
  processPending();

  static unsigned long lo = 0;
  if (millis() - lo > 200) { oledDraw(); lo = millis(); }

  // no loop delay
}
