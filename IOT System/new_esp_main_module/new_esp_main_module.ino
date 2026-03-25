/*******************************************************
 * ESP32 Gateway - Improved Full Merge
 * - ESP-NOW receiver
 * - OLED status
 * - SoftAP provisioning + local web page
 * - Save Wi-Fi creds in Preferences (NVS)
 * - Prefer Wi-Fi, fallback to SIM7600
 * - GPS polling from SIM7600
 * - HTTP POST to server
 *
 * Catatan:
 * - Field JSON "raspberry_serial_id" dipertahankan
 *   agar backend lama tidak langsung rusak.
 * - Portal setup sekarang pakai IP: 192.168.50.1
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

// ================= OLED =================
#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
#define OLED_RESET -1
#define I2C_ADDRESS 0x3C
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);

// ================= MODEM =================
HardwareSerial SerialAT(2);
TinyGsm modem(SerialAT);
TinyGsmClient cellClient(modem);
WiFiClient wifiClient;

static const int MODEM_RX = 16; // ESP32 RX <- TXD modem
static const int MODEM_TX = 17; // ESP32 TX -> RXD modem
static const uint32_t MODEM_BAUD = 115200;
static const uint32_t MODEM_BOOT_WAIT_MS = 15000;

// ================= NETWORK CONFIG =================
const char APN[] = "vmobile.jp";
const char GPRS_USER[] = "";
const char GPRS_PASS[] = "";

const char SERVER_HOST[] = "118.22.31.249";
const int SERVER_PORT = 3000;

// Tetap pakai endpoint lama dulu
const char SENSOR_PATH[] = "/api/sensor-data";
const char GATEWAY_PATH[] = "/api/raspi-data";

// ================= WIFI PROVISIONING =================
Preferences prefs;
WebServer setupServer(80);

bool provisioningMode = false;
bool rebootScheduled = false;
unsigned long rebootAtMs = 0;

String savedSsid = "";
String savedPass = "";
String portalSsid = "";
String cachedScanHtml = "<div>Belum scan jaringan.</div>";
unsigned long lastScanMs = 0;

const char *portalPass = "setup1234"; // minimal 8 karakter
IPAddress portalIP(192, 168, 50, 1);
IPAddress portalGW(192, 168, 50, 1);
IPAddress portalMask(255, 255, 255, 0);

// set -1 kalau tidak pakai tombol setup
const int SETUP_BUTTON_PIN = -1;

// ================= SYSTEM STATE =================
enum BackhaulType
{
  BACKHAUL_NONE = 0,
  BACKHAUL_WIFI,
  BACKHAUL_CELL
};

char gatewayId[18] = {0};
uint8_t selfMac[6] = {0};

bool modemReady = false;
bool serverOnline = false;
unsigned long serverOnlineUntil = 0;

const unsigned long SERVER_OK_TTL = 8000;
const unsigned long GPS_POLL_INTERVAL_MS = 5000;
const unsigned long GATEWAY_POST_INTERVAL_MS = 30000;
const unsigned long HTTP_RETRY_INTERVAL_MS = 2000;
const unsigned long PEER_TIMEOUT_MS = 6000;
const unsigned long FRAME_TTL_MS = 3000;
const unsigned long GPS_STALE_MS = 120000;
const unsigned long WIFI_SCAN_CACHE_MS = 15000;

unsigned long lastGpsPollMs = 0;
unsigned long lastHttpAttemptMs = 0;

int lastDisplayedActiveCount = -1;
unsigned long lastSwitchTime = 0;
bool showingServerStatus = true;

// ================= GPS STATE =================
double gpsLat = 0.0;
double gpsLon = 0.0;
float gpsAlt = 0.0f;
bool gpsHasFix = false;
unsigned long gpsLastFixMs = 0;
String gpsTimestampIso = "";

// ================= DEVICE TRACKING =================
#define MAX_DEVICES 50
struct DeviceEntry
{
  uint8_t mac[6];
  unsigned long lastSeen;
};

DeviceEntry knownDevices[MAX_DEVICES];
int deviceCount = 0;

// ================= ESP-NOW RX QUEUE =================
#define ESPNOW_QUEUE_SIZE 12
#define ESPNOW_MAX_DATA_LEN 300

struct EspNowPacket
{
  uint8_t mac[6];
  uint16_t len;
  char data[ESPNOW_MAX_DATA_LEN];
};

EspNowPacket espNowQueue[ESPNOW_QUEUE_SIZE];
volatile int espNowQHead = 0;
volatile int espNowQTail = 0;
volatile int espNowQCount = 0;
portMUX_TYPE espNowQueueMux = portMUX_INITIALIZER_UNLOCKED;

// ================= HTTP JOB QUEUE =================
#define JOB_QUEUE_SIZE 10
struct HttpJob
{
  String path;
  String body;
};

HttpJob jobQueue[JOB_QUEUE_SIZE];
int jobHead = 0;
int jobTail = 0;
int jobCount = 0;

// ================= SENSOR FRAME ASSEMBLY =================
#define MAX_SENDER_ID 9

struct FrameAsm
{
  bool inFrame = false;
  uint16_t cycle = 0;
  unsigned long startedAt = 0;
  String portLine[8];
  bool hasPort[8] = {false};
};

FrameAsm asmBySender[MAX_SENDER_ID + 1];

struct ParsedPortLine
{
  bool valid = false;
  bool isNull = true;
  String sensorType;
  String value;
};

// ================= FORWARD DECLARATIONS =================
bool isSameMac(const uint8_t *a, const uint8_t *b);
String macToString(const uint8_t *mac);
void initGatewayId();
String jsonEscape(const String &s);
String htmlEscape(const String &s);
bool hasRecentGpsFix();

void setupDisplay();
void updateDisplay(bool force);
void drawMacLine(const uint8_t mac[6]);

int findDeviceIndex(const uint8_t *mac);
void addOrUpdateDevice(const uint8_t *mac);
void removeDevice(int index);
int countActivePeers();
void removeTimedOutPeers();

void scheduleReboot(unsigned long delayMs);
bool loadWiFiCreds();
void saveWiFiCreds(const String &ssid, const String &pass);
void clearWiFiCreds();
bool shouldStartProvisioningAtBoot();
bool connectSavedWiFi(uint32_t timeoutMs);
void startProvisioningPortal();
void stopProvisioningPortal();
void handleProvisioningPortal();
String buildPortalHtml(const String &msg, bool ok);
void handlePortalRoot();
void handlePortalSave();
void handlePortalClear();
void handlePortalRescan();
void refreshWifiScanCache(bool force);
bool setupButtonLongPressed(unsigned long holdMs);

void flushSerialAT();
bool responseHasOk(const String &s);
bool responseHasError(const String &s);
bool sendRawAT(const char *cmd, String &resp, uint32_t timeoutMs);
bool initModem();
bool ensureCellular();

bool parseDDMMToDecimal(const String &raw, double &outVal);
bool splitCsv(const String &s, String out[], int maxParts, int &partCount);
bool parseCgpsInfoResponse(const String &resp, double &lat, double &lon, float &alt, String &isoTs);
void pollGpsIfDue();

bool enqueueJob(const String &path, const String &body);
void popFrontJob();
bool parseHttpStatusLine(const String &line, int &statusCode);

bool ensureBestBackhaul(BackhaulType &kind);
Client &pickTransport(BackhaulType kind);
bool httpPostJsonGeneric(Client &transport, const char *host, int port, const char *path,
                         const String &body, int &statusCode, String &respSnippet);
bool httpPostJsonBestLink(const char *path, const String &body, int &statusCode, String &respSnippet);
void processHttpQueue();

int extractIntField(const String &s, const char *key);
bool extractPortLineFromPayload(const String &s, int port, String &outLine);
void resetFrame(FrameAsm &fa);
bool frameExpired(const FrameAsm &fa);
ParsedPortLine parsePortLine(const String &line, int expectedPort);
String buildSensorPayloadJson(int senderId, const FrameAsm &fa);
String buildGatewayPayloadJson();
void enqueueGatewaySnapshotIfDue();

void enqueueEspNowPacket(const uint8_t *mac, const uint8_t *data, int len);
bool popEspNowPacket(EspNowPacket &out);
void processEspNowInbox();
void processOneSensorMessage(const uint8_t *mac_addr, const String &s);

void setupEspNow();

// ========================================================
// ================= BASIC HELPERS ========================
// ========================================================

bool isSameMac(const uint8_t *a, const uint8_t *b)
{
  return memcmp(a, b, 6) == 0;
}

String macToString(const uint8_t *mac)
{
  char buf[18];
  snprintf(buf, sizeof(buf), "%02X:%02X:%02X:%02X:%02X:%02X",
           mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
  return String(buf);
}

void initGatewayId()
{
  esp_wifi_get_mac(WIFI_IF_STA, selfMac);
  snprintf(gatewayId, sizeof(gatewayId),
           "%02X%02X%02X%02X%02X%02X",
           selfMac[0], selfMac[1], selfMac[2],
           selfMac[3], selfMac[4], selfMac[5]);
}

String jsonEscape(const String &s)
{
  String out;
  out.reserve(s.length() + 8);
  for (size_t i = 0; i < s.length(); i++)
  {
    char c = s[i];
    switch (c)
    {
    case '\"':
      out += "\\\"";
      break;
    case '\\':
      out += "\\\\";
      break;
    case '\b':
      out += "\\b";
      break;
    case '\f':
      out += "\\f";
      break;
    case '\n':
      out += "\\n";
      break;
    case '\r':
      out += "\\r";
      break;
    case '\t':
      out += "\\t";
      break;
    default:
      out += c;
      break;
    }
  }
  return out;
}

String htmlEscape(const String &s)
{
  String out;
  out.reserve(s.length() + 16);
  for (size_t i = 0; i < s.length(); i++)
  {
    char c = s[i];
    switch (c)
    {
    case '&':
      out += "&amp;";
      break;
    case '<':
      out += "&lt;";
      break;
    case '>':
      out += "&gt;";
      break;
    case '\"':
      out += "&quot;";
      break;
    case '\'':
      out += "&#39;";
      break;
    default:
      out += c;
      break;
    }
  }
  return out;
}

bool hasRecentGpsFix()
{
  return gpsHasFix && (millis() - gpsLastFixMs <= GPS_STALE_MS);
}

// ========================================================
// ================= DISPLAY ==============================
// ========================================================

void drawMacLine(const uint8_t mac[6])
{
  for (int i = 0; i < 6; i++)
  {
    display.printf("%02X", mac[i]);
    if (i < 5)
      display.print(":");
  }
}

void setupDisplay()
{
  if (!display.begin(SSD1306_SWITCHCAPVCC, I2C_ADDRESS))
  {
    Serial.println("OLED failed");
    while (1)
    {
      delay(1000);
    }
  }

  display.clearDisplay();
  display.setTextColor(WHITE);
  display.setCursor(0, 0);
  display.println("Initializing...");
  display.display();
}

int findDeviceIndex(const uint8_t *mac)
{
  for (int i = 0; i < deviceCount; i++)
  {
    if (isSameMac(knownDevices[i].mac, mac))
      return i;
  }
  return -1;
}

void addOrUpdateDevice(const uint8_t *mac)
{
  if (isSameMac(mac, selfMac))
    return;

  int idx = findDeviceIndex(mac);
  if (idx >= 0)
  {
    knownDevices[idx].lastSeen = millis();
    return;
  }

  if (deviceCount < MAX_DEVICES)
  {
    memcpy(knownDevices[deviceCount].mac, mac, 6);
    knownDevices[deviceCount].lastSeen = millis();
    deviceCount++;
  }
}

void removeDevice(int index)
{
  for (int i = index; i < deviceCount - 1; i++)
  {
    knownDevices[i] = knownDevices[i + 1];
  }
  deviceCount--;
}

int countActivePeers()
{
  int c = 0;
  for (int i = 0; i < deviceCount; i++)
  {
    if (!isSameMac(knownDevices[i].mac, selfMac))
      c++;
  }
  return c;
}

void removeTimedOutPeers()
{
  unsigned long now = millis();
  for (int i = 0; i < deviceCount;)
  {
    if (now - knownDevices[i].lastSeen > PEER_TIMEOUT_MS)
    {
      Serial.print("[TIMEOUT] Removed peer: ");
      Serial.println(macToString(knownDevices[i].mac));
      removeDevice(i);
    }
    else
    {
      i++;
    }
  }
}

void updateDisplay(bool force)
{
  static unsigned long lastUpdate = 0;

  if (provisioningMode)
  {
    display.clearDisplay();
    display.setTextSize(1);
    display.setTextColor(WHITE);

    display.setCursor(0, 0);
    display.println("WiFi Setup Mode");

    display.setCursor(0, 12);
    display.println(portalSsid);

    display.setCursor(0, 24);
    display.println("Pass:");
    display.setCursor(0, 34);
    display.println(portalPass);

    display.setCursor(0, 48);
    display.println("192.168.50.1");

    display.display();
    return;
  }

  bool serverIsOnlineNow = serverOnline && (millis() < serverOnlineUntil);
  int activePeers = countActivePeers();

  if (millis() - lastSwitchTime > 3000)
  {
    showingServerStatus = !showingServerStatus;
    lastSwitchTime = millis();
  }

  if (!force &&
      activePeers == lastDisplayedActiveCount &&
      millis() - lastUpdate < 1000)
  {
    return;
  }

  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(WHITE);

  display.setCursor(0, 0);
  display.println("GATEWAY ID:");
  display.setCursor(0, 10);
  display.println(gatewayId);

  display.setCursor(0, 22);
  display.println("MAC:");
  display.setCursor(0, 32);
  drawMacLine(selfMac);

  display.setCursor(0, 48);
  if (showingServerStatus)
  {
    display.print("Server: ");
    display.println(serverIsOnlineNow ? "Online" : "Offline");
  }
  else
  {
    display.print("Peers: ");
    display.println(activePeers);
  }

  display.display();
  lastDisplayedActiveCount = activePeers;
  lastUpdate = millis();
}

// ========================================================
// ================= WIFI PROVISIONING ====================
// ========================================================

void scheduleReboot(unsigned long delayMs)
{
  rebootScheduled = true;
  rebootAtMs = millis() + delayMs;
}

bool loadWiFiCreds()
{
  prefs.begin("netcfg", true);
  savedSsid = prefs.getString("ssid", "");
  savedPass = prefs.getString("pass", "");
  prefs.end();
  return savedSsid.length() > 0;
}

void saveWiFiCreds(const String &ssid, const String &pass)
{
  prefs.begin("netcfg", false);
  prefs.putString("ssid", ssid);
  prefs.putString("pass", pass);
  prefs.end();
  savedSsid = ssid;
  savedPass = pass;
}

void clearWiFiCreds()
{
  prefs.begin("netcfg", false);
  prefs.remove("ssid");
  prefs.remove("pass");
  prefs.end();
  savedSsid = "";
  savedPass = "";
}

bool shouldStartProvisioningAtBoot()
{
  bool hasCreds = loadWiFiCreds();
  if (!hasCreds)
    return true;

  if (SETUP_BUTTON_PIN >= 0)
  {
    pinMode(SETUP_BUTTON_PIN, INPUT_PULLUP);
    delay(20);
    if (digitalRead(SETUP_BUTTON_PIN) == LOW)
    {
      return true;
    }
  }

  return false;
}

bool connectSavedWiFi(uint32_t timeoutMs)
{
  if (!loadWiFiCreds())
  {
    Serial.println("[WIFI] No saved credentials");
    return false;
  }

  if (savedSsid.length() == 0)
    return false;
  if (WiFi.status() == WL_CONNECTED)
  {
    Serial.print("[WIFI] Already connected. IP=");
    Serial.println(WiFi.localIP());
    return true;
  }

  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.setAutoReconnect(true);
  WiFi.begin(savedSsid.c_str(), savedPass.length() ? savedPass.c_str() : nullptr);

  Serial.print("[WIFI] Connecting to ");
  Serial.println(savedSsid);

  unsigned long start = millis();
  while (millis() - start < timeoutMs)
  {
    if (WiFi.status() == WL_CONNECTED)
    {
      Serial.print("[WIFI] Connected. IP=");
      Serial.println(WiFi.localIP());
      return true;
    }
    delay(250);
  }

  Serial.println("[WIFI] Connect timeout");
  WiFi.disconnect();
  return false;
}

void refreshWifiScanCache(bool force)
{
  if (!provisioningMode)
    return;
  if (!force && (millis() - lastScanMs < WIFI_SCAN_CACHE_MS))
    return;

  Serial.println("[WIFI] Refreshing scan cache...");
  int n = WiFi.scanNetworks();

  String html;
  html.reserve(2048);
  html += "<div style='margin:10px 0'><b>SSID terdeteksi</b><br>";

  if (n <= 0)
  {
    html += "Tidak ada jaringan ditemukan.<br>";
  }
  else
  {
    for (int i = 0; i < n; i++)
    {
      String ssid = WiFi.SSID(i);
      int32_t rssi = WiFi.RSSI(i);
      int32_t ch = WiFi.channel(i);

      html += "<label style='display:block;padding:6px 0'>";
      html += "<input type='radio' name='ssid' value='" + htmlEscape(ssid) + "'>";
      html += htmlEscape(ssid) + " (RSSI " + String(rssi) + ", CH " + String(ch) + ")";
      html += "</label>";
    }
  }

  html += "</div>";
  WiFi.scanDelete();

  cachedScanHtml = html;
  lastScanMs = millis();
}

String buildPortalHtml(const String &msg, bool ok)
{
  String html;
  html.reserve(4096);

  html += "<!doctype html><html><head><meta charset='utf-8'>";
  html += "<meta name='viewport' content='width=device-width,initial-scale=1'>";
  html += "<title>Gateway Wi-Fi Setup</title></head>";
  html += "<body style='font-family:sans-serif;max-width:700px;margin:20px auto;padding:0 12px'>";
  html += "<h2>Gateway Wi-Fi Setup</h2>";
  html += "<p><b>Gateway ID:</b> " + htmlEscape(String(gatewayId)) + "</p>";
  html += "<p><b>Setup AP:</b> " + htmlEscape(portalSsid) + "<br>";
  html += "<b>IP:</b> 192.168.50.1</p>";

  if (msg.length())
  {
    html += "<div style='padding:10px;border-radius:8px;background:";
    html += ok ? "#e7f7e7;color:#145214" : "#fdeaea;color:#7a1010";
    html += ";margin:10px 0'>" + htmlEscape(msg) + "</div>";
  }

  html += "<form method='POST' action='/save'>";
  html += cachedScanHtml;
  html += "<div style='margin:10px 0'>";
  html += "<button type='submit' formaction='/rescan' formmethod='POST' style='padding:8px 12px'>Refresh Scan</button>";
  html += "</div>";
  html += "<div style='margin:10px 0'><b>Atau isi manual</b><br>";
  html += "<input name='ssid_manual' placeholder='SSID manual' style='width:100%;padding:8px'></div>";
  html += "<div style='margin:10px 0'><b>Password</b><br>";
  html += "<input type='password' name='pass' placeholder='Password Wi-Fi' style='width:100%;padding:8px'></div>";
  html += "<button type='submit' style='padding:10px 16px'>Simpan & Reboot</button>";
  html += "</form>";

  html += "<form method='POST' action='/clear' style='margin-top:20px'>";
  html += "<button type='submit' style='padding:10px 16px;background:#eee'>Hapus kredensial tersimpan</button>";
  html += "</form>";

  if (savedSsid.length())
  {
    html += "<p style='margin-top:20px'><b>Tersimpan saat ini:</b> " + htmlEscape(savedSsid) + "</p>";
  }

  html += "</body></html>";
  return html;
}

void handlePortalRoot()
{
  setupServer.send(200, "text/html", buildPortalHtml("", false));
}

void handlePortalSave()
{
  String ssid = setupServer.arg("ssid");
  String ssidManual = setupServer.arg("ssid_manual");
  String pass = setupServer.arg("pass");

  ssid.trim();
  ssidManual.trim();
  pass.trim();

  if (ssid.length() == 0)
    ssid = ssidManual;

  if (ssid.length() == 0)
  {
    setupServer.send(400, "text/html", buildPortalHtml("SSID kosong.", false));
    return;
  }

  saveWiFiCreds(ssid, pass);
  setupServer.send(200, "text/html", buildPortalHtml("Kredensial disimpan. Gateway akan reboot.", true));
  scheduleReboot(1500);
}

void handlePortalClear()
{
  clearWiFiCreds();
  setupServer.send(200, "text/html", buildPortalHtml("Kredensial dihapus. Gateway akan reboot.", true));
  scheduleReboot(1500);
}

void handlePortalRescan()
{
  refreshWifiScanCache(true);
  setupServer.send(200, "text/html", buildPortalHtml("Scan diperbarui.", true));
}

void stopProvisioningPortal()
{
  if (!provisioningMode)
    return;
  setupServer.stop();
  WiFi.softAPdisconnect(true);
  provisioningMode = false;
}

void startProvisioningPortal()
{
  provisioningMode = true;
  cachedScanHtml = "<div>Memindai jaringan...</div>";
  lastScanMs = 0;

  String suffix = String(gatewayId);
  if (suffix.length() > 4)
  {
    suffix = suffix.substring(suffix.length() - 4);
  }
  portalSsid = "GW-SETUP-" + suffix;

  // putus dari STA lama dulu
  if (WiFi.status() == WL_CONNECTED)
  {
    WiFi.disconnect(true);
    delay(100);
  }

  // Tetap AP+STA agar scan SSID bisa jalan, tapi workload lain dihentikan.
  WiFi.mode(WIFI_AP_STA);
  WiFi.setSleep(false);
  WiFi.softAPConfig(portalIP, portalGW, portalMask);

  bool apOk = WiFi.softAP(portalSsid.c_str(), portalPass, 1, 0, 4);
  Serial.print("[WIFI] Portal AP start: ");
  Serial.println(apOk ? "OK" : "FAIL");

  setupServer.on("/", HTTP_GET, handlePortalRoot);
  setupServer.on("/save", HTTP_POST, handlePortalSave);
  setupServer.on("/clear", HTTP_POST, handlePortalClear);
  setupServer.on("/rescan", HTTP_POST, handlePortalRescan);
  setupServer.onNotFound(handlePortalRoot);
  setupServer.begin();

  refreshWifiScanCache(true);

  Serial.print("[WIFI] Connect to SSID: ");
  Serial.println(portalSsid);
  Serial.println("[WIFI] Open http://192.168.50.1");
}

void handleProvisioningPortal()
{
  if (provisioningMode)
  {
    refreshWifiScanCache(false);
    setupServer.handleClient();
  }

  if (rebootScheduled && millis() >= rebootAtMs)
  {
    delay(100);
    ESP.restart();
  }
}

bool setupButtonLongPressed(unsigned long holdMs)
{
  if (SETUP_BUTTON_PIN < 0)
    return false;

  static bool wasPressed = false;
  static unsigned long pressedAt = 0;

  bool pressed = (digitalRead(SETUP_BUTTON_PIN) == LOW);

  if (pressed && !wasPressed)
  {
    wasPressed = true;
    pressedAt = millis();
  }

  if (!pressed && wasPressed)
  {
    wasPressed = false;
    pressedAt = 0;
  }

  if (pressed && wasPressed && (millis() - pressedAt >= holdMs))
  {
    wasPressed = false;
    pressedAt = 0;
    return true;
  }

  return false;
}

// ========================================================
// ================= MODEM / AT ===========================
// ========================================================

void flushSerialAT()
{
  while (SerialAT.available())
  {
    SerialAT.read();
  }
}

bool responseHasOk(const String &s)
{
  return s.indexOf("\r\nOK\r\n") >= 0 ||
         s.indexOf("\nOK\r\n") >= 0 ||
         s.endsWith("OK\r\n") ||
         s.endsWith("OK\n");
}

bool responseHasError(const String &s)
{
  return s.indexOf("\r\nERROR\r\n") >= 0 ||
         s.indexOf("\nERROR\r\n") >= 0 ||
         s.endsWith("ERROR\r\n") ||
         s.endsWith("ERROR\n");
}

bool sendRawAT(const char *cmd, String &resp, uint32_t timeoutMs)
{
  flushSerialAT();

  Serial.print("[AT] ");
  Serial.println(cmd);

  SerialAT.print(cmd);
  SerialAT.print("\r\n");

  resp = "";
  resp.reserve(256);

  unsigned long lastRx = millis();
  unsigned long start = millis();

  while (millis() - start < timeoutMs)
  {
    while (SerialAT.available())
    {
      char c = (char)SerialAT.read();
      resp += c;
      lastRx = millis();
    }

    if (responseHasOk(resp) || responseHasError(resp))
    {
      break;
    }

    if (resp.length() > 0 && millis() - lastRx > 200)
    {
      if (responseHasOk(resp) || responseHasError(resp))
        break;
    }

    delay(2);
  }

  if (resp.length())
  {
    Serial.println(resp);
  }

  return responseHasOk(resp);
}

bool initModem()
{
  if (modemReady)
    return true;

  Serial.println("[MODEM] Boot wait...");
  delay(MODEM_BOOT_WAIT_MS);

  String resp;
  bool ok = false;

  for (int i = 0; i < 3; i++)
  {
    if (sendRawAT("AT", resp, 3000))
    {
      ok = true;
      break;
    }
    delay(1000);
  }

  if (!ok)
  {
    Serial.println("[MODEM] No AT response");
    return false;
  }

  sendRawAT("ATE0", resp, 1500);
  sendRawAT("AT+CGPS=1", resp, 3000);

  modemReady = true;

  String info = modem.getModemInfo();
  Serial.print("[MODEM] Info: ");
  Serial.println(info);

  return true;
}

bool ensureCellular()
{
  if (!initModem())
    return false;

  if (!modem.isNetworkConnected())
  {
    Serial.println("[MODEM] Waiting network...");
    if (!modem.waitForNetwork(60000L))
    {
      Serial.println("[MODEM] waitForNetwork failed");
      return false;
    }
  }

  if (!modem.isGprsConnected())
  {
    Serial.print("[MODEM] Connecting APN: ");
    Serial.println(APN);
    if (!modem.gprsConnect(APN, GPRS_USER, GPRS_PASS))
    {
      Serial.println("[MODEM] gprsConnect failed");
      return false;
    }
  }

  return modem.isNetworkConnected() && modem.isGprsConnected();
}

// ========================================================
// ================= GPS ==================================
// ========================================================

bool parseDDMMToDecimal(const String &raw, double &outVal)
{
  if (raw.length() < 4)
    return false;
  double v = raw.toDouble();
  if (v == 0.0)
    return false;

  int deg = (int)(v / 100);
  double minutes = v - (deg * 100);
  outVal = deg + (minutes / 60.0);
  return true;
}

bool splitCsv(const String &s, String out[], int maxParts, int &partCount)
{
  partCount = 0;
  int start = 0;

  for (int i = 0; i <= s.length(); i++)
  {
    if (i == s.length() || s[i] == ',')
    {
      if (partCount >= maxParts)
        return false;
      out[partCount++] = s.substring(start, i);
      start = i + 1;
    }
  }
  return true;
}

bool parseCgpsInfoResponse(const String &resp, double &lat, double &lon, float &alt, String &isoTs)
{
  int pos = resp.indexOf("+CGPSINFO:");
  if (pos < 0)
    return false;

  int lineEnd = resp.indexOf('\n', pos);
  String line = (lineEnd >= 0) ? resp.substring(pos, lineEnd) : resp.substring(pos);
  line.trim();

  int colon = line.indexOf(':');
  if (colon < 0)
    return false;

  String payload = line.substring(colon + 1);
  payload.trim();

  String parts[10];
  int count = 0;
  if (!splitCsv(payload, parts, 10, count))
    return false;
  if (count < 8)
    return false;

  if (parts[0].length() == 0 || parts[2].length() == 0)
    return false;

  double parsedLat = 0.0, parsedLon = 0.0;
  if (!parseDDMMToDecimal(parts[0], parsedLat))
    return false;
  if (!parseDDMMToDecimal(parts[2], parsedLon))
    return false;

  String ns = parts[1];
  String ew = parts[3];
  ns.trim();
  ew.trim();

  if (ns.equalsIgnoreCase("S"))
    parsedLat = -parsedLat;
  if (ew.equalsIgnoreCase("W"))
    parsedLon = -parsedLon;

  lat = parsedLat;
  lon = parsedLon;
  alt = parts[6].toFloat();

  isoTs = "";
  String ddmmyy = parts[4];
  String hhmmss = parts[5];
  ddmmyy.trim();
  hhmmss.trim();

  if (ddmmyy.length() == 6 && hhmmss.length() >= 6)
  {
    String dd = ddmmyy.substring(0, 2);
    String mm = ddmmyy.substring(2, 4);
    String yy = ddmmyy.substring(4, 6);

    String hh = hhmmss.substring(0, 2);
    String mi = hhmmss.substring(2, 4);
    String ss = hhmmss.substring(4, 6);

    isoTs = "20" + yy + "-" + mm + "-" + dd + "T" + hh + ":" + mi + ":" + ss + "Z";
  }

  return true;
}

void pollGpsIfDue()
{
  if (millis() - lastGpsPollMs < GPS_POLL_INTERVAL_MS)
    return;
  lastGpsPollMs = millis();

  if (!modemReady)
  {
    if (!initModem())
      return;
  }

  if (cellClient.connected())
    return;

  String resp;
  if (!sendRawAT("AT+CGPSINFO", resp, 2500))
  {
    return;
  }

  double lat = 0.0, lon = 0.0;
  float alt = 0.0f;
  String isoTs;

  if (parseCgpsInfoResponse(resp, lat, lon, alt, isoTs))
  {
    gpsLat = lat;
    gpsLon = lon;
    gpsAlt = alt;
    gpsTimestampIso = isoTs;
    gpsHasFix = true;
    gpsLastFixMs = millis();

    Serial.print("[GPS] lat=");
    Serial.print(gpsLat, 6);
    Serial.print(" lon=");
    Serial.print(gpsLon, 6);
    Serial.print(" alt=");
    Serial.println(gpsAlt, 1);
  }
  else
  {
    if (millis() - gpsLastFixMs > GPS_STALE_MS)
    {
      gpsHasFix = false;
    }
    Serial.println("[GPS] no fix yet");
  }
}

// ========================================================
// ================= HTTP / BACKHAUL ======================
// ========================================================

bool enqueueJob(const String &path, const String &body)
{
  if (jobCount >= JOB_QUEUE_SIZE)
  {
    Serial.println("[HTTP] Queue full, dropping job");
    return false;
  }

  jobQueue[jobTail].path = path;
  jobQueue[jobTail].body = body;
  jobTail = (jobTail + 1) % JOB_QUEUE_SIZE;
  jobCount++;
  return true;
}

void popFrontJob()
{
  if (jobCount <= 0)
    return;
  jobQueue[jobHead].path = "";
  jobQueue[jobHead].body = "";
  jobHead = (jobHead + 1) % JOB_QUEUE_SIZE;
  jobCount--;
}

bool parseHttpStatusLine(const String &line, int &statusCode)
{
  if (!line.startsWith("HTTP/"))
    return false;

  int sp1 = line.indexOf(' ');
  if (sp1 < 0)
    return false;

  int sp2 = line.indexOf(' ', sp1 + 1);
  String code = (sp2 > sp1) ? line.substring(sp1 + 1, sp2) : line.substring(sp1 + 1);
  code.trim();
  statusCode = code.toInt();

  return statusCode > 0;
}

bool ensureBestBackhaul(BackhaulType &kind)
{
  if (!provisioningMode)
  {
    if (WiFi.status() == WL_CONNECTED || connectSavedWiFi(12000))
    {
      Serial.println("[BACKHAUL] Using WiFi");
      kind = BACKHAUL_WIFI;
      return true;
    }
  }

  if (ensureCellular())
  {
    Serial.println("[BACKHAUL] Using Cellular");
    kind = BACKHAUL_CELL;
    return true;
  }

  Serial.println("[BACKHAUL] No network available");
  kind = BACKHAUL_NONE;
  return false;
}

Client &pickTransport(BackhaulType kind)
{
  if (kind == BACKHAUL_WIFI)
    return wifiClient;
  return cellClient;
}

bool httpPostJsonGeneric(Client &transport,
                         const char *host,
                         int port,
                         const char *path,
                         const String &body,
                         int &statusCode,
                         String &respSnippet)
{
  statusCode = -1;
  respSnippet = "";

  if (transport.connected())
  {
    transport.stop();
    delay(30);
  }

  if (!transport.connect(host, port))
  {
    Serial.println("[HTTP] connect failed");
    return false;
  }

  transport.print(String("POST ") + path + " HTTP/1.1\r\n");
  transport.print(String("Host: ") + host + "\r\n");
  transport.print("Content-Type: application/json\r\n");
  transport.print(String("Content-Length: ") + body.length() + "\r\n");
  transport.print("Connection: close\r\n\r\n");
  transport.print(body);

  bool gotStatus = false;
  bool headersDone = false;
  String line;
  line.reserve(160);

  unsigned long lastData = millis();
  unsigned long hardTimeout = millis() + 15000;

  while (millis() < hardTimeout)
  {
    while (transport.available())
    {
      char c = (char)transport.read();
      lastData = millis();

      if (!headersDone)
      {
        line += c;
        if (line.endsWith("\r\n"))
        {
          String one = line;
          one.trim();

          if (!gotStatus && parseHttpStatusLine(one, statusCode))
          {
            gotStatus = true;
          }

          if (one.length() == 0)
          {
            headersDone = true;
          }

          line = "";
        }
      }
      else
      {
        if (respSnippet.length() < 250)
        {
          respSnippet += c;
        }
      }
    }

    if (!transport.connected() && !transport.available())
      break;
    if (gotStatus && millis() - lastData > 5000)
      break;
    delay(2);
  }

  transport.stop();
  return gotStatus && statusCode >= 200 && statusCode < 300;
}

bool httpPostJsonBestLink(const char *path,
                          const String &body,
                          int &statusCode,
                          String &respSnippet)
{
  BackhaulType kind;
  if (!ensureBestBackhaul(kind))
  {
    statusCode = -1;
    respSnippet = "";
    return false;
  }

  Client &transport = pickTransport(kind);

  bool ok = httpPostJsonGeneric(
      transport,
      SERVER_HOST,
      SERVER_PORT,
      path,
      body,
      statusCode,
      respSnippet);

  if (ok)
  {
    serverOnline = true;
    serverOnlineUntil = millis() + SERVER_OK_TTL;
    Serial.print("[HTTP] via ");
    Serial.println(kind == BACKHAUL_WIFI ? "WiFi" : "Cellular");
  }
  else
  {
    serverOnline = false;
  }

  return ok;
}

void processHttpQueue()
{
  if (jobCount <= 0)
    return;
  if (millis() - lastHttpAttemptMs < HTTP_RETRY_INTERVAL_MS)
    return;

  lastHttpAttemptMs = millis();

  HttpJob &job = jobQueue[jobHead];
  int statusCode = -1;
  String resp;

  bool ok = httpPostJsonBestLink(job.path.c_str(), job.body, statusCode, resp);

  Serial.print("[HTTP] path: ");
  Serial.println(job.path);
  Serial.print("[HTTP] status: ");
  Serial.println(statusCode);
  if (resp.length())
  {
    Serial.print("[HTTP] body: ");
    Serial.println(resp);
  }

  if (ok)
  {
    Serial.println("[HTTP] POST OK");
    popFrontJob();
    return;
  }

  Serial.println("[HTTP] POST failed");

  if (statusCode >= 400 && statusCode < 500)
  {
    Serial.println("[HTTP] Permanent client error. Dropping job.");
    popFrontJob();
  }
}

// ========================================================
// ================= SENSOR PAYLOAD =======================
// ========================================================

int extractIntField(const String &s, const char *key)
{
  String k = "\"" + String(key) + "\":";
  int p = s.indexOf(k);
  if (p < 0)
    return -1;
  p += k.length();

  int q = s.indexOf(",", p);
  if (q < 0)
    q = s.indexOf("}", p);
  if (q < 0)
    return -1;

  String v = s.substring(p, q);
  v.trim();
  return v.toInt();
}

bool extractPortLineFromPayload(const String &s, int port, String &outLine)
{
  String tag = "p" + String(port) + "-";
  int a = s.indexOf(tag);
  if (a < 0)
    return false;

  int b = s.indexOf("\n", a);
  if (b < 0)
    b = s.length();

  outLine = s.substring(a, b);
  outLine.trim();
  return outLine.length() > 0;
}

void resetFrame(FrameAsm &fa)
{
  fa.inFrame = false;
  fa.cycle = 0;
  fa.startedAt = 0;
  for (int i = 0; i < 8; i++)
  {
    fa.portLine[i] = "";
    fa.hasPort[i] = false;
  }
}

bool frameExpired(const FrameAsm &fa)
{
  return fa.inFrame && (millis() - fa.startedAt > FRAME_TTL_MS);
}

ParsedPortLine parsePortLine(const String &line, int expectedPort)
{
  ParsedPortLine out;

  String prefix = "p" + String(expectedPort) + "-";
  if (!line.startsWith(prefix))
  {
    return out;
  }

  String rest = line.substring(prefix.length());
  rest.trim();
  if (rest.length() == 0)
  {
    return out;
  }

  if (rest == "null-null")
  {
    out.valid = true;
    out.isNull = true;
    return out;
  }

  if (rest.startsWith("ID="))
  {
    int sep = rest.indexOf(";VAL=");
    if (sep > 0)
    {
      out.valid = true;
      out.isNull = false;
      out.sensorType = rest.substring(3, sep);
      out.value = rest.substring(sep + 5);
      out.sensorType.trim();
      out.value.trim();
      return out;
    }
  }

  int idx = rest.indexOf('-');
  if (idx >= 0)
  {
    out.valid = true;
    out.isNull = false;
    out.sensorType = rest.substring(0, idx);
    out.value = rest.substring(idx + 1);
    out.sensorType.trim();
    out.value.trim();
    return out;
  }

  return out;
}

String buildSensorPayloadJson(int senderId, const FrameAsm &fa)
{
  String json;
  json.reserve(1200);

  json += "{\"sensor_controller_id\":\"";
  json += String(senderId);
  json += "\",\"raspberry_serial_id\":\"";
  json += gatewayId;
  json += "\",\"datas\":[";

  for (int p = 1; p <= 8; p++)
  {
    ParsedPortLine pp;
    if (fa.hasPort[p - 1])
    {
      pp = parsePortLine(fa.portLine[p - 1], p);
    }

    if (p > 1)
      json += ",";

    json += "{\"port_number\":";
    json += String(p);
    json += ",\"sensor_type\":";

    if (!pp.valid || pp.isNull)
    {
      json += "null,\"value\":null}";
    }
    else
    {
      json += "\"";
      json += jsonEscape(pp.sensorType);
      json += "\",\"value\":\"";
      json += jsonEscape(pp.value);
      json += "\"}";
    }
  }

  json += "]}";
  return json;
}

String buildGatewayPayloadJson()
{
  String json;
  json.reserve(320);

  json += "{\"raspberry_serial_id\":\"";
  json += gatewayId;
  json += "\",\"datas\":[";

  bool first = true;

  // Pertahankan object temperature demi kompatibilitas backend lama.
  // Kalau backend menolak null, ubah di sini.
  json += "{\"temperature\":null}";
  first = false;

  if (hasRecentGpsFix())
  {
    if (!first)
      json += ",";
    json += "{\"altitude\":";
    json += String(gpsAlt, 1);
    json += ",\"latitude\":";
    json += String(gpsLat, 6);
    json += ",\"longitude\":";
    json += String(gpsLon, 6);

    if (gpsTimestampIso.length() > 0)
    {
      json += ",\"timestamp_gps\":\"";
      json += gpsTimestampIso;
      json += "\"";
    }

    json += "}";
  }

  json += "]}";
  return json;
}

void enqueueGatewaySnapshotIfDue()
{
  static unsigned long lastGatewayEnqueueMs = 0;

  if (millis() - lastGatewayEnqueueMs < GATEWAY_POST_INTERVAL_MS)
    return;
  if (jobCount >= JOB_QUEUE_SIZE - 2)
    return;

  lastGatewayEnqueueMs = millis();
  enqueueJob(GATEWAY_PATH, buildGatewayPayloadJson());
  Serial.println("[QUEUE] Gateway snapshot enqueued");
}

// ========================================================
// ================= ESP-NOW ==============================
// ========================================================

void enqueueEspNowPacket(const uint8_t *mac, const uint8_t *data, int len)
{
  if (len <= 0)
    return;

  portENTER_CRITICAL_ISR(&espNowQueueMux);

  if (espNowQCount >= ESPNOW_QUEUE_SIZE)
  {
    portEXIT_CRITICAL_ISR(&espNowQueueMux);
    return;
  }

  int slot = espNowQTail;
  memcpy(espNowQueue[slot].mac, mac, 6);

  int copyLen = len;
  if (copyLen >= ESPNOW_MAX_DATA_LEN)
    copyLen = ESPNOW_MAX_DATA_LEN - 1;

  memcpy(espNowQueue[slot].data, data, copyLen);
  espNowQueue[slot].data[copyLen] = '\0';
  espNowQueue[slot].len = copyLen;

  espNowQTail = (espNowQTail + 1) % ESPNOW_QUEUE_SIZE;
  espNowQCount++;

  portEXIT_CRITICAL_ISR(&espNowQueueMux);
}

bool popEspNowPacket(EspNowPacket &out)
{
  bool ok = false;

  portENTER_CRITICAL(&espNowQueueMux);
  if (espNowQCount > 0)
  {
    out = espNowQueue[espNowQHead];
    espNowQHead = (espNowQHead + 1) % ESPNOW_QUEUE_SIZE;
    espNowQCount--;
    ok = true;
  }
  portEXIT_CRITICAL(&espNowQueueMux);

  return ok;
}

#if defined(ESP_ARDUINO_VERSION_MAJOR) && (ESP_ARDUINO_VERSION_MAJOR >= 3)
void onEspNowRecv(const esp_now_recv_info_t *info, const uint8_t *data, int len)
{
  enqueueEspNowPacket(info->src_addr, data, len);
}
#else
void onEspNowRecv(const uint8_t *mac_addr, const uint8_t *data, int len)
{
  enqueueEspNowPacket(mac_addr, data, len);
}
#endif

void processOneSensorMessage(const uint8_t *mac_addr, const String &s)
{
  addOrUpdateDevice(mac_addr);

  if (!(s.startsWith("{") && s.endsWith("}")))
  {
    Serial.println("[WARN] Dropped non-JSON payload");
    return;
  }

  int senderId = extractIntField(s, "sender_id");
  int cycle = extractIntField(s, "cycle");
  int port = extractIntField(s, "port");

  if (senderId < 1 || senderId > MAX_SENDER_ID || port < 1 || port > 8 || cycle < 0)
  {
    Serial.println("[WARN] Bad sender_id/port/cycle");
    return;
  }

  FrameAsm &fa = asmBySender[senderId];

  if (frameExpired(fa))
  {
    Serial.printf("[WARN] Frame timeout sid=%d cycle=%u\n", senderId, fa.cycle);
    resetFrame(fa);
  }

  bool hasStart = (s.indexOf("@sensor_data_start") >= 0);
  bool hasEnd = (s.indexOf("@sensor_data_end") >= 0);

  if (hasStart || port == 1)
  {
    if (fa.inFrame && fa.cycle != (uint16_t)cycle)
    {
      resetFrame(fa);
    }
    fa.inFrame = true;
    fa.cycle = (uint16_t)cycle;
    fa.startedAt = millis();
    for (int i = 0; i < 8; i++)
    {
      fa.portLine[i] = "";
      fa.hasPort[i] = false;
    }
  }

  if (!fa.inFrame)
  {
    Serial.printf("[WARN] sid=%d got port=%d but no frame start\n", senderId, port);
    return;
  }

  if (fa.cycle != (uint16_t)cycle)
  {
    Serial.printf("[WARN] sid=%d cycle mismatch active=%u got=%d\n", senderId, fa.cycle, cycle);
    return;
  }

  String line;
  if (extractPortLineFromPayload(s, port, line))
  {
    fa.portLine[port - 1] = line;
    fa.hasPort[port - 1] = true;
  }
  else
  {
    Serial.printf("[WARN] sid=%d cycle=%u port=%d missing p-line\n", senderId, fa.cycle, port);
  }

  if (hasEnd || port == 8)
  {
    String payload = buildSensorPayloadJson(senderId, fa);
    if (enqueueJob(SENSOR_PATH, payload))
    {
      Serial.printf("[QUEUE] sensor payload enqueued sid=%d cycle=%u\n", senderId, fa.cycle);
    }
    else
    {
      Serial.printf("[QUEUE] sensor payload dropped sid=%d cycle=%u\n", senderId, fa.cycle);
    }
    resetFrame(fa);
  }
}

void processEspNowInbox()
{
  EspNowPacket pkt;
  while (popEspNowPacket(pkt))
  {
    String s(pkt.data);
    s.trim();

    Serial.print("[ESPNOW] from ");
    Serial.print(macToString(pkt.mac));
    Serial.print(" -> ");
    Serial.println(s);

    processOneSensorMessage(pkt.mac, s);
  }
}

void setupEspNow()
{
  WiFi.mode(WIFI_STA);

  if (esp_now_init() != ESP_OK)
  {
    Serial.println("ESP-NOW init failed");
    display.clearDisplay();
    display.setCursor(0, 0);
    display.println("ESP-NOW failed");
    display.display();
    while (1)
    {
      delay(1000);
    }
  }

  esp_now_register_recv_cb(onEspNowRecv);
}

// ========================================================
// ================= SETUP / LOOP =========================
// ========================================================

void setup()
{
  Serial.begin(115200);
  delay(1000);
  Serial.println("\n=== ESP32 Gateway Start ===");

  setupDisplay();

  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  initGatewayId();

  Serial.print("Gateway ID: ");
  Serial.println(gatewayId);
  Serial.print("Self MAC: ");
  Serial.println(macToString(selfMac));

  if (SETUP_BUTTON_PIN >= 0)
  {
    pinMode(SETUP_BUTTON_PIN, INPUT_PULLUP);
  }

  setupEspNow();
  updateDisplay(true);

  SerialAT.begin(MODEM_BAUD, SERIAL_8N1, MODEM_RX, MODEM_TX);

  // modem tidak di-init di sini supaya boot portal lebih cepat
  // akan di-init saat memang diperlukan

  if (shouldStartProvisioningAtBoot())
  {
    startProvisioningPortal();
  }
  else
  {
    connectSavedWiFi(12000);
  }

  // snapshot awal
  enqueueJob(GATEWAY_PATH, buildGatewayPayloadJson());

  updateDisplay(true);
}

void loop()
{
  // masuk ke mode provisioning lewat tombol long press
  if (!provisioningMode && setupButtonLongPressed(5000))
  {
    Serial.println("[WIFI] Long press detected. Enter provisioning mode.");

    if (wifiClient.connected())
      wifiClient.stop();
    if (cellClient.connected())
      cellClient.stop();

    WiFi.disconnect(true);
    delay(100);

    startProvisioningPortal();
    updateDisplay(true);
  }

  if (provisioningMode)
  {
    handleProvisioningPortal();
    updateDisplay(false);
    delay(2);
    return;
  }

  processEspNowInbox();
  removeTimedOutPeers();
  pollGpsIfDue();
  enqueueGatewaySnapshotIfDue();
  processHttpQueue();
  updateDisplay(false);
  delay(10);
}