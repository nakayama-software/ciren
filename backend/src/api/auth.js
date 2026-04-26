const express    = require('express')
const router     = express.Router()
const bcrypt     = require('bcryptjs')
const jwt        = require('jsonwebtoken')
const User       = require('../models/User')

const JWT_SECRET  = process.env.JWT_SECRET  || 'ciren-secret-key'
const JWT_EXPIRES = process.env.JWT_EXPIRES || '7d'

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { username, password } = req.body
    if (!username || !password)
      return res.status(400).json({ error: 'username and password required' })

    const exists = await User.findOne({ username })
    if (exists) return res.status(409).json({ error: 'Username already taken' })

    const hash = await bcrypt.hash(password, 10)
    const user = await User.create({ username, password: hash, devices: [] })

    const token = jwt.sign({ userId: user._id, username }, JWT_SECRET, { expiresIn: JWT_EXPIRES })
    res.status(201).json({ token, username })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body
    if (!username || !password)
      return res.status(400).json({ error: 'username and password required' })

    const user = await User.findOne({ username })
    if (!user) return res.status(401).json({ error: 'Invalid credentials' })

    const ok = await bcrypt.compare(password, user.password)
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' })

    const token = jwt.sign({ userId: user._id, username }, JWT_SECRET, { expiresIn: JWT_EXPIRES })
    res.json({ token, username })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

module.exports = router
