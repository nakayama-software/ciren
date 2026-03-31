#pragma once
#include <Wire.h>
#include <WiFi.h>
#include <WebServer.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include "ciren_config_014424.h"
#include "ring_buffer_014424.h"
#include "system_state_014424.h"

// ─── OLED ─────────────────────────────────────────
static Adafruit_SSD1306 oled(OLED_WIDTH, OLED_HEIGHT, &Wire, -1);
static bool oled_ready = false;

// ─── Button state ─────────────────────────────────
static bool btn_was_down = false;
static uint32_t btn_press_ms = 0;

enum BtnAction
{
  BA_NONE,
  BA_SHORT,
  BA_HOLD5
};

static BtnAction btn_tick()
{
  static uint32_t debounce_ms = 0;
  bool down = (digitalRead(PIN_BTN) == LOW);
  BtnAction act = BA_NONE;

  if (down && !btn_was_down)
  {
    if (millis() - debounce_ms > BTN_DEBOUNCE_MS)
    {
      btn_was_down = true;
      btn_press_ms = millis();
    }
    debounce_ms = millis();
  }
  if (!down && btn_was_down)
  {
    uint32_t held = millis() - btn_press_ms;
    btn_was_down = false;
    if (held >= BTN_HOLD_MS)
      act = BA_HOLD5;
    else if (held >= BTN_DEBOUNCE_MS)
      act = BA_SHORT;
  }
  return act;
}

static uint32_t btn_held_ms()
{
  return btn_was_down ? millis() - btn_press_ms : 0;
}

// ─── OLED page ────────────────────────────────────
static int oled_page = PAGE_GATEWAY;

// ─── WiFi provisioning portal ─────────────────────
static WebServer portal_server(PORTAL_PORT);
static bool portal_active = false;
static bool reboot_pending = false;
static uint32_t reboot_at_ms = 0;
static String portal_ssid = "";
static String portal_scan_html = "";

static String html_esc(const String &s)
{
  String o;
  for (size_t i = 0; i < s.length(); i++)
  {
    char c = s[i];
    if (c == '&')
      o += "&amp;";
    else if (c == '<')
      o += "&lt;";
    else if (c == '>')
      o += "&gt;";
    else if (c == '"')
      o += "&quot;";
    else
      o += c;
  }
  return o;
}

static String build_scan_html()
{
  int n = WiFi.scanNetworks();
  String h = "<div style='margin:8px 0'><b>Available Networks</b><br>";
  if (n <= 0)
    h += "None found.<br>";
  else
    for (int i = 0; i < n; i++)
    {
      h += "<label style='display:block;padding:4px 0'>"
           "<input type='radio' name='ssid' value='" +
           html_esc(WiFi.SSID(i)) + "'> ";
      h += html_esc(WiFi.SSID(i)) + " (RSSI " + String(WiFi.RSSI(i)) + ")</label>";
    }
  WiFi.scanDelete();
  h += "</div>";
  return h;
}

static String build_portal_page(const String &msg = "", bool ok = false)
{
  String h;
  h += "<!doctype html><html><head><meta charset='utf-8'>"
       "<meta name='viewport' content='width=device-width,initial-scale=1'>"
       "<title>CIREN Setup</title></head>"
       "<body style='font-family:sans-serif;max-width:600px;margin:20px auto;padding:0 12px'>";
  h += "<h2>CIREN WiFi Setup</h2>"
       "<p><b>Device:</b> " +
       String(DEVICE_ID) + " | <b>FW:</b> " + String(FW_VERSION) + "</p>";
  if (msg.length())
  {
    h += "<div style='padding:10px;border-radius:6px;margin:10px 0;background:";
    h += ok ? "#e7f7e7;color:#145214" : "#fdeaea;color:#7a1010";
    h += "'>" + html_esc(msg) + "</div>";
  }
  h += "<form method='POST' action='/save'>" + portal_scan_html;
  h += "<p><a href='/refresh' style='font-size:13px'>Refresh list</a></p>";
  h += "<div style='margin:8px 0'><b>Manual SSID</b><br>"
       "<input name='ssid_m' placeholder='Type SSID' style='width:100%;padding:7px'></div>";
  h += "<div style='margin:8px 0'><b>Password</b><br>"
       "<input type='password' name='pass' placeholder='WiFi Password' style='width:100%;padding:7px'></div>";
  h += "<button type='submit' style='padding:10px 18px'>Save &amp; Reboot</button></form>";
  h += "</body></html>";
  return h;
}

