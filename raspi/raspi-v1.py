#!/usr/bin/env python3
# -*- coding: utf-8 -*-

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
from typing import Optional, Dict, Any, Tuple, List
import re
import subprocess

try:
    import psutil  # type: ignore
except Exception:
    psutil = None

import requests
import serial
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
    receiver_port_hint: str = os.environ.get("RECEIVER_ESP", "").strip()
    serial_detect_interval_sec: float = float(os.environ.get("SERIAL_DETECT_INTERVAL_S", "1.0"))

    request_timeout: int = int(os.environ.get("REQUEST_TIMEOUT_S", "5"))
    http_max_retry: int = int(os.environ.get("HTTP_MAX_RETRY", "3"))

    raspi_data_url: str = os.environ.get("RASPI_DATA_URL", "http://192.168.103.174:3000/api/raspi-data")
    hub_data_url: str = os.environ.get("HUB_DATA_URL", "http://192.168.103.174:3000/api/sensor-data")

    heartbeat_to_receiver_sec: float = float(os.environ.get("HB_TO_RX_S", "5"))
    send_pi_serial_sec: float = float(os.environ.get("SEND_PI_SERIAL_S", "30"))
    push_raspi_data_sec: float = float(os.environ.get("PUSH_RASPI_DATA_S", "60"))

    queue_maxsize: int = int(os.environ.get("QUEUE_MAXSIZE", "2000"))

    gps_port: str = os.environ.get("GPS_PORT", "/dev/ttyUSB3")
    gps_poll_interval: float = float(os.environ.get("GPS_POLL_INTERVAL_S", "2"))

    packet_buffer_timeout: float = float(os.environ.get("PACKET_BUFFER_TIMEOUT_S", "10"))

CFG = Config()

# ================== Globals/State ==================
STOP = threading.Event()
SER_HANDLE: Optional[serial.Serial] = None
SER_LOCK = threading.Lock()
HTTP_SESSION = requests.Session()

DATA_QUEUE: "Queue[Dict[str, Any]]" = Queue(maxsize=CFG.queue_maxsize)
PI_SERIAL: str = "UNKNOWN_PI"

LATEST_GPS_FIX: Optional[Dict[str, Any]] = None
GPS_FIX_LOCK = threading.Lock()

PACKET_BUFFER: Dict[str, Dict[str, Any]] = {}
BUFFER_LOCK = threading.Lock()

# ================== Helpers =======================
def detect_serial_port() -> Optional[str]:
    gps_dev = (CFG.gps_port or "").lower()
    for p in list_ports.comports():
        dev = p.device.lower()
        if dev == gps_dev:
            continue
        if any(tag in dev for tag in ("ttyusb", "ttyacm", "cu.usbserial", "cu.usbmodem")):
            log.info(f"[FOUND] ESP32 receiver at {p.device}")
            return p.device
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
    try:
        with open("/proc/cpuinfo") as f:
            for line in f:
                if line.lower().startswith("serial"):
                    return line.split(":")[1].strip()
    except Exception:
        pass
    return "UNKNOWN_PI"

def get_raspi_cpu_temp_c() -> Optional[float]:
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

# ================== HTTP helpers ==================
def _http_post(url: str, payload: Dict[str, Any], timeout: Optional[int] = None) -> bool:
    to = timeout if timeout is not None else CFG.request_timeout
    for attempt in range(1, CFG.http_max_retry + 1):
        if STOP.is_set():
            return False
        try:
            resp = HTTP_SESSION.post(url, json=payload, timeout=to)
            if 200 <= resp.status_code < 300:
                return True
            log.warning(f"[HTTP {resp.status_code}] {url} {resp.text[:160]}")
        except requests.exceptions.RequestException as e:
            log.warning(f"[HTTP RETRY {attempt}] {url} -> {e}")
        if STOP.wait(min(1 * attempt, 5)):
            return False
    return False

def send_hub_data(payload: Dict[str, Any]) -> bool:
    return _http_post(CFG.hub_data_url, payload)

def post_raspi_data_once() -> bool:
    datas: List[Dict[str, Any]] = []

    temp_c = get_raspi_cpu_temp_c()
    if temp_c is not None:
        datas.append({
            "temperature": temp_c,
            "timestamp_temperature": datetime.utcnow().isoformat() + "Z",
            "uptime_s": get_uptime_s(),
        })
    else:
        datas.append({
            "uptime_s": get_uptime_s(),
            "timestamp_temperature": datetime.utcnow().isoformat() + "Z",
        })

    with GPS_FIX_LOCK:
        gps_snapshot = dict(LATEST_GPS_FIX) if LATEST_GPS_FIX else None

    if gps_snapshot is not None:
        datas.append(gps_snapshot)

    payload = {
        "raspberry_serial_id": str(PI_SERIAL or "UNKNOWN_PI"),
        "datas": datas,
    }
    return _http_post(CFG.raspi_data_url, payload)

