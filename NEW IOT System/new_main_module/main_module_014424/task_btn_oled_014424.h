#pragma once
#include <SPI.h>
#include <WiFi.h>
#include <WebServer.h>
#include <Adafruit_GFX.h>
#include <Adafruit_ILI9341.h>
#include "ciren_config_014424.h"
#include "ring_buffer_014424.h"
#include "system_state_014424.h"

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
                        "background:#0f172a;border:1px solid #334155;border-radius:10px;"
                        "padding:12px 14px;cursor:pointer;transition:border-color .15s}"
         ".network-item:has(input:checked){border-color:#0ea5e9;background:#0c1a2e}"
         ".network-item input{position:absolute;opacity:0;pointer-events:none}"
         ".network-info{display:flex;align-items:center;gap:4px;font-size:14px;font-weight:500}"
         ".network-name{color:#f1f5f9}"
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
       "<p>Device: " + String(DEVICE_ID) + " &nbsp;&bull;&nbsp; Firmware v" + String(FW_VERSION) + "</p>"
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

  // Password
  h += "<div class='field'><label>Password</label>"
       "<input type='password' name='pass' placeholder='Enter WiFi password' autocomplete='off'></div>";

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

// Section label — small gray caps, with underline
static void tft_section(int x, int y, const char *label)
{
  tft.setTextSize(1);
  tft.setTextColor(C_GRAY, C_BG);
  tft.setCursor(x, y);
  tft.print(label);
  int lw = (int)strlen(label) * 6;
  tft.drawFastHLine(x, y + 10, lw, C_SEP);
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
  tft.setTextSize(1);
  tft.setTextColor(C_GRAY, C_BG);
  tft.setCursor(PAD, FTR_Y + 6);
  tft.print(DEVICE_ID "  v" FW_VERSION);
  tft.setCursor(190, FTR_Y + 6);
  tft.print("BTN: short=next");
}

// ─── Page: Gateway ───────────────────────────────────────────────────────────
static void _draw_gateway()
{
  int y = CONT_Y;

  // ── Connection row ──
  tft_section(PAD, y, "CONNECTION");
  y += 14;

  bool wifi_mode = (strncmp(sys_state.conn_mode, "wifi", 4) == 0);
  tft_badge(PAD, y, wifi_mode ? "WiFi" : "SIM",
            wifi_mode ? 0x000F : 0x6000, C_WHITE, 1);
  bool conn = sys_state.is_connected;
  tft_badge(PAD + 60, y, conn ? "CONNECTED" : "OFFLINE",
            conn ? 0x0320 : 0x6000, C_WHITE, 1);

  // ── RSSI ──
  y += 26;
  tft_section(PAD, y, "RSSI SIGNAL");
  y += 14;

  int rssi = (int)sys_state.rssi;
  float rssi_pct = (rssi == 0) ? 0.0f : constrain((rssi + 90.0f) / 60.0f, 0.0f, 1.0f);
  uint16_t rssi_clr = (rssi < -75) ? C_YELLOW : C_ACCENT;

  tft_signal_bars(PAD, y, rssi_pct, rssi_clr);

  char rbuf[16];
  if (rssi != 0) snprintf(rbuf, sizeof(rbuf), "%-8d dBm", rssi);
  else           snprintf(rbuf, sizeof(rbuf), "%-12s",    "--");
  tft.setTextSize(1);
  tft.setTextColor(rssi_clr, C_BG);
  tft.setCursor(54, y + 8);
  tft.print(rbuf);

  y += 30;
  tft_hbar(PAD, y, 220, 10, rssi_pct, rssi_clr);

  // ── Buffer ──
  y += 18;
  tft_section(PAD, y, "BUFFER");
  y += 14;

  float buf_pct = rb_usage();
  uint16_t buf_clr = (buf_pct > 0.8f) ? C_RED : (buf_pct > 0.5f) ? C_YELLOW : C_ACCENT;
  tft_hbar(PAD, y, 180, 10, buf_pct, buf_clr);
  char bbuf[10];
  snprintf(bbuf, sizeof(bbuf), "%-4.0f%%", buf_pct * 100.0f);
  tft.setTextSize(1);
  tft.setTextColor(C_WHITE, C_BG);
  tft.setCursor(196, y + 1);
  tft.print(bbuf);

  // ── Uptime + Published ──
  y += 18;
  char upbuf[24];
  snprintf(upbuf, sizeof(upbuf), "Up: %-7lus", millis() / 1000UL);
  tft.setTextSize(1);
  tft.setTextColor(C_WHITE, C_BG);
  tft.setCursor(PAD, y);
  tft.print(upbuf);

  tft.setCursor(160, y);
  int sc = sys_state.last_status_code;
  if (sc == 200)      { tft.setTextColor(C_GREEN,  C_BG); tft.print("PUB: OK   "); }
  else if (sc > 0)    { tft.setTextColor(C_RED,    C_BG);
                        char pb[12]; snprintf(pb, sizeof(pb), "PUB: %-5d", sc);
                        tft.print(pb); }
  else                { tft.setTextColor(C_GRAY,   C_BG); tft.print("PUB: --   "); }

  // ── MAC ──
  y += 14;
  uint8_t _mac[6];
  WiFi.macAddress(_mac);
  char macbuf[22];
  snprintf(macbuf, sizeof(macbuf), "%02X:%02X:%02X:%02X:%02X:%02X",
           _mac[0], _mac[1], _mac[2], _mac[3], _mac[4], _mac[5]);
  tft.setTextSize(1);
  tft.setTextColor(C_GRAY, C_BG);
  tft.setCursor(PAD, y);
  tft.print("MAC: ");
  tft.print(macbuf);
}

