const { Device }      = require('../models/Device')
const SensorReading   = require('../models/SensorReading')

const SERVER_START = Date.now()

// GET /api/stats — public, no auth required
// Dipakai oleh login page untuk tampilkan stats aggregate
module.exports = async function handleStats(req, res) {
  try {
    const since5min = new Date(Date.now() - 5 * 60 * 1000)

    const [activeDevices, totalReadings] = await Promise.all([
      Device.countDocuments({ last_seen: { $gte: since5min } }),
      SensorReading.estimatedDocumentCount(),
    ])

    const uptimeSec  = Math.floor((Date.now() - SERVER_START) / 1000)
    const uptimeHrs  = Math.floor(uptimeSec / 3600)
    const uptimeMins = Math.floor((uptimeSec % 3600) / 60)
    const uptimeStr  = uptimeHrs > 0
      ? `${uptimeHrs}h ${uptimeMins}m`
      : `${uptimeMins}m`

    res.json({ activeDevices, totalReadings, uptime: uptimeStr })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}
