#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Raspberry Pi → Express Server sender (IMPROVED with packet buffering)

NEW FEATURES:
- Multi-packet buffering: Automatically buffers and merges split packets from hub
- Smart packet assembly: Combines packets with seq/tot fields before sending to server
- Buffer cleanup: Auto-removes stale incomplete packets after timeout
- Backward compatible: Single packets pass through unchanged

Original features:
- Auto-detect ESP32 Receiver port (USB) with reconnect on disconnect
- Read "[FOR_PI]{...json...}" lines from receiver → queue → POST to /api/hub-data
- Heartbeat to receiver every N seconds: "[SVROK]\n"
- Send Raspberry serial number to receiver periodically (for OLED display)
- Push RasPi heartbeat (CPU temp, uptime) to /api/raspi-heartbeat periodically
- Separate GPS worker: AT init, polling AT+CGPSINFO, POST to /api/gps
- Graceful shutdown (Ctrl+C / SIGTERM), HTTP retry with STOP-aware backoff
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
    psutil = None  # fallback without psutil (mem metrics will be None)

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

    # opsional: kalau Anda mau paksa pakai port tertentu
    receiver_port_hint: str = os.environ.get("RECEIVER_ESP", "").strip()

    # interval scan untuk cari port ESP32 (detik)
    serial_detect_interval_sec: float = float(os.environ.get("SERIAL_DETECT_INTERVAL_S", "1.0"))

    # HTTP
    request_timeout: int = int(os.environ.get("REQUEST_TIMEOUT_S", "5"))
    http_max_retry: int = int(os.environ.get("HTTP_MAX_RETRY", "3"))

    # NEW API endpoints
    raspi_hb_url: str = os.environ.get("RASPI_HB_URL", "http://192.168.103.174:3000/api/raspi-heartbeat")
    hub_data_url: str = os.environ.get("HUB_DATA_URL", "http://192.168.103.174:3000/api/hub-data")
    gps_api_url: str = os.environ.get("GPS_API_URL", "http://192.168.103.174:3000/api/gps")

    # intervals
    heartbeat_to_receiver_sec: float = float(os.environ.get("HB_TO_RX_S", "5"))
    push_sys_metrics_sec: float = float(os.environ.get("PUSH_SYS_METRICS_S", "5"))
    send_pi_serial_sec: float = float(os.environ.get("SEND_PI_SERIAL_S", "30"))

    # queue
    queue_maxsize: int = int(os.environ.get("QUEUE_MAXSIZE", "2000"))

    # GPS
    gps_port: str = os.environ.get("GPS_PORT", "/dev/ttyUSB3")
    gps_poll_interval: float = float(os.environ.get("GPS_POLL_INTERVAL_S", "2"))

    # NEW: Multi-packet buffer settings
    packet_buffer_timeout: float = float(os.environ.get("PACKET_BUFFER_TIMEOUT_S", "10"))

CFG = Config()

# ================== Globals/State ==================
STOP = threading.Event()        # shutdown signal
SER_HANDLE: Optional[serial.Serial] = None  # ESP32 receiver
SER_LOCK = threading.Lock()
HTTP_SESSION = requests.Session()

DATA_QUEUE: "Queue[Dict[str, Any]]" = Queue(maxsize=CFG.queue_maxsize)
PI_SERIAL: str = "UNKNOWN_PI"

# NEW: Multi-packet buffer
# Structure: {buffer_key: {"packets": {seq: packet}, "timestamp": float, "total": int}}
PACKET_BUFFER: Dict[str, Dict[str, Any]] = {}
BUFFER_LOCK = threading.Lock()

# ================== Helpers =======================
def detect_serial_port() -> Optional[str]:
    """Find ESP32 receiver USB port. Return path or None.
    Skip GPS port to avoid conflict with GPS worker.
    """
    gps_dev = (CFG.gps_port or "").lower()
    for p in list_ports.comports():
        dev = p.device.lower()
        if dev == gps_dev:
            continue  # skip GPS port
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
    """Get RasPi CPU temp (°C). Prefer vcgencmd; fallback thermal_zone0."""
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
    """Build RasPi metrics packet (local info)—for local logging/diagnostics."""
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

# ================== HTTP helpers ==================
def _http_post(url: str, payload: Dict[str, Any], timeout: Optional[int] = None) -> bool:
    """Simple POST with retry & STOP-aware backoff."""
    to = timeout if timeout is not None else CFG.request_timeout
    for attempt in range(1, CFG.http_max_retry + 1):
        if STOP.is_set():
            return False
        try:
            resp = HTTP_SESSION.post(url, json=payload, timeout=to)
            if 200 <= resp.status_code < 300:
                log.debug(f"[HTTP OK] {url} {resp.status_code}")
                return True
            log.warning(f"[HTTP {resp.status_code}] {url} {resp.text[:160]}")
        except requests.exceptions.RequestException as e:
            log.warning(f"[HTTP RETRY {attempt}] {url} -> {e}")
        # linear backoff, STOP-aware
        if STOP.wait(min(1 * attempt, 5)):
            return False
    return False

