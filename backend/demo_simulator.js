/**
 * CIREN Exhibition Demo Simulator
 *
 * Simulates sensor plug-in scenarios via MQTT.
 * The real dashboard reacts as if hardware is connected.
 *
 * Usage:
 *   node demo_simulator.js
 *   node demo_simulator.js MY-DEVICE-ID
 *
 * Prerequisites: backend + MQTT broker must be running.
 */

const mqtt = require('mqtt')

// ── Config ────────────────────────────────────────────────────────────────────
const DEVICE_ID = process.argv[2] || 'MM-001'   // ← ganti atau pass sebagai argumen
const BROKER    = 'mqtt://localhost:1883'
const CTRL_ID   = 1

// ── Constants ─────────────────────────────────────────────────────────────────
const FTYPE = { HELLO: 0x02, DATA: 0x04, HB: 0x05, STALE: 0xFE }
const STYPE = {
  TEMP:    0x01, HUM:     0x02,
  VOLTAGE: 0x0B,
  ACCEL_X: 0x03, ACCEL_Y: 0x04, ACCEL_Z: 0x05,
  GYRO_X:  0x06, GYRO_Y:  0x07, GYRO_Z:  0x08,
  PITCH:   0x10, ROLL:    0x11, YAW:     0x12,
}
const IMU_STYPES = [0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x10, 0x11, 0x12]

// ── Helpers ───────────────────────────────────────────────────────────────────
const wait  = ms => new Promise(r => setTimeout(r, ms))
const rnd   = (base, range) => parseFloat((base + (Math.random() - 0.5) * range * 2).toFixed(2))
const clamp = (v, min, max) => Math.min(Math.max(v, min), max)

function pub(client, stype, portNum, value, ftype) {
  const payload = {
    ctrl_id:      CTRL_ID,
    port_num:     portNum,
    sensor_type:  stype,
    value,
    timestamp_ms: Date.now(),
    ftype,
  }
  client.publish(`ciren/data/${DEVICE_ID}`, JSON.stringify(payload))
}

function hello(client, portNum, stype) {
  pub(client, stype, portNum, stype, FTYPE.HELLO)
}

function data(client, portNum, stype, value) {
  pub(client, stype, portNum, value, FTYPE.DATA)
}

function stale(client, portNum) {
  pub(client, 0, portNum, 0, FTYPE.STALE)
}

