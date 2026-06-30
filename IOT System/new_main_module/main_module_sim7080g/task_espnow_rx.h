#pragma once
#include <esp_now.h>
#include <esp_task_wdt.h>
#include "ciren_config.h"
#include "ring_buffer.h"
#include "system_state.h"
#include "task_logger.h"

typedef struct
{
  uint8_t type;
  uint8_t channel;
} __attribute__((packed)) HelloAck;

typedef struct
{
  enum
  {
    LOG_NONE,
    LOG_HELLO_ACK,
    LOG_RX,
    LOG_RX_SKIP,
    LOG_PEER_FAIL,
    LOG_CONFIG_ACK,
    LOG_CTRL_HELLO
  } type;
  uint8_t ctrl_id;
  uint8_t ch;
  uint8_t peers;
  uint8_t port_num;
  uint8_t stype;
  float value;
  uint8_t ftype;
} EspNowLog;

static QueueHandle_t espnow_log_queue = NULL;

// ── Per-controller info registry (written from ISR, read from task context) ──────
CtrlInfo _ctrl_info[MAX_CTRL_IDS];
volatile uint8_t _ctrl_info_count = 0;

// Update liveness only (for HELLO with port_num==0, ERROR, etc.)
static void _ctrl_touch_liveness(uint8_t ctrl_id)
{
  uint32_t now_ms = (uint32_t)millis();
  for (uint8_t i = 0; i < _ctrl_info_count; i++)
  {
    if (_ctrl_info[i].ctrl_id == ctrl_id)
    {
      _ctrl_info[i].last_seen_ms = now_ms;
      return;
    }
  }
  if (_ctrl_info_count < MAX_CTRL_IDS)
  {
    _ctrl_info[_ctrl_info_count].ctrl_id = ctrl_id;
    _ctrl_info[_ctrl_info_count].last_seen_ms = now_ms;
    _ctrl_info[_ctrl_info_count].port_count = 0;
    memset(_ctrl_info[_ctrl_info_count].ports, 0,
           sizeof(_ctrl_info[_ctrl_info_count].ports));
    _ctrl_info_count++;  // write all fields before incrementing
    LOG_INFO("ESPNOW", "New controller ctrl=%d", ctrl_id);
  }
}

// Update liveness AND register port/sensor_type info (for DATA_TYPED, HB_TYPED, etc.)
static void _ctrl_touch_ex(uint8_t ctrl_id, uint8_t port_num, uint8_t sensor_type)
{
  uint32_t now_ms = (uint32_t)millis();

  // Find or create controller entry
  uint8_t ci = 0;
  for (; ci < _ctrl_info_count; ci++)
  {
    if (_ctrl_info[ci].ctrl_id == ctrl_id)
      break;
  }
  if (ci == _ctrl_info_count)
  {
    if (_ctrl_info_count >= MAX_CTRL_IDS)
      return;  // table full
    _ctrl_info[ci].ctrl_id = ctrl_id;
    _ctrl_info[ci].last_seen_ms = now_ms;
    _ctrl_info[ci].port_count = 0;
    memset(_ctrl_info[ci].ports, 0, sizeof(_ctrl_info[ci].ports));
    _ctrl_info_count++;
    LOG_INFO("ESPNOW", "New controller ctrl=%d", ctrl_id);
  }
  else
  {
    _ctrl_info[ci].last_seen_ms = now_ms;
  }

  // Find or create port entry
  CtrlInfo *ctrl = &_ctrl_info[ci];
  uint8_t pi = 0;
  for (; pi < ctrl->port_count; pi++)
  {
    if (ctrl->ports[pi].port_num == port_num)
      break;
  }
  if (pi == ctrl->port_count)
  {
    if (ctrl->port_count >= MAX_PORTS_PER_CTRL)
      return;  // ports full
    ctrl->ports[pi].port_num = port_num;
    ctrl->ports[pi].stype_count = 0;
    memset(ctrl->ports[pi].stypes, 0, sizeof(ctrl->ports[pi].stypes));
    ctrl->port_count++;
  }

  // Add sensor_type if not already present
  CtrlPortInfo *port = &ctrl->ports[pi];
  for (uint8_t si = 0; si < port->stype_count; si++)
  {
    if (port->stypes[si] == sensor_type)
      return;  // already tracked
  }
  if (port->stype_count < MAX_STYPES_PER_PORT)
  {
    port->stypes[port->stype_count++] = sensor_type;
  }
}

static uint16_t _ctrl_count_active()
{
  uint32_t now_ms = (uint32_t)millis();
  uint16_t n = 0;
  for (uint8_t i = 0; i < _ctrl_info_count; i++)
  {
    if ((now_ms - _ctrl_info[i].last_seen_ms) < (uint32_t)CTRL_TIMEOUT_MS)
      n++;
  }
  return n;
}

typedef struct
{
  uint8_t mac[6];
  uint8_t ch;
} PendingAck;

static QueueHandle_t espnow_ack_queue = NULL;

