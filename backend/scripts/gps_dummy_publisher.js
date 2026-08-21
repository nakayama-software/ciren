/**
 * CIREN GPS Dummy Publisher
 * Simulasi main module publish GPS forklift tracker ke MQTT — TANPA hardware
 * LoRa/GT-U7 sama sekali. Berguna untuk test update realtime peta di frontend
 * saat cuma ada 1 modul LoRa fisik (jadi gerakan/multi-node susah ditest langsung).
 *
 * Publish ke topic yang SAMA persis dengan main module asli (ciren/gps/{device_id}),
 * jadi lewat jalur backend + WebSocket yang sama seperti data GPS beneran —
 * bukan jalur test terpisah.
 *
 * Jalankan: node scripts/gps_dummy_publisher.js [device_id] [node_ids]
 *   node scripts/gps_dummy_publisher.js                  → MM-A21D2C, node 1,2
 *   node scripts/gps_dummy_publisher.js MM-A21D2C 1,2,3   → simulasi 3 node sekaligus
 * Ctrl+C untuk stop.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '..', '.config') })
const mqtt = require('mqtt')

const DEVICE_ID = process.argv[2] || 'MM-A21D2C'
const NODE_IDS  = (process.argv[3] || '2,3').split(',').map(Number)   // simulasi multi-forklift sekaligus

// Titik pusat pergerakan — dari data GPS asli sebelumnya (dekat Fukuoka)
const CENTER_LAT = 33.21143
const CENTER_LON = 130.04588
const RADIUS_DEG = 0.0006     // ~60m — cukup kelihatan bergerak di peta tapi realistis
const PERIOD_MS  = 60000      // satu putaran penuh per 60 detik
const PUBLISH_INTERVAL_MS = 2000

const host = process.env.MQTT_HOST || 'localhost'
const port = process.env.MQTT_PORT || 1883

const client = mqtt.connect(`mqtt://${host}:${port}`, {
  clientId: 'ciren-gps-dummy-publisher',
  clean: true,
})

let seq = 0

client.on('connect', () => {
  console.log(`[GPS-DUMMY] Connected to MQTT broker ${host}:${port}`)
  console.log(`[GPS-DUMMY] Publishing to ciren/gps/${DEVICE_ID} for node_id(s): ${NODE_IDS.join(', ')}`)
  console.log('[GPS-DUMMY] Ctrl+C to stop.\n')
  setInterval(tick, PUBLISH_INTERVAL_MS)
})

client.on('error', (err) => console.error('[GPS-DUMMY] Error:', err.message))

function positionFor(nodeId, tMs) {
  // Offset each node's phase so multiple simulated nodes don't overlap
  const phase = (nodeId * (Math.PI / 3))
  const angle = (tMs / PERIOD_MS) * 2 * Math.PI + phase
  const lat = CENTER_LAT + RADIUS_DEG * Math.sin(angle)
  const lon = CENTER_LON + RADIUS_DEG * Math.cos(angle)
  // Heading = direction of travel (derivative of the circle), speed constant for simplicity
  const headingRad = angle + Math.PI / 2
  const heading = ((headingRad * 180 / Math.PI) % 360 + 360) % 360
  return { lat, lon, heading }
}

function tick() {
  seq++
  const now = Date.now()

  for (const nodeId of NODE_IDS) {
    const { lat, lon, heading } = positionFor(nodeId, now)
    const payload = {
      device_id: DEVICE_ID,
      type: 'gps',
      node_id: nodeId,
      seq,
      lat: +lat.toFixed(6),
      lon: +lon.toFixed(6),
      alt: 12.5,
      speed: 8.0 + Math.random() * 4,       // km/h, plausible walking-pace forklift
      heading: +heading.toFixed(1),
      hdop: +(0.8 + Math.random() * 0.7).toFixed(1),
      sat: 6 + Math.floor(Math.random() * 6),
      timestamp: Math.floor(now / 1000),
    }
    const topic = `ciren/gps/${DEVICE_ID}`
    client.publish(topic, JSON.stringify(payload))
    console.log(`[PUB] node=${nodeId} seq=${seq} lat=${payload.lat} lon=${payload.lon}`)
  }
}
