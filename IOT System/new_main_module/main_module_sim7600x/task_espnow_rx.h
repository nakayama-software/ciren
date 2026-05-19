#pragma once
#include <esp_now.h>
#include "ciren_config.h"
#include "ring_buffer.h"
#include "system_state.h"

typedef struct {
  uint8_t type;
  uint8_t channel;
} __attribute__((packed)) HelloAck;

// ── Deferred log dari callback ke task ──────────────────────────────────────
// espnow_recv_cb() berjalan di WiFi task stack (Core 0, ~3584B fixed).
// Serial.printf di dalam callback menghabiskan ~256B per call.
// Solusi: simpan data log di struct kecil, cetak dari task_espnow_rx.

typedef struct {
  enum { LOG_NONE, LOG_HELLO_ACK, LOG_RX, LOG_RX_SKIP, LOG_PEER_FAIL,
         LOG_CONFIG_ACK, LOG_CTRL_HELLO } type;
  uint8_t ctrl_id;
  uint8_t ch;
  uint8_t peers;
  uint8_t port_num;
  uint8_t stype;
  float   value;
  uint8_t ftype;
} EspNowLog;

static QueueHandle_t espnow_log_queue = NULL;

// ── Active controller tracking ───────────────────────────────────────────────
// Tracks last millis() when each ctrl_id sent any packet.
// Updated from callback (safe: uint32 writes are atomic on Xtensa).
// Read from task on same core — no true parallelism, preemption-safe.
static uint8_t  _ctrl_ids[MAX_CTRL_IDS];
static uint32_t _ctrl_seen_ms[MAX_CTRL_IDS];
static uint8_t  _ctrl_id_count = 0;

// ── Auto-config for IMU throttle in SIM mode ──────────────────────────────────
// IMU sensors (0x03-0x08, 0x10-0x12) send data at 10Hz by default.
// Over SIM/LTE this overwhelms the publish queue. When in SIM mode,
// auto-configure IMU ports to forward at a slower rate.
#define IMU_THROTTLE_MS  2000   // IMU interval in SIM mode (2 sec = 0.5 Hz)
#define MAX_AUTO_CFG     16
static uint8_t  _auto_cfg_ctrl[MAX_AUTO_CFG];
static uint8_t  _auto_cfg_port[MAX_AUTO_CFG];
static uint8_t  _auto_cfg_count = 0;

static bool _is_imu_stype(uint8_t stype) {
  return (stype >= 0x03 && stype <= 0x08) || (stype >= 0x10 && stype <= 0x12);
}

static bool _auto_cfg_exists(uint8_t ctrl_id, uint8_t port_num) {
  for (uint8_t i = 0; i < _auto_cfg_count; i++) {
    if (_auto_cfg_ctrl[i] == ctrl_id && _auto_cfg_port[i] == port_num)
      return true;
  }
  return false;
}

static void _ctrl_touch(uint8_t ctrl_id) {
  uint32_t now_ms = (uint32_t)millis();
  for (uint8_t i = 0; i < _ctrl_id_count; i++) {
    if (_ctrl_ids[i] == ctrl_id) {
      _ctrl_seen_ms[i] = now_ms;   // atomic uint32 write
      return;
    }
  }
  if (_ctrl_id_count < MAX_CTRL_IDS) {
    _ctrl_ids[_ctrl_id_count]     = ctrl_id;  // write entry before incrementing count
    _ctrl_seen_ms[_ctrl_id_count] = now_ms;
    _ctrl_id_count++;
  }
}

static uint16_t _ctrl_count_active() {
  uint32_t now_ms = (uint32_t)millis();
  uint16_t n = 0;
  for (uint8_t i = 0; i < _ctrl_id_count; i++) {
    if ((now_ms - _ctrl_seen_ms[i]) < (uint32_t)CTRL_TIMEOUT_MS) n++;
  }
  return n;
}

// ── Deferred HELLO_ACK ───────────────────────────────────────────────────────
// esp_now_send() di dalam callback memakan ~512B stack WiFi task.
// Defer ke task_espnow_rx menggunakan queue kecil.
typedef struct {
  uint8_t mac[6];
  uint8_t ch;
} PendingAck;

static QueueHandle_t espnow_ack_queue = NULL;

