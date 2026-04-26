const mqtt   = require('mqtt')
const SensorReading          = require('../models/SensorReading')
const { SensorNode, Device } = require('../models/Device')
const NodeConfig             = require('../models/NodeConfig')
const { broadcast }          = require('../websocket/ws')
const { FTYPE }              = require('../utils/constants')

// ─── MQTT Topics ──────────────────────────────────
// Main module publish ke:
//   ciren/data/{device_id}     — data sensor (satu frame per message)
//   ciren/status/{device_id}   — heartbeat device (GPS, batt, signal)
//   ciren/hello/{device_id}    — saat pertama konek / setelah reboot
//
// Backend publish ke main module:
//   ciren/config/{device_id}   — remote config (mode, reboot, dll)

const TOPICS = [
  'ciren/data/+',
  'ciren/status/+',
  'ciren/hello/+',
]

let client = null
let _hbInterval = null

// ─── HumTemp timestamp alignment cache ──────────────
// When temp (0x01) or humidity (0x02) arrives as a single-object MQTT message
// (not part of a batch array), the existing alignment code doesn't apply.
// This cache tracks the shared timestamp so that a companion reading arriving
// within a few seconds reuses it, keeping HumTemp pairs in sync.
const _humTempTs = {}   // key: `${ctrlId}_${portNum}` → { sharedTs, updatedAt }

function _humTempSharedTs(ctrlId, portNum) {
  const key = `${ctrlId}_${portNum}`
  const now = Date.now()
  const cached = _humTempTs[key]
  if (cached && (now - cached.updatedAt) < 5000) {
    // Companion was received recently — reuse its shared timestamp
    cached.updatedAt = now
    return cached.sharedTs
  }
  // First of the pair or cache expired — create new shared timestamp
  _humTempTs[key] = { sharedTs: now, updatedAt: now }
  return now
}

// Clean stale HumTemp cache entries every 60s
setInterval(() => {
  const now = Date.now()
  for (const [k, v] of Object.entries(_humTempTs)) {
    if (now - v.updatedAt > 30000) delete _humTempTs[k]
  }
}, 60000)

// Debounce tracker for config resend on sensor HELLO
const _resendDebounce = {}

// ─── Dedup cache ───────────────────────────────────────
// Prevents storing duplicate SensorReading documents when the same reading
// arrives multiple times (e.g. re-published after SIM reconnect, or HumTemp
// batch sent as individual messages with the same server_ts).
// Key: `${deviceId}_${ctrlId}_${portNum}_${sensorType}_${tsBucket}`
// tsBucket = Math.floor(server_ts / 1000) — groups readings within the same second
const _dedupCache = {}

function _isDuplicate(deviceId, ctrlId, portNum, sensorType, serverTs) {
  const tsBucket = Math.floor(serverTs / 1000)
  const key = `${deviceId}_${ctrlId}_${portNum}_${sensorType}_${tsBucket}`
  const now = Date.now()
  const cached = _dedupCache[key]
  if (cached && (now - cached) < 5000) {
    return true  // duplicate within 5s window
  }
  _dedupCache[key] = now
  return false
}

// Clean stale dedup entries every 60s
setInterval(() => {
  const now = Date.now()
  for (const [k, v] of Object.entries(_dedupCache)) {
    if (now - v > 10000) delete _dedupCache[k]
  }
}, 60000)

// ─── Diagnostic counter ───────────────────────────
const _rxCount = {}
let   _rxLogTimer = null
function _trackRx(key) {
  _rxCount[key] = (_rxCount[key] || 0) + 1
  if (!_rxLogTimer) {
    _rxLogTimer = setInterval(() => {
      const entries = Object.entries(_rxCount)
      if (entries.length === 0) return
      const summary = entries.map(([k, v]) => `${k}:${v}`).join(' | ')
      console.log(`[RX/5s] ${summary}`)
      Object.keys(_rxCount).forEach(k => { _rxCount[k] = 0 })
    }, 5000)
  }
}

// ─── Rate limiter per device ──────────────────────
// Batasi max MAX_MSG_PER_SEC pesan DATA per device per detik
// Mencegah sensor hang/loop dari spam overwhelm server
const MAX_MSG_PER_SEC  = 500  // max 500 DATA frame per detik per device (IMU realtime)
const _rateWindow      = {}   // { deviceId: { count, windowStart } }

