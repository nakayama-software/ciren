#pragma once
#include <SPI.h>
#include <WiFi.h>
#include <WebServer.h>
#include <esp_task_wdt.h>
#include <Adafruit_GFX.h>
#include <Adafruit_ILI9341.h>
#include <U8g2_for_Adafruit_GFX.h>
#include "ciren_config.h"
#include "ring_buffer.h"
#include "system_state.h"
#include "logo.h"


// ─── TFT instance ────────────────────────────────────────────────────────────
// Hardware SPI — pin dikonfigurasi lewat SPI.begin() di btn_oled_init()
// sebelum tft.begin() dipanggil.
static Adafruit_ILI9341 tft(PIN_TFT_CS, PIN_TFT_DC, PIN_TFT_RST);
static bool tft_ready = false;

// ─── Japanese text (U8g2_for_Adafruit_GFX layered on the existing tft canvas) ──
// Adafruit_GFX's built-in font is ASCII-only, so all Japanese UI text renders
// through this instead. u8g2_font_unifont_t_japanese1 is a bundled, pre-made
// bitmap font (hiragana/katakana + common kanji) — no glyph data authored here.
static U8G2_FOR_ADAFRUIT_GFX u8f;
#define JP_FONT  u8g2_font_unifont_t_japanese1

static void jp_font_init()
{
  u8f.begin(tft);
  u8f.setFontMode(1);   // transparent glyph draw — caller/jp_print clears the box itself
  u8f.setFontDirection(0);
  u8f.setFont(JP_FONT);
}

// ─── Draw cache — avoids the blank-then-redraw flicker ──────────────────────
// tft_draw() re-invokes every page's draw function on every ~200ms tick (not
// just on page change), so live values stay fresh. jp_print()/tft_badge()
// clear their own box before drawing (unlike tft.print(fg,bg), which erases
// and draws in one atomic pass) — redoing that every tick for text that
// hasn't actually changed produced a constant blank/redraw blink, especially
// visible on static section headers and rarely-changing badges. This cache
// skips the whole redraw (erase included) when the same (x,y) already shows
// the same text/colors. Must be cleared with ui_cache_clear() any time
// something else bulk-clears the screen/area behind these positions —
// otherwise a real screen wipe wouldn't be caught and text would go missing.
#define UI_CACHE_SIZE 32
struct UiCacheEntry { int16_t x, y; char text[40]; uint16_t fg, bg; };
static UiCacheEntry _ui_cache[UI_CACHE_SIZE];
static uint8_t      _ui_cache_count = 0;

static void ui_cache_clear() { _ui_cache_count = 0; }

// Returns true if (x,y,text,fg,bg) is already on screen (caller should skip
// redrawing). Otherwise records/updates the entry and returns false.
static bool ui_cache_hit(int x, int y, const char *text, uint16_t fg, uint16_t bg)
{
  for (uint8_t i = 0; i < _ui_cache_count; i++) {
    UiCacheEntry &e = _ui_cache[i];
    if (e.x == x && e.y == y) {
      if (e.fg == fg && e.bg == bg && strncmp(e.text, text, sizeof(e.text) - 1) == 0)
        return true;
      strncpy(e.text, text, sizeof(e.text) - 1);
      e.text[sizeof(e.text) - 1] = '\0';
      e.fg = fg; e.bg = bg;
      return false;
    }
  }
  if (_ui_cache_count < UI_CACHE_SIZE) {
    UiCacheEntry &e = _ui_cache[_ui_cache_count++];
    e.x = x; e.y = y;
    strncpy(e.text, text, sizeof(e.text) - 1);
    e.text[sizeof(e.text) - 1] = '\0';
    e.fg = fg; e.bg = bg;
  }
  return false;
}

// Draw UTF-8 text (Japanese or mixed) at top-left (x,y), same convention as
// tft.setCursor()+print(). U8g2 positions by baseline, not top-left, so this
// clears its own bounding box with `bg` first and offsets by font ascent —
// callers can treat it as a drop-in replacement for the tft.print() pattern.
// Only one font size is loaded (JP_FONT) — no tft-style sz multiplier exists
// for u8g2 bitmap fonts, so every call renders at that font's fixed size.
static void jp_print(int x, int y, const char *utf8, uint16_t fg, uint16_t bg)
{
  if (ui_cache_hit(x, y, utf8, fg, bg)) return;
  u8f.setForegroundColor(fg);
  u8f.setBackgroundColor(bg);
  int asc = u8f.getFontAscent();
  int desc = u8f.getFontDescent();   // negative
  int h = asc - desc;
  int w = u8f.getUTF8Width(utf8);
  tft.fillRect(x, y, w, h, bg);
  u8f.setCursor(x, y + asc);
  u8f.print(utf8);
}

