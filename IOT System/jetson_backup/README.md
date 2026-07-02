# CIREN Backup Reader (Jetson)

Backup sensor data dari main module MM-DB59B0 via USB serial.

## Setup

### 1. Hubungkan ESP32-S3 ke Jetson via USB

ESP32-S3 akan muncul sebagai serial device:
```bash
ls /dev/ttyACM*   # biasanya /dev/ttyACM0
```

### 2. Install dependency

```bash
pip3 install pyserial
```

### 3. Run

```bash
# Auto-detect port
python3 backup_reader.py

# Specify port
python3 backup_reader.py --port /dev/ttyACM0

# Tanpa raw log file
python3 backup_reader.py --no-log
```

### 4. Run sebagai service (opsional)

```bash
# Buat systemd service
sudo tee /etc/systemd/system/ciren-backup.service << 'EOF'
[Unit]
Description=CIREN Backup Reader
After=multi-user.target

[Service]
ExecStart=/usr/bin/python3 /path/to/backup_reader.py --port /dev/ttyACM0
Restart=always
RestartSec=10
User=jetson

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable ciren-backup
sudo systemctl start ciren-backup

# Cek status
sudo systemctl status ciren-backup

# Cek log
journalctl -u ciren-backup -f
```

## Database

Data disimpan di `ciren_backup.db` (SQLite):

```sql
-- Lihat data terbaru
SELECT * FROM sensor_data ORDER BY id DESC LIMIT 20;

-- Lihat data per controller per jam
SELECT
  ctrl_id,
  sensor_name,
  COUNT(*) as readings,
  MIN(value) as min_val,
  MAX(value) as max_val,
  AVG(value) as avg_val
FROM sensor_data
WHERE received_at > datetime('now', '-1 hour')
GROUP BY ctrl_id, sensor_name;

-- Export CSV
sqlite3 ciren_backup.db -header -csv \
  "SELECT * FROM sensor_data WHERE date(received_at) = date('now');" > today.csv
```

## Format Serial

```
[RX] ctrl=1 port=1 stype=0x01 val=25.5882 ftype=0x05 ts=1782829887
[RX] ctrl=1 port=1 stype=0x02 val=63.5485 ftype=0x05 ts=1782829887
[RX] ctrl=2 port=1 stype=0x01 val=26.3546 ftype=0x05 ts=1782829889
```

| Field | Keterangan |
|-------|-----------|
| ctrl | Controller ID |
| port | Port number |
| stype | Sensor type: 0x01=temperature, 0x02=humidity |
| val | Sensor value |
| ftype | Frame type: 0x05=DATA |
| ts | Epoch seconds (NTP-synced), atau kosong jika belum sync |