static void portal_loading_anim()
{
  auto frame = [](int pct, const char *m1, const char *m2)
  {
    oled.clearDisplay();
    oled.setTextSize(1);
    oled.setTextColor(WHITE);
    oled.setCursor(0, 8);
    oled.println(m1);
    oled.setCursor(0, 22);
    oled.println(m2);
    oled.drawRect(0, 38, 128, 12, WHITE);
    int f = (pct * 126) / 100;
    if (f > 0)
      oled.fillRect(1, 39, f, 10, WHITE);
    oled.display();
  };
  for (int p = 0; p <= 40; p += 4)
  {
    frame(p, "WiFi Setup", "Preparing...");
    delay(40);
  }
  for (int p = 40; p <= 75; p += 3)
  {
    frame(p, "WiFi Setup", "Scanning...");
    delay(30);
  }
}

static void portal_ready_anim(const String &ap)
{
  for (int p = 75; p <= 100; p += 5)
  {
    oled.clearDisplay();
    oled.setTextSize(1);
    oled.setTextColor(WHITE);
    oled.setCursor(0, 8);
    oled.println("WiFi Setup Ready!");
    oled.drawRect(0, 22, 128, 12, WHITE);
    int f = (p * 126) / 100;
    if (f > 0)
      oled.fillRect(1, 23, f, 10, WHITE);
    oled.setCursor(0, 40);
    oled.print("AP: ");
    oled.println(ap);
    oled.setCursor(0, 52);
    oled.println("192.168.4.1");
    oled.display();
    delay(40);
  }
  delay(800);
}

static Preferences *_prefs_ptr = nullptr;

static void portal_start(Preferences *prefs)
{
  _prefs_ptr = prefs;
  portal_loading_anim();

  // Buat AP SSID dari 4 karakter terakhir MAC
  uint8_t mac[6];
  WiFi.macAddress(mac);
  char suffix[5];
  snprintf(suffix, sizeof(suffix), "%02X%02X", mac[4], mac[5]);
  portal_ssid = String("CIREN-") + suffix;

  WiFi.disconnect();
  delay(50);
  WiFi.mode(WIFI_AP_STA);
  WiFi.softAPConfig(
      IPAddress(192, 168, 4, 1),
      IPAddress(192, 168, 4, 1),
      IPAddress(255, 255, 255, 0));
  WiFi.softAP(portal_ssid.c_str(), PORTAL_PASS, 1, 0, 4);
  portal_scan_html = build_scan_html();

  portal_server.on("/", HTTP_GET, []()
                   { portal_server.send(200, "text/html", build_portal_page()); });
  portal_server.on("/refresh", HTTP_GET, []()
                   {
    portal_scan_html = build_scan_html();
    portal_server.sendHeader("Location", "/");
    portal_server.send(302, "text/plain", ""); });
  portal_server.on("/save", HTTP_POST, []()
                   {
    String ssid = portal_server.arg("ssid");
    String ssid_m = portal_server.arg("ssid_m");
    String pass = portal_server.arg("pass");
    ssid.trim(); ssid_m.trim(); pass.trim();
    if (ssid.length() == 0) ssid = ssid_m;
    if (ssid.length() == 0) {
      portal_server.send(400, "text/html", build_portal_page("SSID empty.", false));
      return;
    }
    if (_prefs_ptr) {
      _prefs_ptr->begin("ciren", false);
      _prefs_ptr->putString("ssid", ssid);
      _prefs_ptr->putString("pass", pass);
      _prefs_ptr->end();
    }
    portal_server.send(200, "text/html", build_portal_page("Saved! Rebooting in 2s...", true));
    reboot_pending = true;
    reboot_at_ms   = millis() + 2000; });
  portal_server.onNotFound([]()
                           {
    portal_server.sendHeader("Location", "/");
    portal_server.send(302, "text/plain", ""); });
  portal_server.begin();

  portal_ready_anim(portal_ssid);
  portal_active = true;

  Serial.printf("[PORTAL] AP=%s Pass=%s\n", portal_ssid.c_str(), PORTAL_PASS);
}

