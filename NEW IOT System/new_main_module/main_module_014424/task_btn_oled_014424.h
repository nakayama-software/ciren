#pragma once
#include <SPI.h>
#include <WiFi.h>
#include <WebServer.h>
#include <Adafruit_GFX.h>
#include <Adafruit_ILI9341.h>
#include "ciren_config_014424.h"
#include "ring_buffer_014424.h"
#include "system_state_014424.h"
#include "logo_014424.h"


// ─── TFT instance ────────────────────────────────────────────────────────────
// Hardware SPI — pin dikonfigurasi lewat SPI.begin() di btn_oled_init()
// sebelum tft.begin() dipanggil.
static Adafruit_ILI9341 tft(PIN_TFT_CS, PIN_TFT_DC, PIN_TFT_RST);
static bool tft_ready = false;

// ─── Color palette (RGB565) ──────────────────────────────────────────────────
#define C_BG         0x0000   // black background
#define C_HDR_BG     0x01EA   // dark teal  rgb(0,60,80)
#define C_CARD       0x10A4   // dark card  rgb(16,20,32)
#define C_SEP        0x2967   // separator  rgb(40,44,56)
#define C_ACCENT     0x07FF   // cyan
#define C_WHITE      0xFFFF
#define C_GRAY       0x6370   // label gray rgb(96,108,128)
#define C_DGRAY      0x2945   // dark gray
#define C_GREEN      0x07E0
#define C_RED        0xF800
#define C_YELLOW     0xFFE0
#define C_ORANGE     0xFD20
#define C_NAVY       0x000F
#define C_DARKRED    0x6000   // rgb(96,0,0)

// ─── Layout constants ────────────────────────────────────────────────────────
#define HDR_H     34      // header bar height
#define FTR_Y     222     // footer separator y
#define CONT_Y    (HDR_H + 3)   // content area start y = 37
#define PAD       10      // horizontal padding

// ─── Button state ────────────────────────────────────────────────────────────
static bool     btn_was_down = false;
static uint32_t btn_press_ms = 0;

enum BtnAction { BA_NONE, BA_SHORT, BA_HOLD5 };

static BtnAction btn_tick()
{
  static uint32_t debounce_ms = 0;
  bool down = (digitalRead(PIN_BTN) == LOW);
  BtnAction act = BA_NONE;
  if (down && !btn_was_down) {
    if (millis() - debounce_ms > BTN_DEBOUNCE_MS) {
      btn_was_down = true;
      btn_press_ms = millis();
    }
    debounce_ms = millis();
  }
  if (!down && btn_was_down) {
    uint32_t held = millis() - btn_press_ms;
    btn_was_down  = false;
    if (held >= BTN_HOLD_MS)           act = BA_HOLD5;
    else if (held >= BTN_DEBOUNCE_MS)  act = BA_SHORT;
  }
  return act;
}

static uint32_t btn_held_ms()
{
  return btn_was_down ? millis() - btn_press_ms : 0;
}

// ─── Page state ──────────────────────────────────────────────────────────────
static int  tft_page       = PAGE_GATEWAY;
static bool page_dirty     = true;   // force full redraw on first tick
static bool hold_overlay   = false;  // hold-progress overlay is showing

// ─── WiFi provisioning portal ────────────────────────────────────────────────
static WebServer portal_server(PORTAL_PORT);
static bool     portal_active    = false;
static bool     reboot_pending   = false;
static uint32_t reboot_at_ms     = 0;
static String   portal_ssid      = "";
static String   portal_scan_html = "";

static String html_esc(const String &s)
{
  String o;
  for (size_t i = 0; i < s.length(); i++) {
    char c = s[i];
    if      (c == '&') o += "&amp;";
    else if (c == '<') o += "&lt;";
    else if (c == '>') o += "&gt;";
    else if (c == '"') o += "&quot;";
    else               o += c;
  }
  return o;
}

// Konversi RSSI ke jumlah bar (0–4) dan label kualitas
static const char* _rssi_label(int rssi) {
  if (rssi >= -50) return "Excellent";
  if (rssi >= -65) return "Good";
  if (rssi >= -75) return "Fair";
  return "Weak";
}
static int _rssi_bars(int rssi) {
  if (rssi >= -50) return 4;
  if (rssi >= -65) return 3;
  if (rssi >= -75) return 2;
  return 1;
}

// Render SVG signal bars (4 bars, filled sesuai kekuatan sinyal)
static String _signal_svg(int bars) {
  // 4 bar dengan tinggi 4/7/10/13px
  String s = "<svg width='20' height='14' viewBox='0 0 20 14' style='vertical-align:middle;margin-right:6px'>";
  int heights[] = {4, 7, 10, 14};
  const char* filled_clr  = "#22c55e";  // green
  const char* empty_clr   = "#334155";  // slate
  for (int i = 0; i < 4; i++) {
    int x  = i * 5;
    int h  = heights[i];
    int y  = 14 - h;
    s += "<rect x='" + String(x) + "' y='" + String(y) +
         "' width='4' height='" + String(h) +
         "' rx='1' fill='" + (i < bars ? filled_clr : empty_clr) + "'/>";
  }
  s += "</svg>";
  return s;
}

static String build_scan_html()
{
  int n = WiFi.scanNetworks();

  String h = "<div class='section-label'>Available Networks</div>";

  if (n <= 0) {
    h += "<div class='empty-state'>No networks found</div>";
  } else {
    h += "<div class='network-list'>";
    for (int i = 0; i < n; i++) {
      int    rssi  = WiFi.RSSI(i);
      int    bars  = _rssi_bars(rssi);
      bool   open  = (WiFi.encryptionType(i) == WIFI_AUTH_OPEN);
      String ssid  = html_esc(WiFi.SSID(i));
      String idstr = "net" + String(i);

      h += "<label class='network-item' for='" + idstr + "'>";
      h += "<input type='radio' id='" + idstr +
           "' name='ssid' value='" + ssid + "'>";
      h += "<span class='check-dot'></span>";
      h += "<span class='network-info'>";
      h += _signal_svg(bars);
      h += "<span class='network-name'>" + ssid + "</span>";
      if (!open) h += "<span class='lock-icon'>&#x1F512;</span>";
      h += "</span>";
      h += "<span class='network-meta'>" + String(rssi) + " dBm &bull; " +
           _rssi_label(rssi) + "</span>";
      h += "</label>";
    }
    h += "</div>";
  }
  WiFi.scanDelete();
  return h;
}

static String _portal_mqtt_host;
static String _portal_sim_apn;
static String _portal_sim_user;
static String _portal_sim_pass;
static String _portal_device_id;

