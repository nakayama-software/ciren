#pragma once
// ─────────────────────────────────────────────────────────────────────────────
// Store-and-forward flash buffer — overflow extension for publish_queue.
//
// This is NOT an always-on write log. In normal operation (publish_queue has
// room) this module is never touched — flash is only used when the RAM queue
// is full, i.e. the device has been disconnected long enough that the live
// path can't keep up. See the design discussion / published flow diagrams
// for the full rationale.
//
// Scope: only FTYPE_DATA / FTYPE_DATA_TYPED (genuine sensor measurements) are
// ever written here. HB_TYPED and ERROR frames are never buffered — callers
// must filter before calling fb_write().
//
// Storage: a fixed-size file on LittleFS, treated as a circular buffer of
// fixed-size FlashRecord slots. Two ever-increasing counters — write_idx and
// confirmed_idx — are persisted in NVS (Preferences) so they survive a
// reboot; physical slot = index % FLASH_BUFFER_CAPACITY.
//
//   write_idx      — next slot to write a new overflowed reading into
//   confirmed_idx  — oldest record NOT YET confirmed as successfully sent
//   backlog        — write_idx - confirmed_idx (records still owed to the server)
//
// A record is only removed from "owed" accounting (confirmed_idx advances)
// after the publish that carried it returns success — not merely once it's
// been read into a PublishItem. If a publish fails, or the device reboots
// before it succeeds, confirmed_idx is untouched and the same slot range is
// retried from scratch next time. This is what makes replay safe across
// both a failed send and a mid-send reboot.
//
// Eviction policy when the buffer is completely full: drop the OLDEST
// unconfirmed record (advance confirmed_idx without having sent it) to make
// room for the new one — FIFO, per the agreed design.
// ─────────────────────────────────────────────────────────────────────────────

#include <Arduino.h>
#include <LittleFS.h>
#include <Preferences.h>
#include "ciren_config.h"
#include "system_state.h"
#include "task_logger.h"

// One buffered reading. Packed to keep the on-flash record size fixed and
// small (12 bytes) — deliberately NOT ring_buffer.h's SensorPacket, because
// that struct carries timestamp_ms (monotonic millis() since boot), which is
// meaningless after a reboot. epoch_s is the NTP-synced wall-clock time,
// resolved by the caller at write time, while the current boot's NTP offset
// is still known — see fb_write()'s epoch_s parameter.
typedef struct {
  uint8_t  ctrl_id;
  uint8_t  port_num;
  uint8_t  sensor_type;
  float    value;
  uint32_t epoch_s;
  uint8_t  ftype;
} __attribute__((packed)) FlashRecord;

static SemaphoreHandle_t _fb_mutex            = NULL;
static Preferences       _fb_prefs;
static uint32_t          _fb_write_idx        = 0;
static uint32_t          _fb_confirmed_idx    = 0;
static uint8_t           _fb_outstanding_count = 0;  // size of the batch currently peeked-but-unconfirmed (0 = none in flight)
static bool              _fb_ready            = false;

// ── NVS persistence for the two cursors ──────────────────────────────────────
static void _fb_persist_write_idx() {
  _fb_prefs.begin("ciren_fb", false);
  _fb_prefs.putUInt("w_idx", _fb_write_idx);
  _fb_prefs.end();
}
static void _fb_persist_confirmed_idx() {
  _fb_prefs.begin("ciren_fb", false);
  _fb_prefs.putUInt("c_idx", _fb_confirmed_idx);
  _fb_prefs.end();
}

// ── Raw record I/O (file opened/closed per access — simplest and safest;
//    this path is only hit during actual overflow/replay, never in the
//    common case, so the extra open/close overhead doesn't matter) ───────────
static bool _fb_write_record_at(uint32_t slot, const FlashRecord &rec) {
  File f = LittleFS.open(FLASH_BUFFER_PATH, "r+");
  if (!f) return false;
  bool ok = f.seek((uint32_t)slot * sizeof(FlashRecord));
  if (ok) ok = (f.write((const uint8_t *)&rec, sizeof(FlashRecord)) == sizeof(FlashRecord));
  f.close();
  return ok;
}

