const mongoose = require('mongoose')

// ─── Sensor Reading ───────────────────────────────
// Satu dokumen = satu frame dari sensor node
const sensorReadingSchema = new mongoose.Schema({
  device_id:   { type: String, required: true, index: true },
  ctrl_id:     { type: Number, required: true },
  port_num:    { type: Number, required: true },
  sensor_type: { type: Number, required: true },
  value:       { type: Number, required: true },
  ftype:       { type: Number, required: true },
  device_ts:   { type: Number },
  server_ts:   { type: Date, default: Date.now, index: true },
}, { versionKey: false })

// Compound index untuk query dashboard
sensorReadingSchema.index({ device_id: 1, ctrl_id: 1, port_num: 1, server_ts: -1 })

// TTL index: hapus data otomatis setelah 30 hari
sensorReadingSchema.index({ server_ts: 1 }, { expireAfterSeconds: 2592000 })

module.exports = mongoose.model('SensorReading', sensorReadingSchema)