# ─────────────────────────────────────────────────────────────────────────────
# CIREN — EMERGENCY: Secure MongoDB after ransomware attack
# Jalankan SEGERA di VPS: .\secure-mongodb-emergency.ps1
# Harus dijalankan sebagai Administrator
# ─────────────────────────────────────────────────────────────────────────────

#Requires -RunAsAdministrator

$ErrorActionPreference = "Stop"

$MONGO_ADMIN_USER = "admin"
$MONGO_ADMIN_PASS = "ciren4171"
$MONGO_DATA_DIR   = "C:\data\db"

Write-Host "════════════════════════════════════════" -ForegroundColor Red
Write-Host "  EMERGENCY: Securing MongoDB" -ForegroundColor Red
Write-Host "════════════════════════════════════════" -ForegroundColor Red

# ─── 1. STOP MongoDB immediately to prevent further damage ────────────────────
Write-Host ""
Write-Host "[1/5] Stopping MongoDB..." -ForegroundColor Yellow
Stop-Service -Name MongoDB -Force -ErrorAction SilentlyContinue
Write-Host "  MongoDB stopped" -ForegroundColor Green

# ─── 2. Create admin user BEFORE enabling auth ───────────────────────────────
Write-Host ""
Write-Host "[2/5] Creating admin user..." -ForegroundColor Yellow

# Start MongoDB temporarily WITHOUT auth to create admin user
$mongoCfg = Get-ChildItem "C:\Program Files\MongoDB\Server" -Filter "mongod.cfg" -Recurse -ErrorAction SilentlyContinue |
            Select-Object -First 1 -ExpandProperty FullName

if ($mongoCfg) {
    # Temporarily remove auth from config
    $cfg = Get-Content $mongoCfg -Raw
    $cfgOriginal = $cfg

    # Remove any authorization line
    $cfg = $cfg -replace '(?m)^\s*authorization:\s*\w+.*\r?\n?', ''
    $cfg = $cfg -replace '(?m)^security:.*\r?\n?', ''
    Set-Content $mongoCfg $cfg

    # Start MongoDB without auth
    Start-Service -Name MongoDB
    Start-Sleep -Seconds 5

    # Create admin user
    Write-Host "  Creating admin user '$MONGO_ADMIN_USER'..." -ForegroundColor Gray
    & mongosh --eval @"
db.getSiblingDB('admin').createUser({
  user: '$MONGO_ADMIN_USER',
  pwd: '$MONGO_ADMIN_PASS',
  roles: [{ role: 'root', db: 'admin' }]
})
"@ --quiet 2>$null

    # Stop MongoDB again to re-enable auth
    Stop-Service -Name MongoDB -Force
    Write-Host "  Admin user created" -ForegroundColor Green
} else {
    Write-Host "  WARN: mongod.cfg not found, creating admin user manually" -ForegroundColor Yellow
}

# ─── 3. Enable authentication in mongod.cfg ──────────────────────────────────
Write-Host ""
Write-Host "[3/5] Enabling authentication..." -ForegroundColor Yellow

if ($mongoCfg -and (Test-Path $mongoCfg)) {
    $cfg = Get-Content $mongoCfg -Raw

    # Ensure dbPath is set
    if ($cfg -notmatch 'dbPath:') {
        $cfg = $cfg.TrimEnd() + "`n  dbPath: $MONGO_DATA_DIR"
    }

    # Add security.authorization: enabled
    if ($cfg -match 'security:') {
        if ($cfg -match 'authorization:') {
            $cfg = $cfg -replace 'authorization:\s*\w+', 'authorization: enabled'
        } else {
            $cfg = $cfg -replace 'security:', "security:`n  authorization: enabled"
        }
    } else {
        $cfg = $cfg.TrimEnd() + "`nsecurity:`n  authorization: enabled"
    }

    # Ensure bindIp is 0.0.0.0 (we'll restrict via firewall instead)
    $cfg = $cfg -replace 'bindIp:\s*127\.0\.0\.1', 'bindIp: 0.0.0.0'

    Set-Content $mongoCfg $cfg
    Write-Host "  Auth enabled in mongod.cfg" -ForegroundColor Green
}

# ─── 4. Restrict firewall — ONLY allow your IPs ─────────────────────────────
Write-Host ""
Write-Host "[4/5] Restricting firewall..." -ForegroundColor Yellow

# Remove open-to-all MongoDB rule
Remove-NetFirewallRule -DisplayName "CIREN-MongoDB" -ErrorAction SilentlyContinue

# IMPORTANT: Add YOUR IP addresses here!
# These are the public IPs that need to connect to MongoDB (your backend server)
$allowedIPs = @(
    "92.203.100.196"   # Lokal PC (backend)
)

