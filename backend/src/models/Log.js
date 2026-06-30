const mongoose = require('mongoose')

// ─── Device Log ───────────────────────────────────
// Satu dokumen = satu log entry dari main module
// Dikirim via MQTT topic ciren/log/{device_id}
const logSchema = new mongoose.Schema({
  device_id:   { type: String, required: true, index: true },
  level:       { type: String, required: true },   // INFO | WARN | ERROR
  tag:         { type: String, required: true },    // e.g. "WiFi", "SIM", "MQTT"
  msg:         { type: String, required: true },    // log message
  device_ts:   { type: Number },                    // firmware millis() timestamp
  server_ts:   { type: Date, default: Date.now },   // server arrival time
}, { versionKey: false })

// Query index: logs by device, sorted by time
logSchema.index({ device_id: 1, server_ts: -1 })
// Query index: level-filtered queries
logSchema.index({ device_id: 1, level: 1, server_ts: -1 })

// TTL index: auto-delete logs after 7 days
logSchema.index({ server_ts: 1 }, { expireAfterSeconds: 604800 })

module.exports = mongoose.model('Log', logSchema)