static String build_portal_page(const String &msg = "", bool ok = false)
{
  String h;
  h += F("<!doctype html><html lang='en'><head>"
         "<meta charset='utf-8'>"
         "<meta name='viewport' content='width=device-width,initial-scale=1'>"
         "<title>CIREN Setup</title>"
         "<style>"
         "*{box-sizing:border-box;margin:0;padding:0}"
         "body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;"
               "background:#0f172a;color:#e2e8f0;min-height:100vh;"
               "display:flex;align-items:flex-start;justify-content:center;padding:16px}"
         ".card{background:#1e293b;border:1px solid #334155;border-radius:16px;"
               "width:100%;max-width:480px;overflow:hidden;margin-top:16px}"
         ".header{background:linear-gradient(135deg,#0e7490,#1e40af);"
                 "padding:24px;text-align:center}"
         ".header-dot{width:48px;height:48px;background:rgba(255,255,255,.15);"
                      "border-radius:12px;display:inline-flex;align-items:center;"
                      "justify-content:center;margin-bottom:12px;"
                      "font-size:24px;line-height:1}"
         ".header h1{font-size:20px;font-weight:700;color:#fff;letter-spacing:.5px}"
         ".header p{font-size:12px;color:rgba(255,255,255,.6);margin-top:4px}"
         ".body{padding:24px}"
         ".section-label{font-size:11px;font-weight:600;text-transform:uppercase;"
                         "letter-spacing:.08em;color:#64748b;margin-bottom:10px}"
         ".network-list{display:flex;flex-direction:column;gap:6px;margin-bottom:20px}"
         ".network-item{display:flex;align-items:center;justify-content:space-between;"
                        "background:#0f172a;border:2px solid #334155;border-radius:10px;"
                        "padding:12px 14px;cursor:pointer;transition:all .15s}"
         ".network-item:has(input:checked){border-color:#0ea5e9;background:#0c2a3d;"
                                          "box-shadow:0 0 0 3px rgba(14,165,233,0.2)}"
         ".network-item:has(input:checked) .network-name{color:#0ea5e9;font-weight:700}"
         ".network-item:has(input:checked) .check-dot{display:block}"
         ".check-dot{display:none;width:8px;height:8px;border-radius:50%;"
                    "background:#0ea5e9;flex-shrink:0;margin-right:6px}"
         ".network-item input{position:absolute;opacity:0;pointer-events:none}"
         ".network-info{display:flex;align-items:center;gap:4px;font-size:14px;font-weight:500}"
         ".network-name{color:#f1f5f9;transition:color .15s}"
         ".lock-icon{font-size:11px;margin-left:4px;opacity:.5}"
         ".network-meta{font-size:11px;color:#64748b;white-space:nowrap}"
         ".empty-state{text-align:center;padding:20px;color:#64748b;"
                       "font-size:13px;margin-bottom:20px}"
         ".divider{display:flex;align-items:center;gap:10px;margin:20px 0;color:#475569;font-size:12px}"
         ".divider::before,.divider::after{content:'';flex:1;height:1px;background:#334155}"
         ".field{margin-bottom:16px}"
         ".field label{display:block;font-size:12px;font-weight:500;color:#94a3b8;margin-bottom:6px}"
         ".field input{width:100%;background:#0f172a;border:1px solid #334155;border-radius:8px;"
                       "padding:10px 14px;color:#f1f5f9;font-size:14px;outline:none;transition:border-color .15s}"
         ".field input:focus{border-color:#0ea5e9}"
         ".field input::placeholder{color:#475569}"
         ".btn-row{display:flex;gap:10px;margin-top:8px}"
         ".btn{flex:1;padding:12px;border:none;border-radius:10px;font-size:14px;"
               "font-weight:600;cursor:pointer;transition:opacity .15s}"
         ".btn-primary{background:linear-gradient(135deg,#0ea5e9,#2563eb);color:#fff}"
         ".btn-secondary{background:#1e293b;border:1px solid #334155;color:#94a3b8}"
         ".btn:active{opacity:.85}"
         ".alert{padding:12px 14px;border-radius:10px;font-size:13px;margin-bottom:20px;"
                 "display:flex;align-items:center;gap:10px}"
         ".alert-ok{background:#052e16;border:1px solid #166534;color:#4ade80}"
         ".alert-err{background:#2d0a0a;border:1px solid #7f1d1d;color:#f87171}"
         ".alert-icon{font-size:16px;flex-shrink:0}"
         ".meta{font-size:11px;color:#475569;text-align:center;margin-top:16px}"
         "</style>"
         "</head><body><div class='card'>");

  // Header
  h += "<div class='header'>"
       "<div class='header-dot'>&#x1F4F6;</div>"
       "<h1>CIREN WiFi Setup</h1>"
       "<p>Device: " + String(sys_state.device_id) + " &nbsp;&bull;&nbsp; Firmware v" + String(FW_VERSION) + "</p>"
       "</div>";

  h += "<div class='body'>";

  // Alert message
  if (msg.length()) {
    h += "<div class='alert " + String(ok ? "alert-ok" : "alert-err") + "'>"
         "<span class='alert-icon'>" + String(ok ? "&#x2713;" : "&#x26A0;") + "</span>"
         "<span>" + html_esc(msg) + "</span></div>";
  }

  // Form
  h += "<form method='POST' action='/save'>";

  // Network list
  h += portal_scan_html;

  // Refresh link
  h += "<div style='text-align:right;margin-bottom:20px'>"
       "<a href='/refresh' style='font-size:12px;color:#0ea5e9;text-decoration:none'>"
       "&#x21BB; Refresh networks</a></div>";

  // Divider
  h += "<div class='divider'>or enter manually</div>";

  // Manual SSID
  h += "<div class='field'><label>Network Name (SSID)</label>"
       "<input name='ssid_m' placeholder='Enter WiFi name' autocomplete='off'></div>";

  // Password (shown as plain text for easy entry on mobile)
  h += "<div class='field'><label>Password</label>"
       "<input type='text' name='pass' placeholder='Enter WiFi password' autocomplete='off'></div>";

  // Advanced: Device ID + MQTT + SIM APN
  h += "<div style='margin:20px 0 16px;border-top:1px solid #334155;padding-top:16px'>"
       "<p class='section-label'>Advanced</p>"
       "<div class='field'><label>Device ID <span style='color:#475569'>(leave blank for auto-generated)</span></label>"
       "<input type='text' name='device_id' value='" + html_esc(_portal_device_id) + "' "
       "placeholder='e.g. MM-A1B2C3' autocomplete='off' maxlength='31'></div>"
       "<div class='field'><label>MQTT Broker IP</label>"
       "<input type='text' name='mqtt_host' value='" + html_esc(_portal_mqtt_host) + "' "
       "placeholder='e.g. 118.22.31.254' autocomplete='off'></div>"
       "</div>"
       "<div style='margin:0 0 16px;border-top:1px solid #334155;padding-top:16px'>"
       "<p class='section-label'>SIM Card APN</p>"
       "<div class='field'><label>APN</label>"
       "<input type='text' name='sim_apn' value='" + html_esc(_portal_sim_apn) + "' "
       "placeholder='e.g. internet' autocomplete='off'></div>"
       "<div class='field'><label>APN Username <span style='color:#475569'>(leave blank if none)</span></label>"
       "<input type='text' name='sim_user' value='" + html_esc(_portal_sim_user) + "' "
       "placeholder='optional' autocomplete='off'></div>"
       "<div class='field'><label>APN Password <span style='color:#475569'>(leave blank if none)</span></label>"
       "<input type='text' name='sim_pass' value='" + html_esc(_portal_sim_pass) + "' "
       "placeholder='optional' autocomplete='off'></div>"
       "</div>";

  // Buttons
  h += "<div class='btn-row'>"
       "<button type='submit' class='btn btn-primary'>Save &amp; Reboot</button>"
       "</div>";

  h += "</form>";

  h += "<p class='meta'>After saving, reconnect to your usual WiFi network.</p>";

  h += "</div></div></body></html>";
  return h;
}

