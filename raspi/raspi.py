#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Raspberry Pi → Express Server sender (tidy/optimized)

Fitur:
- Deteksi otomatis port ESP32 Receiver (USB) dan reconnect jika lepas/pasang.
- Baca baris bertanda "[FOR_PI]{...json...}" dari receiver → antri → POST ke Express.
- Heartbeat ke receiver tiap N detik: "[SVROK]\n".
- Kirim serial number Raspberry ke receiver berkala untuk ditampilkan.
- Push metrik sistem "RASPI_SYS" (suhu CPU, uptime, load, mem) berkala → ke server.
- Logging rapi + shutdown mulus (Ctrl+C).

Tambahan (GPS):
- Worker GPS terpisah (dedicated port; default /dev/ttyUSB3)
- AT+CFUN=1, AT+CGPS=1 pada start
- Poll AT+CGPSINFO berkala; konversi DM→DD
- POST realtime ke API GPS baru (CFG.gps_api_url)
- NO FIX → warning log (tidak POST agar sesuai kontrak server)
"""

from __future__ import annotations
import os
import sys
import time
import json
import signal
import logging
import threading
from dataclasses import dataclass
from queue import Queue, Full, Empty
from datetime import datetime
from typing import Optional, Dict, Any, Tuple
import re
import subprocess

# --- optional deps ---
try:
    import psutil  # type: ignore
except Exception:
    psutil = None  # graceful fallback tanpa mem metrics

import requests
import serial  # pyserial
from serial.tools import list_ports  # type: ignore

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
    baud_rate: int = int(os.environ.get("BAUD_RATE", "115200"))
    request_timeout: int = int(os.environ.get("REQUEST_TIMEOUT_S", "5"))
    http_max_retry: int = int(os.environ.get("HTTP_MAX_RETRY", "3"))
    serial_detect_interval: float = float(os.environ.get("SERIAL_DETECT_INTERVAL_S", "3"))
    vps_api_url: str = os.environ.get("VPS_API_URL", "http://192.168.103.174:3000/api/iot-data")

    # intervals
    heartbeat_to_receiver_sec: float = float(os.environ.get("HB_TO_RX_S", "5"))
    push_sys_metrics_sec: float = float(os.environ.get("PUSH_SYS_METRICS_S", "5"))
    send_pi_serial_sec: float = float(os.environ.get("SEND_PI_SERIAL_S", "30"))

    # queue
    queue_maxsize: int = int(os.environ.get("QUEUE_MAXSIZE", "2000"))

    # GPS
    gps_port: str = os.environ.get("GPS_PORT", "/dev/ttyUSB3")
    gps_poll_interval: float = float(os.environ.get("GPS_POLL_INTERVAL_S", "2"))
    gps_api_url: str = os.environ.get("GPS_API_URL", "http://192.168.103.174:3000/api/gps")

CFG = Config()

# ================== Globals/State ==================
STOP = threading.Event()        # sinyal shutdown
SER_HANDLE: Optional[serial.Serial] = None  # ESP32 receiver
SER_LOCK = threading.Lock()
HTTP_SESSION = requests.Session()

DATA_QUEUE: "Queue[Dict[str, Any]]" = Queue(maxsize=CFG.queue_maxsize)
PI_SERIAL: str = "UNKNOWN_PI"

# ================== Helpers =======================
def detect_serial_port() -> Optional[str]:
    """Cari port USB ESP32 receiver. Kembalikan path atau None.
    Melewati port GPS agar tidak bentrok dengan worker GPS.
    """
    gps_dev = (CFG.gps_port or "").lower()
    for p in list_ports.comports():
        dev = p.device.lower()
        if dev == gps_dev:
            continue  # jangan ambil port GPS
        if any(tag in dev for tag in ("ttyusb", "ttyacm", "cu.usbserial", "cu.usbmodem")):
            log.info(f"[FOUND] ESP32 receiver at {p.device}")
            return p.device
    log.debug("No ESP32 serial yet...")
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

def get_raspi_cpu_temp_c() -> Optional[float]:
    """Ambil suhu CPU RasPi (°C). Prefer vcgencmd; fallback thermal_zone0."""
    try:
        out = subprocess.check_output(["vcgencmd", "measure_temp"], text=True).strip()
        if out.startswith("temp=") and out.endswith("'C"):
            return float(out[5:-2])
    except Exception:
        pass
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

def post_payload(payload: Dict[str, Any]) -> bool:
    for attempt in range(1, CFG.http_max_retry + 1):
        if STOP.is_set():  # <- biar langsung kabur saat shutdown
            return False
        try:
            # Saat shutdown, jangan lama-lama
            timeout = 1 if STOP.is_set() else CFG.request_timeout
            
            print("111111")
            resp = HTTP_SESSION.post(CFG.vps_api_url, json=payload, timeout=timeout)
            print("2222")
            ok = 200 <= resp.status_code < 300
            log.debug(f"[POST] {resp.status_code} {resp.text[:160]}")
            if ok:
                return True
        except requests.exceptions.RequestException as e:
            log.warning(f"[HTTP RETRY {attempt}] {e}")

        # ganti time.sleep(...) → STOP.wait(...)
        backoff = min(1 * attempt, 5)
        if STOP.wait(backoff):
            return False
    return False

def queue_put(data: Dict[str, Any]) -> None:
    """Masukkan data ke antrian tanpa melempar ke caller."""
    try:
        DATA_QUEUE.put(data, timeout=1)
    except Full:
        log.warning("[QUEUE] Full, dropping payload")

# ================== Workers (IoT/original) ========================
def worker_http_sender():
    """Worker HTTP: ambil dari queue → kirim ke server → beri tag ke receiver."""
    global SER_HANDLE
    while not STOP.is_set():
        try:
            data = DATA_QUEUE.get(timeout=0.5)
        except Empty:
            continue
        
          # kalau STOP sudah set ketika dapat item, drop saja agar cepat bubar
        if STOP.is_set():
            DATA_QUEUE.task_done()
            break
        
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
            data = build_raspi_sys()
            data.setdefault("ts_iso", datetime.utcnow().isoformat() + "Z")
            queue_put(data)

        except Exception as e:
            log.warning(f"[SYS METRICS ERROR] {e}")
        STOP.wait(CFG.push_sys_metrics_sec)

def worker_serial_reader():
    """Deteksi & buka serial receiver; baca baris [FOR_PI]{...} → queue."""
    global SER_HANDLE
    buf = ""
    last_port: Optional[str] = None

    while not STOP.is_set():
        # pastikan ada port (skip GPS port)
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

                                # ✅ Auto-normalize missing fields
                                if "sensor_controller_id" not in parsed:
                                    parsed["sensor_controller_id"] = parsed.get("id") or parsed.get("type") or "UNKNOWN"

                                # ✅ Always include timestamp
                                parsed.setdefault("ts_iso", datetime.utcnow().isoformat() + "Z")

                                queue_put(parsed)
                                log.debug("[QUEUE] hub JSON queued")

                            except json.JSONDecodeError as e:
                                log.warning(f"[JSON ERROR] {e}: {json_part[:200]}")
                        else:
                            log.debug(f"[DROP] Non-object/malformed JSON: {json_part[:160]}")
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

# ================== GPS Worker (baru) ==================
GPS_PATTERN = re.compile(
    r"\+CGPSINFO:\s*([^,]*),([NS]?),(.*?),([EW]?),(.*?),(.*?),(.*?),(.*?),?$"
)

def _dm_to_dd(dm_str: str) -> float:
    dm = float(dm_str)
    d = int(dm // 100)
    m = dm - d * 100
    return d + m / 60.0

def _parse_cgpsinfo(line: str) -> Dict[str, Any]:
    m = GPS_PATTERN.search(line)
    if not m:
        return {"status": "invalid", "raw": line}
    lat_dm, lat_dir, lon_dm, lon_dir, dmy, hms, alt, spd = [g.strip() for g in m.groups()]
    if not lat_dm or not lon_dm:
        return {"status": "nofix"}
    try:
        lat = _dm_to_dd(lat_dm)
        lon = _dm_to_dd(lon_dm)
        if lat_dir == "S": lat = -lat
        if lon_dir == "W": lon = -lon
    except Exception:
        return {"status": "invalid", "raw": line}
    return {
        "status": "fix",
        "lat": lat,
        "lon": lon,
        "alt_m": float(alt) if alt else None,
        "speed_knots": float(spd) if spd else None,
    }

def _gps_send_api(payload: Dict[str, Any]) -> None:
    try:
        r = requests.post(CFG.gps_api_url, json=payload, timeout=CFG.request_timeout)
        log.info(f"[GPS API] {r.status_code} {r.text[:160]}")
    except requests.RequestException as e:
        log.warning(f"[GPS API ERROR] {e}")

def worker_gps_reader():
    """GPS Reader dedicated:
       - Open CFG.gps_port (bukan SER_HANDLE/shared)
       - Init AT+CFUN=1; AT+CGPS=1
       - Poll AT+CGPSINFO
       - POST ke CFG.gps_api_url (lat/lon wajib → skip NO FIX)
    """
    port = CFG.gps_port
    baud = CFG.baud_rate

    def _open() -> Optional[serial.Serial]:
        try:
            s = serial.Serial(port, baud, timeout=1)
            log.info(f"[GPS] Connected {port} @{baud}")
            return s
        except Exception as e:
            log.error(f"[GPS] Cannot open {port}: {e}")
            return None

    def _send(ser: serial.Serial, cmd: str, wait=0.4) -> str:
        try:
            ser.reset_input_buffer()
            ser.write((cmd + "\r\n").encode("ascii"))
            ser.flush()
            time.sleep(wait)
            return ser.read_all().decode("ascii", errors="ignore")
        except Exception as e:
            log.debug(f"[GPS SEND ERROR] {e}")
            return ""

    ser = None
    last_status = None
    last_warn = 0.0
    WARN_COOLDOWN = 5.0

    while not STOP.is_set():
        if ser is None:
            ser = _open()
            if ser is None:
                STOP.wait(3.0)
                continue
            # init GNSS
            _send(ser, "AT")
            _send(ser, "ATE0")
            _send(ser, "AT+CFUN=1", wait=1.0)
            _send(ser, "AT+CGPS=1", wait=1.0)
            log.info("[GPS] GNSS ON (CFUN=1, CGPS=1)")

        try:
            resp = _send(ser, "AT+CGPSINFO", wait=0.5)
            for line in resp.splitlines():
                if "+CGPSINFO:" not in line:
                    continue
                st = _parse_cgpsinfo(line)

                if st["status"] == "fix":
                    if last_status != "fix":
                        log.info("[GPS] Fix acquired")
                    last_status = "fix"

                    # knots → km/h
                    speed_kmh = st["speed_knots"] * 1.852 if st.get("speed_knots") is not None else 0.0
                    payload = {
                        "raspi_serial_id": (PI_SERIAL or "UNKNOWN_PI"),
                        "lat": st["lat"],
                        "lon": st["lon"],
                        "speed_kmh": round(speed_kmh, 2),
                        "altitude_m": st.get("alt_m") or 0,
                        "sats": 0,
                        "raw": line.strip(),
                        "timestamp": datetime.utcnow().isoformat() + "Z"
                    }

                    _gps_send_api(payload)

                elif st["status"] == "nofix":
                    now = time.time()
                    if last_status != "nofix" or (now - last_warn) > WARN_COOLDOWN:
                        log.warning("[GPS] No fix — waiting for satellites…")
                        last_warn = now
                    last_status = "nofix"
                    # Jangan POST ke /api/gps karena endpoint butuh lat/lon

                else:
                    log.debug(f"[GPS RAW] {line.strip()}")

        except serial.SerialException as e:
            log.warning(f"[GPS DISCONNECTED] {e}")
            try:
                ser.close()
            except Exception:
                pass
            ser = None
        except Exception as e:
            log.error(f"[GPS ERROR] {e}")
            try:
                ser.close()
            except Exception:
                pass
            ser = None

        STOP.wait(CFG.gps_poll_interval)

    try:
        if ser:
            ser.close()
    except Exception:
        pass

# =================== Main/Runner ===================
def install_signal_handlers():
    def _handle(sig, _frame):
        log.info(f"Signal {sig} received → shutting down...")
        STOP.set()
    for s in (signal.SIGINT, signal.SIGTERM):
        try:
            signal.signal(s, _handle)
        except Exception:
            pass 

def start_thread(target, name: str):
    t = threading.Thread(target=target, name=name, daemon=True)
    t.start()
    return t

def main() -> int:
    global PI_SERIAL
    log.info("[START] RasPi sender")
    log.info(f"[CFG] POST → {CFG.vps_api_url}")
    log.info(f"[CFG] GPS POST → {CFG.gps_api_url}")
    log.info(f"[CFG] GPS PORT → {CFG.gps_port}")
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
        start_thread(worker_gps_reader,            "gps-reader"),   # NEW
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