static void portal_tick()
{
  if (portal_active)
    portal_server.handleClient();
  if (reboot_pending && millis() >= reboot_at_ms)
    esp_restart();
}

// ─── OLED helpers ─────────────────────────────────
static void oled_page_dots()
{
  for (int i = 0; i < OLED_TOTAL_PAGES; i++)
  {
    int px = OLED_WIDTH - (OLED_TOTAL_PAGES - i) * 7;
    if (i == oled_page)
      oled.fillRect(px, 0, 5, 4, WHITE);
    else
      oled.drawRect(px, 0, 5, 4, WHITE);
  }
}

static void oled_pbar(int x, int y, int w, int h, float pct)
{
  oled.drawRect(x, y, w, h, WHITE);
  int f = (int)(pct * (float)(w - 2));
  if (f > 0)
    oled.fillRect(x + 1, y + 1, f, h - 2, WHITE);
}

static bool has_recent_gps_fix()
{
  return sys_state.gps_fix && (millis() - sys_state.gps_fix_ms <= GPS_STALE_MS);
}

static void oled_draw()
{
  if (!oled_ready)
    return;
  oled.clearDisplay();
  oled.setTextSize(1);
  oled.setTextColor(WHITE);
  oled.setTextWrap(false);

  uint32_t held_ms = btn_held_ms();

  // Hold progress overlay — hanya di halaman action
  bool on_action_page = (oled_page == PAGE_SETTINGS || oled_page == PAGE_SIM_CTRL);
  if (on_action_page && held_ms >= 1000)
  {
    float pct = min(1.0f, (float)held_ms / (float)BTN_HOLD_MS);
    oled.setCursor(0, 2);
    oled.println("Hold to confirm...");
    oled_pbar(0, 18, 128, 12, pct);
    oled.setCursor(0, 38);
    if (oled_page == PAGE_SETTINGS)
      oled.println(portal_active ? "Release = Reset WiFi" : "Release = WiFi Setup");
    else
      oled.printf("Release = SIM %s", sys_state.sim_enabled ? "DISABLE" : "ENABLE");
    oled.setCursor(0, 52);
    float rem = max(0.0f, ((float)BTN_HOLD_MS - (float)held_ms) / 1000.0f);
    oled.printf("%.1f s remaining", rem);
    oled.display();
    return;
  }

  oled_page_dots();

  switch (oled_page)
  {

    // ── Page 0: Gateway ───────────────────────────
  case PAGE_GATEWAY:
  {
    uint8_t _mac[6];
    WiFi.macAddress(_mac);
    oled.setCursor(0, 8);
    oled.println("CIREN Gateway");
    oled.setCursor(0, 20);
    oled.printf("%s %s", sys_state.conn_mode, sys_state.is_connected ? "[OK]" : "[--]");
    oled.setCursor(0, 32);
    oled.printf("RSSI: %ddBm", sys_state.rssi);
    oled.setCursor(0, 44);
    oled.printf("BUF:%.0f%% Up:%lus", rb_usage() * 100, millis() / 1000);
    oled.setCursor(0, 56);
    oled.printf("%02X:%02X:%02X:%02X:%02X:%02X",
                _mac[0], _mac[1], _mac[2], _mac[3], _mac[4], _mac[5]);
    break;
  }

  // ── Page 1: WiFi ──────────────────────────────
  case PAGE_WIFI:
  {
    oled.setCursor(0, 8);
    oled.println("WiFi");
    if (WiFi.status() == WL_CONNECTED)
    {
      oled.setCursor(0, 20);
      oled.printf("RSSI: %ddBm", WiFi.RSSI());
      oled.setCursor(0, 32);
      oled.print("IP: ");
      oled.println(WiFi.localIP().toString());
      oled.setCursor(0, 44);
      oled.print("SSID: ");
      String ssid = WiFi.SSID();
      oled.println(ssid.length() > 14 ? ssid.substring(0, 14) + ".." : ssid);
      oled.setCursor(0, 56);
      oled.println("Connected");
    }
    else
    {
      oled.setCursor(0, 20);
      oled.println("Not connected");
      oled.setCursor(0, 36);
      oled.println("Go to Settings");
      oled.setCursor(0, 48);
      oled.println("to configure WiFi");
    }
    break;
  }

  // ── Page 2: SIM ───────────────────────────────
  case PAGE_SIM:
  {
    oled.setCursor(0, 8);
    oled.println("SIM7600X");
    if (!sys_state.sim_enabled)
    {
      oled.setCursor(0, 24);
      oled.println("Module disabled");
      oled.setCursor(0, 40);
      oled.println("Page 5 = SIM Control");
      break;
    }
    oled.setCursor(0, 20);
    oled.printf("Modem: %s",
                sys_state.sim_modem_ok ? "OK" : "Init...");
    if (sys_state.sim_modem_ok)
    {
      String op = String(sys_state.sim_operator);
      oled.setCursor(0, 32);
      oled.print("Op: ");
      oled.println(op.length() > 13 ? op.substring(0, 13) : op);
      oled.setCursor(0, 44);
      oled.printf("Sig:%d/31 GPRS:%s",
                  sys_state.sim_signal, sys_state.sim_gprs ? "ON" : "OFF");
    }
    break;
  }

  // ── Page 3: GPS ───────────────────────────────
  case PAGE_GPS:
  {
    oled.setCursor(0, 8);
    oled.println("GPS");
    if (!sys_state.sim_enabled)
    {
      oled.setCursor(0, 24);
      oled.println("SIM disabled");
      oled.setCursor(0, 40);
      oled.println("GPS not available");
      break;
    }
    if (!sys_state.gps_fix)
    {
      oled.setCursor(0, 20);
      oled.println("No fix");
      oled.setCursor(0, 36);
      oled.println("Check antenna");
      oled.setCursor(0, 48);
      oled.println("(outdoor)");
    }
    else
    {
      oled.setCursor(0, 20);
      oled.printf("Lat: %.5f", sys_state.gps_lat);
      oled.setCursor(0, 32);
      oled.printf("Lon: %.5f", sys_state.gps_lon);
      oled.setCursor(0, 44);
      oled.printf("Alt: %.1fm", sys_state.gps_alt);
      oled.setCursor(0, 56);
      oled.printf("Fix: %lus ago",
                  (millis() - sys_state.gps_fix_ms) / 1000);
    }
    break;
  }

  // ── Page 4: Settings ──────────────────────────
  case PAGE_SETTINGS:
  {
    oled.setCursor(0, 8);
    oled.println("WiFi Settings");
    if (portal_active)
    {
      oled.setCursor(0, 22);
      oled.print("AP: ");
      oled.println(portal_ssid);
      oled.setCursor(0, 34);
      oled.print("PW: ");
      oled.println(PORTAL_PASS);
      oled.setCursor(0, 46);
      oled.println("192.168.4.1");
    }
    else if (WiFi.status() != WL_CONNECTED)
    {
      oled.setCursor(0, 22);
      oled.println("Not connected");
      oled.setCursor(0, 40);
      oled.println("Hold 5s = WiFi Setup");
    }
    else
    {
      String ssid = WiFi.SSID();
      oled.setCursor(0, 20);
      oled.print("SSID: ");
      oled.println(ssid.length() > 14 ? ssid.substring(0, 14) + ".." : ssid);
      oled.setCursor(0, 32);
      oled.println("Connected");
      oled.setCursor(0, 48);
      oled.println("Hold 5s = Change WiFi");
    }
    // POST status di pojok kanan atas
    oled.fillRect(90, 0, 38, 6, BLACK);
    oled.setCursor(90, 0);
    if (sys_state.last_status_code == 200)
      oled.println("PUB:OK");
    else if (sys_state.last_status_code > 0)
      oled.printf("PUB:%d", sys_state.last_status_code);
    else
      oled.println("PUB:--");
    break;
  }

  // ── Page 5: SIM Control ───────────────────────
  case PAGE_SIM_CTRL:
  {
    oled.setCursor(0, 8);
    oled.println("SIM Control");
    oled.setCursor(0, 20);
    oled.print("Status: ");
    if (sys_state.sim_enabled)
    {
      oled.println("ENABLED");
      oled.setCursor(0, 32);
      oled.printf("Modem: %s",
                  sys_state.sim_modem_ok ? "OK" : "Init...");
      oled.setCursor(0, 44);
      oled.printf("GPRS: %s",
                  sys_state.sim_gprs ? "ON" : "OFF");
    }
    else
    {
      oled.println("DISABLED");
      oled.setCursor(0, 36);
      oled.println("Hold 5s = Enable");
    }
    break;
  }
  }

  oled.display();
}