// ─── Drawing primitives ──────────────────────────────────────────────────────

// Horizontal progress bar with border
static void tft_hbar(int x, int y, int w, int h, float pct, uint16_t clr)
{
  tft.drawRoundRect(x, y, w, h, 3, C_SEP);
  int inner = w - 4;
  int fill  = (int)(pct * inner);
  if (fill > 0)
    tft.fillRoundRect(x + 2, y + 2, fill, h - 4, 2, clr);
  if (fill < inner)
    tft.fillRect(x + 2 + fill, y + 2, inner - fill, h - 4, C_BG);
}

// Filled pill badge
static void tft_badge(int x, int y, const char *text, uint16_t bg, uint16_t fg, uint8_t sz = 1)
{
  int tw = (int)strlen(text) * sz * 6;
  int th = sz * 8;
  tft.fillRoundRect(x, y, tw + 12, th + 8, 4, bg);
  tft.setTextSize(sz);
  tft.setTextColor(fg, bg);
  tft.setCursor(x + 6, y + 4);
  tft.print(text);
}

// Section label — large cyan text, easy to read for elderly users
static void tft_section(int x, int y, const char *label)
{
  tft.setTextSize(2);
  tft.setTextColor(C_ACCENT, C_BG);
  tft.setCursor(x, y);
  tft.print(label);
  // Callers should add y += 22 after this (16px text + 6px gap)
}

// WiFi/SIM signal bars (5 vertical bars)
static void tft_signal_bars(int x, int y, float pct, uint16_t clr = C_GREEN)
{
  int n = (int)(pct * 5.0f + 0.5f);
  for (int i = 0; i < 5; i++) {
    int bh = 5 + i * 5;
    int bx = x + i * 8;
    int by = y + (25 - bh);
    tft.fillRect(bx, by, 6, bh, i < n ? clr : C_DGRAY);
  }
}

// Status dot (filled circle)
static void tft_dot(int cx, int cy, uint16_t clr)
{
  tft.fillCircle(cx, cy, 5, clr);
  tft.drawCircle(cx, cy, 5, C_BG);  // anti-alias edge
}

// ─── Header & footer ─────────────────────────────────────────────────────────
static const char *_page_titles[] = {
  "Gateway", "WiFi", "SIM", "GPS", "Settings", "SIM Control"
};

static void tft_draw_header()
{
  tft.fillRect(0, 0, TFT_WIDTH, HDR_H, C_HDR_BG);
  // Accent circle
  tft.fillCircle(16, HDR_H / 2, 6, C_ACCENT);
  tft.drawCircle(16, HDR_H / 2, 8, C_ACCENT);
  // "CIREN" brand
  tft.setTextSize(2);
  tft.setTextColor(C_WHITE, C_HDR_BG);
  tft.setCursor(28, (HDR_H - 16) / 2);
  tft.print("CIREN");
  // Page title
  tft.setTextSize(1);
  tft.setTextColor(C_ACCENT, C_HDR_BG);
  tft.setCursor(90, (HDR_H - 8) / 2 + 2);
  if (tft_page >= 0 && tft_page < OLED_TOTAL_PAGES)
    tft.print(_page_titles[tft_page]);
  // Page indicator dots
  for (int i = 0; i < OLED_TOTAL_PAGES; i++) {
    int dx = TFT_WIDTH - (OLED_TOTAL_PAGES - i) * 14 + 4;
    int dy = HDR_H / 2;
    if (i == tft_page)
      tft.fillCircle(dx, dy, 4, C_ACCENT);
    else
      tft.drawCircle(dx, dy, 3, C_GRAY);
  }
}

static void tft_draw_footer()
{
  tft.drawFastHLine(0, FTR_Y, TFT_WIDTH, C_SEP);
  tft.fillRect(0, FTR_Y + 1, TFT_WIDTH, TFT_HEIGHT - FTR_Y - 1, C_BG);

  // Device ID + version (left)
  tft.setTextSize(1);
  tft.setTextColor(C_WHITE, C_BG);
  tft.setCursor(PAD, FTR_Y + 5);
  tft.printf("%s  v%s", sys_state.device_id, FW_VERSION);

  // Company logo (right-aligned)
  int lx = TFT_WIDTH - LOGO_FOOTER_W - PAD;
  int ly = FTR_Y + (TFT_HEIGHT - FTR_Y - LOGO_FOOTER_H) / 2;
  tft.drawRGBBitmap(lx, ly, LOGO_FOOTER, LOGO_FOOTER_W, LOGO_FOOTER_H);
}