// Language-aware print — picks `en` or `ja` based on sys_state.lang_ja and
// draws it via jp_print (unifont covers plain ASCII too, so English mode
// still renders through the same path, just with the English string).
static void ui_print(int x, int y, const char *en, const char *ja, uint16_t fg, uint16_t bg)
{
  jp_print(x, y, sys_state.lang_ja ? ja : en, fg, bg);
}

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

// ─── Thread-safe snapshot of sys_state for OLED drawing ──────────────────────
// OLED task (Core 0) reads sys_state which is written by other tasks (Core 1)
// without mutex in the original code. We snapshot once per frame under mutex
// protection, then draw from the snapshot — no torn reads.
typedef struct {
  char     device_id[32];
  char     conn_mode[8];
  bool     is_connected;
  int8_t   rssi;
  bool     sim_enabled;
  bool     sim_modem_ok;
  bool     sim_gprs;
  int8_t   sim_signal;
  char     sim_operator[24];
  uint16_t peer_count;
} OledSnapshot;

static OledSnapshot _snap;   // updated once per frame via _oled_snapshot()

static void _oled_snapshot() {
  if (!state_mutex) return;   // not yet created
  xSemaphoreTake(state_mutex, portMAX_DELAY);
  strncpy(_snap.device_id,   sys_state.device_id,   sizeof(_snap.device_id));
  strncpy(_snap.conn_mode,   sys_state.conn_mode,    sizeof(_snap.conn_mode));
  _snap.is_connected  = sys_state.is_connected;
  _snap.rssi          = sys_state.rssi;
  _snap.sim_enabled   = sys_state.sim_enabled;
  _snap.sim_modem_ok  = sys_state.sim_modem_ok;
  _snap.sim_gprs      = sys_state.sim_gprs;
  _snap.sim_signal    = sys_state.sim_signal;
  strncpy(_snap.sim_operator, sys_state.sim_operator, sizeof(_snap.sim_operator));
  _snap.peer_count    = sys_state.peer_count;
  xSemaphoreGive(state_mutex);
  // Ensure null-termination for string fields
  _snap.device_id[sizeof(_snap.device_id) - 1]   = '\0';
  _snap.conn_mode[sizeof(_snap.conn_mode) - 1]     = '\0';
  _snap.sim_operator[sizeof(_snap.sim_operator) - 1] = '\0';
}

// ─── WiFi provisioning portal ────────────────────────────────────────────────
static WebServer portal_server(PORTAL_PORT);
static bool     portal_active    = false;
static bool     reboot_pending   = false;
static uint32_t reboot_at_ms     = 0;
static String   portal_ssid      = "";
static String   portal_scan_html = "";
static bool     _scan_running    = false;   // true while async WiFi scan is in progress

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
  if (sys_state.lang_ja) {
    if (rssi >= -50) return "最高";
    if (rssi >= -65) return "良好";
    if (rssi >= -75) return "普通";
    return "弱い";
  }
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
// Uses snprintf to avoid ~20 temporary String allocations per call (heap corruption fix)
static String _signal_svg(int bars) {
  static const int heights[] = {4, 7, 10, 14};
  static const char* filled_clr = "#22c55e";  // green
  static const char* empty_clr  = "#334155";  // slate
  char buf[320];  // large enough for 4 rect elements + svg wrapper
  int len = snprintf(buf, sizeof(buf),
    "<svg width='20' height='14' viewBox='0 0 20 14' style='vertical-align:middle;margin-right:6px'>"
    "<rect x='0' y='%d' width='4' height='%d' rx='1' fill='%s'/>"
    "<rect x='5' y='%d' width='4' height='%d' rx='1' fill='%s'/>"
    "<rect x='10' y='%d' width='4' height='%d' rx='1' fill='%s'/>"
    "<rect x='15' y='%d' width='4' height='%d' rx='1' fill='%s'/>"
    "</svg>",
    14 - heights[0], heights[0], bars > 0 ? filled_clr : empty_clr,
    14 - heights[1], heights[1], bars > 1 ? filled_clr : empty_clr,
    14 - heights[2], heights[2], bars > 2 ? filled_clr : empty_clr,
    14 - heights[3], heights[3], bars > 3 ? filled_clr : empty_clr);
  (void)len;  // suppress unused warning
  return String(buf);
}

