# ─────────────────────────────────────────────────────────────────────────────
# CIREN — VPS Setup (Windows) — MongoDB + Mosquitto
# Jalankan sekali di VPS: .\setup-vps.ps1
# Harus dijalankan sebagai Administrator
# ─────────────────────────────────────────────────────────────────────────────

#Requires -RunAsAdministrator

$ErrorActionPreference = "Stop"
$VPS_IP = "118.22.31.254"

# MongoDB credentials — MUST match .env.production
$MONGO_ADMIN_USER = "admin"
$MONGO_ADMIN_PASS = "ciren4171"
$MONGO_DATA_DIR   = "C:\data\db"

Write-Host "════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  CIREN VPS Setup — MongoDB + Mosquitto"
Write-Host "  VPS: $VPS_IP"
Write-Host "════════════════════════════════════════" -ForegroundColor Cyan

# ─── 1. MongoDB ───────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "[1/3] Installing MongoDB..." -ForegroundColor Yellow

if (-not (Get-Command mongod -ErrorAction SilentlyContinue)) {
    winget install MongoDB.Server --silent --accept-package-agreements --accept-source-agreements
} else {
    Write-Host "  MongoDB sudah terinstall, skip."
}

# Ensure data directory exists
if (-not (Test-Path $MONGO_DATA_DIR)) {
    New-Item -ItemType Directory -Path $MONGO_DATA_DIR -Force | Out-Null
    Write-Host "  Data directory created: $MONGO_DATA_DIR"
}

# Find mongod.cfg
$mongoCfg = $null
if (Test-Path "C:\Program Files\MongoDB\Server\7.0\bin\mongod.cfg") {
    $mongoCfg = "C:\Program Files\MongoDB\Server\7.0\bin\mongod.cfg"
} elseif (Test-Path "C:\Program Files\MongoDB\Server\8.0\bin\mongod.cfg") {
    $mongoCfg = "C:\Program Files\MongoDB\Server\8.0\bin\mongod.cfg"
} else {
    $mongoCfg = Get-ChildItem "C:\Program Files\MongoDB\Server" -Filter "mongod.cfg" -Recurse -ErrorAction SilentlyContinue |
                Select-Object -First 1 -ExpandProperty FullName
}

if ($mongoCfg -and (Test-Path $mongoCfg)) {
    Write-Host "  Config: $mongoCfg"
    $cfg = Get-Content $mongoCfg -Raw

    # Ensure bindIp is 0.0.0.0
    if ($cfg -match 'bindIp:\s*127\.0\.0\.1') {
        $cfg = $cfg -replace 'bindIp:\s*127\.0\.0\.1', 'bindIp: 0.0.0.0'
        Write-Host "  bindIp diupdate ke 0.0.0.0"
    }

    # Ensure dbPath is explicitly set (prevents data loss on service re-register)
    if ($cfg -notmatch 'dbPath:') {
        $cfg = $cfg.TrimEnd() + "`n  dbPath: $MONGO_DATA_DIR"
        Write-Host "  dbPath ditambahkan: $MONGO_DATA_DIR"
    }

    Set-Content $mongoCfg $cfg
} else {
    Write-Host "  WARN: mongod.cfg tidak ditemukan, set bindIp/dbPath manual." -ForegroundColor Yellow
}

# Register + start sebagai Windows service
if (-not (Get-Service -Name MongoDB -ErrorAction SilentlyContinue)) {
    $mongodPath = Get-ChildItem "C:\Program Files\MongoDB\Server" -Filter "mongod.exe" -Recurse |
                  Select-Object -First 1 -ExpandProperty FullName
    if ($mongodPath -and $mongoCfg) {
        & $mongodPath --config $mongoCfg --install
    }
}
Start-Service -Name MongoDB -ErrorAction SilentlyContinue
Set-Service -Name MongoDB -StartupType Automatic

# Wait for MongoDB to be ready
Write-Host "  Menunggu MongoDB siap..." -ForegroundColor Gray
$maxWait = 30
$waited = 0
while ($waited -lt $maxWait) {
    try {
        $result = & mongosh --eval "db.runCommand({ping:1})" --quiet 2>$null
        if ($LASTEXITCODE -eq 0) { break }
    } catch {}
    Start-Sleep -Seconds 1
    $waited++
}
if ($waited -ge $maxWait) {
    Write-Host "  WARN: MongoDB tidak merespon setelah ${maxWait}s" -ForegroundColor Yellow
} else {
    Write-Host "  MongoDB service: running" -ForegroundColor Green
}

# ─── Create MongoDB admin user ────────────────────────────────────────────────
Write-Host ""
Write-Host "[2/3] Creating MongoDB admin user..." -ForegroundColor Yellow

# Check if user already exists
$checkUser = & mongosh --eval "db.getSiblingDB('admin').getUser('$MONGO_ADMIN_USER')" --quiet 2>$null
if ($checkUser -match "null" -or $LASTEXITCODE -ne 0) {
    & mongosh --eval @"
db.getSiblingDB('admin').createUser({
  user: '$MONGO_ADMIN_USER',
  pwd: '$MONGO_ADMIN_PASS',
  roles: [{ role: 'root', db: 'admin' }]
})
"@ --quiet 2>$null
    Write-Host "  User '$MONGO_ADMIN_USER' created" -ForegroundColor Green
} else {
    Write-Host "  User '$MONGO_ADMIN_USER' already exists, skip." -ForegroundColor Gray
}