// ─── Page: Gateway ───────────────────────────────────────────────────────────
static void _draw_gateway()
{
  int y = CONT_Y;

  // ── Device MAC ──
  tft_section(PAD, y, "DEVICE");
  y += 22;

  tft.setTextSize(1);
  tft.setTextColor(C_WHITE, C_BG);
  tft.setCursor(PAD, y);
  tft.print("MAC: ");
  tft.setTextColor(C_ACCENT, C_BG);
  tft.print(WiFi.macAddress().c_str());
  y += 18;

  // ── Connection mode + server status ──
  tft_section(PAD, y, "CONNECTION");
  y += 22;

  bool wifi_mode = (strncmp(sys_state.conn_mode, "wifi", 4) == 0);
  bool conn      = sys_state.is_connected;

  tft_badge(PAD,       y, wifi_mode ? "WiFi" : "SIM",
            wifi_mode  ? 0x000F : 0x6000, C_WHITE, 2);
  tft_badge(PAD + 90,  y, conn ? "SERVER OK" : "NO SERVER",
            conn       ? 0x0320 : 0x6000, C_WHITE, 2);
  y += 28;

  // ── Sensor controllers ──
  tft_section(PAD, y, "CONTROLLERS");
  y += 22;

  uint16_t peers = sys_state.peer_count;
  char pbuf[4];  snprintf(pbuf, sizeof(pbuf), "%d", peers);
  tft.setTextSize(2);
  tft.setTextColor(peers > 0 ? C_ACCENT : C_GRAY, C_BG);
  tft.setCursor(PAD, y);
  tft.print(pbuf);
  tft.setTextSize(1);
  tft.setTextColor(C_WHITE, C_BG);
  tft.setCursor(PAD + (peers >= 10 ? 28 : 16), y + 5);
  tft.print(peers == 1 ? "controller" : "controllers");
  tft.print(" connected");
  y += 22;

  // ── Data buffer ──
  // Ring buffer (128 slots) antrian sensor data antara ESP-NOW dan MQTT publish.
  // 0% = normal. >50% = jaringan lambat. >80% = data lama mulai tertimpa.
  tft_section(PAD, y, "DATA BUFFER");
  y += 22;

  float    buf_pct = rb_usage();
  uint16_t buf_clr = (buf_pct > 0.8f) ? C_RED : (buf_pct > 0.5f) ? C_YELLOW : C_ACCENT;
  tft_hbar(PAD, y, 200, 12, buf_pct, buf_clr);
  char bbuf[8];  snprintf(bbuf, sizeof(bbuf), "%3.0f%%", buf_pct * 100.0f);
  tft.setTextSize(2);
  tft.setTextColor(C_WHITE, C_BG);
  tft.setCursor(218, y - 2);
  tft.print(bbuf);
}

// ─── Page: WiFi ──────────────────────────────────────────────────────────────
static void _draw_wifi()
{
  int y = CONT_Y;

  tft_section(PAD, y, "NETWORK");
  y += 22;

  if (WiFi.status() == WL_CONNECTED) {
    // Status dot + SSID
    tft_dot(PAD + 6, y + 10, C_GREEN);
    String ssid = WiFi.SSID();
    if (ssid.length() > 17) ssid = ssid.substring(0, 17) + "..";
    tft.setTextSize(2);
    tft.setTextColor(C_WHITE, C_BG);
    tft.setCursor(PAD + 22, y);
    tft.print(ssid.c_str());
    // Clear trailing space
    tft.setTextColor(C_BG, C_BG);
    tft.print("     ");
    y += 24;

    // IP address
    tft.setTextSize(2);
    tft.setTextColor(C_WHITE, C_BG);
    tft.setCursor(PAD, y);
    tft.print("IP:");
    tft.setTextColor(C_ACCENT, C_BG);
    char ipbuf[18];
    snprintf(ipbuf, sizeof(ipbuf), "%-15s", WiFi.localIP().toString().c_str());
    tft.print(ipbuf);
    y += 24;

    // RSSI + signal bars
    tft_section(PAD, y, "SIGNAL");
    y += 22;

    int rssi = WiFi.RSSI();
    float pct = constrain((rssi + 90.0f) / 60.0f, 0.0f, 1.0f);
    uint16_t sc = (rssi < -75) ? C_YELLOW : C_GREEN;
    tft_signal_bars(PAD, y, pct, sc);
    char rbuf[12]; snprintf(rbuf, sizeof(rbuf), "%d dBm", rssi);
    tft.setTextSize(2);
    tft.setTextColor(sc, C_BG);
    tft.setCursor(58, y + 5);
    tft.print(rbuf);
    y += 30;
    tft_hbar(PAD, y, 240, 12, pct, sc);
    y += 22;

    // Channel
    tft.setTextSize(2);
    tft.setTextColor(C_WHITE, C_BG);
    tft.setCursor(PAD, y);
    tft.print("Ch:");
    tft.setTextColor(C_ACCENT, C_BG);
    char chbuf[8]; snprintf(chbuf, sizeof(chbuf), "%-4d", WiFi.channel());
    tft.print(chbuf);

  } else {
    // Not connected
    tft_dot(PAD + 6, y + 10, C_RED);
    tft.setTextSize(2);
    tft.setTextColor(C_RED, C_BG);
    tft.setCursor(PAD + 22, y);
    tft.print("NOT CONNECTED   ");
    y += 36;

    tft.setTextSize(2);
    tft.setTextColor(C_WHITE, C_BG);
    tft.setCursor(PAD, y);
    tft.print("See Settings page ");
  }
}

// ─── Page: SIM ───────────────────────────────────────────────────────────────
static void _draw_sim()
{
  int y = CONT_Y;

  tft_section(PAD, y, "SIM MODULE");
  y += 22;

  if (!sys_state.sim_enabled) {
    tft_badge(PAD, y, "DISABLED", C_DARKRED, C_WHITE, 2);
    y += 36;
    tft.setTextSize(2);
    tft.setTextColor(C_WHITE, C_BG);
    tft.setCursor(PAD, y);
    tft.print("Go to SIM Ctrl  ");
    y += 24;
    tft.setTextColor(C_YELLOW, C_BG);
    tft.setCursor(PAD, y);
    tft.print("Hold 5s =Enable  ");
    return;
  }

  // Modem status badge
  tft_badge(PAD, y, sys_state.sim_modem_ok ? "MODEM OK" : "INIT...",
            sys_state.sim_modem_ok ? 0x0320 : C_DGRAY, C_WHITE, 2);
  bool active = (strncmp(sys_state.conn_mode, "sim", 3) == 0);
  if (active)
    tft_badge(PAD + 150, y, "ACTIVE", C_ACCENT, C_BG, 2);
  y += 36;

  if (sys_state.sim_modem_ok) {
    // Operator
    tft_section(PAD, y, "OPERATOR");
    y += 22;
    tft.setTextSize(2);
    tft.setTextColor(C_WHITE, C_BG);
    char opbuf[17];
    snprintf(opbuf, sizeof(opbuf), "%-16s", sys_state.sim_operator);
    tft.setCursor(PAD, y);
    tft.print(opbuf);
    y += 24;

    // Signal
    tft_section(PAD, y, "SIGNAL");
    y += 22;
    int sig = sys_state.sim_signal;
    // CSQ → dBm: rssi = -113 + csq*2  (valid range 0–31; 99 = unknown)
    int sim_dbm = (sig > 0 && sig < 99) ? (-113 + sig * 2) : 0;
    float pct = constrain(sig / 31.0f, 0.0f, 1.0f);
    uint16_t sc = (sig < 8) ? C_RED : (sig < 16) ? C_YELLOW : C_GREEN;
    tft_signal_bars(PAD, y, pct, sc);
    char sbuf[16];
    if (sim_dbm != 0) snprintf(sbuf, sizeof(sbuf), "%d dBm", sim_dbm);
    else              snprintf(sbuf, sizeof(sbuf), "--");
    tft.setTextSize(2);
    tft.setTextColor(sc, C_BG);
    tft.setCursor(58, y + 5);
    tft.print(sbuf);
    y += 30;
    tft_hbar(PAD, y, 240, 12, pct, sc);
    y += 22;
  }
}