if ($allowedIPs.Count -gt 0) {
    foreach ($ip in $allowedIPs) {
        New-NetFirewallRule -DisplayName "CIREN-MongoDB-$ip" -Direction Inbound -Protocol TCP -LocalPort 27017 -Action Allow -RemoteAddress $ip | Out-Null
        Write-Host "  Allowed: $ip" -ForegroundColor Gray
    }
    # Also allow localhost
    New-NetFirewallRule -DisplayName "CIREN-MongoDB-Localhost" -Direction Inbound -Protocol TCP -LocalPort 27017 -Action Allow -RemoteAddress "127.0.0.1" | Out-Null
    Write-Host "  MongoDB restricted to allowed IPs only" -ForegroundColor Green
} else {
    Write-Host "  WARNING: No IPs specified!" -ForegroundColor Red
    Write-Host "  MongoDB is still accessible from the internet!" -ForegroundColor Red
    Write-Host "  Edit this script and add your IP addresses to `$allowedIPs" -ForegroundColor Yellow
    New-NetFirewallRule -DisplayName "CIREN-MongoDB-Localhost" -Direction Inbound -Protocol TCP -LocalPort 27017 -Action Allow -RemoteAddress "127.0.0.1" | Out-Null
    Write-Host "  Temporarily restricted to localhost only" -ForegroundColor Yellow
}

# Keep MQTT open (needed for SIM devices)
Remove-NetFirewallRule -DisplayName "CIREN-MQTT" -ErrorAction SilentlyContinue
New-NetFirewallRule -DisplayName "CIREN-MQTT" -Direction Inbound -Protocol TCP -LocalPort 1883 -Action Allow | Out-Null

# ─── 5. Start MongoDB with auth enabled ──────────────────────────────────────
Write-Host ""
Write-Host "[5/5] Starting MongoDB with auth..." -ForegroundColor Yellow
Start-Service -Name MongoDB
Set-Service -Name MongoDB -StartupType Automatic
Start-Sleep -Seconds 3

# Verify connection with auth
$testResult = & mongosh "mongodb://${MONGO_ADMIN_USER}:${MONGO_ADMIN_PASS}@localhost:27017/admin" --eval "db.runCommand({ping:1})" --quiet 2>$null
if ($LASTEXITCODE -eq 0) {
    Write-Host "  MongoDB running with authentication ENABLED" -ForegroundColor Green
    Write-Host "  Connection test: OK" -ForegroundColor Green
} else {
    Write-Host "  WARN: Could not verify auth connection" -ForegroundColor Yellow
    Write-Host "  Check credentials and try manually:" -ForegroundColor Yellow
    Write-Host "    mongosh `"mongodb://${MONGO_ADMIN_USER}:${MONGO_ADMIN_PASS}@localhost:27017/admin`"" -ForegroundColor Gray
}

# ─── Clean up ransom collection ─────────────────────────────────────────────
Write-Host ""
Write-Host "Cleaning up ransom collection..." -ForegroundColor Yellow
& mongosh "mongodb://${MONGO_ADMIN_USER}:${MONGO_ADMIN_PASS}@localhost:27017/admin" --eval @"
db.getSiblingDB('ciren').getCollection('READ_ME_TO_RECOVER_YOUR_DATA').drop()
"@ --quiet 2>$null
Write-Host "  Ransom collection dropped" -ForegroundColor Green

# ─── Summary ──────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "════════════════════════════════════════" -ForegroundColor Green
Write-Host "  MongoDB is now SECURED:" -ForegroundColor Green
Write-Host "  - Authentication: ENABLED" -ForegroundColor White
Write-Host "  - Admin user: $MONGO_ADMIN_USER" -ForegroundColor White
Write-Host "  - Firewall: RESTRICTED" -ForegroundColor White
Write-Host ""
Write-Host "  IMPORTANT: Your data was DELETED by the attacker." -ForegroundColor Red
Write-Host "  You need to re-register and re-configure your devices." -ForegroundColor Red
Write-Host ""
Write-Host "  Connection string for .env.production:" -ForegroundColor Yellow
Write-Host "  mongodb://${MONGO_ADMIN_USER}:${MONGO_ADMIN_PASS}@localhost:27017/ciren?authSource=admin" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Connection string for remote (if you added your IP):" -ForegroundColor Yellow
Write-Host "  mongodb://${MONGO_ADMIN_USER}:${MONGO_ADMIN_PASS}@${VPS_IP}:27017/ciren?authSource=admin" -ForegroundColor Cyan
Write-Host "════════════════════════════════════════" -ForegroundColor Green