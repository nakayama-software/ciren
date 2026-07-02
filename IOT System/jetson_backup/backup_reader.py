#!/usr/bin/env python3
"""
CIREN Main Module Backup Reader
================================
Reads sensor data from ESP32-S3 via USB serial and stores to SQLite.
Designed for 1 device (MM-DB59B0) as local backup.

Usage:
  python3 backup_reader.py                       # auto-detect serial port
  python3 backup_reader.py --port /dev/ttyACM0    # specify port
  python3 backup_reader.py --port /dev/ttyUSB0    # specify port

The ESP32-S3 outputs [RX] lines like:
  [RX] ctrl=1 port=1 stype=0x01 val=25.5882 ftype=0x05 ts=1782829887

This script parses those lines and stores them in SQLite.
Other serial output (logs, status, etc.) is optionally saved to a log file.
"""

import serial
import sqlite3
import re
import time
import signal
import sys
import os
from datetime import datetime, timezone

# ── Configuration ──────────────────────────────────────────────────────────────
DEVICE_ID = "MM-DB59B0"
BAUD_RATE = 115200
DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ciren_backup.db")
LOG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "serial_log.txt")

SENSOR_NAMES = {
    0x01: "temperature",
    0x02: "humidity",
}

# ── Serial port auto-detection ────────────────────────────────────────────────
def find_serial_port():
    """Try common serial port paths for ESP32-S3 USB CDC."""
    candidates = [
        "/dev/ttyACM0",     # USB CDC (most common for ESP32-S3)
        "/dev/ttyACM1",
        "/dev/ttyUSB0",     # USB-Serial bridge
        "/dev/ttyUSB1",
        "/dev/serial0",     # Raspberry Pi / Jetson serial
        "COM71"
    ]
    for port in candidates:
        if os.path.exists(port):
            return port
    return None

# ── Database ───────────────────────────────────────────────────────────────────
def init_db():
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS sensor_data (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id TEXT NOT NULL,
            ctrl_id INTEGER NOT NULL,
            port_num INTEGER NOT NULL,
            sensor_type INTEGER NOT NULL,
            sensor_name TEXT,
            value REAL NOT NULL,
            device_ts INTEGER,
            received_at TEXT NOT NULL,
            created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        )
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_sensor_data_ts
        ON sensor_data (device_id, ctrl_id, sensor_type, received_at)
    """)
    conn.commit()
    return conn

# ── Parser ────────────────────────────────────────────────────────────────────
# Match: [RX] ctrl=1 port=1 stype=0x01 val=25.5882 ftype=0x05 ts=1782829887
# ts= is optional (added in newer firmware, falls back to Jetson time)
RX_PATTERN = re.compile(
    r'\[RX\]\s+ctrl=(\d+)\s+port=(\d+)\s+stype=(0x[0-9a-fA-F]+)\s+val=([\d.]+)\s+ftype=(0x[0-9a-fA-F]+)(?:\s+ts=(\d+))?'
)

def parse_rx_line(line):
    """Parse [RX] line, return dict or None."""
    m = RX_PATTERN.match(line)
    if not m:
        return None
    device_ts = int(m.group(6)) if m.group(6) else None
    stype = int(m.group(3), 16)
    return {
        "ctrl_id": int(m.group(1)),
        "port_num": int(m.group(2)),
        "sensor_type": stype,
        "sensor_name": SENSOR_NAMES.get(stype, f"unknown_0x{stype:02x}"),
        "value": float(m.group(4)),
        "device_ts": device_ts,
    }

# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    import argparse
    parser = argparse.ArgumentParser(description="CIREN backup reader")
    parser.add_argument("--port", "-p", help="Serial port (auto-detect if not specified)")
    parser.add_argument("--no-log", action="store_true", help="Don't save raw serial to log file")
    args = parser.parse_args()

    port = args.port or find_serial_port()
    if not port:
        print("[ERROR] No serial port found. Specify with --port")
        sys.exit(1)

    conn = init_db()
    print(f"[Backup] Database: {DB_PATH}")
    print(f"[Backup] Serial: {port} @ {BAUD_RATE}")
    print(f"[Backup] Device: {DEVICE_ID}")
    print(f"[Backup] Waiting for data... (Ctrl+C to stop)")
    print()

    log_file = None if args.no_log else open(LOG_PATH, "a", encoding="utf-8")

    count = 0
    ser = None
    running = True

    def handle_signal(sig, frame):
        nonlocal running
        running = False
    signal.signal(signal.SIGINT, handle_signal)

    while running:
        try:
            if ser is None or not ser.is_open:
                try:
                    ser = serial.Serial(port, BAUD_RATE, timeout=1)
                    print(f"[Backup] Connected to {port}")
                except serial.SerialException as e:
                    print(f"[Backup] Cannot open {port}: {e}. Retrying in 5s...")
                    time.sleep(5)
                    continue

            line_bytes = ser.readline()
            if not line_bytes:
                continue

            try:
                line = line_bytes.decode("utf-8", errors="ignore").strip()
            except Exception:
                continue

            if not line:
                continue

            # Save raw log
            if log_file:
                ts_str = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
                log_file.write(f"{ts_str} {line}\n")
                log_file.flush()

            # Try to parse [RX] line
            data = parse_rx_line(line)
            if data:
                now_utc = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
                device_ts = data["device_ts"]  # may be None if old firmware

                conn.execute(
                    """INSERT INTO sensor_data
                       (device_id, ctrl_id, port_num, sensor_type, sensor_name, value, device_ts, received_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                    (DEVICE_ID, data["ctrl_id"], data["port_num"], data["sensor_type"],
                     data["sensor_name"], data["value"], device_ts, now_utc)
                )
                conn.commit()
                count += 1
                ts_display = f"ts={device_ts}" if device_ts else f"rx={now_utc}"
                print(f"  #{count:4d}  ctrl={data['ctrl_id']}  {data['sensor_name']:12s}={data['value']:7.2f}  {ts_display}")

        except serial.SerialException:
            print("[Backup] Serial disconnected. Reconnecting in 5s...")
            try:
                if ser and ser.is_open:
                    ser.close()
            except:
                pass
            ser = None
            time.sleep(5)

        except Exception as e:
            print(f"[Backup] Error: {e}")
            time.sleep(1)

    print(f"\n[Backup] Stopped. {count} readings saved to {DB_PATH}")

    if log_file:
        log_file.close()
    if conn:
        conn.close()
    if ser and ser.is_open:
        ser.close()


if __name__ == "__main__":
    main()