# ─── Enable MongoDB authentication ────────────────────────────────────────────
Write-Host "  Enabling auth in mongod.cfg..." -ForegroundColor Yellow
if ($mongoCfg -and (Test-Path $mongoCfg)) {
    $cfg = Get-Content $mongoCfg -Raw
    if ($cfg -notmatch 'authorization:\s*enabled') {
        # Add security section with authorization enabled
        if ($cfg -match 'security:') {
            $cfg = $cfg -replace 'security:\s*\n\s*authorization:\s*disabled', 'security:`n  authorization: enabled'
            if ($cfg -notmatch 'authorization:\s*enabled') {
                # Fallback: add authorization line after security:
                $cfg = $cfg -replace 'security:', "security:`n  authorization: enabled"
            }
        } else {
            $cfg = $cfg.TrimEnd() + "`nsecurity:`n  authorization: enabled"
        }
        Set-Content $mongoCfg $cfg
        Write-Host "  Auth enabled — restarting MongoDB..." -ForegroundColor Yellow
        Restart-Service -Name MongoDB -Force
        Start-Sleep -Seconds 3
        Write-Host "  MongoDB restarted with auth enabled" -ForegroundColor Green
    } else {
        Write-Host "  Auth already enabled, skip." -ForegroundColor Gray
    }
}

Write-Host "  MongoDB: running with auth" -ForegroundColor Green

# ─── 3. Mosquitto ────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "[3/3] Installing Mosquitto..." -ForegroundColor Yellow

if (-not (Get-Command mosquitto -ErrorAction SilentlyContinue)) {
    winget install EclipseFoundation.Mosquitto --silent --accept-package-agreements --accept-source-agreements
} else {
    Write-Host "  Mosquitto sudah terinstall, skip."
}

# Config: listen di semua interface
$mosquittoCfg = "C:\Program Files\mosquitto\mosquitto.conf"
if (Test-Path $mosquittoCfg) {
    $cirenConf = @"

# CIREN — listen on all interfaces
listener 1883 0.0.0.0
allow_anonymous true
"@
    # Tambahkan hanya jika belum ada
    $existing = Get-Content $mosquittoCfg -Raw
    if ($existing -notmatch "listener 1883 0\.0\.0\.0") {
        Add-Content $mosquittoCfg $cirenConf
        Write-Host "  mosquitto.conf diupdate: listener 1883 0.0.0.0"
    } else {
        Write-Host "  mosquitto.conf sudah benar, skip."
    }
} else {
    Write-Host "  WARN: mosquitto.conf tidak ditemukan di path default." -ForegroundColor Yellow
}

# Register + start sebagai Windows service
if (-not (Get-Service -Name mosquitto -ErrorAction SilentlyContinue)) {
    & "C:\Program Files\mosquitto\mosquitto.exe" install
}
Start-Service -Name mosquitto -ErrorAction SilentlyContinue
Set-Service -Name mosquitto -StartupType Automatic
Write-Host "  Mosquitto service: running" -ForegroundColor Green

# ─── 4. Windows Firewall ──────────────────────────────────────────────────────
Write-Host ""
Write-Host "[Firewall] Membuka port 27017 (MongoDB) dan 1883 (MQTT)..." -ForegroundColor Yellow
Write-Host "  PERHATIAN: Sebaiknya batasi ke IP tertentu saja!" -ForegroundColor Red

# Hapus rule lama kalau ada, lalu buat baru
Remove-NetFirewallRule -DisplayName "CIREN-MongoDB" -ErrorAction SilentlyContinue
Remove-NetFirewallRule -DisplayName "CIREN-MQTT"    -ErrorAction SilentlyContinue

New-NetFirewallRule -DisplayName "CIREN-MongoDB" -Direction Inbound -Protocol TCP -LocalPort 27017 -Action Allow | Out-Null
New-NetFirewallRule -DisplayName "CIREN-MQTT"    -Direction Inbound -Protocol TCP -LocalPort 1883  -Action Allow | Out-Null

Write-Host "  Port 27017 + 1883 dibuka (semua IP)" -ForegroundColor Green
Write-Host "  Rekomendasi: batasi ke IP lokal kamu di Windows Firewall / panel VPS." -ForegroundColor Yellow

# ─── Done ─────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  Setup complete!"
Write-Host ""
Write-Host "  Cek status service:"
Write-Host "    Get-Service MongoDB"
Write-Host "    Get-Service mosquitto"
Write-Host ""
Write-Host "  Test koneksi dari lokal (dengan auth):"
Write-Host "    mongosh `"mongodb://NIWDBZONE-MongoDB-ROOT:ciren4171@${VPS_IP}:27017/admin`""
Write-Host "    mosquitto_pub -h $VPS_IP -t test -m hello"
Write-Host "════════════════════════════════════════" -ForegroundColor Cyan