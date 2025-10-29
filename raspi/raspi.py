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
    baud_rate: int = int(os.environ.get("BAUD_RATE", "115200"))
    request_timeout: int = int(os.environ.get("REQUEST_TIMEOUT_S", "5"))
    http_max_retry: int = int(os.environ.get("HTTP_MAX_RETRY", "3"))
    serial_detect_interval: float = float(os.environ.get("SERIAL_DETECT_INTERVAL_S", "3"))
    vps_api_url: str = os.environ.get("VPS_API_URL", "http://127.0.0.1:3000/api/iot-data")

    # intervals
    heartbeat_to_receiver_sec: float = float(os.environ.get("HB_TO_RX_S", "5"))
    push_sys_metrics_sec: float = float(os.environ.get("PUSH_SYS_METRICS_S", "5"))
    send_pi_serial_sec: float = float(os.environ.get("SEND_PI_SERIAL_S", "30"))

    # queue
    queue_maxsize: int = int(os.environ.get("QUEUE_MAXSIZE", "2000"))

CFG = Config()

# ================== Globals/State ==================
STOP = threading.Event()        # sinyal shutdown
SER_HANDLE: Optional[serial.Serial] = None
SER_LOCK = threading.Lock()
HTTP_SESSION = requests.Session()

DATA_QUEUE: "Queue[Dict[str, Any]]" = Queue(maxsize=CFG.queue_maxsize)
PI_SERIAL: str = "UNKNOWN_PI"

# ================== Helpers =======================
def detect_serial_port() -> Optional[str]:
    """Cari port USB ESP32 receiver. Kembalikan path atau None."""
    for p in list_ports.comports():
        dev = p.device.lower()
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
    """Deteksi & buka serial receiver; baca baris [FOR_PI]{...} → queue."""
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
        start_thread(worker_http_sender,        "http-sender"),
        start_thread(worker_heartbeat_to_receiver, "hb-to-rx"),
        start_thread(worker_send_pi_serial,     "send-pi-serial"),
        start_thread(worker_push_sys_metrics,   "push-sys"),
        start_thread(worker_serial_reader,      "serial-reader"),
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