// ─── Page: GPS ───────────────────────────────────────────────────────────────
static bool _has_recent_gps()
{
  return sys_state.gps_fix && (millis() - sys_state.gps_fix_ms <= GPS_STALE_MS);
}

static void _draw_gps()
{
  int y = CONT_Y;

  tft_section(PAD, y, "GPS STATUS");
  y += 22;

  if (!sys_state.sim_enabled) {
    tft_badge(PAD, y, "SIM DISABLED", C_DARKRED, C_WHITE, 2);
    y += 36;
    tft.setTextSize(2);
    tft.setTextColor(C_WHITE, C_BG);
    tft.setCursor(PAD, y);
    tft.print("Need SIM module ");
    return;
  }

  bool fix = _has_recent_gps();
  tft_badge(PAD, y, fix ? "FIX OK" : "NO FIX",
            fix ? 0x0320 : C_DARKRED, C_WHITE, 2);
  y += 36;

  if (fix) {
    // Latitude
    tft_section(PAD, y, "LATITUDE");
    y += 22;
    char latbuf[12]; snprintf(latbuf, sizeof(latbuf), "%.5f", sys_state.gps_lat);
    tft.setTextSize(2);
    tft.setTextColor(C_WHITE, C_BG);
    tft.setCursor(PAD, y);
    tft.print(latbuf);
    tft.setTextColor(C_BG, C_BG); tft.print("         ");  // clear
    y += 24;

    // Longitude
    tft_section(PAD, y, "LONGITUDE");
    y += 22;
    char lonbuf[12]; snprintf(lonbuf, sizeof(lonbuf), "%.5f", sys_state.gps_lon);
    tft.setTextSize(2);
    tft.setTextColor(C_WHITE, C_BG);
    tft.setCursor(PAD, y);
    tft.print(lonbuf);
    tft.setTextColor(C_BG, C_BG); tft.print("         ");  // clear
    y += 24;

    // Alt + fix age
    uint32_t age_s = (millis() - sys_state.gps_fix_ms) / 1000UL;
    tft.setTextSize(2);
    tft.setTextColor(C_WHITE, C_BG);
    tft.setCursor(PAD, y);
    tft.print("Alt:");
    tft.setTextColor(C_ACCENT, C_BG);
    char altbuf[10]; snprintf(altbuf, sizeof(altbuf), "%.0fm", sys_state.gps_alt);
    tft.print(altbuf);
    tft.setTextColor(C_WHITE, C_BG);
    tft.print("  Age:");
    tft.setTextColor(age_s < 120 ? C_GREEN : C_YELLOW, C_BG);
    char agebuf[8]; snprintf(agebuf, sizeof(agebuf), "%lus", age_s);
    tft.print(agebuf);

  } else {
    tft.setTextSize(2);
    tft.setTextColor(C_YELLOW, C_BG);
    tft.setCursor(PAD, y);
    tft.print("Searching...    ");
    y += 24;
    tft.setTextColor(C_WHITE, C_BG);
    tft.setCursor(PAD, y);
    tft.print("Go outdoors     ");
    y += 24;
    tft.setCursor(PAD, y);
    tft.print("Clear sky needed");
  }
}

// ─── Page: Settings ──────────────────────────────────────────────────────────
static void _draw_settings()
{
  int y = CONT_Y;

  tft_section(PAD, y, "WiFi SETTINGS");
  y += 22;

  if (portal_active) {
    // Portal is running — show connection instructions
    tft_badge(PAD, y, "SETUP MODE", C_ACCENT, C_BG, 2);
    y += 36;

    tft.setTextSize(2);
    tft.setTextColor(C_WHITE, C_BG);
    tft.setCursor(PAD, y); tft.print("Connect to WiFi:");
    y += 22;
    tft.setTextColor(C_ACCENT, C_BG);
    tft.setCursor(PAD, y);
    String ap = portal_ssid;
    if (ap.length() > 16) ap = ap.substring(0, 16);
    tft.print(ap.c_str());
    tft.setTextColor(C_BG, C_BG); tft.print("         ");
    y += 22;
    tft.setTextColor(C_WHITE, C_BG);
    tft.setCursor(PAD, y); tft.print("Pass: " PORTAL_PASS "  ");
    y += 22;
    tft.setTextColor(C_ACCENT, C_BG);
    tft.setCursor(PAD, y); tft.print("192.168.4.1     ");

  } else if (WiFi.status() == WL_CONNECTED) {
    tft_dot(PAD + 6, y + 10, C_GREEN);
    tft.setTextSize(2);
    tft.setTextColor(C_WHITE, C_BG);
    String ssid = WiFi.SSID();
    if (ssid.length() > 15) ssid = ssid.substring(0, 15);
    tft.setCursor(PAD + 22, y);
    tft.print(ssid.c_str());
    tft.setTextColor(C_BG, C_BG); tft.print("     ");
    y += 28;

    tft.setTextSize(2);
    tft.setTextColor(C_WHITE, C_BG);
    tft.setCursor(PAD, y); tft.print("IP:");
    tft.setTextColor(C_ACCENT, C_BG);
    char ipbuf[16];
    snprintf(ipbuf, sizeof(ipbuf), "%-13s", WiFi.localIP().toString().c_str());
    tft.print(ipbuf);
    y += 36;
    tft.setTextColor(C_YELLOW, C_BG);
    tft.setCursor(PAD, y); tft.print("Hold 5s = Reset   ");

  } else {
    // Credentials saved but WiFi not connected (wrong password / network down)
    tft_dot(PAD + 6, y + 10, C_RED);
    tft.setTextSize(2);
    tft.setTextColor(C_RED, C_BG);
    tft.setCursor(PAD + 22, y); tft.print("NOT CONNECTED   ");
    y += 36;
    tft.setTextColor(C_WHITE, C_BG);
    tft.setCursor(PAD, y); tft.print("Wrong password? ");
    y += 24;
    tft.setTextColor(C_YELLOW, C_BG);
    tft.setCursor(PAD, y); tft.print("Hold 5s = Reset   ");
  }
}