// ── Scenarios ─────────────────────────────────────────────────────────────────
async function runScenarios(client) {

  // ───────────────────────────────────────────────────────────────────────────
  // SCENARIO 1 — Sensor Controller ID 1 appears
  // ───────────────────────────────────────────────────────────────────────────
  log('SCENARIO 1 — Controller online')
  client.publish(`ciren/hello/${DEVICE_ID}`, JSON.stringify({
    conn_mode: 'wifi', fw_version: '1.0.0',
  }))
  await wait(4000)

  // ───────────────────────────────────────────────────────────────────────────
  // SCENARIO 2 — DHT20 (Temp + Humidity) on Port 1
  // ───────────────────────────────────────────────────────────────────────────
  log('SCENARIO 2 — DHT20 connecting to Port 1')
  hello(client, 1, STYPE.TEMP)
  await wait(80)
  hello(client, 1, STYPE.HUM)
  await wait(1500)

  log('  → streaming data...')
  let t1 = 27.5, h1 = 63.0
  for (let i = 0; i < 14; i++) {
    t1 = clamp(rnd(t1, 0.3), 20, 40)
    h1 = clamp(rnd(h1, 0.8), 30, 95)
    data(client, 1, STYPE.TEMP, t1)
    await wait(40)
    data(client, 1, STYPE.HUM,  h1)
    await wait(900)
  }
  await wait(2000)

  // ───────────────────────────────────────────────────────────────────────────
  // SCENARIO 3 — Voltage on Port 2
  // ───────────────────────────────────────────────────────────────────────────
  log('SCENARIO 3 — Voltage sensor connecting to Port 2')
  hello(client, 2, STYPE.VOLTAGE)
  await wait(1500)

  log('  → streaming data...')
  let volt = 12.40
  for (let i = 0; i < 14; i++) {
    volt = clamp(rnd(volt, 0.12), 11.0, 14.0)
    data(client, 2, STYPE.VOLTAGE, volt)
    await wait(900)
  }
  await wait(2000)

  // ───────────────────────────────────────────────────────────────────────────
  // SCENARIO 4 — Another DHT20 on Port 3
  // ───────────────────────────────────────────────────────────────────────────
  log('SCENARIO 4 — DHT20 connecting to Port 3')
  hello(client, 3, STYPE.TEMP)
  await wait(80)
  hello(client, 3, STYPE.HUM)
  await wait(1500)

  log('  → streaming data...')
  let t3 = 25.1, h3 = 71.0
  for (let i = 0; i < 14; i++) {
    t3 = clamp(rnd(t3, 0.3), 20, 40)
    h3 = clamp(rnd(h3, 0.8), 30, 95)
    data(client, 3, STYPE.TEMP, t3)
    await wait(40)
    data(client, 3, STYPE.HUM,  h3)
    await wait(900)
  }
  await wait(2000)

  // ───────────────────────────────────────────────────────────────────────────
  // SCENARIO 5 — Port 1 disconnected → IMU replaces it
  //   "Change sensors anytime. No complicated reconfiguration."
  // ───────────────────────────────────────────────────────────────────────────
  log('SCENARIO 5 — Port 1 disconnect')
  stale(client, 1)
  await wait(3500)

  log('  → IMU connecting to Port 1')
  for (const s of IMU_STYPES) {
    hello(client, 1, s)
    await wait(40)
  }
  await wait(1500)

  log('  → streaming IMU data...')
  let pitch = 2.1, roll = -1.3, yaw = 0.0
  let ax = 0.05, ay = -0.03, az = 9.81
  let gx = 0.01, gy = -0.01, gz = 0.005

  for (let i = 0; i < 30; i++) {
    ax    = clamp(rnd(ax, 0.08),  -2,   2)
    ay    = clamp(rnd(ay, 0.08),  -2,   2)
    az    = clamp(rnd(az, 0.12),   9,  10.5)
    gx    = clamp(rnd(gx, 0.04), -0.5, 0.5)
    gy    = clamp(rnd(gy, 0.04), -0.5, 0.5)
    gz    = clamp(rnd(gz, 0.02), -0.3, 0.3)
    pitch = clamp(rnd(pitch, 0.6), -10, 10)
    roll  = clamp(rnd(roll,  0.5), -10, 10)
    yaw   = parseFloat((yaw + rnd(0.2, 0.15)).toFixed(2))

    const imuFrame = {
      [STYPE.ACCEL_X]: ax,   [STYPE.ACCEL_Y]: ay, [STYPE.ACCEL_Z]: az,
      [STYPE.GYRO_X]:  gx,   [STYPE.GYRO_Y]:  gy, [STYPE.GYRO_Z]:  gz,
      [STYPE.PITCH]:   pitch, [STYPE.ROLL]:   roll, [STYPE.YAW]:     yaw,
    }
    for (const [stype, value] of Object.entries(imuFrame)) {
      pub(client, Number(stype), 1, value, FTYPE.DATA)
      await wait(10)
    }
    await wait(180)
  }

  log('=== All scenarios complete ===')
  log('You can stop recording now.')
}

// ── Main ──────────────────────────────────────────────────────────────────────
function log(msg) {
  console.log(`[${new Date().toLocaleTimeString()}] ${msg}`)
}

const client = mqtt.connect(BROKER)

client.on('connect', () => {
  log(`Connected to broker ${BROKER}`)
  log(`Device ID : ${DEVICE_ID}`)
  log(`Ctrl ID   : ${CTRL_ID}`)
  log('Starting in 2 seconds...\n')

  setTimeout(() => {
    runScenarios(client)
      .then(() => { setTimeout(() => client.end(), 1000) })
      .catch(err => { console.error('[ERROR]', err); client.end() })
  }, 2000)
})

client.on('error', err => {
  console.error('[MQTT ERROR]', err.message)
  console.error('Pastikan backend + MQTT broker sudah running.')
})
