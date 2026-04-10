const mongoose = require('mongoose')

// Per (device_id, ctrl_id, port_num) upload interval setting.
// Created/updated via POST /api/devices/:deviceId/node-config.
// Re-sent to the main module on every device HELLO so configs survive firmware reboots.
const nodeConfigSchema = new mongoose.Schema({
  device_id:   { type: String, required: true },
  ctrl_id:     { type: Number, required: true },
  port_num:    { type: Number, required: true },
  interval_ms: { type: Number, required: true, min: 100 },
  updated_at:  { type: Date, default: Date.now },
}, { versionKey: false })

nodeConfigSchema.index(
  { device_id: 1, ctrl_id: 1, port_num: 1 },
  { unique: true }
)

module.exports = mongoose.model('NodeConfig', nodeConfigSchema)
