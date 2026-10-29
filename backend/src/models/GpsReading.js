const mongoose = require('mongoose')

// ─── GPS Reading ──────────────────────────────────
// Satu dokumen = satu paket GPS dari forklift tracker (via LoRa → main module → MQTT)
const gpsReadingSchema = new mongoose.Schema({
  device_id: { type: String, required: true, index: true },
  node_id:   { type: Number, required: true },
  seq:       { type: Number },
  lat:       { type: Number, required: true },
  lon:       { type: Number, required: true },
  alt:       { type: Number },
  speed:     { type: Number },
  heading:   { type: Number },
  hdop:      { type: Number },
  sat:       { type: Number },
  device_ts: { type: Number },
  server_ts: { type: Date, default: Date.now },
}, { versionKey: false })

// Compound index untuk query "latest per node" dan history
gpsReadingSchema.index({ device_id: 1, node_id: 1, server_ts: -1 })

// TTL index: hapus data otomatis setelah 30 hari (sama seperti SensorReading)
gpsReadingSchema.index({ server_ts: 1 }, { expireAfterSeconds: 2592000 })

module.exports = mongoose.model('GpsReading', gpsReadingSchema)
