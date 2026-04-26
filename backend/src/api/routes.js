const express    = require('express')
const router     = express.Router()
const SensorReading          = require('../models/SensorReading')
const { SensorNode, Device } = require('../models/Device')
const NodeConfig             = require('../models/NodeConfig')
const { sendConfig, sendNodeConfig } = require('../mqtt/handler')
const { STYPE_LABEL }        = require('../utils/constants')

// ══════════════════════════════════════════════════
//  DEVICES
// ══════════════════════════════════════════════════

// GET /api/devices
// Semua main module yang terdaftar
router.get('/devices', async (req, res) => {
  try {
    const devices = await Device.find().sort({ last_seen: -1 }).lean()
    res.json(devices)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// GET /api/devices/:deviceId
// Detail satu main module + semua sensor node-nya
router.get('/devices/:deviceId', async (req, res) => {
  try {
    const device = await Device.findOne({ device_id: req.params.deviceId }).lean()
    if (!device) return res.status(404).json({ error: 'Device not found' })

    const nodes = await SensorNode
      .find({ device_id: req.params.deviceId })
      .sort({ ctrl_id: 1, port_num: 1 })
      .lean()

    // Tambahkan label sensor type ke setiap node
    nodes.forEach(n => {
      n.sensor_label = STYPE_LABEL[n.sensor_type] || { label: 'Unknown', unit: '' }
    })

    res.json({ ...device, nodes })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// POST /api/devices/:deviceId/config
// Kirim config command ke main module via MQTT
// Body: { action: 'set_mode'|'reboot', value: 'wifi'|'sim'|'auto' }
router.post('/devices/:deviceId/config', (req, res) => {
  const { action, value } = req.body
  if (!action) return res.status(400).json({ error: 'action required' })
  const ok = sendConfig(req.params.deviceId, { action, value })
  if (!ok) return res.status(503).json({ error: 'MQTT not connected' })
  res.json({ ok: true, sent: { action, value } })
})

// ══════════════════════════════════════════════════
//  DASHBOARD (combined snapshot untuk initial load)
// ══════════════════════════════════════════════════

// GET /api/dashboard
// Semua device milik user + latest reading tiap sensor + node list
// Query: ?device_ids=MM-001,MM-002 (optional, filter)
router.get('/dashboard', async (req, res) => {
  try {
    const { device_ids } = req.query
    const filter = device_ids
      ? { device_id: { $in: device_ids.split(',').map(s => s.trim()) } }
      : {}

    const devices = await Device.find(filter).sort({ last_seen: -1 }).lean()
    if (devices.length === 0) return res.json({ devices: [] })

    const ids = devices.map(d => d.device_id)

    // Nodes + latest readings paralel
    const [allNodes, allLatest] = await Promise.all([
      SensorNode.find({ device_id: { $in: ids } }).sort({ ctrl_id: 1, port_num: 1 }).lean(),
      SensorReading.aggregate([
        { $match: { device_id: { $in: ids } } },
        { $sort:  { server_ts: -1 } },
        { $group: {
            _id: { device_id: '$device_id', ctrl_id: '$ctrl_id', port_num: '$port_num', sensor_type: '$sensor_type' },
            doc: { $first: '$$ROOT' }
        }},
        { $replaceRoot: { newRoot: '$doc' } },
      ]),
    ])

    // Group by device_id
    const nodesByDevice   = {}
    const latestByDevice  = {}
    for (const n of allNodes) {
      n.sensor_label = STYPE_LABEL[n.sensor_type] || { label: 'Unknown', unit: '' }
      ;(nodesByDevice[n.device_id] = nodesByDevice[n.device_id] || []).push(n)
    }
    for (const r of allLatest) {
      ;(latestByDevice[r.device_id] = latestByDevice[r.device_id] || []).push(r)
    }

    const result = devices.map(d => ({
      ...d,
      nodes:   nodesByDevice[d.device_id]  || [],
      latest:  latestByDevice[d.device_id] || [],
    }))

    res.json({ devices: result })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ══════════════════════════════════════════════════
//  SENSOR NODES
// ══════════════════════════════════════════════════

// GET /api/devices/:deviceId/nodes
// Semua sensor node di satu device
router.get('/devices/:deviceId/nodes', async (req, res) => {
  try {
    const nodes = await SensorNode
      .find({ device_id: req.params.deviceId })
      .sort({ ctrl_id: 1, port_num: 1 })
      .lean()
    nodes.forEach(n => {
      n.sensor_label = STYPE_LABEL[n.sensor_type] || { label: 'Unknown', unit: '' }
    })
    res.json(nodes)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ══════════════════════════════════════════════════
//  SENSOR DATA
// ══════════════════════════════════════════════════

// GET /api/devices/:deviceId/data
// Data terbaru semua sensor di device ini
// Query: ?ctrl_id=1&port_num=1&limit=100&from=ISO&to=ISO
router.get('/devices/:deviceId/data', async (req, res) => {
  try {
    const { ctrl_id, port_num, limit = 100, from, to } = req.query
    const filter = { device_id: req.params.deviceId }
    if (ctrl_id)  filter.ctrl_id  = Number(ctrl_id)
    if (port_num) filter.port_num = Number(port_num)
    if (from || to) {
      filter.server_ts = {}
      if (from) filter.server_ts.$gte = new Date(from)
      if (to)   filter.server_ts.$lte = new Date(to)
    }
    const data = await SensorReading
      .find(filter)
      .sort({ server_ts: -1 })
      .limit(Math.min(Number(limit), 1000))
      .lean()
    res.json(data)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// GET /api/devices/:deviceId/data/latest
// Nilai terbaru tiap (ctrl_id, port_num, sensor_type) — satu per kombinasi unik
// Penting: group by sensor_type juga agar DHT20 return temp+humidity terpisah
// Query: ?maxAge=3600 (detik, default 3600 = 1 jam) — filter data lama dari sensor yg sudah pindah port
router.get('/devices/:deviceId/data/latest', async (req, res) => {
  try {
    const maxAgeSec = Math.min(Number(req.query.maxAge) || 2592000, 2592000)  // default+max = 30 days (matches MongoDB TTL)
    const since = new Date(Date.now() - maxAgeSec * 1000)

    const latest = await SensorReading.aggregate([
      { $match: { device_id: req.params.deviceId, server_ts: { $gte: since } } },
      { $sort:  { server_ts: -1 } },
      { $group: {
          _id: { ctrl_id: '$ctrl_id', port_num: '$port_num', sensor_type: '$sensor_type' },
          doc: { $first: '$$ROOT' }
      }},
      { $replaceRoot: { newRoot: '$doc' } },
      { $sort: { ctrl_id: 1, port_num: 1, sensor_type: 1 } },
    ])
    latest.forEach(r => {
      r.sensor_label = STYPE_LABEL[r.sensor_type] || { label: 'Unknown', unit: '' }
    })
    res.json(latest)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// GET /api/devices/:deviceId/data/history
// Data historis untuk grafik
// Query: ?ctrl_id=1&port_num=1&sensor_type=1&hours=24
router.get('/devices/:deviceId/data/history', async (req, res) => {
  try {
    const { ctrl_id, port_num, sensor_type, hours = 24 } = req.query
    if (!ctrl_id || !port_num)
      return res.status(400).json({ error: 'ctrl_id and port_num required' })

    const from = new Date(Date.now() - Number(hours) * 3600 * 1000)

    const filter = {
      device_id: req.params.deviceId,
      ctrl_id:   Number(ctrl_id),
      port_num:  Number(port_num),
      server_ts: { $gte: from },
      ftype:     { $in: [0x01, 0x04] },
    }
    if (sensor_type) filter.sensor_type = Number(sensor_type)

    const data = await SensorReading
      .find(filter)
      .sort({ server_ts: 1 })
      .lean()

    res.json(data)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// DELETE /api/devices/:deviceId/data
// Hapus reading untuk kombinasi ctrl_id + port_num [+ sensor_type]
// Jika sensor_type tidak diberikan, hapus SEMUA sensor_type di port tersebut
// Body atau query: ctrl_id, port_num required; sensor_type optional
router.delete('/devices/:deviceId/data', async (req, res) => {
  try {
    const { ctrl_id, port_num, sensor_type } = { ...req.query, ...req.body }
    if (!ctrl_id || !port_num)
      return res.status(400).json({ error: 'ctrl_id and port_num required' })

    const filter = {
      device_id: req.params.deviceId,
      ctrl_id:   Number(ctrl_id),
      port_num:  Number(port_num),
    }
    if (sensor_type) filter.sensor_type = Number(sensor_type)

    const result = await SensorReading.deleteMany(filter)

    // Hapus SensorNode juga
    await SensorNode.deleteMany(filter)

    res.json({ ok: true, deleted: result.deletedCount })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ══════════════════════════════════════════════════
//  NODE INTERVAL CONFIG
// ══════════════════════════════════════════════════

// GET /api/devices/:deviceId/node-config
// Semua node interval config yang tersimpan untuk device ini
router.get('/devices/:deviceId/node-config', async (req, res) => {
  try {
    const configs = await NodeConfig
      .find({ device_id: req.params.deviceId })
      .sort({ ctrl_id: 1, port_num: 1 })
      .lean()
    res.json(configs)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// POST /api/devices/:deviceId/node-config
// Set interval untuk satu sensor node: { ctrl_id, port_num, interval_ms }
router.post('/devices/:deviceId/node-config', async (req, res) => {
  try {
    const { ctrl_id, port_num, interval_ms } = req.body
    if (!ctrl_id || !port_num || !interval_ms)
      return res.status(400).json({ error: 'ctrl_id, port_num, interval_ms required' })
    if (interval_ms < 100)
      return res.status(400).json({ error: 'interval_ms must be >= 100' })

    await NodeConfig.findOneAndUpdate(
      { device_id: req.params.deviceId, ctrl_id: Number(ctrl_id), port_num: Number(port_num) },
      { interval_ms: Number(interval_ms), updated_at: new Date() },
      { upsert: true, new: true }
    )

    const ok = sendNodeConfig(req.params.deviceId, Number(ctrl_id), Number(port_num), Number(interval_ms))
    // Always return success — config is saved to DB regardless of MQTT status.
    // If MQTT is not connected, config will be re-sent when device reconnects (HELLO).
    res.json({
      ok: true,
      delivered: ok,
      sent: { ctrl_id: Number(ctrl_id), port_num: Number(port_num), interval_ms: Number(interval_ms) },
      ...(ok ? {} : { warning: 'Config saved to database. Device is offline — interval will be applied when device reconnects.' }),
    })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ══════════════════════════════════════════════════
//  INTERVAL VERIFICATION
// ══════════════════════════════════════════════════

// GET /api/devices/:deviceId/node-config/verify
// Compare configured interval vs actual observed interval from recent reading timestamps
// Query: ?ctrl_id=1&port_num=2 (optional, defaults to all configured nodes)
router.get('/devices/:deviceId/node-config/verify', async (req, res) => {
  try {
    const { ctrl_id, port_num } = req.query
    const configFilter = { device_id: req.params.deviceId }
    if (ctrl_id)  configFilter.ctrl_id  = Number(ctrl_id)
    if (port_num) configFilter.port_num = Number(port_num)

    const configs = await NodeConfig.find(configFilter).sort({ ctrl_id: 1, port_num: 1 }).lean()
    if (configs.length === 0) return res.json([])

    const results = []

    for (const cfg of configs) {
      // Get last 10 readings for this (ctrl_id, port_num) — across all sensor_types
      const readings = await SensorReading
        .find({
          device_id: req.params.deviceId,
          ctrl_id:   cfg.ctrl_id,
          port_num:  cfg.port_num,
          ftype:     { $in: [0x01, 0x04] },  // DATA frames only
        })
        .sort({ server_ts: -1 })
        .limit(10)
        .lean()

      let observed_ms = null
      if (readings.length >= 2) {
        // Calculate average interval between consecutive readings
        const sorted = readings.sort((a, b) => a.server_ts - b.server_ts)
        let totalDiff = 0
        let count = 0
        for (let i = 1; i < sorted.length; i++) {
          const diff = new Date(sorted[i].server_ts) - new Date(sorted[i - 1].server_ts)
          if (diff > 0 && diff < 3600000) {  // ignore gaps > 1h (device was offline)
            totalDiff += diff
            count++
          }
        }
        if (count > 0) observed_ms = Math.round(totalDiff / count)
      }

      results.push({
        ctrl_id:       cfg.ctrl_id,
        port_num:      cfg.port_num,
        configured_ms: cfg.interval_ms,
        observed_ms,
        match: observed_ms != null
          ? Math.abs(observed_ms - cfg.interval_ms) < cfg.interval_ms * 0.25  // within 25%
          : null,
        reading_count: readings.length,
      })
    }

    res.json(results)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// ══════════════════════════════════════════════════
//  HEALTH CHECK
// ══════════════════════════════════════════════════
router.get('/health', (req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString() })
})

module.exports = router