static bool _fb_read_record_at(uint32_t slot, FlashRecord &rec) {
  File f = LittleFS.open(FLASH_BUFFER_PATH, "r");
  if (!f) return false;
  bool ok = f.seek((uint32_t)slot * sizeof(FlashRecord));
  if (ok) ok = (f.read((uint8_t *)&rec, sizeof(FlashRecord)) == sizeof(FlashRecord));
  f.close();
  return ok;
}

// Pre-size the ring file to exactly FLASH_BUFFER_CAPACITY slots on first use
// (or after a capacity change / corruption — detected by size mismatch).
static bool _fb_ensure_file() {
  const size_t want_size = (size_t)FLASH_BUFFER_CAPACITY * sizeof(FlashRecord);

  if (LittleFS.exists(FLASH_BUFFER_PATH)) {
    File f = LittleFS.open(FLASH_BUFFER_PATH, "r");
    bool sized_ok = f && (f.size() == want_size);
    if (f) f.close();
    if (sized_ok) return true;
    LittleFS.remove(FLASH_BUFFER_PATH);   // wrong size — rebuild from scratch below
  }

  File f = LittleFS.open(FLASH_BUFFER_PATH, "w");
  if (!f) return false;
  FlashRecord zero = {0, 0, 0, 0.0f, 0, 0};
  bool ok = true;
  for (uint32_t i = 0; i < FLASH_BUFFER_CAPACITY && ok; i++) {
    ok = (f.write((const uint8_t *)&zero, sizeof(FlashRecord)) == sizeof(FlashRecord));
  }
  f.close();
  return ok;
}

// ── Public API ────────────────────────────────────────────────────────────────

void fb_init() {
  _fb_mutex = xSemaphoreCreateMutex();

  if (!LittleFS.begin(true)) {   // true = format on mount failure
    Serial.println("[FB] LittleFS mount failed — store-and-forward disabled");
    LOG_ERROR("FB", "LittleFS mount failed — store-and-forward disabled");
    return;
  }

  if (!_fb_ensure_file()) {
    Serial.println("[FB] Ring buffer file init failed — store-and-forward disabled");
    LOG_ERROR("FB", "Ring buffer file init failed — store-and-forward disabled");
    return;
  }

  _fb_prefs.begin("ciren_fb", true);
  _fb_write_idx     = _fb_prefs.getUInt("w_idx", 0);
  _fb_confirmed_idx = _fb_prefs.getUInt("c_idx", 0);
  _fb_prefs.end();

  // Defend against a stale/corrupt NVS pair (e.g. left over from a firmware
  // revision with a different FLASH_BUFFER_CAPACITY) rather than trust it blindly.
  if (_fb_confirmed_idx > _fb_write_idx ||
      (_fb_write_idx - _fb_confirmed_idx) > FLASH_BUFFER_CAPACITY) {
    _fb_write_idx = _fb_confirmed_idx;
  }

  _fb_ready = true;
  uint32_t backlog = _fb_write_idx - _fb_confirmed_idx;
  Serial.printf("[FB] Ready — backlog=%lu record(s) pending from a previous session\n", (unsigned long)backlog);
  LOG_INFO("FB", "Ready — backlog=%lu record(s) pending", (unsigned long)backlog);
}