// ─── Page: SIM Control ───────────────────────────────────────────────────────
static void _draw_sim_ctrl()
{
  int y = CONT_Y;

  tft_section(PAD, y, "SIM CONTROL");
  y += 22;

  bool enabled = sys_state.sim_enabled;
  tft_badge(PAD, y, enabled ? "ENABLED" : "DISABLED",
            enabled ? 0x0320 : C_DARKRED, C_WHITE, 2);
  y += 38;

  if (enabled) {
    tft.setTextSize(2);
    tft.setTextColor(C_WHITE, C_BG);
    tft.setCursor(PAD, y); tft.print("Modem:");
    tft.setTextColor(sys_state.sim_modem_ok ? C_GREEN : C_YELLOW, C_BG);
    tft.print(sys_state.sim_modem_ok ? "OK      " : "Init... ");
    y += 22;
    tft.setTextColor(C_WHITE, C_BG);
    tft.setCursor(PAD, y); tft.print("GPRS: ");
    tft.setTextColor(sys_state.sim_gprs ? C_GREEN : C_RED, C_BG);
    tft.print(sys_state.sim_gprs ? "OK      " : "OFFLINE ");
    y += 22;
    bool sim_active = (strncmp(sys_state.conn_mode, "sim", 3) == 0);
    tft.setTextColor(C_WHITE, C_BG);
    tft.setCursor(PAD, y); tft.print("Mode: ");
    tft.setTextColor(sim_active ? C_ACCENT : C_WHITE, C_BG);
    tft.print(sim_active ? "SIM     " : "Standby ");
    y += 28;
  }

  tft.setTextSize(2);
  tft.setTextColor(C_YELLOW, C_BG);
  tft.setCursor(PAD, y);
  tft.print(enabled ? "Hold 5s = Disable " : "Hold 5s =Enable  ");
}

// ─── Hold-progress overlay ───────────────────────────────────────────────────
static void _draw_hold_overlay(uint32_t held_ms)
{
  float pct = min(1.0f, (float)held_ms / (float)BTN_HOLD_MS);

  // Fill content area with a semi-dark rect
  tft.fillRect(0, CONT_Y, TFT_WIDTH, FTR_Y - CONT_Y, C_BG);
  tft.drawRect(PAD, CONT_Y + 4, TFT_WIDTH - PAD * 2, FTR_Y - CONT_Y - 8, C_SEP);

  int inner_y = CONT_Y + 24;
  tft.setTextSize(1);
  tft.setTextColor(C_GRAY, C_BG);
  tft.setCursor(PAD + 8, inner_y);
  tft.print("Hold to confirm...");
  inner_y += 18;

  // Progress bar
  tft_hbar(PAD + 8, inner_y, TFT_WIDTH - PAD * 2 - 16, 16, pct, C_ACCENT);
  inner_y += 28;

  // Action description
  tft.setTextSize(1);
  tft.setTextColor(C_ACCENT, C_BG);
  tft.setCursor(PAD + 8, inner_y);
  if (tft_page == PAGE_SIM_CTRL) {
    tft.print(sys_state.sim_enabled ? "Release = Disable SIM Module    " :
                                      "Release = Enable SIM Module     ");
  } else {
    tft.print("Release = Reset WiFi + Reboot   ");
  }
  inner_y += 18;

  // Countdown
  float rem = max(0.0f, ((float)BTN_HOLD_MS - (float)held_ms) / 1000.0f);
  tft.setTextSize(2);
  tft.setTextColor(C_WHITE, C_BG);
  tft.setCursor(PAD + 8, inner_y);
  char cntbuf[12]; snprintf(cntbuf, sizeof(cntbuf), "%.1f s  ", rem);
  tft.print(cntbuf);
}

// ─── Portal loading animations ───────────────────────────────────────────────
static void portal_loading_anim()
{
  tft.fillScreen(C_BG);
  tft_draw_header();
  tft_draw_footer();

  auto frame = [](int pct, const char *msg) {
    tft.setTextSize(1);
    tft.setTextColor(C_WHITE, C_BG);
    tft.fillRect(PAD, 80, TFT_WIDTH - PAD * 2, 16, C_BG);
    tft.setCursor(PAD, 80);
    tft.print(msg);
    tft_hbar(PAD, 104, TFT_WIDTH - PAD * 2, 16, pct / 100.0f, C_ACCENT);
  };
  for (int p = 0; p <= 40; p += 4)  { frame(p, "Preparing...         "); delay(40); }
  for (int p = 40; p <= 75; p += 3) { frame(p, "Scanning WiFi...     "); delay(30); }
}

static void portal_ready_anim(const String &ap, const char* pass)
{
  auto frame = [](int pct) {
    tft_hbar(PAD, 104, TFT_WIDTH - PAD * 2, 16, pct / 100.0f, C_GREEN);
  };
  for (int p = 75; p <= 100; p += 5) { frame(p); delay(40); }

  tft.fillRect(PAD, 80, TFT_WIDTH - PAD * 2, 16, C_BG);
  tft.setTextSize(1);
  tft.setTextColor(C_GREEN, C_BG);
  tft.setCursor(PAD, 80);
  tft.print("Portal Ready!          ");

  tft.fillRect(PAD, 132, TFT_WIDTH - PAD * 2, 80, C_BG);
  tft.setTextSize(1);
  tft.setTextColor(C_GRAY, C_BG);
  tft.setCursor(PAD, 132);
  tft.print("Connect phone to AP:");
  tft.setTextSize(2);
  tft.setTextColor(C_ACCENT, C_BG);
  tft.setCursor(PAD, 148);
  tft.print(ap.c_str());
  tft.setTextSize(1);
  tft.setTextColor(C_GRAY, C_BG);
  tft.setCursor(PAD, 174);
  tft.printf("Pass: %s  then 192.168.4.1", pass);
  delay(800);
}

// ─── Portal start ────────────────────────────────────────────────────────────
static Preferences *_prefs_ptr = nullptr;

