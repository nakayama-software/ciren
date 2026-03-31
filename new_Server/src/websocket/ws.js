const { WebSocketServer } = require('ws')

let wss = null

// Inisialisasi WebSocket server
function initWS(port) {
  wss = new WebSocketServer({ port })

  wss.on('connection', (ws) => {
    console.log('[WS] Client connected')
    ws.on('close', () => console.log('[WS] Client disconnected'))
  })

  console.log(`[WS] Server running on port ${port}`)
  return wss
}

// Broadcast data ke semua client yang terhubung
// type: 'sensor_data' | 'device_status' | 'node_status'
function broadcast(type, payload) {
  if (!wss) return
  const msg = JSON.stringify({ type, payload, ts: Date.now() })
  wss.clients.forEach(client => {
    if (client.readyState === 1) {  // OPEN
      try {
        client.send(msg)
      } catch {
        // client disconnected between readyState check and send — safe to ignore
      }
    }
  })
}

module.exports = { initWS, broadcast }
