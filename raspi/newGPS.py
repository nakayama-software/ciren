#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Sistem GPS Full Python (Raspberry Pi + SIMHAT)
-------------------------------------------------
- Membaca data GPS (NMEA) dari port serial SIMHAT (mis. /dev/ttyUSB0)
- Menyediakan web server Flask berisi peta Leaflet
- Marker otomatis update posisi setiap beberapa detik
"""

import threading
import time
import re
import serial
from flask import Flask, jsonify, render_template_string

# =============================================
# KONFIGURASI
# =============================================
SERIAL_PORT = "/dev/ttyUSB0"  # ubah sesuai port SIMHAT kamu
BAUD_RATE = 9600

# posisi awal (Jakarta)
gps_data = {"lat": -6.200000, "lon": 106.816666, "fix_time": None}

# =============================================
# Fungsi bantu parsing NMEA
# =============================================

def dm_to_deg(dm_str, hemi):
    """Konversi derajat-menit NMEA (DDMM.MMMM) → derajat desimal."""
    if not dm_str or not hemi:
        return None
    try:
        if "." not in dm_str:
            return None
        head, tail = dm_str.split(".", 1)
        mins_frac = float("0." + tail)
        mins_int = int(head[-2:])
        degs = int(head[:-2]) if head[:-2] else 0
        minutes = mins_int + mins_frac
        val = degs + minutes / 60.0
        if hemi in ("S", "W"):
            val = -val
        return val
    except Exception:
        return None

def parse_nmea(line: str):
    """Parse kalimat NMEA untuk ambil latitude/longitude."""
    global gps_data
    if not line.startswith("$"):
        return
    parts = line.strip().split(",")
    if len(parts) < 6:
        return
    # contoh: $GNRMC,070559.00,A,0613.1234,S,10649.5678,E,...
    if parts[0].endswith("RMC") and parts[2] == "A":
        lat = dm_to_deg(parts[3], parts[4])
        lon = dm_to_deg(parts[5], parts[6])
        if lat and lon:
            gps_data["lat"] = lat
            gps_data["lon"] = lon
            gps_data["fix_time"] = time.strftime("%Y-%m-%d %H:%M:%S")
            print(f"[GPS] {lat:.6f}, {lon:.6f}")

# =============================================
# Thread pembaca serial
# =============================================

def gps_reader():
    """Membaca data NMEA dari SIMHAT terus-menerus."""
    global gps_data
    buf = ""
    while True:
        try:
            with serial.Serial(SERIAL_PORT, BAUD_RATE, timeout=1) as ser:
                print(f"[INFO] Terhubung ke {SERIAL_PORT} @ {BAUD_RATE}")
                while True:
                    data = ser.readline().decode(errors="ignore").strip()
                    if data.startswith("$GN") or data.startswith("$GP"):
                        parse_nmea(data)
        except serial.SerialException as e:
            print(f"[WARN] Port tidak tersedia: {e}")
            time.sleep(3)
        except Exception as e:
            print(f"[ERROR] {e}")
            time.sleep(3)

# =============================================
# Web Server (Flask + Leaflet)
# =============================================

app = Flask(__name__)

# Template HTML dengan Leaflet
PAGE_TEMPLATE = """
<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="utf-8" />
<title>GPS Tracker SIMHAT</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link
  rel="stylesheet"
  href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
/>
<style>
  html, body { height: 100%; margin: 0; }
  #map { height: 100vh; }
  .info {
    position: absolute; top: 10px; left: 10px;
    background: white; padding: 8px 12px;
    border-radius: 5px; box-shadow: 0 2px 5px rgba(0,0,0,0.3);
    font-family: sans-serif;
  }
</style>
</head>
<body>
<div id="map"></div>
<div class="info">
  <b>Koordinat:</b> <span id="coords">Menunggu data...</span>
</div>

<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
  const map = L.map('map').setView([-6.2, 106.8], 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap'
  }).addTo(map);

  const marker = L.marker([-6.2, 106.8]).addTo(map);
  const coordsText = document.getElementById("coords");

  async function updateGPS() {
    const res = await fetch("/api/pos");
    const data = await res.json();
    const lat = data.lat, lon = data.lon;
    marker.setLatLng([lat, lon]);
    map.setView([lat, lon]);
    coordsText.textContent = `${lat.toFixed(6)}, ${lon.toFixed(6)} | ${data.fix_time}`;
  }

  setInterval(updateGPS, 3000);
  updateGPS();
</script>
</body>
</html>
"""

@app.route("/")
def index():
    return render_template_string(PAGE_TEMPLATE)

@app.route("/api/pos")
def api_pos():
    return jsonify(gps_data)

# =============================================
# Main
# =============================================
if __name__ == "__main__":
    # Jalankan thread pembaca GPS
    t = threading.Thread(target=gps_reader, daemon=True)
    t.start()

    print("[INFO] Menjalankan web server di http://0.0.0.0:5000")
    app.run(host="0.0.0.0", port=5000, debug=False)