def post_heartbeat() -> bool:
    """Send RasPi heartbeat to /api/raspi-heartbeat (online status)."""
    payload = {
        "raspi_serial_id": PI_SERIAL,
        "temp_c": get_raspi_cpu_temp_c(),
        "uptime_s": get_uptime_s()
    }
    ok = _http_post(CFG.raspi_hb_url, payload)
    if not ok:
        log.debug("[HB] Failed")
    return ok

def send_hub_data(payload: Dict[str, Any]) -> bool:
    """Send hub packet (ESP32) to /api/hub-data."""
    return _http_post(CFG.hub_data_url, payload)

def gps_send_api(payload: Dict[str, Any]) -> bool:
    """Send GPS to /api/gps."""
    return _http_post(CFG.gps_api_url, payload)

def queue_put(data: Dict[str, Any]) -> None:
    """Put data into queue without throwing to caller."""
    try:
        DATA_QUEUE.put(data, timeout=1)
    except Full:
        log.warning("[QUEUE] Full, dropping payload")

# ================== NEW: Multi-packet buffering ==================
def get_buffer_key(packet: Dict[str, Any]) -> str:
    """Generate unique key for packet buffering based on controller ID and timestamp."""
    controller_id = packet.get("sensor_controller_id", "unknown")
    ts = packet.get("ts", 0)
    return f"{controller_id}_{ts}"

def merge_packets(packets: Dict[int, Dict[str, Any]]) -> Dict[str, Any]:
    """Merge multiple packets into a single combined packet.
    
    Strategy:
    1. Use first packet as base (has all metadata)
    2. Merge all port-* fields from all packets
    3. Remove seq/tot fields (no longer needed)
    """
    if not packets:
        return {}
    
    # Sort by seq to ensure consistent merging
    sorted_packets = sorted(packets.items(), key=lambda x: x[0])
    
    # Start with first packet as base
    merged = dict(sorted_packets[0][1])
    
    # Remove seq/tot from merged result
    merged.pop("seq", None)
    merged.pop("tot", None)
    
    # Merge port-* fields from all packets
    for seq, packet in sorted_packets[1:]:
        for key, value in packet.items():
            if key.startswith("port-"):
                merged[key] = value
    
    log.info(f"[MERGE] Combined {len(packets)} packets into 1 (controller_id={merged.get('sensor_controller_id')})")
    return merged