// Build scan HTML from the results of a completed async scan.
// Does NOT call WiFi.scanNetworks() — that must be started separately.
// Uses snprintf + reserve() to avoid excessive temporary String allocations.
static String build_scan_html_from_results()
{
  esp_task_wdt_reset();   // feed WDT — this can be slow with many networks

  int n = WiFi.scanComplete();
  if (n < 0) {
    return "<div class='section-label'>" + String(sys_state.lang_ja ? "利用可能なネットワーク" : "Available Networks") + "</div>"
           "<div class='empty-state'>Scan failed — tap Refresh</div>";
  }

  // Cap displayed networks to limit HTML size and heap usage
  const int MAX_DISPLAY_NETS = 10;
  if (n > MAX_DISPLAY_NETS) n = MAX_DISPLAY_NETS;

  String h;
  h.reserve(512 + (size_t)n * 300);   // pre-allocate to reduce fragmentation
  h = "<div class='section-label'>" + String(sys_state.lang_ja ? "利用可能なネットワーク" : "Available Networks") + "</div>";

  if (n <= 0) {
    h += "<div class='empty-state'>" + String(sys_state.lang_ja ? "ネットワークが見つかりません" : "No networks found") + "</div>";
  } else {
    h += "<div class='network-list'>";
    char item[512];   // per-network item buffer (stack, not heap)
    for (int i = 0; i < n; i++) {
      int  rssi = WiFi.RSSI(i);
      int  bars = _rssi_bars(rssi);
      bool open  = (WiFi.encryptionType(i) == WIFI_AUTH_OPEN);
      String ssid = html_esc(WiFi.SSID(i));    // one String per network (unavoidable — SSID is variable-length)
      String svg  = _signal_svg(bars);           // one String per network (uses snprintf internally now)

      snprintf(item, sizeof(item),
        "<label class='network-item' for='net%d'>"
        "<input type='radio' id='net%d' name='ssid' value='%s'>"
        "<span class='check-dot'></span>"
        "<span class='network-info'>%s"
        "<span class='network-name'>%s</span>%s</span>"
        "<span class='network-meta'>%d dBm &bull; %s</span>"
        "</label>",
        i, i, ssid.c_str(),
        svg.c_str(),
        ssid.c_str(),
        open ? "" : "<span class='lock-icon'>&#x1F512;</span>",
        rssi, _rssi_label(rssi));
      h += item;

      // Feed WDT every 4 networks to prevent timeout on large scans
      if ((i & 3) == 3) esp_task_wdt_reset();
    }
    h += "</div>";
  }
  WiFi.scanDelete();
  return h;
}

// Start an async WiFi scan (non-blocking). Results are collected in portal_tick().
static void start_wifi_scan()
{
  if (_scan_running) return;   // scan already in progress
  WiFi.scanDelete();           // clear any previous results
  WiFi.scanNetworks(true);     // true = async, returns immediately
  _scan_running = true;
}

static String _portal_mqtt_host;
static String _portal_sim_apn;
static String _portal_sim_user;
static String _portal_sim_pass;
static String _portal_device_id;
static bool   _portal_sim_enabled = true;
static bool   _portal_lora_enabled = true;