// ─── Page: WiFi ──────────────────────────────────────────────────────────────
static void _draw_wifi()
{
  int y = CONT_Y;

  tft_section(PAD, y, "NETWORK");
  y += 14;

  if (WiFi.status() == WL_CONNECTED) {
    // Status dot + SSID
    tft_dot(PAD + 5, y + 8, C_GREEN);
    String ssid = WiFi.SSID();
    if (ssid.length() > 20) ssid = ssid.substring(0, 20) + "..";
    tft.setTextSize(2);
    tft.setTextColor(C_WHITE, C_BG);
    tft.setCursor(PAD + 18, y);
    char sbuf[24]; snprintf(sbuf, sizeof(sbuf), "%-22s", ssid.c_str());
    tft.print(sbuf);
    y += 24;

    // IP address
    tft.setTextSize(1);
    tft.setTextColor(C_GRAY, C_BG);
    tft.setCursor(PAD, y);
    tft.print("IP  ");
    tft.setTextColor(C_ACCENT, C_BG);
    char ipbuf[20];
    snprintf(ipbuf, sizeof(ipbuf), "%-18s", WiFi.localIP().toString().c_str());
    tft.print(ipbuf);
    y += 14;

    // RSSI + signal bars
    tft_section(PAD, y, "SIGNAL STRENGTH");
    y += 14;

    int rssi = WiFi.RSSI();
    float pct = constrain((rssi + 90.0f) / 60.0f, 0.0f, 1.0f);
    uint16_t sc = (rssi < -75) ? C_YELLOW : C_GREEN;
    tft_signal_bars(PAD, y, pct, sc);
    char rbuf[16]; snprintf(rbuf, sizeof(rbuf), "%-6d dBm", rssi);
    tft.setTextSize(1);
    tft.setTextColor(sc, C_BG);
    tft.setCursor(54, y + 9);
    tft.print(rbuf);
    y += 32;
    tft_hbar(PAD, y, 240, 10, pct, sc);
    y += 18;

    // Channel
    tft.setTextSize(1);
    tft.setTextColor(C_GRAY, C_BG);
    tft.setCursor(PAD, y);
    tft.print("Channel ");
    tft.setTextColor(C_WHITE, C_BG);
    char chbuf[8]; snprintf(chbuf, sizeof(chbuf), "%-4d", WiFi.channel());
    tft.print(chbuf);

  } else {
    // Not connected
    tft_dot(PAD + 5, y + 8, C_RED);
    tft.setTextSize(2);
    tft.setTextColor(C_RED, C_BG);
    tft.setCursor(PAD + 18, y);
    tft.print("NOT CONNECTED     ");
    y += 32;

    tft.setTextSize(1);
    tft.setTextColor(C_GRAY, C_BG);
    tft.setCursor(PAD, y);
    tft.print("Go to Settings page    ");
    y += 16;
    tft.setCursor(PAD, y);
    tft.print("Hold 5s to start WiFi Setup");
  }
}