// ─── Init ─────────────────────────────────────────
void btn_oled_init()
{
  Wire.begin(PIN_OLED_SDA, PIN_OLED_SCL);
  pinMode(PIN_BTN, INPUT_PULLUP);

  if (oled.begin(SSD1306_SWITCHCAPVCC, OLED_ADDR))
  {
    oled_ready = true;
    oled.setTextSize(1);
    oled.setTextColor(WHITE);
    oled.setTextWrap(false);
    oled.clearDisplay();
    oled.setCursor(0, 0);
    oled.println("CIREN " FW_VERSION);
    oled.setCursor(0, 16);
    oled.println("Booting...");
    oled.display();
  }
  else
  {
    Serial.println("[OLED] Init failed");
  }
}

// ─── Task ─────────────────────────────────────────
void task_oled(void *param)
{
  Preferences *prefs = (Preferences *)param;

  for (;;)
  {
    vTaskDelay(pdMS_TO_TICKS(OLED_REFRESH_MS));

    portal_tick();

    BtnAction act = btn_tick();

    if (act == BA_SHORT)
    {
      oled_page = (oled_page + 1) % OLED_TOTAL_PAGES;
      Serial.printf("[BTN] Page -> %d\n", oled_page);
    }
    else if (act == BA_HOLD5)
    {
      if (oled_page == PAGE_SETTINGS)
      {
        if (!portal_active)
        {
          Serial.println("[BTN] Hold 5s — starting WiFi portal");
          portal_start(prefs);
        }
        else
        {
          // Reset WiFi credentials + reboot
          if (prefs)
          {
            prefs->begin("ciren", false);
            prefs->remove("ssid");
            prefs->remove("pass");
            prefs->end();
          }
          oled.clearDisplay();
          oled.setCursor(0, 18);
          oled.println("WiFi credentials");
          oled.setCursor(0, 32);
          oled.println("deleted!");
          oled.setCursor(0, 48);
          oled.println("Rebooting...");
          oled.display();
          delay(1500);
          esp_restart();
        }
      }
      else if (oled_page == PAGE_SIM_CTRL)
      {
        // Toggle SIM enable/disable
        bool new_val = !sys_state.sim_enabled;
        if (prefs)
        {
          prefs->begin("ciren", false);
          prefs->putBool("sim_en", new_val);
          prefs->end();
        }
        oled.clearDisplay();
        oled.setCursor(0, 10);
        oled.println("SIM Module:");
        oled.setCursor(0, 26);
        oled.printf("-> %s", new_val ? "ENABLED" : "DISABLED");
        oled.setCursor(0, 44);
        oled.println("Rebooting...");
        oled.display();
        delay(1500);
        esp_restart();
      }
    }

    oled_draw();
  }
}
