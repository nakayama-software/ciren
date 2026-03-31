#pragma once
#include <esp_now.h>
#include "ciren_config_014424.h"
#include "ring_buffer_014424.h"
#include "system_state_014424.h"

typedef struct {
  uint8_t type;
  uint8_t channel;
} __attribute__((packed)) HelloAck;

// ── Deferred log dari callback ke task ──────────────────────────────────────
// espnow_recv_cb() berjalan di WiFi task stack (Core 0, ~3584B fixed).
// Serial.printf di dalam callback menghabiskan ~256B per call.
// Solusi: simpan data log di struct kecil, cetak dari task_espnow_rx.

typedef struct {
  enum { LOG_NONE, LOG_HELLO_ACK, LOG_RX, LOG_RX_SKIP, LOG_PEER_FAIL } type;
  uint8_t ctrl_id;
  uint8_t ch;
  uint8_t peers;
  uint8_t port_num;
  uint8_t stype;
  float   value;
  uint8_t ftype;
} EspNowLog;

static QueueHandle_t espnow_log_queue = NULL;

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

  // ── HELLO ──────────────────────────────────────────────────────────────────
  if (pkt.ftype == FTYPE_HELLO) {
    uint8_t ch = (uint8_t)WiFi.channel();

    if (ch == 0) {
      // WiFi belum associate — log dan skip
      if (espnow_log_queue) {
        EspNowLog log = {};
        log.type    = EspNowLog::LOG_RX_SKIP;
        log.ctrl_id = pkt.ctrl_id;
        log.ch      = ch;
        xQueueSendFromISR(espnow_log_queue, &log, NULL);
      }
      return;
    }

    // Update peer channel (operasi kecil, aman di callback)
    if (!esp_now_is_peer_exist(mac)) {
      esp_now_peer_info_t peer = {};
      memcpy(peer.peer_addr, mac, 6);
      peer.channel = ch;
      peer.encrypt = false;
      if (esp_now_add_peer(&peer) != ESP_OK) {
        if (espnow_log_queue) {
          EspNowLog log = {};
          log.type = EspNowLog::LOG_PEER_FAIL;
          xQueueSendFromISR(espnow_log_queue, &log, NULL);
        }
        return;
      }
    } else {
      esp_now_peer_info_t peer = {};
      memcpy(peer.peer_addr, mac, 6);
      peer.channel = ch;
      peer.encrypt = false;
      esp_now_mod_peer(&peer);
    }

    // Update peer_count tanpa semaphore (atomic read/write uint16 di Xtensa = safe)
    esp_now_peer_num_t peer_num = {};
    esp_now_get_peer_num(&peer_num);
    sys_state.peer_count = peer_num.total_num;

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
      log.peers   = (uint8_t)peer_num.total_num;
      xQueueSendFromISR(espnow_log_queue, &log, NULL);
    }

    // Hanya NODE HELLO (port_num > 0) yang dipublish ke MQTT untuk update registrasi
    // CONTROLLER HELLO (port_num=0) hanya untuk channel sync — jangan kirim ke server
    if (pkt.port_num > 0) rb_write(&pkt);
    return;
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
          Serial.printf("[HELLO_ACK] ctrl_id=%d ch=%d peers=%d\n",
                        log.ctrl_id, log.ch, log.peers);
          break;
        case EspNowLog::LOG_RX:
          Serial.printf("[RX] ctrl=%d port=%d stype=0x%02X val=%.4f ftype=0x%02X\n",
                        log.ctrl_id, log.port_num, log.stype, log.value, log.ftype);
          break;
        case EspNowLog::LOG_RX_SKIP:
          Serial.printf("[HELLO_ACK] skip — WiFi ch=0 (ctrl_id=%d)\n", log.ctrl_id);
          break;
        case EspNowLog::LOG_PEER_FAIL:
          Serial.println("[ESPNOW] add_peer failed");
          break;
        default: break;
      }
    }

    // Cukup poll setiap 10ms — lebih dari cukup untuk 200ms data interval
    vTaskDelay(pdMS_TO_TICKS(10));
  }
}