static String build_portal_page(const String &msg = "", bool ok = false)
{
  esp_task_wdt_reset();   // feed WDT — this function builds a large String

  // Pick English or Japanese for a given string pair based on the current
  // language setting — shared with the OLED (sys_state.lang_ja), so switching
  // it here also changes what the physical screen shows on its next redraw.
  auto PL = [](const char *en, const char *ja) { return String(sys_state.lang_ja ? ja : en); };
  const bool ja = sys_state.lang_ja;

  String h;
  h.reserve(4096);   // pre-allocate to reduce heap fragmentation
  h += F("<!doctype html><html lang='");
  h += (ja ? "ja" : "en");
  h += F("'><head>"
         "<meta charset='utf-8'>"
         "<meta name='viewport' content='width=device-width,initial-scale=1'>"
         "<title>");
  h += PL("CIREN Setup", "CIREN セットアップ");
  h += F("</title>"
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
         "details summary{cursor:pointer;list-style:none;user-select:none;"
                          "display:flex;align-items:center;gap:6px}"
         "details summary::-webkit-details-marker{display:none}"
         "details .details-arrow{display:inline-block;transition:transform .15s;font-size:10px}"
         "details[open] .details-arrow{transform:rotate(90deg)}"
         "details .field{margin-top:12px}"
         ".checkbox-row{display:flex;align-items:center;gap:8px;margin-bottom:16px;"
                        "font-size:13px;color:#e2e8f0;cursor:pointer}"
         ".checkbox-row input{width:16px;height:16px;accent-color:#0ea5e9;cursor:pointer}"
         ".lang-switch{position:absolute;top:14px;right:14px;font-size:13px;font-weight:700;"
                       "color:#fff;text-decoration:none;letter-spacing:.02em;"
                       "background:rgba(255,255,255,.22);border:1.5px solid rgba(255,255,255,.55);"
                       "padding:7px 14px;border-radius:20px;display:inline-flex;"
                       "align-items:center;gap:5px;box-shadow:0 2px 8px rgba(0,0,0,.2);"
                       "transition:background .15s}"
         ".lang-switch:active{background:rgba(255,255,255,.4)}"
         ".header{position:relative}"
         "</style>"
         "</head><body><div class='card'>");

  // Header — use _snap.device_id (mutex-protected) instead of direct sys_state access
  h += "<div class='header'>"
       "<a class='lang-switch' href='/lang?set=" + String(ja ? "en" : "ja") + "'>"
       "&#x1F310; " + (ja ? "EN" : "日本語") + "</a>"
       "<div class='header-dot'>&#x1F4F6;</div>"
       "<h1>" + PL("CIREN WiFi Setup", "CIREN WiFi設定") + "</h1>"
       "<p>" + PL("Device: ", "デバイス: ") + String(_snap.device_id) +
       " &nbsp;&bull;&nbsp; " + PL("Firmware v", "ファームウェア v") + String(FW_VERSION) + "</p>"
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

  // Network list (show "Scanning..." if async scan is still in progress)
  if (_scan_running && portal_scan_html.length() == 0) {
    h += "<div class='section-label'>Available Networks</div>"
         "<div class='empty-state'>Scanning... <a href='/refresh' style='color:#0ea5e9'>Refresh</a></div>";
  } else {
    h += portal_scan_html;
  }

  // Refresh link
  h += "<div style='text-align:right;margin-bottom:20px'>"
       "<a href='/refresh' style='font-size:12px;color:#0ea5e9;text-decoration:none'>"
       "&#x21BB; " + PL("Refresh networks", "ネットワークを更新") + "</a></div>";

  // Divider
  h += "<div class='divider'>" + PL("or enter manually", "または手動で入力") + "</div>";

  // Manual SSID
  h += "<div class='field'><label>" + PL("Network Name (SSID)", "ネットワーク名 (SSID)") + "</label>"
       "<input name='ssid_m' placeholder='" + PL("Enter WiFi name", "WiFi名を入力") + "' autocomplete='off'></div>";

  // Password (shown as plain text for easy entry on mobile)
  h += "<div class='field'><label>" + PL("Password", "パスワード") + "</label>"
       "<input type='text' name='pass' placeholder='" + PL("Enter WiFi password", "WiFiパスワードを入力") + "' autocomplete='off'></div>";

  // Advanced: Device ID + MQTT + SIM/LoRa enable/disable — collapsed by
  // default behind a <details> dropdown
  h += "<div style='margin:20px 0 16px;border-top:1px solid #334155;padding-top:16px'>"
       "<details>"
       "<summary class='section-label'><span class='details-arrow'>&#x25B8;</span>" + PL("Advanced", "詳細設定") + "</summary>"
       "<div class='field'><label>" + PL("Device ID", "デバイスID") + " <span style='color:#475569'>" +
       PL("(leave blank for auto-generated)", "（空欄で自動生成）") + "</span></label>"
       "<input type='text' name='device_id' value='" + html_esc(_portal_device_id) + "' "
       "placeholder='" + PL("e.g. MM-A1B2C3", "例: MM-A1B2C3") + "' autocomplete='off' maxlength='31'></div>"
       "<div class='field'><label>" + PL("MQTT Broker IP", "MQTTブローカーIP") + "</label>"
       "<input type='text' name='mqtt_host' value='" + html_esc(_portal_mqtt_host) + "' "
       "placeholder='" + PL("e.g. 118.22.31.254", "例: 118.22.31.254") + "' autocomplete='off'></div>"
       "<label class='checkbox-row'>"
       "<input type='checkbox' name='sim_enabled' value='1'" + String(_portal_sim_enabled ? " checked" : "") + ">"
       + PL("Enable SIM (cellular fallback)", "SIMを有効にする（モバイル回線フォールバック）") + "</label>"
       "<label class='checkbox-row'>"
       "<input type='checkbox' name='lora_enabled' value='1'" + String(_portal_lora_enabled ? " checked" : "") + ">"
       + PL("Enable LoRa (GPS receiver)", "LoRaを有効にする（GPS受信）") + "</label>"
       "</details>"
       "</div>"
       "<div style='margin:0 0 16px;border-top:1px solid #334155;padding-top:16px'>"
       "<p class='section-label'>" + PL("SIM Card APN", "SIMカード APN") + "</p>"
       "<div class='field'><label>APN</label>"
       "<input type='text' name='sim_apn' value='" + html_esc(_portal_sim_apn) + "' "
       "placeholder='" + PL("e.g. internet", "例: internet") + "' autocomplete='off'></div>"
       "<div class='field'><label>" + PL("APN Username", "APNユーザー名") + " <span style='color:#475569'>" +
       PL("(leave blank if none)", "（なければ空欄）") + "</span></label>"
       "<input type='text' name='sim_user' value='" + html_esc(_portal_sim_user) + "' "
       "placeholder='" + PL("optional", "任意") + "' autocomplete='off'></div>"
       "<div class='field'><label>" + PL("APN Password", "APNパスワード") + " <span style='color:#475569'>" +
       PL("(leave blank if none)", "（なければ空欄）") + "</span></label>"
       "<input type='text' name='sim_pass' value='" + html_esc(_portal_sim_pass) + "' "
       "placeholder='" + PL("optional", "任意") + "' autocomplete='off'></div>"
       "</div>";

  // Buttons
  h += "<div class='btn-row'>"
       "<button type='submit' class='btn btn-primary'>" + PL("Save &amp; Reboot", "保存して再起動") + "</button>"
       "</div>";

  h += "</form>";

  h += "<p class='meta'>" + PL("After saving, reconnect to your usual WiFi network.",
                                "保存後、通常お使いのWiFiネットワークに再接続してください。") + "</p>";

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

// Filled pill badge — sized from the actual UTF-8 glyph width (not byte
// length) so it works for both ASCII and Japanese text through the same u8g2
// font as jp_print/ui_print.
static void tft_badge(int x, int y, const char *text, uint16_t bg, uint16_t fg)
{
  if (ui_cache_hit(x, y, text, fg, bg)) return;
  u8f.setForegroundColor(fg);
  u8f.setBackgroundColor(bg);
  int asc = u8f.getFontAscent();
  int desc = u8f.getFontDescent();
  int th = asc - desc;
  int tw = u8f.getUTF8Width(text);
  tft.fillRoundRect(x, y, tw + 12, th + 8, 4, bg);
  u8f.setCursor(x + 6, y + 4 + asc);
  u8f.print(text);
}

// Language-aware badge — picks `en`/`ja` based on sys_state.lang_ja.
static void ui_badge(int x, int y, const char *en, const char *ja, uint16_t bg, uint16_t fg)
{
  tft_badge(x, y, sys_state.lang_ja ? ja : en, bg, fg);
}

// Section label — cyan text, easy to read for elderly users
static void tft_section(int x, int y, const char *en, const char *ja)
{
  ui_print(x, y, en, ja, C_ACCENT, C_BG);
  // Callers should add y += 22 after this
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
static const char *_page_titles_en[] = { "Gateway", "WiFi", "SIM", "Settings" };
static const char *_page_titles_ja[] = { "ゲートウェイ", "WiFi", "SIM", "設定" };

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
  if (tft_page >= 0 && tft_page < OLED_TOTAL_PAGES)
    ui_print(90, (HDR_H - 8) / 2 - 2, _page_titles_en[tft_page], _page_titles_ja[tft_page], C_ACCENT, C_HDR_BG);
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
  tft.printf("%s  v%s", _snap.device_id, FW_VERSION);

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
  tft_section(PAD, y, "DEVICE", "デバイス");
  y += 22;

  tft.setTextSize(1);
  tft.setTextColor(C_GRAY, C_BG);
  tft.setCursor(PAD, y);
  tft.print("MAC");
  y += 12;
  tft.setTextSize(2);
  tft.setTextColor(C_ACCENT, C_BG);
  tft.setCursor(PAD, y);
  tft.print(WiFi.macAddress().c_str());
  y += 22;

  // ── Connection mode + server status ──
  tft_section(PAD, y, "CONNECTION", "接続");
  y += 22;

  bool wifi_mode = (strncmp(_snap.conn_mode, "wifi", 4) == 0);
  bool conn      = _snap.is_connected;

  tft_badge(PAD, y, wifi_mode ? "WiFi" : "SIM", wifi_mode ? 0x000F : 0x6000, C_WHITE);
  if (conn) ui_badge(PAD + 90, y, "SERVER OK", "サーバーOK", 0x0320, C_WHITE);
  else      ui_badge(PAD + 90, y, "NO SERVER", "サーバー未接続", 0x6000, C_WHITE);
  y += 28;

  // ── Sensor controllers ──
  tft_section(PAD, y, "CONTROLLERS", "コントローラー");
  y += 22;

  uint16_t peers = _snap.peer_count;
  char pbuf[4];  snprintf(pbuf, sizeof(pbuf), "%d", peers);
  tft.setTextSize(2);
  tft.setTextColor(peers > 0 ? C_ACCENT : C_GRAY, C_BG);
  tft.setCursor(PAD, y);
  tft.print(pbuf);
  ui_print(PAD + (peers >= 10 ? 28 : 16), y + 5, "controllers connected", "台接続中", C_WHITE, C_BG);
  y += 22;

  // ── Data buffer ──
  // Ring buffer (128 slots) antrian sensor data antara ESP-NOW dan MQTT publish.
  // 0% = normal. >50% = jaringan lambat. >80% = data lama mulai tertimpa.
  tft_section(PAD, y, "DATA BUFFER", "データバッファ");
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

  tft_section(PAD, y, "NETWORK", "ネットワーク");
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
    tft_section(PAD, y, "SIGNAL", "信号");
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
    ui_print(PAD + 22, y, "NOT CONNECTED", "未接続", C_RED, C_BG);
    y += 36;

    ui_print(PAD, y, "See Settings page", "設定ページを確認", C_WHITE, C_BG);
  }
}

