#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# CIREN — Local run script
# Frontend + Backend jalan di lokal, expose via Cloudflare Tunnel.
# MongoDB + Mosquitto ada di VPS 118.22.31.254.
#
# Usage: bash deploy/deploy.sh
# ─────────────────────────────────────────────────────────────────────────────

set -e

REPO="$(dirname "$0")/.."

echo "════════════════════════════════════════"
echo "  CIREN — Local Start"
echo "════════════════════════════════════════"

# ─── 1. Build frontend ────────────────────────────────────────────────────────
echo ""
echo "[1/2] Building frontend..."
cd "$REPO/new dashboard-frontend"
npm install --silent
npm run build
echo "✓ Frontend built → dist/"

# ─── 2. Start backend ─────────────────────────────────────────────────────────
echo ""
echo "[2/2] Starting backend..."
cd "$REPO/new_Server"
NODE_ENV=production node src/index.js &
BACKEND_PID=$!
echo "✓ Backend running (PID $BACKEND_PID)"

echo ""
echo "════════════════════════════════════════"
echo "  Jalankan juga (terminal terpisah):"
echo "    caddy run --config Caddyfile"
echo "    cloudflared tunnel --config .cloudflared/config.yml run"
echo ""
echo "  Frontend : https://cirenfe.raihanrafif.com"
echo "  Backend  : https://cirenbe.raihanrafif.com"
echo "════════════════════════════════════════"
