/**
 * CIREN MQTT Test Publisher
 * Simulasi main module kirim data ke backend
 * Jalankan: node scripts/test_publisher.js
 * 
 * Berguna untuk test backend sebelum hardware datang
 */

require('dotenv').config()
const mqtt = require('mqtt')

const DEVICE_ID = 'MM-001'
const host      = process.env.MQTT_HOST || 'localhost'
const port      = process.env.MQTT_PORT || 1883

const client = mqtt.connect(`mqtt://${host}:${port}`, {
  clientId: 'ciren-test-publisher',
  clean: true,
})

client.on('connect', () => {
  console.log(`[TEST] Connected to MQTT broker`)
  console.log(`[TEST] Simulating main module: ${DEVICE_ID}`)
  console.log('')
  runSimulation()
})

client.on('error', err => console.error('[TEST] Error:', err.message))

// ─── Helpers ──────────────────────────────────────
function publish(topic, payload) {
  client.publish(topic, JSON.stringify(payload))
  console.log(`[PUB] ${topic}`, JSON.stringify(payload))
}

// ─── Simulation ───────────────────────────────────
async function runSimulation() {
  // Step 1: Device hello (saat boot)
  publish(`ciren/hello/${DEVICE_ID}`, {
    conn_mode:  'wifi',
    fw_version: '1.0.0',
  })
  await sleep(500)

  // Step 2: Device status (GPS, batt, signal)
  publish(`ciren/status/${DEVICE_ID}`, {
    conn_mode: 'wifi',
    gps_lat:   -7.7956,
    gps_lon:   110.3695,
    gps_fix:   true,
    rssi:      -65,
    batt_pct:  87,
    fw_version: '1.0.0',
  })
  await sleep(500)

  // Step 3: Sensor node HELLO (Port 1 = DHT20 temp)
  publish(`ciren/data/${DEVICE_ID}`, {
    ctrl_id: 1, port_num: 1, sensor_type: 0x01,
    value: 1, timestamp_ms: Date.now(), ftype: 0x02   // FTYPE_HELLO
  })
  await sleep(100)

  // Port 1 = DHT20 humidity
  publish(`ciren/data/${DEVICE_ID}`, {
    ctrl_id: 1, port_num: 1, sensor_type: 0x02,
    value: 2, timestamp_ms: Date.now(), ftype: 0x02
  })
  await sleep(100)

  // Port 2 = MPU6050 (pitch, roll, yaw)
  publish(`ciren/data/${DEVICE_ID}`, {
    ctrl_id: 1, port_num: 2, sensor_type: 0x10,
    value: 0x10, timestamp_ms: Date.now(), ftype: 0x02
  })
  await sleep(200)

  // Step 4: Stream data realtime
  console.log('\n[TEST] Streaming sensor data (Ctrl+C to stop)...\n')

  let t = 0
  setInterval(() => {
    t += 0.05

    // Temperature + humidity (tiap 1 detik)
    publish(`ciren/data/${DEVICE_ID}`, {
      ctrl_id: 1, port_num: 1, sensor_type: 0x01,
      value: +(26.5 + Math.sin(t) * 2).toFixed(2),
      timestamp_ms: Date.now(), ftype: 0x04  // FTYPE_DATA_TYPED
    })
    publish(`ciren/data/${DEVICE_ID}`, {
      ctrl_id: 1, port_num: 1, sensor_type: 0x02,
      value: +(55 + Math.cos(t) * 5).toFixed(1),
      timestamp_ms: Date.now(), ftype: 0x04
    })

    // IMU pitch/roll/yaw (tiap 100ms = 10Hz simulasi)
    publish(`ciren/data/${DEVICE_ID}`, {
      ctrl_id: 1, port_num: 2, sensor_type: 0x10,
      value: +(Math.sin(t * 0.7) * 45).toFixed(2),
      timestamp_ms: Date.now(), ftype: 0x04
    })
    publish(`ciren/data/${DEVICE_ID}`, {
      ctrl_id: 1, port_num: 2, sensor_type: 0x11,
      value: +(Math.cos(t * 0.5) * 30).toFixed(2),
      timestamp_ms: Date.now(), ftype: 0x04
    })
    publish(`ciren/data/${DEVICE_ID}`, {
      ctrl_id: 1, port_num: 2, sensor_type: 0x12,
      value: +(t * 20 % 360 - 180).toFixed(2),
      timestamp_ms: Date.now(), ftype: 0x04
    })

    // Status update tiap 5 detik
    if (Math.floor(t * 20) % 100 === 0) {
      publish(`ciren/status/${DEVICE_ID}`, {
        conn_mode: 'wifi', gps_lat: -7.7956, gps_lon: 110.3695,
        gps_fix: true, rssi: -60 + Math.floor(Math.random() * 10),
        batt_pct: 87, fw_version: '1.0.0',
      })
    }
  }, 1000)
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }
