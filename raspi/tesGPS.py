#!/usr/bin/env python3
"""
sim7600_gps_poster.py
- Polls SIM7600 GNSS via AT commands over serial
- Posts JSON { lat, lon, alt, utc, speed, heading, raw } to your server
- Robust: autodetects serial device, retries, logs
"""

import time
import serial
import json
import requests
from datetime import datetime

# Configure these
DEVICE_CANDIDATES = ["/dev/ttyUSB2", "/dev/ttyUSB1", "/dev/ttyUSB0", "/dev/serial0"]
BAUD = 115200
SERVER_URL = "https://your.server.example/api/gps"   # <-- change to your endpoint
POLL_INTERVAL = 10      # seconds between successful posts
GNSS_ENABLE_CMD = "AT+CGPS=1"
GNSS_DISABLE_CMD = "AT+CGPS=0"
GET_GPS_INFO = "AT+CGPSINFO"

# Low-level serial helper
def open_serial(dev):
    try:
        s = serial.Serial(dev, BAUD, timeout=2)
        # flush I/O
        s.reset_input_buffer()
        s.reset_output_buffer()
        return s
    except Exception as e:
        print(f"[open_serial] failed to open {dev}: {e}")
        return None

def try_open_any():
    for dev in DEVICE_CANDIDATES:
        s = open_serial(dev)
        if s:
            print(f"[serial] opened {dev}")
            return s, dev
    raise RuntimeError("no serial device available; check connections")

def at_request(ser, cmd, wait=1.0, read_lines=8):
    """
    send AT command and read response lines (stripped)
    cmd: 'AT' or 'AT+CGPSINFO'
    """
    ser.write((cmd + "\r\n").encode('utf-8'))
    ser.flush()
    time.sleep(wait)
    out = []
    # read available lines up to read_lines
    for _ in range(read_lines):
        try:
            line = ser.readline().decode('utf-8', errors='ignore').strip()
        except Exception:
            break
        if line:
            out.append(line)
    return out

def ensure_at_ok(ser):
    for _ in range(3):
        out = at_request(ser, "AT", wait=0.3, read_lines=2)
        if any("OK" in l for l in out):
            return True
    return False

def enable_gnss(ser):
    print("[gnss] enabling GNSS")
    out = at_request(ser, GNSS_ENABLE_CMD, wait=0.5, read_lines=4)
    print("[gnss] ->", out)
    return any("OK" in l for l in out)

def read_cgpsinfo(ser):
    """
    Query AT+CGPSINFO and parse. Example responses you may see:
    +CGPSINFO: 3723.2475,N,12158.3416,W,201116,152345.000,10.0,0.0
    OR sometimes: +CGPSINFO: ,,,,,,,,
    We'll be defensive parsing.
    """
    out = at_request(ser, GET_GPS_INFO, wait=0.5, read_lines=6)
    raw = "\n".join(out)
    # find a line that starts with +CGPSINFO
    line = next((l for l in out if l.startswith("+CGPSINFO")), None)
    if not line:
        # maybe module outputs NMEA to a different port; return raw for debugging
        return None, raw
    # strip prefix
    payload = line.split(":", 1)[1].strip()
    if not payload or payload.startswith(",") and payload.count(",") >= 6 and payload.replace(",", "").strip() == "":
        return None, raw  # no fix
    fields = [f.strip() for f in payload.split(",")]
    # fields: lat (DDMM.MMMM), N/S, lon DDDMM.MMMM, E/W, date, time, altitude, speed, heading etc (SIM var.)
    try:
        lat_raw, lat_ns, lon_raw, lon_ew = fields[0], fields[1], fields[2], fields[3]
    except Exception:
        return None, raw

    def dm_to_dec(dm, hemi):
        # dm like DDMM.MMMM or DDDMM.MMMM
        if not dm:
            return None
        try:
            if "." not in dm:
                return None
            parts = dm.split(".")
            whole = parts[0]
            deg_len = 2 if len(whole) <= 4 else 3
            deg = int(whole[:deg_len])
            minutes = float(whole[deg_len:] + "." + parts[1])
            dec = deg + minutes / 60.0
            if hemi in ("S", "W"):
                dec = -dec
            return dec
        except Exception:
            return None

    lat = dm_to_dec(lat_raw, lat_ns) if lat_raw else None
    lon = dm_to_dec(lon_raw, lon_ew) if lon_raw else None

    alt = None
    speed = None
    heading = None
    # attempt to read alt/speed/heading if present
    try:
        if len(fields) >= 7:
            # SIM's order may vary; best-effort:
            # fields[4] date, fields[5] time, fields[6] altitude
            alt = float(fields[6]) if fields[6] else None
        if len(fields) >= 8:
            speed = float(fields[7]) if fields[7] else None
        if len(fields) >= 9:
            heading = float(fields[8]) if fields[8] else None
    except Exception:
        pass

    # try to produce UTC timestamp from date/time fields if available
    utc_ts = None
    try:
        if len(fields) >= 6 and fields[4] and fields[5]:
            # date: ddmmyy, time: hhmmss.sss
            d = fields[4]
            t = fields[5].split(".")[0]
            dt = datetime.strptime(d + t, "%d%m%y%H%M%S")
            utc_ts = dt.isoformat() + "Z"
    except Exception:
        utc_ts = None

    return {
        "lat": lat,
        "lon": lon,
        "alt": alt,
        "speed": speed,
        "heading": heading,
        "utc": utc_ts,
        "raw_line": payload,
    }, raw

def post_to_server(body):
    try:
        r = requests.post(SERVER_URL, json=body, timeout=8)
        r.raise_for_status()
        print("[post] ok", r.status_code)
        return True
    except Exception as e:
        print("[post] failed:", e)
        return False

def main_loop():
    ser, dev = try_open_any()
    if not ensure_at_ok(ser):
        print("[error] module not responding to AT")
        return 1

    if not enable_gnss(ser):
        print("[warn] enabling GNSS didn't return OK — still continuing")

    print("[main] polling GNSS every", POLL_INTERVAL, "s")
    try:
        while True:
            parsed, raw = read_cgpsinfo(ser)
            if parsed and parsed["lat"] is not None and parsed["lon"] is not None:
                payload = {
                    "device": dev,
                    "received_at": datetime.utcnow().isoformat() + "Z",
                    "position": {
                        "lat": parsed["lat"],
                        "lon": parsed["lon"],
                        "alt": parsed.get("alt"),
                        "speed": parsed.get("speed"),
                        "heading": parsed.get("heading"),
                        "utc": parsed.get("utc"),
                    },
                    "raw": parsed.get("raw_line"),
                }
                print("[gps] fix:", json.dumps(payload["position"]))
                ok = post_to_server(payload)
                if ok:
                    time.sleep(POLL_INTERVAL)
                else:
                    # backoff on post failure
                    time.sleep(10)
            else:
                print("[gps] no fix yet; raw response:", raw.strip().replace("\n", " | "))
                time.sleep(3)
    except KeyboardInterrupt:
        print("shutting down...")
    finally:
        try:
            ser.write((GNSS_DISABLE_CMD + "\r\n").encode())
            ser.close()
        except Exception:
            pass

if __name__ == "__main__":
    main_loop()