// Overflow-write one reading. Caller is responsible for only calling this for
// FTYPE_DATA / FTYPE_DATA_TYPED — see module header. epoch_s must already be
// NTP-resolved (state_epoch_s_at(...)), not a raw timestamp_ms.
bool fb_write(uint8_t ctrl_id, uint8_t port_num, uint8_t sensor_type,
              float value, uint8_t ftype, uint32_t epoch_s) {
  if (!_fb_ready) return false;
  if (epoch_s < FB_MIN_VALID_EPOCH_S) {
    // NTP hasn't synced this boot yet — don't buffer a reading we can't give
    // a trustworthy replay time to (it would land at the wrong spot on the
    // dashboard later, same reasoning as the backend's own eventMs guard).
    return false;
  }

  if (xSemaphoreTake(_fb_mutex, pdMS_TO_TICKS(2000)) != pdTRUE) return false;

  if (_fb_write_idx - _fb_confirmed_idx >= FLASH_BUFFER_CAPACITY) {
    // Buffer completely full — FIFO: drop the oldest unconfirmed record to
    // make room, per the agreed eviction policy.
    _fb_confirmed_idx++;
    _fb_persist_confirmed_idx();
    LOG_WARN("FB", "Buffer full — dropped oldest unconfirmed record");
  }

  FlashRecord rec = {ctrl_id, port_num, sensor_type, value, epoch_s, ftype};
  uint32_t slot = _fb_write_idx % FLASH_BUFFER_CAPACITY;
  bool ok = _fb_write_record_at(slot, rec);
  if (ok) {
    _fb_write_idx++;
    _fb_persist_write_idx();
  }

  xSemaphoreGive(_fb_mutex);
  return ok;
}

// True only when there's backlog AND no batch is currently peeked-but-unconfirmed.
bool fb_has_backlog() {
  if (!_fb_ready) return false;
  bool has = false;
  if (xSemaphoreTake(_fb_mutex, pdMS_TO_TICKS(1000)) == pdTRUE) {
    has = (_fb_outstanding_count == 0) && (_fb_write_idx != _fb_confirmed_idx);
    xSemaphoreGive(_fb_mutex);
  }
  return has;
}

// Read up to max_count of the oldest unconfirmed records WITHOUT deleting or
// confirming them. Marks that many records "in flight" — a second call
// returns 0 until fb_confirm() or fb_release_peek() clears that mark, so at
// most one replay batch is ever outstanding at a time (never re-peek the
// same backlog into a duplicate second PublishItem while the first is still
// waiting on its publish result).
uint8_t fb_peek_batch(FlashRecord *out, uint8_t max_count) {
  if (!_fb_ready) return 0;
  uint8_t n = 0;
  if (xSemaphoreTake(_fb_mutex, pdMS_TO_TICKS(2000)) == pdTRUE) {
    if (_fb_outstanding_count == 0) {
      uint32_t backlog = _fb_write_idx - _fb_confirmed_idx;
      uint8_t want = (backlog < max_count) ? (uint8_t)backlog : max_count;
      for (uint8_t i = 0; i < want; i++) {
        uint32_t slot = (_fb_confirmed_idx + i) % FLASH_BUFFER_CAPACITY;
        if (!_fb_read_record_at(slot, out[i])) break;
        n++;
      }
      if (n > 0) _fb_outstanding_count = n;
    }
    xSemaphoreGive(_fb_mutex);
  }
  return n;
}

// Call ONLY after the publish that carried a peeked batch actually succeeded.
// Advances confirmed_idx past those records (they're now safely delivered)
// and clears the in-flight mark.
void fb_confirm(uint8_t count) {
  if (!_fb_ready || count == 0) return;
  if (xSemaphoreTake(_fb_mutex, pdMS_TO_TICKS(2000)) == pdTRUE) {
    _fb_confirmed_idx += count;
    _fb_outstanding_count = 0;
    _fb_persist_confirmed_idx();
    uint32_t backlog = _fb_write_idx - _fb_confirmed_idx;
    xSemaphoreGive(_fb_mutex);
    LOG_INFO("FB", "Confirmed %u record(s) sent — backlog now %lu", count, (unsigned long)backlog);
  }
}

// Call if a peeked batch was never actually handed off for sending (e.g. the
// queue turned out full after all) — releases the in-flight mark WITHOUT
// advancing confirmed_idx, so the next cycle re-peeks the same records
// instead of them being stuck "in flight" forever.
void fb_release_peek() {
  if (!_fb_ready) return;
  if (xSemaphoreTake(_fb_mutex, pdMS_TO_TICKS(1000)) == pdTRUE) {
    _fb_outstanding_count = 0;
    xSemaphoreGive(_fb_mutex);
  }
}
