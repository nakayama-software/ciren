const mqtt   = require('mqtt')
const SensorReading          = require('../models/SensorReading')
const { SensorNode, Device } = require('../models/Device')
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

// ─── Diagnostic counter ───────────────────────────
// Print ringkasan tiap 5 detik: berapa banyak pesan masuk per stype
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
  })

  client.on('error',       err  => console.error('[MQTT] Error:', err.message))
  client.on('reconnect',   ()   => console.log('[MQTT] Reconnecting...'))
  client.on('disconnect',  ()   => console.log('[MQTT] Disconnected'))

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

  if (topicType === 'data')   return handleSensorData(deviceId, payload)
  if (topicType === 'status') return handleDeviceStatus(deviceId, payload)
  if (topicType === 'hello')  return handleDeviceHello(deviceId, payload)
}

// ─── Sensor data dari main module ─────────────────
// Payload: { ctrl_id, port_num, sensor_type, value, timestamp_ms, ftype }
async function handleSensorData(deviceId, data) {
  const { ctrl_id, port_num, sensor_type, value, timestamp_ms, ftype } = data
  _trackRx(`c${ctrl_id}p${port_num}s${sensor_type}`)  // diagnostic counter

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

  // ERROR frame — simpan tapi tandai sebagai error
  // DATA / HEARTBEAT — simpan ke database
  if (ftype === FTYPE.ERROR || ftype === FTYPE.DATA ||
      ftype === FTYPE.DATA_TYPED || ftype === FTYPE.HEARTBEAT ||
      ftype === FTYPE.HB_TYPED) {

    // IMU high-frequency types: broadcast langsung, skip MongoDB
    const IMU_TYPES = new Set([0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x10, 0x11, 0x12])
    const isIMU = IMU_TYPES.has(Number(sensor_type))

    // Broadcast SEGERA ke dashboard — termasuk HB_TYPED agar heartbeat sensor (DHT20) juga update
    if (ftype === FTYPE.DATA || ftype === FTYPE.DATA_TYPED || ftype === FTYPE.HB_TYPED) {
      broadcast('sensor_data', {
        device_id: deviceId,
        ctrl_id, port_num, sensor_type,
        value, ftype,
        ts: Date.now(),
      })
    }

    if (isIMU) return  // IMU: tidak disimpan ke MongoDB

    console.log(`[DATA] ${deviceId} ctrl=${ctrl_id} port=${port_num} stype=${sensor_type} val=${value} ftype=0x${ftype?.toString(16)}`)

    // Simpan reading
    await SensorReading.create({
      device_id: deviceId,
      ctrl_id, port_num, sensor_type,
      value, ftype,
      device_ts: timestamp_ms,
      server_ts: new Date(),
    })

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
}

// ─── Kirim config command ke main module ──────────
// cmd: { action: 'set_mode'|'reboot', value: 'wifi'|'sim'|'auto' }
function sendConfig(deviceId, cmd) {
  if (!client) return false
  const topic = `ciren/config/${deviceId}`
  client.publish(topic, JSON.stringify(cmd))
  return true
}

module.exports = { initMQTT, sendConfig }