static void portal_start(Preferences *prefs)
{
  _prefs_ptr = prefs;
  prefs->begin("ciren", true);
  _portal_mqtt_host = prefs->getString("mqtt_host", "118.22.31.254");
  _portal_sim_apn   = prefs->getString("sim_apn",  "");
  _portal_sim_user  = prefs->getString("sim_user", "");
  _portal_sim_pass  = prefs->getString("sim_pass", "");
  _portal_device_id = String(sys_state.device_id);  // sudah di-set sebelum portal_start dipanggil
  prefs->end();
  portal_loading_anim();

  uint8_t mac[6];
  WiFi.macAddress(mac);
  char suffix[5];
  snprintf(suffix, sizeof(suffix), "%02X%02X", mac[4], mac[5]);
  portal_ssid = String("CIREN-") + suffix;

  const char* portal_pass_buf = PORTAL_PASS;

  WiFi.disconnect();
  delay(50);
  WiFi.mode(WIFI_AP_STA);
  WiFi.softAPConfig(IPAddress(192, 168, 4, 1), IPAddress(192, 168, 4, 1),
                    IPAddress(255, 255, 255, 0));
  WiFi.softAP(portal_ssid.c_str(), portal_pass_buf, 1, 0, 4);
  portal_scan_html = build_scan_html();

  portal_server.on("/", HTTP_GET, []() {
    portal_server.send(200, "text/html", build_portal_page());
  });
  portal_server.on("/refresh", HTTP_GET, []() {
    portal_scan_html = build_scan_html();
    portal_server.sendHeader("Location", "/");
    portal_server.send(302, "text/plain", "");
  });
  portal_server.on("/save", HTTP_POST, []() {
    String ssid      = portal_server.arg("ssid");
    String ssid_m    = portal_server.arg("ssid_m");
    String pass      = portal_server.arg("pass");
    String mqtt_host = portal_server.arg("mqtt_host");
    String sim_apn   = portal_server.arg("sim_apn");
    String sim_user  = portal_server.arg("sim_user");
    String sim_pass  = portal_server.arg("sim_pass");
    String device_id = portal_server.arg("device_id");
    ssid.trim(); ssid_m.trim(); pass.trim(); mqtt_host.trim();
    sim_apn.trim(); sim_user.trim(); sim_pass.trim(); device_id.trim();
    if (ssid.length() == 0) ssid = ssid_m;
    // SSID is optional — user may run in SIM-only mode with no WiFi configured.
    if (_prefs_ptr) {
      _prefs_ptr->begin("ciren", false);
      if (ssid.length() > 0) {
        _prefs_ptr->putString("ssid", ssid);
        _prefs_ptr->putString("pass", pass);
      }
      // If ssid is empty, leave existing ssid/pass in flash unchanged.
      if (mqtt_host.length() > 0) {
        _prefs_ptr->putString("mqtt_host", mqtt_host);
        _portal_mqtt_host = mqtt_host;
      }
      // Simpan APN — izinkan string kosong (hapus APN lama)
      _prefs_ptr->putString("sim_apn",  sim_apn);
      _prefs_ptr->putString("sim_user", sim_user);
      _prefs_ptr->putString("sim_pass", sim_pass);
      _portal_sim_apn  = sim_apn;
      _portal_sim_user = sim_user;
      _portal_sim_pass = sim_pass;
      // Update sys_state langsung agar berlaku saat reboot
      strncpy(sys_state.sim_apn,      sim_apn.c_str(),  sizeof(sys_state.sim_apn));
      strncpy(sys_state.sim_apn_user, sim_user.c_str(), sizeof(sys_state.sim_apn_user));
      strncpy(sys_state.sim_apn_pass, sim_pass.c_str(), sizeof(sys_state.sim_apn_pass));
      // Device ID — hanya update jika diisi, jika kosong pertahankan yang ada
      if (device_id.length() > 0) {
        _prefs_ptr->putString("device_id", device_id);
        _portal_device_id = device_id;
        strncpy(sys_state.device_id, device_id.c_str(), sizeof(sys_state.device_id) - 1);
        state_build_topics();  // rebuild topic strings
      }
      _prefs_ptr->end();
    }
    portal_server.send(200, "text/html",
                       build_portal_page("Saved! Rebooting in 2s...", true));
    reboot_pending = true;
    reboot_at_ms   = millis() + 2000;
  });
  portal_server.onNotFound([]() {
    portal_server.sendHeader("Location", "/");
    portal_server.send(302, "text/plain", "");
  });
  portal_server.begin();

  portal_ready_anim(portal_ssid, portal_pass_buf);
  portal_active = true;
  page_dirty    = true;   // force page redraw after animation

  Serial.printf("[PORTAL] AP=%s Pass=%s\n", portal_ssid.c_str(), portal_pass_buf);
}

static void portal_tick()
{
  if (portal_active) portal_server.handleClient();
  if (reboot_pending && millis() >= reboot_at_ms) esp_restart();
}

// ─── Main draw function ───────────────────────────────────────────────────────
static void tft_draw()
{
  if (!tft_ready) return;

  // Hold is always active when WiFi is configured (to reset from any page),
  // or specifically on SIM_CTRL page.
  bool on_action = (!portal_active || tft_page == PAGE_SIM_CTRL);
  uint32_t held  = btn_held_ms();

  // Hold progress overlay
  if (on_action && held >= 800) {
    if (!hold_overlay) {
      hold_overlay = true;
    }
    _draw_hold_overlay(held);
    return;
  }

  // Returning from hold overlay
  if (hold_overlay) {
    hold_overlay = false;
    page_dirty   = true;
  }

  // Full page redraw on page change
  if (page_dirty) {
    tft.fillScreen(C_BG);
    tft_draw_header();
    tft_draw_footer();
    page_dirty = false;
  } else {
    // Redraw header dots on every tick (page indicator stays fresh)
    for (int i = 0; i < OLED_TOTAL_PAGES; i++) {
      int dx = TFT_WIDTH - (OLED_TOTAL_PAGES - i) * 14 + 4;
      int dy = HDR_H / 2;
      if (i == tft_page)
        tft.fillCircle(dx, dy, 4, C_ACCENT);
      else
        tft.drawCircle(dx, dy, 3, C_GRAY);
    }
  }

  // Draw page content
  switch (tft_page) {
    case PAGE_GATEWAY:  _draw_gateway();  break;
    case PAGE_WIFI:     _draw_wifi();     break;
    case PAGE_SIM:      _draw_sim();      break;
    case PAGE_GPS:      _draw_gps();      break;
    case PAGE_SETTINGS: _draw_settings(); break;
    case PAGE_SIM_CTRL: _draw_sim_ctrl(); break;
  }
}

