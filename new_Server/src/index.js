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


const app  = express()
const PORT = process.env.PORT || 3000
const WS_PORT = process.env.WS_PORT || 3001

// ─── Middleware ───────────────────────────────────
app.use(cors())
app.use(express.json())

// ─── API Routes ───────────────────────────────────
app.use('/api/auth', authRoutes)
app.use('/api/user', userRoutes)
app.use('/api', apiRoutes)

// ─── MongoDB ──────────────────────────────────────
async function connectMongo() {
  const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/ciren'
  await mongoose.connect(uri)
  console.log(`[MongoDB] Connected: ${uri}`)
}

// ─── Start ────────────────────────────────────────
async function start() {
  try {
    // 1. MongoDB
    await connectMongo()

    // 2. WebSocket server (realtime ke dashboard)
    initWS(WS_PORT)

    // 3. MQTT subscriber (terima data dari main module)
    initMQTT()

    // 4. HTTP server
    app.listen(PORT, () => {
      console.log(`[HTTP] Server running on port ${PORT}`)
      console.log(`[WS]   WebSocket on port ${WS_PORT}`)
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
  } catch (err) {
    console.error('Startup error:', err)
    process.exit(1)
  }
}

start()