def queue_put(data: Dict[str, Any]) -> None:
    try:
        DATA_QUEUE.put(data, timeout=1)
    except Full:
        log.warning("[QUEUE] Full, dropping payload")

# ================== Multi-packet buffering ==================
def get_buffer_key(packet: Dict[str, Any]) -> str:
    controller_id = packet.get("sensor_controller_id", "unknown")
    ts = packet.get("ts", 0)
    return f"{controller_id}_{ts}"

def merge_packets(packets: Dict[int, Dict[str, Any]]) -> Dict[str, Any]:
    if not packets:
        return {}
    sorted_packets = sorted(packets.items(), key=lambda x: x[0])
    merged = dict(sorted_packets[0][1])
    merged.pop("seq", None)
    merged.pop("tot", None)
    for _, packet in sorted_packets[1:]:
        for key, value in packet.items():
            if key.startswith("port-"):
                merged[key] = value
    return merged

def process_packet(packet: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    seq = packet.get("seq")
    tot = packet.get("tot")

    if seq is None or tot is None:
        return packet

    buffer_key = get_buffer_key(packet)

    with BUFFER_LOCK:
        if buffer_key not in PACKET_BUFFER:
            PACKET_BUFFER[buffer_key] = {
                "packets": {},
                "timestamp": time.time(),
                "total": tot
            }

        buffer_entry = PACKET_BUFFER[buffer_key]
        buffer_entry["packets"][seq] = packet
        received_count = len(buffer_entry["packets"])

        if received_count == tot:
            merged = merge_packets(buffer_entry["packets"])
            del PACKET_BUFFER[buffer_key]
            return merged
        return None

def cleanup_stale_buffers():
    now = time.time()
    with BUFFER_LOCK:
        stale_keys = []
        for key, entry in PACKET_BUFFER.items():
            age = now - entry["timestamp"]
            if age > CFG.packet_buffer_timeout:
                stale_keys.append(key)
        for key in stale_keys:
            del PACKET_BUFFER[key]

# ================== Workers ========================
def worker_http_sender():
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
            log.debug(f"[HTTP SENDER] Processing data from queue")
            
            # Kirim langsung ke hub
            ok = send_hub_data(data)

            if ok:
                log.info(f"[SUCCESS] Data sent from sensor {data.get('sensor_controller_id', 'unknown')}")
            else:
                log.warning(f"[FAILED] Could not send data from sensor {data.get('sensor_controller_id', 'unknown')}")

            # Kirim status ke ESP32 receiver
            tag = b"[SVROK]\n" if ok else b"[SVRERR]\n"
            with SER_LOCK:
                if SER_HANDLE and SER_HANDLE.writable():
                    try:
                        SER_HANDLE.write(tag)
                        SER_HANDLE.flush()
                    except Exception:
                        pass
        except Exception as e:
            log.error(f"[HTTP SENDER ERROR] {e}")
        finally:
            DATA_QUEUE.task_done()

def worker_heartbeat_to_receiver():
    while not STOP.is_set():
        with SER_LOCK:
            if SER_HANDLE and SER_HANDLE.writable():
                try:
                    SER_HANDLE.write(b"[SVROK]\n")
                    SER_HANDLE.flush()
                except Exception:
                    pass
        STOP.wait(CFG.heartbeat_to_receiver_sec)

def worker_send_pi_serial():
    payload = ((PI_SERIAL or "UNKNOWN_PI") + "\n").encode("utf-8")
    while not STOP.is_set():
        with SER_LOCK:
            if SER_HANDLE and SER_HANDLE.writable():
                try:
                    SER_HANDLE.write(payload)
                    SER_HANDLE.flush()
                except Exception:
                    pass
        STOP.wait(CFG.send_pi_serial_sec)

def worker_push_raspi_data():
    while not STOP.is_set():
        try:
            post_raspi_data_once()
        except Exception as e:
            log.warning(f"[RASPI-DATA SEND ERROR] {e}")
        STOP.wait(CFG.push_raspi_data_sec)

def worker_buffer_cleanup():
    while not STOP.is_set():
        try:
            cleanup_stale_buffers()
        except Exception as e:
            log.error(f"[BUFFER CLEANUP ERROR] {e}")
        STOP.wait(CFG.packet_buffer_timeout / 2)

def worker_serial_reader():
    global SER_HANDLE
    buf = ""
    last_port: Optional[str] = None

    while not STOP.is_set():
        port = CFG.receiver_port_hint or (detect_serial_port() or last_port)
        if not port:
            STOP.wait(CFG.serial_detect_interval_sec)
            continue

        last_port = port

        try:
            with SER_LOCK:
                SER_HANDLE = serial.Serial(port, CFG.baud_rate, timeout=1)
            log.info(f"[SERIAL] Connected to {port} @{CFG.baud_rate}")

            while not STOP.is_set():
                with SER_LOCK:
                    if SER_HANDLE.in_waiting:
                        try:
                            new_data = SER_HANDLE.read(SER_HANDLE.in_waiting).decode(errors="ignore")
                            buf += new_data
                            # DEBUG: Print raw data received
                            if new_data.strip():
                                log.debug(f"[RAW DATA] Received {len(new_data)} bytes: {repr(new_data[:200])}")
                        except Exception as e:
                            log.error(f"[READ ERROR] {e}")
                            break

                # DEBUG: Show current buffer state periodically
                if buf and len(buf) > 0:
                    log.debug(f"[BUFFER] Current buffer size: {len(buf)} bytes")
                    log.debug(f"[BUFFER] Has sensorID: {'sensorID:' in buf}")
                    log.debug(f"[BUFFER] Has @sensor_data_start: {'@sensor_data_start' in buf}")
                    log.debug(f"[BUFFER] Has @sensor_data_end: {'@sensor_data_end' in buf}")
                    
                    # Show first 500 chars of buffer
                    if len(buf) > 50:
                        log.debug(f"[BUFFER PREVIEW] First 500 chars: {repr(buf[:500])}")

                # Process received data looking for complete packets
                while "sensorID:" in buf and "@sensor_data_start" in buf and "@sensor_data_end" in buf:
                    log.info("[PACKET DETECTION] Found complete packet markers!")
                    
                    # Find sensorID
                    sensorid_idx = buf.index("sensorID:")
                    sensorid_line_end = buf.index("\n", sensorid_idx)
                    sensorID = buf[sensorid_idx + 9:sensorid_line_end].strip()
                    log.info(f"[EXTRACTED] sensorID: '{sensorID}'")
                    
                    # Find sensor data block
                    start_idx = buf.index("@sensor_data_start") + len("@sensor_data_start")
                    end_idx = buf.index("@sensor_data_end")
                    sensor_data = buf[start_idx:end_idx].strip()
                    
                    log.info(f"[SENSOR DATA] Received from sensorID: {sensorID}")
                    log.debug(f"[SENSOR DATA RAW] {repr(sensor_data)}")

                    # Parse data per line (each line in format pX-sensor_type-value)
                    data_lines = sensor_data.split("\n")
                    log.debug(f"[PARSING] Found {len(data_lines)} lines to parse")
                    
                    # Build data array for backend
                    datas = []
                    for idx, line in enumerate(data_lines):
                        line = line.strip()
                        log.debug(f"[LINE {idx}] Processing: {repr(line)}")
                        
                        if not line or "-" not in line:
                            log.debug(f"[LINE {idx}] Skipped (empty or no dash)")
                            continue
                        
                        try:
                            parts = line.split("-")
                            log.debug(f"[LINE {idx}] Split into {len(parts)} parts: {parts}")
                            
                            if len(parts) < 3:
                                log.warning(f"[PARSE WARN] Invalid format: {line}")
                                continue
                            
                            port = parts[0]  # e.g., "p1"
                            sensor_type = parts[1]
                            sensor_value = "-".join(parts[2:])  # Join remaining parts in case value contains "-"
                            
                            log.debug(f"[LINE {idx}] Parsed: port={port}, type={sensor_type}, value={sensor_value}")
                            
                            if not port.startswith("p") or not port[1:].isdigit():
                                log.warning(f"[PARSE WARN] Invalid port format: {port}")
                                continue
                            
                            port_number = int(port[1:])  # Extract port number (e.g., p1 -> 1)
                            
                            # Skip null-null entries
                            if sensor_type == "null" and sensor_value == "null":
                                log.debug(f"[LINE {idx}] Skipped null-null entry")
                                continue
                            
                            datas.append({
                                "port_number": port_number,
                                "sensor_type": sensor_type,
                                "value": sensor_value
                            })
                            log.debug(f"[LINE {idx}] Added to datas array")
                            
                        except (ValueError, IndexError) as e:
                            log.warning(f"[PARSE ERROR] Failed to parse line: {line} - {e}")
                            continue
                    
                    log.info(f"[PARSING COMPLETE] Extracted {len(datas)} valid sensor entries")
                    
                    # Only send if we have valid sensorID and data
                    if not sensorID:
                        log.warning("[ERROR] sensorID is empty!")
                        buf = buf[end_idx + len("@sensor_data_end"):]
                        continue
                    
                    if not datas:
                        log.info(f"[INFO] No valid sensor data for sensorID: {sensorID}")
                        buf = buf[end_idx + len("@sensor_data_end"):]
                        continue

                    # Build payload for backend
                    payload = {
                        "sensor_controller_id": sensorID,
                        "raspberry_id": PI_SERIAL,
                        "datas": datas
                    }
                    
                    log.info(f"[PAYLOAD] Built payload: {json.dumps(payload, indent=2)}")

                    # Masukkan ke queue
                    log.debug(f"[QUEUE] Adding sensor data from {sensorID} to queue")
                    queue_put(payload)
                    log.info(f"[QUEUE] Successfully added to queue")

                    # Remove processed data from buffer
                    buf = buf[end_idx + len("@sensor_data_end"):]
                    log.debug(f"[BUFFER] Cleaned, remaining size: {len(buf)} bytes")

                time.sleep(0.01)  # Small delay to prevent busy-waiting

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
            log.error(f"[SERIAL ERROR] {e}", exc_info=True)
            with SER_LOCK:
                try:
                    if SER_HANDLE:
                        SER_HANDLE.close()
                except Exception:
                    pass
            SER_HANDLE = None
            STOP.wait(CFG.serial_detect_interval_sec)
            
# ================== GPS Worker ==================
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
    lat_dm, lat_dir, lon_dm, lon_dir, _dmy, _hms, alt, spd = [g.strip() for g in m.groups()]
    if not lat_dm or not lon_dm:
        return {"status": "nofix"}
    try:
        lat = _dm_to_dd(lat_dm)
        lon = _dm_to_dd(lon_dm)
        if lat_dir == "S":
            lat = -lat
        if lon_dir == "W":
            lon = -lon
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
    global LATEST_GPS_FIX
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
        except Exception:
            return ""

    ser = None
    last_status = None
    last_warn = 0.0
    warn_cooldown = 5.0

    while not STOP.is_set():
        if ser is None:
            ser = _open()
            if ser is None:
                STOP.wait(3.0)
                continue
            _send(ser, "AT")
            _send(ser, "ATE0")
            _send(ser, "AT+CFUN=1", wait=1.0)
            _send(ser, "AT+CGPS=1", wait=1.0)

        try:
            resp = _send(ser, "AT+CGPSINFO", wait=0.5)
            for line in resp.splitlines():
                if "+CGPSINFO:" not in line:
                    continue
                st = _parse_cgpsinfo(line)

                if st["status"] == "fix":
                    last_status = "fix"
                    speed_kmh = st["speed_knots"] * 1.852 if st.get("speed_knots") is not None else None

                    gps_fix = {
                        "altitude": st.get("alt_m"),
                        "latitude": st["lat"],
                        "longitude": st["lon"],
                        "speed_kmh": round(speed_kmh, 2) if speed_kmh is not None else None,
                        "timestamp_gps": datetime.utcnow().isoformat() + "Z",
                        "raw": line.strip(),
                    }

                    with GPS_FIX_LOCK:
                        LATEST_GPS_FIX = gps_fix

                elif st["status"] == "nofix":
                    now = time.time()
                    if last_status != "nofix" or (now - last_warn) > warn_cooldown:
                        log.warning("[GPS] No fix — waiting for satellites…")
                        last_warn = now
                    last_status = "nofix"

        except serial.SerialException:
            try:
                ser.close()
            except Exception:
                pass
            ser = None
        except Exception:
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
    log.info("[START] RasPi sender (updated for /api/raspi-data)")
    log.info(f"[CFG] Raspi Data → {CFG.raspi_data_url} (every {CFG.push_raspi_data_sec}s)")
    log.info(f"[CFG] Hub Data   → {CFG.hub_data_url}")
    log.info(f"[CFG] GPS PORT   → {CFG.gps_port}")

    PI_SERIAL = get_pi_serial()
    print(f"Raspberry Pi Serial ID: {PI_SERIAL}")

    install_signal_handlers()

    _ = [
        start_thread(worker_http_sender,           "http-sender"),
        start_thread(worker_heartbeat_to_receiver, "hb-to-rx"),
        start_thread(worker_send_pi_serial,        "send-pi-serial"),
        start_thread(worker_push_raspi_data,       "push-raspi-data"),
        start_thread(worker_serial_reader,         "serial-reader"),
        start_thread(worker_gps_reader,            "gps-reader"),
        start_thread(worker_buffer_cleanup,        "buffer-cleanup"),
    ]

    try:
        while not STOP.is_set():
            time.sleep(0.5)
    finally:
        end = time.time() + 3.0
        while time.time() < end and not DATA_QUEUE.empty():
            time.sleep(0.1)
        with SER_LOCK:
            try:
                if SER_HANDLE:
                    SER_HANDLE.close()
            except Exception:
                pass
    return 0

if __name__ == "__main__":
    sys.exit(main())
