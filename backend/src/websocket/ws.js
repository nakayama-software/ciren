const { WebSocketServer } = require('ws')
const jwt = require('jsonwebtoken')

const JWT_SECRET   = process.env.JWT_SECRET || 'ciren-secret-key'
const PING_INTERVAL = 30000  // ping tiap 30s untuk deteksi dead connections

let wss = null

function initWS(serverOrPort) {
  const opts = typeof serverOrPort === 'number'
    ? { port: serverOrPort }
    : { server: serverOrPort }
  wss = new WebSocketServer(opts)

  // Ping semua client secara berkala — tandai yang tidak balas sebagai dead
  const pingTimer = setInterval(() => {
    if (!wss) return
    wss.clients.forEach(ws => {
      if (!ws.isAlive) { ws.terminate(); return }
      ws.isAlive = false
      ws.ping()
    })
  }, PING_INTERVAL)

  wss.on('close', () => clearInterval(pingTimer))

  wss.on('connection', (ws, req) => {
    // ── Auth: JWT token atau demo key ──
    const url       = new URL(req.url, 'ws://localhost')
    const token     = url.searchParams.get('token')
    const demoKey   = url.searchParams.get('demo')
    const DEMO_SECRET = process.env.DEMO_SECRET || 'ciren-demo'

    if (demoKey === DEMO_SECRET) {
      ws.user = { username: 'demo', role: 'viewer' }
    } else if (token) {
      try {
        ws.user = jwt.verify(token, JWT_SECRET)
      } catch {
        ws.close(4001, 'Invalid token')
        return
      }
    } else {
      ws.close(4001, 'No token')
      return
    }

    ws.isAlive = true
    ws.on('pong', () => { ws.isAlive = true })
    ws.on('close', () => console.log(`[WS] Client disconnected: ${ws.user?.username}`))
    console.log(`[WS] Client connected: ${ws.user?.username}`)
  })

  const portInfo = typeof serverOrPort === 'number' ? serverOrPort : (process.env.BACKEND_PORT || process.env.PORT || 3000)
  console.log(`[WS] Server running on port ${portInfo}`)
  return wss
}

// Broadcast ke semua authenticated client
function broadcast(type, payload) {
  if (!wss) return
  const msg = JSON.stringify({ type, payload, ts: Date.now() })
  wss.clients.forEach(client => {
    if (client.readyState === 1 && client.user) {
      try { client.send(msg) } catch { /* client disconnected */ }
    }
  })
}

module.exports = { initWS, broadcast }