function _isRateLimited(deviceId) {
  const now  = Date.now()
  const win  = _rateWindow[deviceId]
  if (!win || now - win.windowStart >= 1000) {
    _rateWindow[deviceId] = { count: 1, windowStart: now }
    return false
  }
  win.count++
  if (win.count > MAX_MSG_PER_SEC) {
    if (win.count === MAX_MSG_PER_SEC + 1)  // log hanya sekali per window
      console.warn(`[RATE] Device ${deviceId} exceeded ${MAX_MSG_PER_SEC} msg/s — throttling`)
    return true
  }
  return false
}

function initMQTT() {
  const host = process.env.MQTT_HOST || 'localhost'
  const port = process.env.MQTT_PORT || 1883
  const clientId = process.env.MQTT_CLIENT_ID || 'ciren-backend'

  client = mqtt.connect(`mqtt://${host}:${port}`, {
    clientId,
    clean: true,
    reconnectPeriod: 3000,
    connectTimeout: 5000,
  })

  client.on('connect', () => {
    console.log(`[MQTT] Connected to ${host}:${port}`)
    TOPICS.forEach(t => {
      client.subscribe(t, err => {
        if (err) console.error(`[MQTT] Subscribe failed: ${t}`, err)
        else     console.log(`[MQTT] Subscribed: ${t}`)
      })
    })

    // Publish server heartbeat immediately, then every 30s
    // Firmware pakai ini untuk menentukan apakah server (bukan hanya broker) aktif
    const publishHB = () => {
      if (client.connected) client.publish('ciren/server/heartbeat', '1')
    }
    publishHB()
    if (_hbInterval) clearInterval(_hbInterval)
    _hbInterval = setInterval(publishHB, 30000)
  })

  client.on('error',       err  => console.error('[MQTT] Error:', err.message))
  client.on('reconnect',   ()   => console.log('[MQTT] Reconnecting...'))
  client.on('disconnect',  ()   => {
    console.log('[MQTT] Disconnected')
    if (_hbInterval) { clearInterval(_hbInterval); _hbInterval = null }
  })

  client.on('message', (topic, message) => {
    handleMessage(topic, message).catch(err =>
      console.error('[MQTT] Handle error:', err.message)
    )
  })

  return client
}

// ─── Message handler ──────────────────────────────
async function handleMessage(topic, message) {
  let payload
  try {
    payload = JSON.parse(message.toString())
  } catch {
    console.warn('[MQTT] Invalid JSON:', message.toString().slice(0, 100))
    return
  }

  const parts     = topic.split('/')  // ['ciren', 'data', 'MM-001']
  const topicType = parts[1]          // 'data' | 'status' | 'hello'
  const deviceId  = parts[2]

  if (!deviceId) return

  // Support batch: payload can be an array of readings
  if (topicType === 'data') {
    if (Array.isArray(payload)) {
      // Align timestamps for HumTemp pairs (0x01+0x02 on same ctrl+port) within the batch
      // so both readings share the same server_ts and broadcast ts
      const humTempGroups = {}
      for (const item of payload) {
        if ((item.sensor_type === 0x01 || item.sensor_type === 0x02) && item.ctrl_id && item.port_num) {
          const key = `${item.ctrl_id}_${item.port_num}`
          if (!humTempGroups[key]) humTempGroups[key] = []
          humTempGroups[key].push(item)
        }
      }
      // For groups that have both 0x01 and 0x02, assign a shared timestamp
      const sharedTs = {}
      for (const [key, items] of Object.entries(humTempGroups)) {
        const has01 = items.some(i => i.sensor_type === 0x01)
        const has02 = items.some(i => i.sensor_type === 0x02)
        if (has01 && has02) {
          sharedTs[key] = Date.now()
        }
      }

      for (const item of payload) {
        // Inject shared timestamp for HumTemp pairs
        const htk = `${item.ctrl_id}_${item.port_num}`
        if (sharedTs[htk] && (item.sensor_type === 0x01 || item.sensor_type === 0x02)) {
          item._shared_ts = sharedTs[htk]
        }
        await handleSensorData(deviceId, item)
      }
    } else {
      // Single-object payload — align HumTemp timestamps using cache
      if ((payload.sensor_type === 0x01 || payload.sensor_type === 0x02) &&
          payload.ctrl_id != null && payload.port_num != null) {
        payload._shared_ts = _humTempSharedTs(payload.ctrl_id, payload.port_num)
      }
      return handleSensorData(deviceId, payload)
    }
    return
  }
  if (topicType === 'status') return handleDeviceStatus(deviceId, payload)
  if (topicType === 'hello')  return handleDeviceHello(deviceId, payload)
}

