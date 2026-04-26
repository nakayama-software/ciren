const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env'
require('dotenv').config({ path: require('path').resolve(__dirname, '..', envFile) })
const express  = require('express')
const cors     = require('cors')
const mongoose = require('mongoose')

const { initWS }    = require('./websocket/ws')
const { initMQTT }  = require('./mqtt/handler')
const apiRoutes     = require('./api/routes')
const authRoutes    = require('./api/auth')
const userRoutes    = require('./api/userRoutes')
const requireAuth   = require('./middleware/auth')
const handleStats   = require('./api/stats')


const app  = express()
const PORT = process.env.PORT || 3000

// ─── Middleware ───────────────────────────────────
app.use(cors())
app.use(express.json())

// ─── API Routes ───────────────────────────────────
app.use('/api/auth', authRoutes)
app.get('/api/stats', handleStats)           // public — login page stats
app.use('/api/user', requireAuth, userRoutes)
app.use('/api', requireAuth, apiRoutes)

// ─── MongoDB ──────────────────────────────────────
async function connectMongo() {
  const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/ciren'
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10000,
    heartbeatFrequencyMS: 10000,
    retryWrites: true,
  })
  console.log(`[MongoDB] Connected: ${uri}`)
}

// ── MongoDB connection resilience ──────────────────
mongoose.connection.on('disconnected', () => {
  console.warn('[MongoDB] Connection lost — Mongoose will auto-reconnect')
})
mongoose.connection.on('reconnected', () => {
  console.log('[MongoDB] Reconnected')
})
mongoose.connection.on('error', (err) => {
  console.error('[MongoDB] Connection error:', err.message)
})

// ─── Start ────────────────────────────────────────
async function start() {
  try {
    // 1. MongoDB
    await connectMongo()

    // 2. WebSocket server — akan di-attach ke HTTP server setelah listen

    // 3. MQTT subscriber (terima data dari main module)
    initMQTT()

    // 4. HTTP server (WebSocket shares same port via server attachment)
    const server = app.listen(PORT, () => {
      console.log(`[HTTP] Server running on port ${PORT}`)
      console.log(`[WS]   WebSocket on port ${PORT} (shared)`)
      console.log('')
      console.log('API endpoints:')
      console.log(`  GET  /api/health`)
      console.log(`  GET  /api/devices`)
      console.log(`  GET  /api/devices/:id`)
      console.log(`  GET  /api/devices/:id/nodes`)
      console.log(`  GET  /api/devices/:id/data`)
      console.log(`  GET  /api/devices/:id/data/latest`)
      console.log(`  GET  /api/devices/:id/data/history`)
      console.log(`  POST /api/devices/:id/config`)
    })

    // 5. Attach WebSocket ke HTTP server (share port)
    initWS(server)
  } catch (err) {
    console.error('Startup error:', err.message)
    console.error('[MongoDB] Retrying in 5 seconds...')
    await new Promise(r => setTimeout(r, 5000))
    await connectMongo()  // retry once; Mongoose handles ongoing reconnection
  }
}

start()