// ─── Page: SIM ───────────────────────────────────────────────────────────────
static void _draw_sim()
{
  int y = CONT_Y;

  tft_section(PAD, y, "SIM MODULE", "SIMモジュール");
  y += 22;

  if (!_snap.sim_enabled) {
    ui_badge(PAD, y, "DISABLED", "無効", C_DARKRED, C_WHITE);
    y += 36;
    // SIM enable/disable now lives in the WiFi-setup web portal (Advanced
    // section), not a physical page/hold-gesture — PAGE_SIM_CTRL was removed.
    ui_print(PAD, y, "Enable via setup portal", "セットアップポータルで有効化", C_WHITE, C_BG);
    y += 24;
    ui_print(PAD, y, "Connect to 192.168.4.1", "192.168.4.1 に接続", C_YELLOW, C_BG);
    return;
  }

  // Modem status badge
  ui_badge(PAD, y, _snap.sim_modem_ok ? "MODEM OK" : "INIT...",
           _snap.sim_modem_ok ? "モデムOK" : "初期化中...",
           _snap.sim_modem_ok ? 0x0320 : C_DGRAY, C_WHITE);
  bool active = (strncmp(_snap.conn_mode, "sim", 3) == 0);
  if (active)
    ui_badge(PAD + 150, y, "ACTIVE", "有効", C_ACCENT, C_BG);
  y += 36;

  if (_snap.sim_modem_ok) {
    // Operator
    tft_section(PAD, y, "OPERATOR", "キャリア");
    y += 22;
    tft.setTextSize(2);
    tft.setTextColor(C_WHITE, C_BG);
    char opbuf[17];
    snprintf(opbuf, sizeof(opbuf), "%-16s", _snap.sim_operator);
    tft.setCursor(PAD, y);
    tft.print(opbuf);
    y += 24;

    // Signal
    tft_section(PAD, y, "SIGNAL", "信号");
    y += 22;
    int sig = _snap.sim_signal;
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

// ─── Page: Settings ──────────────────────────────────────────────────────────
static void _draw_settings()
{
  int y = CONT_Y;

  tft_section(PAD, y, "CONNECTION SETTINGS", "接続設定");
  y += 22;

  if (portal_active) {
    // Portal is running — show connection instructions
    ui_badge(PAD, y, "SETUP MODE", "設定モード", C_ACCENT, C_BG);
    y += 36;

    ui_print(PAD, y, "Connect to WiFi:", "WiFiに接続:", C_WHITE, C_BG);
    y += 22;
    String ap = portal_ssid;
    if (ap.length() > 16) ap = ap.substring(0, 16);
    jp_print(PAD, y, ap.c_str(), C_ACCENT, C_BG);
    y += 22;
    { String s = String(sys_state.lang_ja ? "パスワード: " : "Password: ") + PORTAL_PASS;
      jp_print(PAD, y, s.c_str(), C_WHITE, C_BG); }
    y += 22;
    jp_print(PAD, y, "192.168.4.1", C_ACCENT, C_BG);

  } else if (WiFi.status() == WL_CONNECTED) {
    tft_dot(PAD + 6, y + 10, C_GREEN);
    String ssid = WiFi.SSID();
    if (ssid.length() > 15) ssid = ssid.substring(0, 15);
    jp_print(PAD + 22, y, ssid.c_str(), C_WHITE, C_BG);
    y += 28;

    tft.setTextSize(2);
    tft.setTextColor(C_WHITE, C_BG);
    tft.setCursor(PAD, y); tft.print("IP:");
    tft.setTextColor(C_ACCENT, C_BG);
    char ipbuf[16];
    snprintf(ipbuf, sizeof(ipbuf), "%-13s", WiFi.localIP().toString().c_str());
    tft.print(ipbuf);
    y += 36;
    ui_print(PAD, y, "Hold 5s = Reset", "5秒長押しでリセット", C_YELLOW, C_BG);

  } else {
    // Credentials saved but WiFi not connected (wrong password / network down)
    tft_dot(PAD + 6, y + 10, C_RED);
    ui_print(PAD + 22, y, "NOT CONNECTED", "未接続", C_RED, C_BG);
    y += 36;
    ui_print(PAD, y, "Wrong password?", "パスワードを確認", C_WHITE, C_BG);
    y += 24;
    ui_print(PAD, y, "Hold 5s = Reset", "5秒長押しでリセット", C_YELLOW, C_BG);
  }
}

// ─── Hold-progress overlay ───────────────────────────────────────────────────
static void _draw_hold_overlay(uint32_t held_ms)
{
  float pct = min(1.0f, (float)held_ms / (float)BTN_HOLD_MS);

  // Fill content area with a semi-dark rect
  tft.fillRect(0, CONT_Y, TFT_WIDTH, FTR_Y - CONT_Y, C_BG);
  tft.drawRect(PAD, CONT_Y + 4, TFT_WIDTH - PAD * 2, FTR_Y - CONT_Y - 8, C_SEP);
  ui_cache_clear();   // area just got wiped by the fillRect above — don't let jp_print/tft_badge think old text is still there

  int inner_y = CONT_Y + 24;
  ui_print(PAD + 8, inner_y, "Hold to confirm...", "長押しで確定...", C_GRAY, C_BG);
  inner_y += 18;

  // Progress bar
  tft_hbar(PAD + 8, inner_y, TFT_WIDTH - PAD * 2 - 16, 16, pct, C_ACCENT);
  inner_y += 28;

  // Action description
  ui_print(PAD + 8, inner_y, "Release = Reset WiFi + Reboot", "離す = WiFiリセット+再起動", C_ACCENT, C_BG);
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
  ui_cache_clear();
  tft_draw_header();
  tft_draw_footer();

  auto frame = [](int pct, const char *en, const char *ja) {
    ui_print(PAD, 80, en, ja, C_WHITE, C_BG);
    tft_hbar(PAD, 104, TFT_WIDTH - PAD * 2, 16, pct / 100.0f, C_ACCENT);
  };
  for (int p = 0; p <= 40; p += 4)  { frame(p, "Preparing...", "準備中..."); delay(40); }
  for (int p = 40; p <= 75; p += 3) { frame(p, "Scanning WiFi...", "WiFiをスキャン中..."); delay(30); }
}

static void portal_ready_anim(const String &ap, const char* pass)
{
  auto frame = [](int pct) {
    tft_hbar(PAD, 104, TFT_WIDTH - PAD * 2, 16, pct / 100.0f, C_GREEN);
  };
  for (int p = 75; p <= 100; p += 5) { frame(p); delay(40); }

  ui_print(PAD, 80, "Portal Ready!", "ポータル準備完了！", C_GREEN, C_BG);

  tft.fillRect(PAD, 132, TFT_WIDTH - PAD * 2, 80, C_BG);
  ui_print(PAD, 132, "Connect phone to AP:", "スマホをAPに接続:", C_GRAY, C_BG);
  jp_print(PAD, 148, ap.c_str(), C_ACCENT, C_BG);
  char passbuf[64];
  snprintf(passbuf, sizeof(passbuf), sys_state.lang_ja ? "パスワード: %s → 192.168.4.1" : "Password: %s -> 192.168.4.1", pass);
  jp_print(PAD, 174, passbuf, C_GRAY, C_BG);
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
  _portal_sim_enabled = prefs->getBool("sim_en", true);
  _portal_lora_enabled = prefs->getBool("lora_en", true);
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
  start_wifi_scan();   // start async scan — results collected in portal_tick()

  portal_server.on("/", HTTP_GET, []() {
    portal_server.send(200, "text/html", build_portal_page());
  });
  portal_server.on("/refresh", HTTP_GET, []() {
    start_wifi_scan();   // non-blocking: start async scan, redirect immediately
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
    // Checkbox: browsers only include it in the POST body when checked, so
    // its presence (not its value) is what tells us the new state.
    bool sim_enabled_new  = portal_server.hasArg("sim_enabled");
    bool lora_enabled_new = portal_server.hasArg("lora_enabled");
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
      // SIM enable/disable — moved here from the physical SIM CONTROL page
      _prefs_ptr->putBool("sim_en", sim_enabled_new);
      _portal_sim_enabled  = sim_enabled_new;
      sys_state.sim_enabled = sim_enabled_new;
      // LoRa enable/disable — takes effect after reboot, same as SIM above
      _prefs_ptr->putBool("lora_en", lora_enabled_new);
      _portal_lora_enabled  = lora_enabled_new;
      sys_state.lora_enabled = lora_enabled_new;
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
                       build_portal_page(sys_state.lang_ja ? "保存しました！2秒後に再起動します..."
                                                            : "Saved! Rebooting in 2s...", true));
    reboot_pending = true;
    reboot_at_ms   = millis() + 2000;
  });
  portal_server.on("/lang", HTTP_GET, []() {
    // Language switch — affects the portal (this page, re-rendered on
    // redirect) and the physical OLED (same sys_state.lang_ja, redrawn on
    // its next tick) — no reboot needed, just persisted + applied live.
    String set = portal_server.arg("set");
    bool want_ja = (set != "en");
    sys_state.lang_ja = want_ja;
    if (_prefs_ptr) {
      _prefs_ptr->begin("ciren", false);
      _prefs_ptr->putBool("lang_ja", want_ja);
      _prefs_ptr->end();
    }
    page_dirty = true;   // force OLED to redraw in the new language
    portal_server.sendHeader("Location", "/");
    portal_server.send(302, "text/plain", "");
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
  if (!portal_active) {
    if (reboot_pending && millis() >= reboot_at_ms) esp_restart();
    return;
  }

  // ── Collect async WiFi scan results ──────────────────────────────────────
  if (_scan_running) {
    int16_t n = WiFi.scanComplete();
    if (n >= 0) {
      // Scan finished — build HTML from results
      _scan_running = false;
      portal_scan_html = build_scan_html_from_results();
      page_dirty = true;   // force TFT redraw to show updated info
    }
    // If n == WIFI_SCAN_RUNNING (-1), scan is still in progress — skip
  }

  // Refresh snapshot before portal handler reads it (build_portal_page uses _snap)
  _oled_snapshot();
  esp_task_wdt_reset();   // feed WDT before handleClient (can be slow)

  portal_server.handleClient();

  if (reboot_pending && millis() >= reboot_at_ms) esp_restart();
}

// ─── Main draw function ───────────────────────────────────────────────────────
static void tft_draw()
{
  if (!tft_ready) return;

  // Snapshot sys_state under mutex protection — prevents torn reads
  _oled_snapshot();

  // Hold is active whenever WiFi is configured (to reset from any page).
  bool on_action = !portal_active;
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
    ui_cache_clear();
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
    case PAGE_SETTINGS: _draw_settings(); break;
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

  SPI.begin(PIN_TFT_SCK, PIN_TFT_MISO, PIN_TFT_MOSI, -1);
  tft.begin(40000000UL);   // 40 MHz SPI
  tft.setRotation(TFT_ROTATION);
  tft.fillScreen(C_BG);
  jp_font_init();
  tft_ready = true;

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
  { char dbuf[64]; snprintf(dbuf, sizeof(dbuf), sys_state.lang_ja ? "デバイス: %s    v%s" : "Device: %s    v%s",
                            sys_state.device_id, FW_VERSION);
    jp_print(88, 158, dbuf, C_ACCENT, C_BG); }

  // Booting indicator
  ui_print(130, 174, "Booting...", "起動中...", C_WHITE, C_BG);

  delay(2000);   // hold splash for 2 seconds

  Serial.println("[TFT] ILI9341 ready");
}

// ─── Task ────────────────────────────────────────────────────────────────────
void task_oled(void *param)
{
  esp_task_wdt_add(NULL);   // subscribe to Task Watchdog
  Preferences *prefs       = (Preferences *)param;
  uint32_t    last_draw_ms = 0;

  vTaskDelay(pdMS_TO_TICKS(50)); 
  SPI.begin(PIN_TFT_SCK, PIN_TFT_MISO, PIN_TFT_MOSI, -1);
  tft.begin(40000000UL);
  tft.setRotation(TFT_ROTATION);
  jp_font_init();
  tft_ready  = true;
  page_dirty = true;
  Serial.println("[TFT] Task reinit OK (Core 0)");

  for (;;) {
    vTaskDelay(pdMS_TO_TICKS(20));
    esp_task_wdt_reset();   // feed watchdog — top of loop

    portal_tick();
    esp_task_wdt_reset();   // feed watchdog — after portal_tick (which can be slow)

    BtnAction act = btn_tick();

    if (act == BA_SHORT) {
      tft_page  = (tft_page + 1) % OLED_TOTAL_PAGES;
      page_dirty = true;
      Serial.printf("[BTN] Page -> %d\n", tft_page);
    }
    else if (act == BA_HOLD5) {
      if (!portal_active) {
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
        ui_print(PAD, CONT_Y + 30, "WiFi Reset!", "WiFiをリセットしました！", C_RED, C_BG);
        ui_print(PAD, CONT_Y + 58, "Rebooting...", "再起動中...", C_WHITE, C_BG);
        // WDT-safe reboot delay — feed watchdog every 100ms
        for (int i = 0; i < 15; i++) {
          esp_task_wdt_reset();
          vTaskDelay(pdMS_TO_TICKS(100));
        }
        esp_restart();
      }
    }

    // Refresh TFT hanya saat interval terpenuhi
    if (millis() - last_draw_ms >= TFT_REFRESH_MS) {
      last_draw_ms = millis();
      tft_draw();
    }
    esp_task_wdt_reset();   // feed watchdog — end of loop
  }
}
