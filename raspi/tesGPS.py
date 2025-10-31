#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Raspberry Pi → Express Server sender (dengan GPS realtime siap pakai)

Fitur:
- Deteksi otomatis port ESP32 Receiver (USB) dan reconnect jika lepas/pasang.
- Baca baris bertanda "[FOR_PI]{...json...}" dari receiver → antri → POST ke server.
- Mendukung NMEA GPS:
    a) Langsung dari RasPi (UART/USB) autodetect atau set ENV GPS_PORT.
    b) Dari ESP32 jika mengirim NMEA mentah dengan prefix "[GPS]$....".
- Parser NMEA (RMC/GGA) → lat, lon, alt, speed_kmh, course_deg, sats, hdop.
- Kirim payload "GPS_FIX" lengkap dengan GeoJSON Point agar gampang dipakai MongoDB/PostGIS/Leaflet.
- Heartbeat ke receiver tiap N detik: "[SVROK]\\n".
- Kirim serial number Raspberry ke receiver berkala untuk ditampilkan.
- Push metrik sistem "RASPI_SYS" (suhu CPU, uptime, load, mem) berkala → ke server.
- Logging rapi + shutdown mulus (Ctrl+C).

ENV (opsional):
  VPS_API_URL=http://<host>:<port>/api/iot-data
  LOG_LEVEL=INFO|DEBUG
  BAUD_RATE=115200                 # ESP32
  SERIAL_DETECT_INTERVAL_S=3
  REQUEST_TIMEOUT_S=5
  HTTP_MAX_RETRY=3

  # GPS
  GPS_ENABLED=1                    # 0 untuk mematikan reader GPS lokal
  GPS_PORT=/dev/ttyAMA0            # atau /dev/ttyUSB1 (kosongkan untuk autodetect)
  GPS_BAUD=9600
  GPS_DETECT_INTERVAL_S=3
  GPS_PUSH_EVERY_FIX=1             # 1: kirim tiap fix; 0: kirim per interval
  GPS_POST_INTERVAL_S=2            # jika interval
  GPS_MIN_SATS=3
  GPS_MIN_HDOP=10
  GPS_MAX_AGE_S=5