// ─── Public splash helper (called from main.ino) ─────────────────────────────
static void tft_show_msg(const char *line1, const char *line2,
                         const char *line3 = nullptr)
{
  if (!tft_ready) return;
  tft.fillScreen(C_BG);
  tft_draw_header();
  tft_draw_footer();
  tft.setTextSize(2);
  tft.setTextColor(C_WHITE, C_BG);
  tft.setCursor(PAD, CONT_Y + 16);
  tft.print(line1);
  tft.setTextSize(2);
  tft.setTextColor(C_YELLOW, C_BG);
  tft.setCursor(PAD, CONT_Y + 46);
  tft.print(line2);
  if (line3) {
    tft.setTextColor(C_WHITE, C_BG);
    tft.setCursor(PAD, CONT_Y + 76);
    tft.print(line3);
  }
}

// ─── Init ────────────────────────────────────────────────────────────────────
void btn_oled_init()
{
  pinMode(PIN_BTN, INPUT_PULLUP);

  // ESP32-S3: eksplisit set SPI pins — harus dilakukan SEBELUM tft.begin()
  // agar hardware SPI menggunakan pin yang benar (ESP32-S3 tidak ada pin 23)
  SPI.begin(PIN_TFT_SCK, PIN_TFT_MISO, PIN_TFT_MOSI, -1);
  tft.begin(40000000UL);   // 40 MHz SPI
  tft.setRotation(TFT_ROTATION);
  tft.fillScreen(C_BG);
  tft_ready = true;

  // ── Boot splash ──────────────────────────────────────────────────────────
  // Layout (content area: y 37–221 = 185px tall):
  //   Logo  56px  y=62
  //   Title 16px  y=128  (size 2, 18 chars × 12px = 216px → x=52)
  //   ─────────── y=150
  //   Device 8px  y=158  (size 1, ~24 chars × 6px = 144px → x=88)
  //   Boot   8px  y=174  (size 1, 10 chars × 6px = 60px → x=130)

  // Logo — horizontally centred
  tft.drawRGBBitmap(
    (TFT_WIDTH - LOGO_SPLASH_W) / 2,   // x = 20
    62,                                  // y
    LOGO_SPLASH, LOGO_SPLASH_W, LOGO_SPLASH_H
  );

  // Title
  tft.setTextSize(2);
  tft.setTextColor(C_WHITE, C_BG);
  tft.setCursor(52, 128);
  tft.print("CIREN IoT Gateway");

  // Thin separator
  tft.drawFastHLine(PAD, 150, TFT_WIDTH - PAD * 2, C_SEP);

  // Device & firmware — centre-calculated
  tft.setTextSize(1);
  tft.setTextColor(C_ACCENT, C_BG);
  tft.setCursor(88, 158);
  tft.printf("Device: %s    v%s", sys_state.device_id, FW_VERSION);

  // Booting indicator
  tft.setTextColor(C_WHITE, C_BG);
  tft.setCursor(130, 174);
  tft.print("Booting...");

  delay(2000);   // hold splash for 2 seconds

  Serial.println("[TFT] ILI9341 ready");
}

// ─── Task ────────────────────────────────────────────────────────────────────
void task_oled(void *param)
{
  Preferences *prefs       = (Preferences *)param;
  uint32_t    last_draw_ms = 0;

  // Reinisialisasi TFT di Core 0 context (task ini berjalan di Core 0,
  // sedangkan btn_oled_init() berjalan di Core 1/setup). Beberapa versi
  // Adafruit + ESP32-S3 perlu SPI di-init ulang dari core yang sama dengan
  // core yang menggunakannya.
  vTaskDelay(pdMS_TO_TICKS(50));  // beri waktu system settle dulu
  SPI.begin(PIN_TFT_SCK, PIN_TFT_MISO, PIN_TFT_MOSI, -1);
  tft.begin(40000000UL);
  tft.setRotation(TFT_ROTATION);
  tft_ready  = true;
  page_dirty = true;   // paksa full redraw setelah reinit
  Serial.println("[TFT] Task reinit OK (Core 0)");

  for (;;) {
    // Button di-poll setiap 20ms (50Hz) agar press pendek tidak terlewat.
    // TFT hanya di-refresh setiap TFT_REFRESH_MS (200ms).
    vTaskDelay(pdMS_TO_TICKS(20));

    portal_tick();

    BtnAction act = btn_tick();

    if (act == BA_SHORT) {
      tft_page  = (tft_page + 1) % OLED_TOTAL_PAGES;
      page_dirty = true;
      Serial.printf("[BTN] Page -> %d\n", tft_page);
    }
    else if (act == BA_HOLD5) {
      if (tft_page == PAGE_SIM_CTRL) {
        bool new_val = !sys_state.sim_enabled;
        if (prefs) {
          prefs->begin("ciren", false);
          prefs->putBool("sim_en", new_val);
          prefs->end();
        }
        tft.fillScreen(C_BG);
        tft_draw_header();
        tft.setTextSize(2);
        tft.setTextColor(new_val ? C_GREEN : C_RED, C_BG);
        tft.setCursor(PAD, CONT_Y + 30);
        tft.print(new_val ? "SIM ENABLED" : "SIM DISABLED");
        tft.setTextSize(1);
        tft.setTextColor(C_WHITE, C_BG);
        tft.setCursor(PAD, CONT_Y + 58);
        tft.print("Rebooting in 1.5 s...");
        delay(1500);
        esp_restart();
      }
      else if (!portal_active) {
        // WiFi is configured — hold from any page = wipe credentials + reboot to portal
        Serial.println("[BTN] Hold 5s — resetting WiFi credentials");
        if (prefs) {
          prefs->begin("ciren", false);
          prefs->remove("ssid");
          prefs->remove("pass");
          prefs->end();
        }
        tft.fillScreen(C_BG);
        tft_draw_header();
        tft.setTextSize(2);
        tft.setTextColor(C_RED, C_BG);
        tft.setCursor(PAD, CONT_Y + 30);
        tft.print("WiFi Reset!");
        tft.setTextSize(1);
        tft.setTextColor(C_WHITE, C_BG);
        tft.setCursor(PAD, CONT_Y + 58);
        tft.print("Rebooting...");
        delay(1500);
        esp_restart();
      }
    }

    // Refresh TFT hanya saat interval terpenuhi
    if (millis() - last_draw_ms >= TFT_REFRESH_MS) {
      last_draw_ms = millis();
      tft_draw();
    }
  }
}