#if defined(ESP_ARDUINO_VERSION_MAJOR) && (ESP_ARDUINO_VERSION_MAJOR >= 3)
static void IRAM_ATTR espnow_recv_cb(const esp_now_recv_info_t *recv_info,
                                     const uint8_t *data, int len)
{
  const uint8_t *mac = recv_info->src_addr;
#else
static void IRAM_ATTR espnow_recv_cb(const uint8_t *mac,
                                     const uint8_t *data, int len)
{
#endif
  if (len != sizeof(SensorPacket))
  {
    LOG_WARN("ESPNOW", "Malformed packet len=%d expected=%d", len, sizeof(SensorPacket));
    return;
  }

  SensorPacket pkt;
  memcpy(&pkt, data, sizeof(pkt));

  // Register controller/port/stype info and update liveness
  if (pkt.port_num > 0 && pkt.sensor_type > 0)
    _ctrl_touch_ex(pkt.ctrl_id, pkt.port_num, pkt.sensor_type);
  else
    _ctrl_touch_liveness(pkt.ctrl_id);

  uint8_t ch = (uint8_t)WiFi.channel();
  if (ch == 0)
    ch = ESPNOW_FIXED_CHANNEL;

  {
    if (!esp_now_is_peer_exist(mac))
    {
      esp_now_peer_info_t peer = {};
      memcpy(peer.peer_addr, mac, 6);
      peer.channel = ch;
      peer.encrypt = false;
      esp_now_add_peer(&peer);
    }
    else
    {
      esp_now_peer_info_t peer = {};
      memcpy(peer.peer_addr, mac, 6);
      peer.channel = ch;
      peer.encrypt = false;
      esp_now_mod_peer(&peer);
    }
  }

  // ── HELLO ──────────────────────────────────────────────────────────────────
  if (pkt.ftype == FTYPE_HELLO)
  {

    if (espnow_ack_queue)
    {
      PendingAck ack = {};
      memcpy(ack.mac, mac, 6);
      ack.ch = ch;
      xQueueSendFromISR(espnow_ack_queue, &ack, NULL);
    }

    // Defer log ke task
    if (espnow_log_queue)
    {
      EspNowLog log = {};
      log.type = EspNowLog::LOG_HELLO_ACK;
      log.ctrl_id = pkt.ctrl_id;
      log.ch = ch;
      log.peers = 0; // peer_count sekarang diupdate dari _ctrl_count_active()
      xQueueSendFromISR(espnow_log_queue, &log, NULL);
    }

    if (pkt.port_num == 0 && espnow_log_queue)
    {
      EspNowLog log = {};
      log.type = EspNowLog::LOG_CTRL_HELLO;
      log.ctrl_id = pkt.ctrl_id;
      xQueueSendFromISR(espnow_log_queue, &log, NULL);
    }
    if (pkt.port_num > 0)
      rb_write(&pkt);
    return;
  }

  // ── CONFIG_ACK ─────────────────────────────────────────────────────────────
  if (pkt.ftype == FTYPE_CONFIG_ACK)
  {
    if (espnow_log_queue)
    {
      EspNowLog log = {};
      log.type = EspNowLog::LOG_CONFIG_ACK;
      log.ctrl_id = pkt.ctrl_id;
      log.port_num = pkt.port_num;
      xQueueSendFromISR(espnow_log_queue, &log, NULL);
    }
    return; // do not pass to ring buffer
  }

  // ── ERROR ──────────────────────────────────────────────────────────────────
  if (pkt.ftype == FTYPE_ERROR)
  {
    // Increment tanpa semaphore — satu writer (callback), satu reader (watchdog)
    // uint16 increment tidak atomic tapi race di sini hanya menyebabkan +1 hilang, bukan crash
    sys_state.err_counter++;
    return;
  }

  // ── Data / heartbeat ───────────────────────────────────────────────────────
  rb_write(&pkt);

  // Defer log ke task
  if (espnow_log_queue)
  {
    EspNowLog log = {};
    log.type = EspNowLog::LOG_RX;
    log.ctrl_id = pkt.ctrl_id;
    log.port_num = pkt.port_num;
    log.stype = pkt.sensor_type;
    log.value = pkt.value;
    log.ftype = pkt.ftype;
    xQueueSendFromISR(espnow_log_queue, &log, NULL);
  }
}

// ────────────────────────────────────────────────────────────────────────────
void task_espnow_rx(void *param)
{
  esp_task_wdt_add(NULL);   // subscribe to Task Watchdog
  espnow_log_queue = xQueueCreate(16, sizeof(EspNowLog));
  espnow_ack_queue = xQueueCreate(4, sizeof(PendingAck));

  HelloAck ack_pkt;
  ack_pkt.type = 0xAC;

  uint32_t last_peer_check_ms = 0;

  for (;;)
  {
    PendingAck pending;
    while (xQueueReceive(espnow_ack_queue, &pending, 0) == pdTRUE)
    {
      ack_pkt.channel = pending.ch;
      esp_now_send(pending.mac, (uint8_t *)&ack_pkt, sizeof(ack_pkt));
    }

    EspNowLog log;
    while (xQueueReceive(espnow_log_queue, &log, 0) == pdTRUE)
    {
      switch (log.type)
      {
      case EspNowLog::LOG_HELLO_ACK:
        Serial.printf("[HELLO_ACK] ctrl_id=%d ch=%d\n", log.ctrl_id, log.ch);
        LOG_INFO("ESPNOW", "HELLO from ctrl=%d ch=%d", log.ctrl_id, log.ch);
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
      case EspNowLog::LOG_CONFIG_ACK:
        LOG_INFO("ESPNOW", "CONFIG_ACK ctrl=%d port=%d", log.ctrl_id, log.port_num);
        nc_on_ack(log.ctrl_id, log.port_num);
        break;
      case EspNowLog::LOG_CTRL_HELLO:
        nc_resync_ctrl(log.ctrl_id);
        break;
      default:
        break;
      }
    }

    uint32_t now_ms = (uint32_t)millis();
    if (now_ms - last_peer_check_ms >= 2000)
    {
      last_peer_check_ms = now_ms;
      uint16_t active = _ctrl_count_active();
      if (sys_state.peer_count != active)
      {
        sys_state.peer_count = active;
        Serial.printf("[ESPNOW] Active controllers: %d\n", active);
        LOG_INFO("ESPNOW", "Active controllers: %d", active);
      }
    }

    vTaskDelay(pdMS_TO_TICKS(10));
    esp_task_wdt_reset();   // feed watchdog every 10ms loop
  }
}