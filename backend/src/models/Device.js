const mongoose = require('mongoose')

// ─── Sensor Node Info ─────────────────────────────
// Satu dokumen per (device_id + ctrl_id + port_num + sensor_type)
// Di-upsert setiap kali HELLO frame diterima
// Satu port bisa punya beberapa sensor_type (contoh: DHT20 kirim 0x01 + 0x02)
const sensorNodeSchema = new mongoose.Schema({
  device_id:   { type: String, required: true },
  ctrl_id:     { type: Number, required: true },
  port_num:    { type: Number, required: true },
  sensor_type: { type: Number, required: true },  // dari HELLO frame
  status:      { type: String, enum: ['online', 'offline', 'stale'], default: 'online' },
  last_seen:   { type: Date, default: Date.now },
  first_seen:  { type: Date, default: Date.now },
}, { versionKey: false })

sensorNodeSchema.index(
  { device_id: 1, ctrl_id: 1, port_num: 1, sensor_type: 1 },
  { unique: true }
)

// ─── Main Module / Device ─────────────────────────
// Satu dokumen per main module
// Di-upsert setiap kali heartbeat atau data diterima
const deviceSchema = new mongoose.Schema({
  device_id:    { type: String, required: true, unique: true },
  conn_mode:    { type: String, enum: ['wifi', 'sim', 'auto'], default: 'wifi' },
  gps_lat:      { type: Number },
  gps_lon:      { type: Number },
  gps_fix:      { type: Boolean, default: false },
  rssi:         { type: Number },
  batt_pct:     { type: Number },
  status:       { type: String, enum: ['online', 'offline'], default: 'online' },
  last_seen:    { type: Date, default: Date.now },
  first_seen:   { type: Date, default: Date.now },
  fw_version:   { type: String },
}, { versionKey: false })

module.exports = {
  SensorNode: mongoose.model('SensorNode', sensorNodeSchema),
  Device:     mongoose.model('Device',     deviceSchema),
}