// ─── Sensor data dari main module ─────────────────
// Payload: { ctrl_id, port_num, sensor_type, value, timestamp_ms, ftype }
async function handleSensorData(deviceId, data) {
  const { ctrl_id, port_num, sensor_type, value, timestamp_ms, ftype, _shared_ts } = data
  _trackRx(`c${ctrl_id}p${port_num}s${sensor_type}`)

  // Rate limit — HELLO dan STALE dikecualikan (penting, frekuensi rendah)
  if (ftype !== 0x02 && ftype !== 0xFE && _isRateLimited(deviceId)) return

  // HELLO frame — update/buat sensor node registry
  // Key: (device_id, ctrl_id, port_num, sensor_type) — satu port bisa multi-type (DHT20 = 0x01+0x02)
  if (ftype === FTYPE.HELLO) {
    // Abaikan controller-level HELLO (port_num=0, sensor_type=0) — hanya untuk ESP-NOW channel sync
    if (!port_num || !sensor_type) return

    // Hapus record lama yang sama (device_id, ctrl_id, sensor_type) tapi port_num berbeda
    // Ini terjadi saat sensor dipindah port, atau node reboot dan mendapat port berbeda
    await SensorNode.deleteMany({
      device_id: deviceId,
      ctrl_id,
      sensor_type,
      port_num: { $ne: port_num },
    })

    // Hapus sensor types dari keluarga berbeda di port yang sama.
    // Mencegah "ghost node" — misalnya sisa entry IMU saat port sekarang dipakai HumTemp.
    // Keluarga: HumTemp (0x01,0x02), IMU (0x03-0x08, 0x10-0x12), Single (tipe lainnya).
    const IMU_STYPES = [0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x10, 0x11, 0x12]
    const HT_STYPES  = [0x01, 0x02]
    const st = Number(sensor_type)
    let incompatibleFilter = null
    if (HT_STYPES.includes(st)) {
      incompatibleFilter = { $nin: HT_STYPES }
    } else if (IMU_STYPES.includes(st)) {
      incompatibleFilter = { $nin: IMU_STYPES }
    } else {
      incompatibleFilter = { $ne: st }
    }
    const cleaned = await SensorNode.deleteMany({
      device_id: deviceId, ctrl_id, port_num,
      sensor_type: incompatibleFilter,
    })
    if (cleaned.deletedCount > 0) {
      console.log(`[HELLO] Removed ${cleaned.deletedCount} incompatible sensor type(s) on ${deviceId} ctrl=${ctrl_id} port=${port_num}`)
    }

    await SensorNode.findOneAndUpdate(
      { device_id: deviceId, ctrl_id, port_num, sensor_type },
      {
        status:    'online',
        last_seen: new Date(),
        $setOnInsert: { first_seen: new Date() }
      },
      { upsert: true, new: true }
    )
    // Broadcast ke dashboard
    broadcast('node_status', {
      device_id: deviceId, ctrl_id, port_num,
      sensor_type, status: 'online', event: 'hello'
    })

    // Resend stored node configs so sensor controller gets the latest
    // interval after reboot (debounced per device — at most once every 10s)
    const now = Date.now()
    if (!_resendDebounce[deviceId] || now - _resendDebounce[deviceId] > 10000) {
      _resendDebounce[deviceId] = now
      resendNodeConfigs(deviceId)
    }
    return
  }

  // STALE frame — tandai semua sensor_type di port ini sebagai stale
  if (ftype === FTYPE.STALE) {
    await SensorNode.updateMany(
      { device_id: deviceId, ctrl_id, port_num },
      { status: 'stale', last_seen: new Date() }
    )
    broadcast('node_status', {
      device_id: deviceId, ctrl_id, port_num, status: 'stale'
    })
    return
  }

  // Broadcast ke dashboard untuk semua tipe data + HB
  if (ftype === FTYPE.DATA || ftype === FTYPE.DATA_TYPED || ftype === FTYPE.HB_TYPED) {
    broadcast('sensor_data', {
      device_id: deviceId,
      ctrl_id, port_num, sensor_type,
      value, ftype,
      ts: _shared_ts || Date.now(),
    })
  }

  // HB_TYPED: hanya untuk indikator koneksi dashboard — tidak disimpan ke MongoDB
  // Menyimpan HB tiap 15 detik akan membanjiri database (120x lebih banyak dari data asli)
  if (ftype === FTYPE.HB_TYPED) {
    await SensorNode.findOneAndUpdate(
      { device_id: deviceId, ctrl_id, port_num, sensor_type },
      { status: 'online', last_seen: new Date(), $setOnInsert: { first_seen: new Date() } },
      { upsert: true }
    )
    return
  }

  // ERROR frame — simpan tapi tandai sebagai error
  // DATA / HEARTBEAT — simpan ke database
  if (ftype === FTYPE.ERROR || ftype === FTYPE.DATA ||
      ftype === FTYPE.DATA_TYPED || ftype === FTYPE.HEARTBEAT) {

    // IMU high-frequency types: skip MongoDB
    const IMU_TYPES = new Set([0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x10, 0x11, 0x12])
    if (IMU_TYPES.has(Number(sensor_type))) return

    console.log(`[DATA] ${deviceId} ctrl=${ctrl_id} port=${port_num} stype=${sensor_type} val=${value} ftype=0x${ftype?.toString(16)}`)

    // Simpan reading (skip jika duplikat dalam 5 detik terakhir)
    const serverTs = _shared_ts || Date.now()
    if (!_isDuplicate(deviceId, ctrl_id, port_num, sensor_type, serverTs)) {
      await SensorReading.create({
        device_id: deviceId,
        ctrl_id, port_num, sensor_type,
        value, ftype,
        device_ts: timestamp_ms,
        server_ts: new Date(serverTs),
      })
    }

    // Update last_seen node — upsert sebagai fallback jika HELLO belum diterima
    await SensorNode.findOneAndUpdate(
      { device_id: deviceId, ctrl_id, port_num, sensor_type },
      { status: 'online', last_seen: new Date(), $setOnInsert: { first_seen: new Date() } },
      { upsert: true }
    )

    // Update last_seen device
    await Device.findOneAndUpdate(
      { device_id: deviceId },
      { status: 'online', last_seen: new Date() },
      { upsert: true, setDefaultsOnInsert: true }
    )
  }
}

