#!/bin/bash
# CIREN Backend Setup Script
# Jalankan di Jetson: bash scripts/setup.sh

set -e
echo "══════════════════════════════════════"
echo "  CIREN Backend Setup"
echo "══════════════════════════════════════"

# ─── 1. Mosquitto ─────────────────────────────────
echo ""
echo "[1/4] Installing Mosquitto..."
sudo apt-get update -qq
sudo apt-get install -y mosquitto mosquitto-clients

echo "Copying Mosquitto config..."
sudo cp "$(dirname "$0")/../config/mosquitto.conf" /etc/mosquitto/conf.d/ciren.conf

sudo systemctl enable mosquitto
sudo systemctl restart mosquitto
echo "✓ Mosquitto running"

# Test MQTT
sleep 1
if mosquitto_pub -h localhost -p 1883 -t "ciren/test" -m "hello" 2>/dev/null; then
  echo "✓ MQTT broker reachable on port 1883"
else
  echo "⚠ MQTT test failed — check Mosquitto logs: sudo journalctl -u mosquitto"
fi

# ─── 2. Node.js dependencies ──────────────────────
echo ""
echo "[2/4] Installing Node.js dependencies..."
cd "$(dirname "$0")/.."
npm install
echo "✓ Dependencies installed"

# ─── 3. .env check ────────────────────────────────
echo ""
echo "[3/4] Checking .env..."
if [ ! -f .env ]; then
  cp .env.example .env 2>/dev/null || true
  echo "⚠ .env not found — created from template, please edit it"
else
  echo "✓ .env exists"
fi

# ─── 4. PM2 (optional, untuk autostart) ──────────
echo ""
echo "[4/4] Setting up PM2 for autostart (optional)..."
if command -v pm2 &> /dev/null; then
  pm2 start src/index.js --name ciren-backend
  pm2 save
  pm2 startup | tail -1 | bash 2>/dev/null || true
  echo "✓ PM2 configured"
else
  echo "PM2 not found. To enable autostart:"
  echo "  npm install -g pm2"
  echo "  pm2 start src/index.js --name ciren-backend"
  echo "  pm2 save && pm2 startup"
fi

echo ""
echo "══════════════════════════════════════"
echo "  Setup complete!"
echo ""
echo "  Start server:  npm start"
echo "  Dev mode:      npm run dev"
echo ""
echo "  MQTT broker:   localhost:1883"
echo "  MQTT WebSocket: localhost:9001"
echo "  HTTP API:      localhost:3000"
echo "  WebSocket:     localhost:3001"
echo "══════════════════════════════════════"
