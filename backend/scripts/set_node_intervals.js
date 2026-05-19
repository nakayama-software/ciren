/**
 * Set interval sensor node ke nilai yang benar via MQTT
 * Main module menerima → update NVS-nya → push ke sensor controller via ESP-NOW
 *
 * Jalankan: node scripts/set_node_intervals.js
 */
require('dotenv').config()
const mongoose   = require('mongoose')
const NodeConfig = require('../src/models/NodeConfig')
const { initMQTT, sendNodeConfig } = require('../src/mqtt/handler')

// ── Konfigurasi interval yang benar untuk exhibition ───────────────────────
// Sesuaikan device_id, ctrl_id, port_num dengan setup fisik kamu
const CONFIGS = [
  // IMU (MPU6050) — 100ms = 10 Hz (cukup smooth dengan lerp)
  { device_id: 'MM-FE0FAC', ctrl_id: 1, port_num: 3, interval_ms: 100 },
  { device_id: 'MM-FE0FAC', ctrl_id: 2, port_num: 3, interval_ms: 100 },
  { device_id: 'MM-17BCDC', ctrl_id: 1, port_num: 3, interval_ms: 100 },
  { device_id: 'MM-17BCDC', ctrl_id: 2, port_num: 3, interval_ms: 100 },

  // DHT20 — 500ms = 2 Hz
  { device_id: 'MM-FE0FAC', ctrl_id: 1, port_num: 1, interval_ms: 500 },
  { device_id: 'MM-FE0FAC', ctrl_id: 2, port_num: 1, interval_ms: 500 },
  { device_id: 'MM-17BCDC', ctrl_id: 1, port_num: 1, interval_ms: 500 },
  { device_id: 'MM-17BCDC', ctrl_id: 2, port_num: 1, interval_ms: 500 },
]

async function main() {
  await mongoose.connect(process.env.MONGO_URI)
  console.log('[DB] Connected')

  initMQTT()
  // Tunggu MQTT connect
  await new Promise(r => setTimeout(r, 2000))

  for (const cfg of CONFIGS) {
    // Simpan ke MongoDB (agar resendNodeConfigs pakai nilai ini)
    await NodeConfig.findOneAndUpdate(
      { device_id: cfg.device_id, ctrl_id: cfg.ctrl_id, port_num: cfg.port_num },
      { interval_ms: cfg.interval_ms, updated_at: new Date() },
      { upsert: true }
    )
    // Kirim via MQTT ke main module
    sendNodeConfig(cfg.device_id, cfg.ctrl_id, cfg.port_num, cfg.interval_ms)
    console.log(`[SENT] ${cfg.device_id} ctrl=${cfg.ctrl_id} port=${cfg.port_num} → ${cfg.interval_ms}ms`)
  }

  console.log('[OK] Selesai. Reboot main module agar sensor controller menerima config baru.')
  await new Promise(r => setTimeout(r, 1000))
  process.exit(0)
}

main().catch(e => { console.error('[ERR]', e.message); process.exit(1) })