def process_packet(packet: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Process incoming packet. Handle multi-packet buffering if needed.
    
    Returns:
    - Complete packet (single or merged) if ready to send
    - None if buffering in progress
    """
    # Check if this is a multi-packet transmission
    seq = packet.get("seq")
    tot = packet.get("tot")
    
    # Single packet or heartbeat - pass through immediately
    if seq is None or tot is None:
        log.debug("[PACKET] Single packet/heartbeat - pass through")
        return packet
    
    # Multi-packet transmission - buffer and wait for all parts
    buffer_key = get_buffer_key(packet)
    
    with BUFFER_LOCK:
        # Initialize buffer entry if needed
        if buffer_key not in PACKET_BUFFER:
            PACKET_BUFFER[buffer_key] = {
                "packets": {},
                "timestamp": time.time(),
                "total": tot
            }
            log.debug(f"[BUFFER] New multi-packet session: {buffer_key} (expecting {tot} packets)")
        
        buffer_entry = PACKET_BUFFER[buffer_key]
        
        # Store this packet
        buffer_entry["packets"][seq] = packet
        received_count = len(buffer_entry["packets"])
        
        log.debug(f"[BUFFER] Packet {seq}/{tot} received for {buffer_key} ({received_count}/{tot} collected)")
        
        # Check if we have all packets
        if received_count == tot:
            log.info(f"[BUFFER] All {tot} packets received for {buffer_key} - merging now")
            merged = merge_packets(buffer_entry["packets"])
            
            # Clean up buffer
            del PACKET_BUFFER[buffer_key]
            
            return merged
        else:
            # Still waiting for more packets
            return None

def cleanup_stale_buffers():
    """Remove incomplete packet buffers that have timed out."""
    now = time.time()
    with BUFFER_LOCK:
        stale_keys = []
        for key, entry in PACKET_BUFFER.items():
            age = now - entry["timestamp"]
            if age > CFG.packet_buffer_timeout:
                stale_keys.append(key)
                received = len(entry["packets"])
                total = entry["total"]
                log.warning(f"[BUFFER TIMEOUT] Dropping incomplete transmission {key} "
                           f"({received}/{total} packets, age={age:.1f}s)")
        
        for key in stale_keys:
            del PACKET_BUFFER[key]

# ================== Workers (IoT/original) ========================
def worker_http_sender():
    """HTTP Worker: take from queue → send to /api/hub-data → tag to receiver."""
    global SER_HANDLE
    while not STOP.is_set():
        try:
            data = DATA_QUEUE.get(timeout=0.5)
        except Empty:
            continue

        if STOP.is_set():
            DATA_QUEUE.task_done()
            break

        try:
            # minimal normalization
            if not isinstance(data, dict):
                data = {"_raw": str(data)}

            data.setdefault("_pi_serial", PI_SERIAL or "UNKNOWN_PI")
            data.setdefault("_received_ts", int(time.time()))

            # Payload for /api/hub-data
            payload = {
                "raspi_serial_id": str(PI_SERIAL or "UNKNOWN_PI"),
                "data": [data],
            }

            ok = send_hub_data(payload)

            # Feedback tag to ESP (optional for OLED status)
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
    """Heartbeat to receiver so OLED server status stays fresh (local RPi→ESP link)."""
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
    """Send Raspberry serial periodically to receiver (for display)."""
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
    """Send RasPi heartbeat to server periodically (independent of ESP/hub)."""
    while not STOP.is_set():
        try:
            post_heartbeat()
        except Exception as e:
            log.warning(f"[HB SEND ERROR] {e}")
        STOP.wait(CFG.push_sys_metrics_sec)

def worker_buffer_cleanup():
    """Periodically clean up stale incomplete packet buffers."""
    while not STOP.is_set():
        try:
            cleanup_stale_buffers()
        except Exception as e:
            log.error(f"[BUFFER CLEANUP ERROR] {e}")
        STOP.wait(CFG.packet_buffer_timeout / 2)  # Check twice per timeout period

def worker_serial_reader():
    """Detect & open serial receiver; read lines [FOR_PI]{...} → buffer/merge → queue."""
    global SER_HANDLE
    buf = ""
    last_port: Optional[str] = None

    while not STOP.is_set():
        # ensure we have a port (skip GPS port)
        port = None

        if CFG.receiver_port_hint:
            port = CFG.receiver_port_hint
        else:
            port = detect_serial_port() or last_port

        if not port:
            STOP.wait(CFG.serial_detect_interval_sec)
            continue

        last_port = port

        try:
            with SER_LOCK:
                SER_HANDLE = serial.Serial(port, CFG.baud_rate, timeout=1)
            log.info(f"[SERIAL] Connected to {port} @{CFG.baud_rate}")

            # send PI serial on connect
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

                # process per-line
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

                                # ✅ Always include timestamp (client-side)
                                parsed.setdefault("ts_iso", datetime.utcnow().isoformat() + "Z")

                                # ✅ NEW: Process packet (buffer/merge if multi-packet)
                                complete_packet = process_packet(parsed)
                                
                                if complete_packet is not None:
                                    queue_put(complete_packet)
                                    log.debug("[QUEUE] Complete packet queued")
                                else:
                                    log.debug("[BUFFER] Packet buffered, waiting for more parts")

                            except json.JSONDecodeError as e:
                                log.warning(f"[JSON ERROR] {e}: {json_part[:200]}")
                        else:
                            log.debug(f"[DROP] Non-object/malformed JSON: {json_part[:160]}")
                    else:
                        # other lines ignored
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
            STOP.wait(CFG.serial_detect_interval_sec)
        except Exception as e:
            log.error(f"[SERIAL ERROR] {e}")
            with SER_LOCK:
                try:
                    if SER_HANDLE:
                        SER_HANDLE.close()
                except Exception:
                    pass
                SER_HANDLE = None
            STOP.wait(CFG.serial_detect_interval_sec)

# ================== GPS Worker (original) ==================
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

def worker_gps_reader():
    """GPS Reader dedicated:
       - Open CFG.gps_port (not SER_HANDLE/shared)
       - Init AT+CFUN=1; AT+CGPS=1
       - Poll AT+CGPSINFO
       - POST to CFG.gps_api_url (lat/lon required → skip NO FIX)
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

                    ok = gps_send_api(payload)
                    if not ok:
                        log.debug("[GPS API] failed send")

                elif st["status"] == "nofix":
                    now = time.time()
                    if last_status != "nofix" or (now - last_warn) > WARN_COOLDOWN:
                        log.warning("[GPS] No fix — waiting for satellites…")
                        last_warn = now
                    last_status = "nofix"
                    # Don't POST to /api/gps because endpoint needs lat/lon

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
                if ser:
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
    log.info("[START] RasPi sender (IMPROVED with multi-packet buffering)")
    log.info(f"[CFG] Raspi HB  → {CFG.raspi_hb_url}")
    log.info(f"[CFG] Hub Data  → {CFG.hub_data_url}")
    log.info(f"[CFG] GPS POST  → {CFG.gps_api_url}")
    log.info(f"[CFG] GPS PORT  → {CFG.gps_port}")
    log.info(f"[CFG] Packet buffer timeout: {CFG.packet_buffer_timeout}s")
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
        start_thread(worker_gps_reader,            "gps-reader"),
        start_thread(worker_buffer_cleanup,        "buffer-cleanup"),  # NEW worker
    ]

    # wait for stop
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