// ─── Status/heartbeat dari main module ────────────
// Payload: { device_id, conn_mode, gps_lat, gps_lon, gps_fix, rssi, batt_pct }
async function handleDeviceStatus(deviceId, data) {
  const update = {
    status:    'online',
    last_seen: new Date(),
    conn_mode: data.conn_mode,
    gps_lat:   data.gps_lat,
    gps_lon:   data.gps_lon,
    gps_fix:   data.gps_fix,
    rssi:      data.rssi,
    batt_pct:  data.batt_pct,
    fw_version: data.fw_version,
  }
  await Device.findOneAndUpdate(
    { device_id: deviceId },
    { $set: update },
    { upsert: true, setDefaultsOnInsert: true }
  )
  broadcast('device_status', { device_id: deviceId, ...update })
}

// ─── Hello dari main module (pertama konek) ───────
async function handleDeviceHello(deviceId, data) {
  await Device.findOneAndUpdate(
    { device_id: deviceId },
    {
      status:    'online',
      last_seen: new Date(),
      $setOnInsert: { first_seen: new Date() },
      conn_mode: data.conn_mode,
      fw_version: data.fw_version,
    },
    { upsert: true }
  )
  broadcast('device_status', {
    device_id: deviceId, status: 'online', event: 'hello'
  })
  console.log(`[MQTT] Device online: ${deviceId}`)

  // Re-send all stored node interval configs so firmware always has the latest values
  resendNodeConfigs(deviceId)
}

// ─── Kirim config command ke main module ──────────
// cmd: { action: 'set_mode'|'reboot', value: 'wifi'|'sim'|'auto' }
function sendConfig(deviceId, cmd) {
  if (!client) return false
  const topic = `ciren/config/${deviceId}`
  client.publish(topic, JSON.stringify(cmd))
  return true
}

// ─── Kirim node interval config ke main module ────
function sendNodeConfig(deviceId, ctrl_id, port_num, interval_ms) {
  if (!client) return false
  const topic   = `ciren/config/${deviceId}`
  const payload = JSON.stringify({ action: 'set_node_interval', ctrl_id, port_num, interval_ms })
  client.publish(topic, payload, { qos: 1 })
  console.log(`[MQTT] Sent config → ${topic}: ctrl=${ctrl_id} port=${port_num} interval=${interval_ms}ms`)
  return true
}

// ─── Re-kirim semua stored node configs untuk device (dipanggil saat device HELLO) ───
async function resendNodeConfigs(deviceId) {
  try {
    const configs = await NodeConfig.find({ device_id: deviceId }).lean()
    if (configs.length === 0) return
    for (const cfg of configs) {
      sendNodeConfig(deviceId, cfg.ctrl_id, cfg.port_num, cfg.interval_ms)
    }
    console.log(`[MQTT] Resent ${configs.length} node config(s) → ${deviceId}`)
  } catch (e) {
    console.error('[MQTT] resendNodeConfigs error:', e.message)
  }
}

module.exports = { initMQTT, sendConfig, sendNodeConfig }