"""

from __future__ import annotations
import os
import sys
import re
import time
import json
import signal
import logging
import threading
from dataclasses import dataclass
from queue import Queue, Full, Empty
from datetime import datetime
from typing import Optional, Dict, Any, Tuple

# --- optional deps ---
try:
    import psutil  # type: ignore
except Exception:
    psutil = None  # graceful fallback tanpa mem metrics

import requests
import serial  # pyserial
from serial.tools import list_ports  # type: ignore
import subprocess

# ===================== Logging =====================
LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO").upper()
logging.basicConfig(
    level=LOG_LEVEL,
    format="%(asctime)s.%(msecs)03d %(levelname)s [%(threadName)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("raspi-sender")

# ===================== Config ======================
@dataclass(frozen=True)
class Config:
    # ESP32 receiver
    baud_rate: int = int(os.environ.get("BAUD_RATE", "115200"))
    request_timeout: int = int(os.environ.get("REQUEST_TIMEOUT_S", "5"))
    http_max_retry: int = int(os.environ.get("HTTP_MAX_RETRY", "3"))
    serial_detect_interval: float = float(os.environ.get("SERIAL_DETECT_INTERVAL_S", "3"))
    vps_api_url: str = os.environ.get("VPS_API_URL", "http://127.0.0.1:3000/api/iot-data")
    vps_api_url: str = os.environ.get("VPS_API_URL", "http://192.168.103.174:3000/api/iot-data")

    # intervals
    heartbeat_to_receiver_sec: float = float(os.environ.get("HB_TO_RX_S", "5"))
    push_sys_metrics_sec: float = float(os.environ.get("PUSH_SYS_METRICS_S", "5"))
    send_pi_serial_sec: float = float(os.environ.get("SEND_PI_SERIAL_S", "30"))

    # queue
    queue_maxsize: int = int(os.environ.get("QUEUE_MAXSIZE", "2000"))

    # GPS (NMEA langsung di RasPi)
    gps_enabled: bool = os.environ.get("GPS_ENABLED", "1") not in ("0", "false", "False", "")
    gps_port: Optional[str] = os.environ.get("GPS_PORT")
    gps_baud: int = int(os.environ.get("GPS_BAUD", "9600"))
    gps_detect_interval: float = float(os.environ.get("GPS_DETECT_INTERVAL_S", "3"))
    gps_push_every_fix: bool = os.environ.get("GPS_PUSH_EVERY_FIX", "1") not in ("0", "false", "False", "")
    gps_post_interval_sec: float = float(os.environ.get("GPS_POST_INTERVAL_S", "2"))
    gps_min_sats: int = int(os.environ.get("GPS_MIN_SATS", "3"))
    gps_max_age_s: float = float(os.environ.get("GPS_MAX_AGE_S", "5"))
    gps_min_hdop: float = float(os.environ.get("GPS_MIN_HDOP", "10"))

CFG = Config()

# ================== Globals/State ==================
STOP = threading.Event()        # sinyal shutdown
SER_HANDLE: Optional[serial.Serial] = None
SER_LOCK = threading.Lock()
HTTP_SESSION = requests.Session()

DATA_QUEUE: "Queue[Dict[str, Any]]" = Queue(maxsize=CFG.queue_maxsize)
PI_SERIAL: str = "UNKNOWN_PI"

# State GPS terbaru (dari NMEA RasPi atau [GPS] dari ESP32)
LATEST_GPS_LOCK = threading.Lock()
LATEST_GPS: Dict[str, Any] = {}  # keys: lat, lon, alt, course_deg, speed_kmh, sats, hdop, ts_epoch

# ================== Helpers =======================
def detect_serial_port() -> Optional[str]:
    """Cari port USB ESP32 receiver. Kembalikan path atau None."""
    for p in list_ports.comports():
        dev = p.device.lower()
        if any(tag in dev for tag in ("ttyusb", "ttyacm", "cu.usbserial", "cu.usbmodem")):
            # hindari bentrok dengan port GPS jika sama
            if CFG.gps_port and dev == CFG.gps_port.lower():
                continue
            log.info(f"[FOUND] ESP32 receiver at {p.device}")
            return p.device
    log.debug("No ESP32 serial yet...")
    return None

def detect_gps_port() -> Optional[str]:
    """Deteksi port GPS NMEA. Hormati CFG.gps_port bila diset."""
    if CFG.gps_port and os.path.exists(CFG.gps_port):
        return CFG.gps_port
    # heuristik: cari port serial lain yang bukan ESP32 (ttyAMA0/ttyS0/ttyUSBx) atau ada 'gps' di deskripsi
    for p in list_ports.comports():
        dev = p.device
        desc = (p.description or "").lower()
        esp_port = None
        with SER_LOCK:
            esp_port = SER_HANDLE.port if SER_HANDLE else None
        if esp_port and dev == esp_port:
            continue  # jangan pakai port ESP32
        if re.search(r"(ttyama|ttys0|ttyusb)", dev.lower()) or "gps" in desc:
            return dev
    return None

def get_pi_serial() -> str:
    for path in ("/sys/firmware/devicetree/base/serial-number",
                 "/proc/device-tree/serial-number"):
        try:
            with open(path, "r") as f:
                s = f.read().strip().strip("\x00")
                if s:
                    return s
        except Exception:
            pass
    # fallback /proc/cpuinfo
    try:
        with open("/proc/cpuinfo") as f:
            for line in f:
                if line.lower().startswith("serial"):
                    return line.split(":")[1].strip()
    except Exception:
        pass
    return "UNKNOWN_PI"

def _dm_to_deg(dm_str: str, hemi: str) -> Optional[float]:
    """Konversi derajat-menit (DDMM.MMMM / DDDMM.MMMM) → derajat desimal."""
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

def parse_nmea(line: str) -> Dict[str, Any]:
    """
    Parse subset NMEA:
      - RMC: posisi, speed(knots) → km/h, course
      - GGA: altitude, satelit, HDOP
    Kembalikan partial dict; caller akan merge & validasi.
    """
    out: Dict[str, Any] = {}
    if not line.startswith("$"):
        return out
    # buang checksum
    if "*" in line:
        line = line.split("*", 1)[0]
    parts = line.split(",")
    # contoh header: $GNRMC / $GPRMC / $GNGGA / $GPGGA
    typ = parts[0][3:] if len(parts[0]) >= 6 else parts[0]

    if typ in ("RMC", "GPRMC", "GNRMC"):
        # $..RMC,hhmmss.sss,A,llll.ll,a,yyyyy.yy,a,x.x,x.x,ddmmyy,,,A
        if len(parts) >= 12 and parts[2] == "A":
            lat = _dm_to_deg(parts[3], parts[4])  # llll.ll, N/S
            lon = _dm_to_deg(parts[5], parts[6])  # yyyyy.yy, E/W
            spd_kn = float(parts[7]) if parts[7] else 0.0
            crs = float(parts[8]) if parts[8] else None
            out.update({
                "lat": lat, "lon": lon,
                "speed_kmh": spd_kn * 1.852,
                "course_deg": crs,
            })
    elif typ in ("GGA", "GPGGA", "GNGGA"):
        # $..GGA,hhmmss,lat,N,lon,E,fix,sats,hdop,alt,M,geoid,...
        if len(parts) >= 10:
            lat = _dm_to_deg(parts[2], parts[3]) if parts[2] and parts[3] else None
            lon = _dm_to_deg(parts[4], parts[5]) if parts[4] and parts[5] else None
            fix = int(parts[6]) if parts[6].isdigit() else 0
            sats = int(parts[7]) if parts[7].isdigit() else None
            hdop = float(parts[8]) if parts[8] else None
            alt = float(parts[9]) if parts[9] else None
            if fix > 0:
                out.update({"lat": lat, "lon": lon, "alt": alt, "sats": sats, "hdop": hdop})
    return out

def get_raspi_cpu_temp_c() -> Optional[float]:
    """Ambil suhu CPU RasPi (°C). Prefer vcgencmd; fallback thermal_zone0."""
    # vcgencmd
    try:
        out = subprocess.check_output(["vcgencmd", "measure_temp"], text=True).strip()
        # contoh: temp=48.0'C
        if out.startswith("temp=") and out.endswith("'C"):
            return float(out[5:-2])
    except Exception:
        pass
    # fallback thermal_zone0
    try:
        with open("/sys/class/thermal/thermal_zone0/temp") as f:
            return int(f.read().strip()) / 1000.0
    except Exception:
        return None

def get_uptime_s() -> Optional[float]:
    try:
        with open("/proc/uptime") as f:
            return float(f.read().split()[0])
    except Exception:
        return None

def get_loadavg() -> Tuple[Optional[float], Optional[float], Optional[float]]:
    try:
        l1, l5, l15 = os.getloadavg()
        return float(l1), float(l5), float(l15)
    except Exception:
        return None, None, None

def get_mem_mb() -> Tuple[Optional[int], Optional[int]]:
    if psutil is None:
        return None, None
    try:
        vm = psutil.virtual_memory()
        return int(vm.used / (1024 * 1024)), int(vm.total / (1024 * 1024))
    except Exception:
        return None, None

def build_raspi_sys() -> Dict[str, Any]:
    temp_c = get_raspi_cpu_temp_c()
    uptime_s = get_uptime_s()
    l1, l5, l15 = get_loadavg()
    mem_used_mb, mem_total_mb = get_mem_mb()
    return {
        "sensor_controller_id": "RASPI_SYS",
        "raspi_temp_c": temp_c,
        "uptime_s": uptime_s,
        "load1": l1, "load5": l5, "load15": l15,
        "mem_used_mb": mem_used_mb, "mem_total_mb": mem_total_mb,
        "ts_iso": datetime.utcnow().isoformat() + "Z",
    }

def build_gps_payload(gps: Dict[str, Any]) -> Dict[str, Any]:
    """Bungkus data GPS agar siap kirim ke server/database."""
    lat = gps.get("lat"); lon = gps.get("lon")
    return {
        "sensor_controller_id": "GPS_FIX",
        "lat": lat, "lon": lon,
        "alt": gps.get("alt"),
        "speed_kmh": gps.get("speed_kmh"),
        "course_deg": gps.get("course_deg"),
        "sats": gps.get("sats"),
        "hdop": gps.get("hdop"),
        "ts_iso": datetime.utcnow().isoformat() + "Z",
        # GeoJSON point (lon, lat) → cocok untuk MongoDB/PostGIS/Leaflet
        "geojson": {"type": "Point", "coordinates": [lon, lat]} if lat is not None and lon is not None else None,
    }

def post_payload(payload: Dict[str, Any]) -> bool:
    """Kirim payload ke VPS dengan retry/backoff linier ringan."""
    for attempt in range(1, CFG.http_max_retry + 1):
        try:
            resp = HTTP_SESSION.post(
                CFG.vps_api_url,
                json=payload,
                timeout=CFG.request_timeout,
            )
            ok = 200 <= resp.status_code < 300
            log.debug(f"[POST] {resp.status_code} {resp.text[:160]}")
            if ok:
                return True
        except requests.exceptions.RequestException as e:
            log.warning(f"[HTTP RETRY {attempt}] {e}")
        # backoff ringan
        time.sleep(min(1 * attempt, 5))
    return False

def queue_put(data: Dict[str, Any]) -> None:
    """Masukkan data ke antrian tanpa melempar ke caller."""
    try:
        DATA_QUEUE.put(data, timeout=1)
    except Full:
        log.warning("[QUEUE] Full, dropping payload")

# ================== Workers ========================
def worker_http_sender():
    """Worker HTTP: ambil dari queue → kirim ke server → beri tag ke receiver."""
    global SER_HANDLE
    while not STOP.is_set():
        try:
            data = DATA_QUEUE.get(timeout=0.5)
        except Empty:
            continue
        try:
            if not isinstance(data, dict):
                data = {"_raw": str(data)}

            # enrich meta
            data.setdefault("_pi_serial", PI_SERIAL or "UNKNOWN_PI")
            data.setdefault("_received_ts", int(time.time()))

            payload = {
                "raspi_serial_id": str(PI_SERIAL or "UNKNOWN_PI"),
                "data": [data],
            }

            ok = post_payload(payload)

            tag = b"[SVROK]\n" if ok else b"[SVRERR]\n"
            with SER_LOCK:
                if SER_HANDLE and SER_HANDLE.writable():
                    try:
                        SER_HANDLE.write(tag)
                        SER_HANDLE.flush()
                    except Exception as e:
                        log.debug(f"[TX TAG ERROR] {e}")

            if not ok:
                log.error("[FAILED] give up current payload.")
        finally:
            DATA_QUEUE.task_done()

def worker_heartbeat_to_receiver():
    """Heartbeat ke receiver agar OLED status server tetap segar."""
    while not STOP.is_set():
        with SER_LOCK:
            if SER_HANDLE and SER_HANDLE.writable():
                try:
                    SER_HANDLE.write(b"[SVROK]\n")
                    SER_HANDLE.flush()
                except Exception as e:
                    log.debug(f"[HB ERROR] {e}")
        STOP.wait(CFG.heartbeat_to_receiver_sec)

def worker_send_pi_serial():
    """Kirim serial Raspberry berkala ke receiver (untuk ditampilkan)."""
    msg = (PI_SERIAL or "UNKNOWN_PI") + "\n"
    payload = msg.encode("utf-8")
    while not STOP.is_set():
        with SER_LOCK:
            if SER_HANDLE and SER_HANDLE.writable():
                try:
                    SER_HANDLE.write(payload)
                    SER_HANDLE.flush()
                except Exception as e:
                    log.debug(f"[TX PI SERIAL ERROR] {e}")
        STOP.wait(CFG.send_pi_serial_sec)

def worker_push_sys_metrics():
    """Kirim paket RASPI_SYS ke server berkala, walau tak ada node."""
    while not STOP.is_set():
        try:
            queue_put(build_raspi_sys())
        except Exception as e:
            log.warning(f"[SYS METRICS ERROR] {e}")
        STOP.wait(CFG.push_sys_metrics_sec)

def worker_serial_reader():
    """Deteksi & buka serial receiver; baca baris [FOR_PI]{...} → queue. Juga [GPS]$NMEA."""
    global SER_HANDLE
    buf = ""
    last_port: Optional[str] = None

    while not STOP.is_set():
        # pastikan ada port
        port = detect_serial_port() or last_port
        if not port:
            STOP.wait(CFG.serial_detect_interval)
            continue
        last_port = port

        try:
            with SER_LOCK:
                SER_HANDLE = serial.Serial(port, CFG.baud_rate, timeout=1)
            log.info(f"[SERIAL] Connected to {port} @{CFG.baud_rate}")

            # kirim PI serial saat connect
            with SER_LOCK:
                try:
                    msg = (PI_SERIAL or "UNKNOWN_PI") + "\n"
                    SER_HANDLE.write(msg.encode("utf-8"))
                    SER_HANDLE.flush()
                    log.debug("[TX] PI serial to receiver")
                except Exception as e:
                    log.debug(f"[TX INIT ERROR] {e}")

            while not STOP.is_set():
                with SER_LOCK:
                    if SER_HANDLE.in_waiting:
                        try:
                            buf += SER_HANDLE.read(SER_HANDLE.in_waiting).decode(errors="ignore")
                        except Exception as e:
                            log.debug(f"[SER READ ERROR] {e}")
                            break

                # proses per-baris
                while "\n" in buf:
                    line, buf = buf.split("\n", 1)
                    line = line.strip("\r").strip()
                    if not line:
                        continue

                    if line.startswith("[FOR_PI]"):
                        json_part = line[len("[FOR_PI]"):].strip()
                        if json_part.startswith("{") and json_part.endswith("}"):
                            try:
                                parsed = json.loads(json_part)
                                queue_put(parsed)
                                log.debug("[QUEUE] hub JSON queued")
                            except json.JSONDecodeError as e:
                                log.warning(f"[JSON ERROR] {e}: {json_part[:200]}")
                        else:
                            log.debug(f"[DROP] Non-object/malformed JSON: {json_part[:160]}")
                    elif line.startswith("[GPS]$"):
                        # ESP32 mengirim NMEA mentah dengan prefix [GPS]
                        nmea = line[len("[GPS]"):]
                        gps_partial = parse_nmea(nmea)
                        if gps_partial.get("lat") is not None and gps_partial.get("lon") is not None:
                            with LATEST_GPS_LOCK:
                                LATEST_GPS.update({k: v for k, v in gps_partial.items() if v is not None})
                                LATEST_GPS["ts_epoch"] = time.time()
                            if CFG.gps_push_every_fix:
                                queue_put(build_gps_payload(LATEST_GPS.copy()))
                    else:
                        # baris lain diabaikan
                        pass

                time.sleep(0.01)

        except serial.SerialException as e:
            log.warning(f"[DISCONNECTED] {e}")
            with SER_LOCK:
                try:
                    if SER_HANDLE:
                        SER_HANDLE.close()
                except Exception:
                    pass
                SER_HANDLE = None
            STOP.wait(CFG.serial_detect_interval)
        except Exception as e:
            log.error(f"[SERIAL ERROR] {e}")
            with SER_LOCK:
                try:
                    if SER_HANDLE:
                        SER_HANDLE.close()
                except Exception:
                    pass
                SER_HANDLE = None
            STOP.wait(CFG.serial_detect_interval)

def worker_gps_reader_nmea():
    """Deteksi & baca port GPS NMEA langsung; update LATEST_GPS + kirim jika diminta."""
    if not CFG.gps_enabled:
        return
    buf = ""
    last_port: Optional[str] = None
    ser: Optional[serial.Serial] = None
    while not STOP.is_set():
        port = detect_gps_port() or last_port
        if not port:
            STOP.wait(CFG.gps_detect_interval)
            continue
        last_port = port
        try:
            ser = serial.Serial(port, CFG.gps_baud, timeout=1)
            log.info(f"[GPS] Connected to {port} @{CFG.gps_baud}")
            while not STOP.is_set():
                try:
                    if ser.in_waiting:
                        buf += ser.read(ser.in_waiting).decode(errors="ignore")
                except Exception:
                    break
                while "\n" in buf:
                    line, buf = buf.split("\n", 1)
                    line = line.strip("\r").strip()
                    if not line.startswith("$"):
                        continue
                    gps_partial = parse_nmea(line)
                    if gps_partial:
                        now = time.time()
                        with LATEST_GPS_LOCK:
                            # merge info dari RMC/GGA
                            for k, v in gps_partial.items():
                                if v is not None:
                                    LATEST_GPS[k] = v
                            LATEST_GPS["ts_epoch"] = now
                        if CFG.gps_push_every_fix and LATEST_GPS.get("lat") is not None and LATEST_GPS.get("lon") is not None:
                            queue_put(build_gps_payload(LATEST_GPS.copy()))
                time.sleep(0.02)
        except serial.SerialException as e:
            log.warning(f"[GPS DISCONNECTED] {e}")
            try:
                if ser:
                    ser.close()
            except Exception:
                pass
            ser = None
            STOP.wait(CFG.gps_detect_interval)
        except Exception as e:
            log.error(f"[GPS ERROR] {e}")
            try:
                if ser:
                    ser.close()
            except Exception:
                pass
            ser = None
            STOP.wait(CFG.gps_detect_interval)

def worker_gps_uploader_interval():
    """Kirim GPS secara berkala (opsi selain setiap fix)."""
    if not CFG.gps_enabled or CFG.gps_push_every_fix:
        return
    while not STOP.is_set():
        with LATEST_GPS_LOCK:
            gps = LATEST_GPS.copy()
        now = time.time()
        lat = gps.get("lat"); lon = gps.get("lon")
        sats = gps.get("sats"); hdop = gps.get("hdop")
        ts = gps.get("ts_epoch", 0)
        fresh = (now - ts) <= CFG.gps_max_age_s
        # validasi sederhana
        if lat is not None and lon is not None and fresh:
            if (sats is None or sats >= CFG.gps_min_sats) and (hdop is None or hdop <= CFG.gps_min_hdop):
                queue_put(build_gps_payload(gps))
        STOP.wait(CFG.gps_post_interval_sec)

# =================== Main/Runner ===================
def install_signal_handlers():
    def _handle(sig, _frame):
        log.info(f"Signal {sig} received → shutting down...")
        STOP.set()
    for s in (signal.SIGINT, signal.SIGTERM):
        try:
            signal.signal(s, _handle)
        except Exception:
            pass  # pada Windows bisa gagal untuk SIGTERM

def start_thread(target, name: str):
    t = threading.Thread(target=target, name=name, daemon=True)
    t.start()
    return t

def main() -> int:
    global PI_SERIAL
    log.info("[START] RasPi sender")
    log.info(f"[CFG] POST → {CFG.vps_api_url}")
    PI_SERIAL = get_pi_serial()
    log.info(f"[PI SERIAL] {PI_SERIAL}")

    install_signal_handlers()

    # workers
    workers = [
        start_thread(worker_http_sender,           "http-sender"),
        start_thread(worker_heartbeat_to_receiver, "hb-to-rx"),
        start_thread(worker_send_pi_serial,        "send-pi-serial"),
        start_thread(worker_push_sys_metrics,      "push-sys"),
        start_thread(worker_serial_reader,         "serial-reader"),
        start_thread(worker_gps_reader_nmea,       "gps-reader"),
        start_thread(worker_gps_uploader_interval, "gps-uploader"),
    ]

    # tunggu stop
    try:
        while not STOP.is_set():
            time.sleep(0.5)
    finally:
        log.info("Stopping… waiting queue to drain (up to 3s)…")
        end = time.time() + 3.0
        while time.time() < end and not DATA_QUEUE.empty():
            time.sleep(0.1)
        with SER_LOCK:
            try:
                if SER_HANDLE:
                    SER_HANDLE.close()
            except Exception:
                pass
        log.info("Bye.")
    return 0

if __name__ == "__main__":
    sys.exit(main())
