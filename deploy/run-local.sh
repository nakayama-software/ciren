#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# CIREN — Local Run Script
# Jalankan di Git Bash: bash deploy/run-local.sh
#
# Prerequisite:
#   - MongoDB running di localhost:27017
#   - Mosquitto running di localhost:1883
#   - Caddy installed (https://caddyserver.com)
#   - cloudflared setup (lihat instruksi di .cloudflared/config.yml)
# ─────────────────────────────────────────────────────────────────────────────

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "═══════════════════════════════════════"
echo "  CIREN — Local Deploy"
echo "═══════════════════════════════════════"

# ─── 1. Build frontend ────────────────────────────────────────────────────────
echo ""
echo "[1/4] Building frontend..."
cd "$ROOT/new dashboard-frontend"
npm install --silent
npm run build
echo "✓ Frontend built → dist/"

# ─── 2. Start backend ────────────────────────────────────────────────────────
echo ""
echo "[2/4] Starting backend (port 3000)..."
cd "$ROOT/new_Server"
npm install --silent --production
NODE_ENV=production node src/index.js &
BACKEND_PID=$!
echo "✓ Backend PID: $BACKEND_PID"
sleep 2

# ─── 3. Start Caddy ───────────────────────────────────────────────────────────
echo ""
echo "[3/4] Starting Caddy (port 8080)..."
cd "$ROOT"
caddy start --config Caddyfile
echo "✓ Caddy running"

# ─── 4. Start Cloudflare Tunnel ───────────────────────────────────────────────
echo ""
echo "[4/4] Starting Cloudflare Tunnel..."
echo "      raihanrafif.com     → localhost:8080"
echo "      api.raihanrafif.com → localhost:8080"
echo ""
cloudflared tunnel --config "$ROOT/.cloudflared/config.yml" run

# ─── Cleanup on exit ──────────────────────────────────────────────────────────
echo ""
echo "Shutting down..."
kill $BACKEND_PID 2>/dev/null
caddy stop 2>/dev/null
echo "Done."
