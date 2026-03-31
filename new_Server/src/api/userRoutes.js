const express     = require('express')
const router      = express.Router()
const User        = require('../models/User')
const requireAuth = require('../middleware/auth')
const { Device }  = require('../models/Device')

// All routes require JWT
router.use(requireAuth)

// GET /api/user/devices
// Kembalikan daftar device_id yang sudah didaftarkan oleh user ini
router.get('/devices', async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).lean()
    if (!user) return res.status(404).json({ error: 'User not found' })
    res.json({ devices: user.devices || [] })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// POST /api/user/devices
// Daftarkan device_id ke akun user
// Body: { device_id: "MM-001" }
router.post('/devices', async (req, res) => {
  try {
    const { device_id } = req.body
    if (!device_id) return res.status(400).json({ error: 'device_id required' })

    // Pastikan device sudah pernah online (terdaftar di DB)
    const device = await Device.findOne({ device_id }).lean()
    if (!device)
      return res.status(404).json({ error: 'Device not found. Make sure the main module is online.' })

    await User.updateOne(
      { _id: req.user.userId },
      { $addToSet: { devices: device_id } }
    )
    res.json({ ok: true, device_id })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// DELETE /api/user/devices/:deviceId
// Hapus device_id dari daftar user
router.delete('/devices/:deviceId', async (req, res) => {
  try {
    await User.updateOne(
      { _id: req.user.userId },
      { $pull: { devices: req.params.deviceId } }
    )
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

module.exports = router
