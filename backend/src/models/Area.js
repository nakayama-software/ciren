const mongoose = require('mongoose')

// ─── Area ──────────────────────────────────────────
// Zona/area yang digambar user di peta GPS (per main module) — misal
// "Loading Zone", "Charging Area". Ini data konfigurasi, bukan telemetry,
// jadi tidak pakai TTL.
const areaSchema = new mongoose.Schema({
  device_id:  { type: String, required: true, index: true },
  label:      { type: String, required: true },
  points:     { type: [[Number]], required: true },   // [[lat, lng], ...]
  created_at: { type: Date, default: Date.now },
}, { versionKey: false })

areaSchema.index({ device_id: 1 })

module.exports = mongoose.model('Area', areaSchema)