// ─────────────────────────────────────────────────────────────────────────────
// CALLBACK — berjalan di WiFi task stack (Core 0, ~3584B).
// ATURAN KETAT:
//   - TIDAK BOLEH Serial.printf / Serial.print
//   - TIDAK BOLEH esp_now_send() — defer via queue
//   - BOLEH: rb_write, xQueueSendFromISR, esp_now_mod_peer, xSemaphoreTake singkat
// ─────────────────────────────────────────────────────────────────────────────
#if defined(ESP_ARDUINO_VERSION_MAJOR) && (ESP_ARDUINO_VERSION_MAJOR >= 3)
static void IRAM_ATTR espnow_recv_cb(const esp_now_recv_info_t* recv_info,
                                     const uint8_t* data, int len) {
  const uint8_t* mac = recv_info->src_addr;
#else
static void IRAM_ATTR espnow_recv_cb(const uint8_t* mac,
                                     const uint8_t* data, int len) {
#endif
  if (len != sizeof(SensorPacket)) return;

  SensorPacket pkt;
  memcpy(&pkt, data, sizeof(pkt));

  // Catat waktu terakhir paket diterima dari ctrl_id ini (semua jenis paket)
  _ctrl_touch(pkt.ctrl_id);

  // ── Determine current ESP-NOW channel ─────────────────────────────────────
  // ch==0 means WiFi is unassociated (SIM-only mode, scanning, or early boot).
  // Use the fixed ESP-NOW channel so we can still send/receive data.
  uint8_t ch = (uint8_t)WiFi.channel();
  if (ch == 0) ch = ESPNOW_FIXED_CHANNEL;

  // ── Register/update peer for ANY incoming packet ────────────────────────
  // Without this, config packets can't be sent back if no HELLO was received
  // since boot (e.g. after main module reboot while sensor controller was
  // already running and sending only data/heartbeat frames).
  {
    if (!esp_now_is_peer_exist(mac)) {
      esp_now_peer_info_t peer = {};
      memcpy(peer.peer_addr, mac, 6);
      peer.channel = ch;
      peer.encrypt = false;
      esp_now_add_peer(&peer);   // best-effort — don't block on failure
    } else {
      esp_now_peer_info_t peer = {};
      memcpy(peer.peer_addr, mac, 6);
      peer.channel = ch;
      peer.encrypt = false;
      esp_now_mod_peer(&peer);
    }
  }

  // ── HELLO ──────────────────────────────────────────────────────────────────
  if (pkt.ftype == FTYPE_HELLO) {

    // Defer esp_now_send (HELLO_ACK) ke task — tidak boleh di callback
    if (espnow_ack_queue) {
      PendingAck ack = {};
      memcpy(ack.mac, mac, 6);
      ack.ch = ch;
      xQueueSendFromISR(espnow_ack_queue, &ack, NULL);
    }

    // Defer log ke task
    if (espnow_log_queue) {
      EspNowLog log = {};
      log.type    = EspNowLog::LOG_HELLO_ACK;
      log.ctrl_id = pkt.ctrl_id;
      log.ch      = ch;
      log.peers   = 0;  // peer_count sekarang diupdate dari _ctrl_count_active()
      xQueueSendFromISR(espnow_log_queue, &log, NULL);
    }

    // Controller HELLO (port_num==0): trigger resync all stored configs for this ctrl
    if (pkt.port_num == 0 && espnow_log_queue) {
      EspNowLog log = {};
      log.type    = EspNowLog::LOG_CTRL_HELLO;
      log.ctrl_id = pkt.ctrl_id;
      xQueueSendFromISR(espnow_log_queue, &log, NULL);
    }

    // Hanya NODE HELLO (port_num > 0) yang dipublish ke MQTT untuk update registrasi
    // CONTROLLER HELLO (port_num=0) hanya untuk channel sync — jangan kirim ke server
    if (pkt.port_num > 0) rb_write(&pkt);
    return;
  }

  // ── CONFIG_ACK ─────────────────────────────────────────────────────────────
  if (pkt.ftype == FTYPE_CONFIG_ACK) {
    if (espnow_log_queue) {
      EspNowLog log = {};
      log.type     = EspNowLog::LOG_CONFIG_ACK;
      log.ctrl_id  = pkt.ctrl_id;
      log.port_num = pkt.port_num;
      xQueueSendFromISR(espnow_log_queue, &log, NULL);
    }
    return;  // do not pass to ring buffer
  }

  // ── ERROR ──────────────────────────────────────────────────────────────────
  if (pkt.ftype == FTYPE_ERROR) {
    // Increment tanpa semaphore — satu writer (callback), satu reader (watchdog)
    // uint16 increment tidak atomic tapi race di sini hanya menyebabkan +1 hilang, bukan crash
    sys_state.err_counter++;
    return;
  }

  // ── Data / heartbeat ───────────────────────────────────────────────────────
  rb_write(&pkt);

  // Defer log ke task
  if (espnow_log_queue) {
    EspNowLog log = {};
    log.type     = EspNowLog::LOG_RX;
    log.ctrl_id  = pkt.ctrl_id;
    log.port_num = pkt.port_num;
    log.stype    = pkt.sensor_type;
    log.value    = pkt.value;
    log.ftype    = pkt.ftype;
    xQueueSendFromISR(espnow_log_queue, &log, NULL);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TASK — berjalan di stack task_espnow_rx (Core 0, STACK_RX bytes).
// Semua Serial.printf dan esp_now_send dilakukan di sini, bukan di callback.
// ─────────────────────────────────────────────────────────────────────────────
void task_espnow_rx(void* param) {
  espnow_log_queue = xQueueCreate(16, sizeof(EspNowLog));
  espnow_ack_queue = xQueueCreate(4,  sizeof(PendingAck));

  HelloAck ack_pkt;
  ack_pkt.type = 0xAC;

  uint32_t last_peer_check_ms = 0;

  for (;;) {
    // ── Kirim HELLO_ACK yang pending ─────────────────────────────────────────
    PendingAck pending;
    while (xQueueReceive(espnow_ack_queue, &pending, 0) == pdTRUE) {
      ack_pkt.channel = pending.ch;
      esp_now_send(pending.mac, (uint8_t*)&ack_pkt, sizeof(ack_pkt));
    }

    // ── Cetak log yang pending ───────────────────────────────────────────────
    EspNowLog log;
    while (xQueueReceive(espnow_log_queue, &log, 0) == pdTRUE) {
      switch (log.type) {
        case EspNowLog::LOG_HELLO_ACK:
          Serial.printf("[HELLO_ACK] ctrl_id=%d ch=%d\n", log.ctrl_id, log.ch);
          break;
        case EspNowLog::LOG_RX:
          Serial.printf("[RX] ctrl=%d port=%d stype=0x%02X val=%.4f ftype=0x%02X\n",
                        log.ctrl_id, log.port_num, log.stype, log.value, log.ftype);
          // ── Auto-throttle IMU in SIM mode ──────────────────────────────────
          // IMU at 10Hz overwhelms LTE. Send config to slow down forwarding.
          if (strcmp(sys_state.conn_mode, "sim") == 0 &&
              _is_imu_stype(log.stype) &&
              !_auto_cfg_exists(log.ctrl_id, log.port_num)) {
            nc_set(log.ctrl_id, log.port_num, IMU_THROTTLE_MS);
            if (_auto_cfg_count < MAX_AUTO_CFG) {
              _auto_cfg_ctrl[_auto_cfg_count] = log.ctrl_id;
              _auto_cfg_port[_auto_cfg_count] = log.port_num;
              _auto_cfg_count++;
            }
            Serial.printf("[ESPNOW] Auto-throttle IMU ctrl=%d port=%d → %d ms\n",
                          log.ctrl_id, log.port_num, IMU_THROTTLE_MS);
          }
          break;
        case EspNowLog::LOG_RX_SKIP:
          Serial.printf("[HELLO_ACK] skip — WiFi ch=0 (ctrl_id=%d)\n", log.ctrl_id);
          break;
        case EspNowLog::LOG_PEER_FAIL:
          Serial.println("[ESPNOW] add_peer failed");
          break;
        case EspNowLog::LOG_CONFIG_ACK:
          nc_on_ack(log.ctrl_id, log.port_num);
          break;
        case EspNowLog::LOG_CTRL_HELLO:
          nc_resync_ctrl(log.ctrl_id);
          break;
        default: break;
      }
    }

    // ── Update peer_count setiap 2s berdasarkan timeout ─────────────────────
    // Lebih akurat dari esp_now_get_peer_num() yang tidak berkurang saat peer mati
    uint32_t now_ms = (uint32_t)millis();
    if (now_ms - last_peer_check_ms >= 2000) {
      last_peer_check_ms = now_ms;
      uint16_t active = _ctrl_count_active();
      if (sys_state.peer_count != active) {
        sys_state.peer_count = active;
        Serial.printf("[ESPNOW] Active controllers: %d\n", active);
      }
    }

    // Cukup poll setiap 10ms — lebih dari cukup untuk 200ms data interval
    vTaskDelay(pdMS_TO_TICKS(10));
  }
}