// ─── Page: SIM ───────────────────────────────────────────────────────────────
static void _draw_sim()
{
  int y = CONT_Y;

  tft_section(PAD, y, "SIM MODULE");
  y += 14;

  if (!sys_state.sim_enabled) {
    tft_badge(PAD, y, "DISABLED", C_DARKRED, C_WHITE);
    y += 28;
    tft.setTextSize(1);
    tft.setTextColor(C_GRAY, C_BG);
    tft.setCursor(PAD, y);
    tft.print("Go to SIM Control page  ");
    y += 14;
    tft.setCursor(PAD, y);
    tft.print("Hold 5s to enable        ");
    return;
  }

  // Modem status badge
  tft_badge(PAD, y, sys_state.sim_modem_ok ? "MODEM OK" : "INIT...",
            sys_state.sim_modem_ok ? 0x0320 : C_DGRAY, C_WHITE);
  bool active = (strncmp(sys_state.conn_mode, "sim", 3) == 0);
  if (active)
    tft_badge(PAD + 110, y, "ACTIVE", C_ACCENT, C_BG);
  y += 28;

  if (sys_state.sim_modem_ok) {
    // Operator
    tft_section(PAD, y, "OPERATOR");
    y += 14;
    tft.setTextSize(2);
    tft.setTextColor(C_WHITE, C_BG);
    char opbuf[24];
    snprintf(opbuf, sizeof(opbuf), "%-18s", sys_state.sim_operator);
    tft.setCursor(PAD, y);
    tft.print(opbuf);
    y += 26;

    // Signal
    tft_section(PAD, y, "SIGNAL");
    y += 14;
    int sig = sys_state.sim_signal;
    float pct = constrain(sig / 31.0f, 0.0f, 1.0f);
    uint16_t sc = (sig < 8) ? C_RED : (sig < 16) ? C_YELLOW : C_GREEN;
    tft_signal_bars(PAD, y, pct, sc);
    char sbuf[12]; snprintf(sbuf, sizeof(sbuf), "%-3d/31", sig);
    tft.setTextSize(1);
    tft.setTextColor(sc, C_BG);
    tft.setCursor(54, y + 9);
    tft.print(sbuf);
    y += 32;

    // GPRS
    tft.setTextSize(1);
    tft.setTextColor(C_GRAY, C_BG);
    tft.setCursor(PAD, y);
    tft.print("GPRS: ");
    tft.setTextColor(sys_state.sim_gprs ? C_GREEN : C_GRAY, C_BG);
    tft.print(sys_state.sim_gprs ? "CONNECTED  " : "DISCONNECTED");
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

  tft_section(PAD, y, "GNSS STATUS");
  y += 14;

  if (!sys_state.sim_enabled) {
    tft_badge(PAD, y, "SIM DISABLED", C_DARKRED, C_WHITE);
    y += 28;
    tft.setTextSize(1);
    tft.setTextColor(C_GRAY, C_BG);
    tft.setCursor(PAD, y);
    tft.print("GPS requires SIM module  ");
    return;
  }

  bool fix = _has_recent_gps();
  if (fix)
    tft_badge(PAD, y, "FIX ACQUIRED", 0x0320, C_WHITE);
  else
    tft_badge(PAD, y, "NO FIX", C_DARKRED, C_WHITE);
  y += 28;

  if (fix) {
    // Latitude
    tft_section(PAD, y, "LATITUDE");
    y += 14;
    char latbuf[16]; snprintf(latbuf, sizeof(latbuf), "%.6f", sys_state.gps_lat);
    tft.setTextSize(2);
    tft.setTextColor(C_ACCENT, C_BG);
    tft.setCursor(PAD, y);
    char pad_lat[20]; snprintf(pad_lat, sizeof(pad_lat), "%-16s", latbuf);
    tft.print(pad_lat);
    y += 22;

    // Longitude
    tft_section(PAD, y, "LONGITUDE");
    y += 14;
    char lonbuf[16]; snprintf(lonbuf, sizeof(lonbuf), "%.6f", sys_state.gps_lon);
    tft.setTextSize(2);
    tft.setTextColor(C_ACCENT, C_BG);
    tft.setCursor(PAD, y);
    char pad_lon[20]; snprintf(pad_lon, sizeof(pad_lon), "%-16s", lonbuf);
    tft.print(pad_lon);
    y += 24;

    // Alt + age
    tft.setTextSize(1);
    tft.setTextColor(C_GRAY, C_BG);
    tft.setCursor(PAD, y);
    tft.print("Alt: ");
    tft.setTextColor(C_WHITE, C_BG);
    char altbuf[16]; snprintf(altbuf, sizeof(altbuf), "%-8.1f m", sys_state.gps_alt);
    tft.print(altbuf);

    uint32_t age_s = (millis() - sys_state.gps_fix_ms) / 1000UL;
    tft.setTextColor(C_GRAY, C_BG);
    tft.print("  Fix: ");
    tft.setTextColor(age_s < 120 ? C_GREEN : C_YELLOW, C_BG);
    char agebuf[12]; snprintf(agebuf, sizeof(agebuf), "%-4lus ago", age_s);
    tft.print(agebuf);

  } else {
    tft.setTextSize(1);
    tft.setTextColor(C_GRAY, C_BG);
    tft.setCursor(PAD, y);
    tft.print("Waiting for satellites...  ");
    y += 16;
    tft.setCursor(PAD, y);
    tft.print("Place device outdoors      ");
    y += 16;
    tft.setCursor(PAD, y);
    tft.print("Clear sky view recommended ");
  }
}

// ─── Page: Settings ──────────────────────────────────────────────────────────
static void _draw_settings()
{
  int y = CONT_Y;

  tft_section(PAD, y, "WiFi SETTINGS");
  y += 14;

  if (portal_active) {
    // Portal is running
    tft_badge(PAD, y, "PORTAL ACTIVE", C_ACCENT, C_BG);
    y += 28;

    tft.setTextSize(1);
    tft.setTextColor(C_GRAY, C_BG);
    tft.setCursor(PAD, y); tft.print("Connect your phone to:");
    y += 14;
    tft.setTextSize(2);
    tft.setTextColor(C_WHITE, C_BG);
    tft.setCursor(PAD, y);
    char apbuf[24]; snprintf(apbuf, sizeof(apbuf), "%-18s", portal_ssid.c_str());
    tft.print(apbuf);
    y += 22;
    tft.setTextSize(1);
    tft.setTextColor(C_GRAY, C_BG);
    tft.setCursor(PAD, y); tft.print("Password: " PORTAL_PASS "          ");
    y += 14;
    tft.setTextColor(C_ACCENT, C_BG);
    tft.setCursor(PAD, y); tft.print("Open: 192.168.4.1             ");
    y += 20;
    tft.setTextColor(C_GRAY, C_BG);
    tft.setCursor(PAD, y); tft.print("Hold 5s = Delete & Reboot   ");

  } else if (WiFi.status() == WL_CONNECTED) {
    tft_dot(PAD + 5, y + 8, C_GREEN);
    tft.setTextSize(2);
    tft.setTextColor(C_WHITE, C_BG);
    String ssid = WiFi.SSID();
    if (ssid.length() > 18) ssid = ssid.substring(0, 18);
    tft.setCursor(PAD + 18, y);
    char sbuf[22]; snprintf(sbuf, sizeof(sbuf), "%-20s", ssid.c_str());
    tft.print(sbuf);
    y += 26;

    tft.setTextSize(1);
    tft.setTextColor(C_GRAY, C_BG);
    tft.setCursor(PAD, y); tft.print("IP: ");
    tft.setTextColor(C_ACCENT, C_BG);
    char ipbuf[20];
    snprintf(ipbuf, sizeof(ipbuf), "%-16s", WiFi.localIP().toString().c_str());
    tft.print(ipbuf);
    y += 32;
    tft.setTextSize(1);
    tft.setTextColor(C_GRAY, C_BG);
    tft.setCursor(PAD, y); tft.print("Hold 5s = Change WiFi         ");

  } else {
    tft_dot(PAD + 5, y + 8, C_RED);
    tft.setTextSize(2);
    tft.setTextColor(C_RED, C_BG);
    tft.setCursor(PAD + 18, y); tft.print("NOT CONNECTED     ");
    y += 32;
    tft.setTextSize(1);
    tft.setTextColor(C_GRAY, C_BG);
    tft.setCursor(PAD, y); tft.print("Hold 5s = Start WiFi Setup    ");
  }
}

// ─── Page: SIM Control ───────────────────────────────────────────────────────
static void _draw_sim_ctrl()
{
  int y = CONT_Y;

  tft_section(PAD, y, "SIM CONTROL");
  y += 14;

  bool enabled = sys_state.sim_enabled;
  tft_badge(PAD, y, enabled ? "ENABLED" : "DISABLED",
            enabled ? 0x0320 : C_DARKRED, C_WHITE, 2);
  y += 38;

  if (enabled) {
    tft.setTextSize(1);
    tft.setTextColor(C_GRAY, C_BG);
    tft.setCursor(PAD, y); tft.print("Modem:  ");
    tft.setTextColor(sys_state.sim_modem_ok ? C_GREEN : C_YELLOW, C_BG);
    tft.print(sys_state.sim_modem_ok ? "OK      " : "Init... ");
    y += 18;
    tft.setTextColor(C_GRAY, C_BG);
    tft.setCursor(PAD, y); tft.print("GPRS:   ");
    tft.setTextColor(sys_state.sim_gprs ? C_GREEN : C_GRAY, C_BG);
    tft.print(sys_state.sim_gprs ? "Connected     " : "Disconnected  ");
    y += 18;
    tft.setTextColor(C_GRAY, C_BG);
    tft.setCursor(PAD, y); tft.print("Mode:   ");
    bool sim_active = (strncmp(sys_state.conn_mode, "sim", 3) == 0);
    tft.setTextColor(sim_active ? C_ACCENT : C_WHITE, C_BG);
    tft.print(sim_active ? "SIM (active)    " : "Standby         ");
    y += 24;
  }

  tft.setTextSize(1);
  tft.setTextColor(C_GRAY, C_BG);
  tft.setCursor(PAD, y);
  tft.print(enabled ? "Hold 5s = Disable SIM  " : "Hold 5s = Enable SIM   ");
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
  if (tft_page == PAGE_SETTINGS) {
    tft.print(portal_active ? "Release = Delete WiFi + Reboot  " :
              (WiFi.status() == WL_CONNECTED ? "Release = Change WiFi Config    " :
                                               "Release = Start WiFi Setup      "));
  } else {
    tft.print(sys_state.sim_enabled ? "Release = Disable SIM Module    " :
                                      "Release = Enable SIM Module     ");
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

static void portal_ready_anim(const String &ap)
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
  tft.print("Password: " PORTAL_PASS "    then open 192.168.4.1");
  delay(800);
}

// ─── Portal start ────────────────────────────────────────────────────────────
static Preferences *_prefs_ptr = nullptr;

static void portal_start(Preferences *prefs)
{
  _prefs_ptr = prefs;
  portal_loading_anim();

  uint8_t mac[6];
  WiFi.macAddress(mac);
  char suffix[5];
  snprintf(suffix, sizeof(suffix), "%02X%02X", mac[4], mac[5]);
  portal_ssid = String("CIREN-") + suffix;

  WiFi.disconnect();
  delay(50);
  WiFi.mode(WIFI_AP_STA);
  WiFi.softAPConfig(IPAddress(192, 168, 4, 1), IPAddress(192, 168, 4, 1),
                    IPAddress(255, 255, 255, 0));
  WiFi.softAP(portal_ssid.c_str(), PORTAL_PASS, 1, 0, 4);
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
    String ssid   = portal_server.arg("ssid");
    String ssid_m = portal_server.arg("ssid_m");
    String pass   = portal_server.arg("pass");
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

  portal_ready_anim(portal_ssid);
  portal_active = true;
  page_dirty    = true;   // force page redraw after animation

  Serial.printf("[PORTAL] AP=%s Pass=%s\n", portal_ssid.c_str(), PORTAL_PASS);
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

  bool on_action = (tft_page == PAGE_SETTINGS || tft_page == PAGE_SIM_CTRL);
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
  tft.setCursor(PAD, CONT_Y + 20);
  tft.print(line1);
  tft.setTextSize(1);
  tft.setTextColor(C_YELLOW, C_BG);
  tft.setCursor(PAD, CONT_Y + 52);
  tft.print(line2);
  if (line3) {
    tft.setTextColor(C_GRAY, C_BG);
    tft.setCursor(PAD, CONT_Y + 68);
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

  // Boot splash
  tft_draw_header();
  tft_draw_footer();
  tft.setTextSize(2);
  tft.setTextColor(C_ACCENT, C_BG);
  tft.setCursor(PAD, CONT_Y + 30);
  tft.print("CIREN IoT Gateway");
  tft.setTextSize(1);
  tft.setTextColor(C_GRAY, C_BG);
  tft.setCursor(PAD, CONT_Y + 58);
  tft.print("Firmware v" FW_VERSION "   Device: " DEVICE_ID);
  tft.setCursor(PAD, CONT_Y + 75);
  tft.print("Booting...");
  tft.fillCircle(PAD + 80, CONT_Y + 75 + 4, 3, C_ACCENT);

  Serial.println("[TFT] ILI9341 ready");
}

// ─── Task ────────────────────────────────────────────────────────────────────
void task_oled(void *param)
{
  Preferences *prefs       = (Preferences *)param;
  uint32_t    last_draw_ms = 0;

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
      if (tft_page == PAGE_SETTINGS) {
        if (!portal_active) {
          Serial.println("[BTN] Hold 5s — starting WiFi portal");
          portal_start(prefs);
        } else {
          // Delete WiFi credentials + reboot
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
          tft.print("WiFi Deleted!");
          tft.setTextSize(1);
          tft.setTextColor(C_GRAY, C_BG);
          tft.setCursor(PAD, CONT_Y + 58);
          tft.print("Rebooting in 1.5 s...");
          delay(1500);
          esp_restart();
        }
      }
      else if (tft_page == PAGE_SIM_CTRL) {
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
        tft.setTextColor(C_GRAY, C_BG);
        tft.setCursor(PAD, CONT_Y + 58);
        tft.print("Rebooting in 1.5 s...");
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
