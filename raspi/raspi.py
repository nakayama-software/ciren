#!/usr/bin/env python3
# -*- coding: utf-8 -*- 

from __future__ import annotations
import os
import sys
import time
import json
import signal
import logging
import asyncio
from dataclasses import dataclass
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
    format="%(asctime)s.%(msecs)03d %(levelname)s [%(name)s] %(message)s",
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
PI_SERIAL: str = "UNKNOWN_PI"
LATEST_GPS_FIX: Optional[Dict[str, Any]] = None
PACKET_BUFFER: Dict[str, Dict[str, Any]] = {}

# Use asyncio.Queue for asynchronous queue handling
DATA_QUEUE: asyncio.Queue[Dict[str, Any]] = asyncio.Queue(maxsize=CFG.queue_maxsize)

# Add an asyncio lock for managing serial access
SER_HANDLE_LOCK = asyncio.Lock()
SER_HANDLE: Optional[serial.Serial] = None

# ================== Helpers =======================
async def detect_serial_port() -> Optional[str]:
    gps_dev = (CFG.gps_port or "").lower()
    for p in list_ports.comports():
        dev = p.device.lower()
        if dev == gps_dev:
            continue
        if any(tag in dev for tag in ("ttyusb", "ttyacm", "cu.usbserial", "cu.usbmodem")):
            log.info(f"[FOUND] ESP32 receiver at {p.device}")
            return p.device
    return None

async def get_pi_serial() -> str:
    for path in ("/sys/firmware/devicetree/base/serial-number", "/proc/device-tree/serial-number"):
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

async def get_raspi_cpu_temp_c() -> Optional[float]:
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

async def get_uptime_s() -> Optional[float]:
    try:
        with open("/proc/uptime") as f:
            return float(f.read().split()[0])
    except Exception:
        return None

async def get_mem_mb() -> Tuple[Optional[int], Optional[int]]:
    if psutil is None:
        return None, None
    try:
        vm = psutil.virtual_memory()
        return int(vm.used / (1024 * 1024)), int(vm.total / (1024 * 1024))
    except Exception:
        return None, None

# ================== HTTP helpers ==================
async def _http_post(url: str, payload: Dict[str, Any], timeout: Optional[int] = None) -> bool:
    to = timeout if timeout is not None else CFG.request_timeout
    for attempt in range(1, CFG.http_max_retry + 1):
        try:
            resp = await asyncio.to_thread(requests.post, url, json=payload, timeout=to)
            if 200 <= resp.status_code < 300:
                return True
            log.warning(f"[HTTP {resp.status_code}] {url} {resp.text[:160]}")
        except requests.exceptions.RequestException as e:
            log.warning(f"[HTTP RETRY {attempt}] {url} -> {e}")
    return False

async def send_hub_data(payload: Dict[str, Any]) -> bool:
    return await _http_post(CFG.hub_data_url, payload)

async def post_raspi_data_once() -> bool:
    datas: List[Dict[str, Any]] = []

    temp_c = await get_raspi_cpu_temp_c()
    if temp_c is not None:
        datas.append({
            "temperature": temp_c,
            "timestamp_temperature": datetime.utcnow().isoformat() + "Z",
            "uptime_s": await get_uptime_s(),
        })
    else:
        datas.append({
            "uptime_s": await get_uptime_s(),
            "timestamp_temperature": datetime.utcnow().isoformat() + "Z",
        })

    gps_snapshot = dict(LATEST_GPS_FIX) if LATEST_GPS_FIX else None
    if gps_snapshot is not None:
        datas.append(gps_snapshot)

    payload = {
        "raspberry_serial_id": str(PI_SERIAL or "UNKNOWN_PI"),
        "datas": datas,
    }
    return await _http_post(CFG.raspi_data_url, payload)

async def queue_put(data: Dict[str, Any]) -> None:
    try:
        await DATA_QUEUE.put(data)
    except asyncio.QueueFull:
        log.warning("[QUEUE] Full, dropping payload")

# ================== Workers ========================
async def worker_http_sender():
    while True:
        log.debug(f"[worker_http_sender] Started")
        data = await DATA_QUEUE.get()
        if data:
            log.debug(f"[HTTP SENDER] Processing data from queue")
            ok = await send_hub_data(data)
            if ok:
                log.info(f"[SUCCESS] Data sent from sensor {data.get('sensor_controller_id', 'unknown')}")
            else:
                log.warning(f"[FAILED] Could not send data from sensor {data.get('sensor_controller_id', 'unknown')}")
            # Write to the serial if available
            async with SER_HANDLE_LOCK:
                if SER_HANDLE and SER_HANDLE.writable():
                    tag = b"[SVROK]\n" if ok else b"[SVRERR]\n"
                    await asyncio.to_thread(SER_HANDLE.write, tag)
                    await asyncio.to_thread(SER_HANDLE.flush)
        await asyncio.sleep(1)

# Worker to keep the heartbeat signal alive to ESP32
async def worker_heartbeat_to_receiver():
    while True:
        log.debug(f"[worker_heartbeat_to_receiver] Started")
        async with SER_HANDLE_LOCK:
            if SER_HANDLE and SER_HANDLE.writable():
                await asyncio.to_thread(SER_HANDLE.write, b"[SVROK]\n")
                await asyncio.to_thread(SER_HANDLE.flush)
        await asyncio.sleep(CFG.heartbeat_to_receiver_sec)

# Worker to send Raspberry Pi serial ID to ESP32
async def worker_send_pi_serial():
    while True:
        log.debug(f"[worker_send_pi_serial] Started")
        payload = ((PI_SERIAL or "UNKNOWN_PI") + "\n").encode("utf-8")
        async with SER_HANDLE_LOCK:
            if SER_HANDLE and SER_HANDLE.writable():
                await asyncio.to_thread(SER_HANDLE.write, payload)
                await asyncio.to_thread(SER_HANDLE.flush)
        await asyncio.sleep(CFG.send_pi_serial_sec)

# =================== Main/Runner ===================
async def main():
    global PI_SERIAL
    log.info("[START] RasPi sender (updated for /api/raspi-data)")

    PI_SERIAL = await get_pi_serial()
    print(f"Raspberry Pi Serial ID: {PI_SERIAL}")

    # Start all worker tasks concurrently
    await asyncio.gather(
        worker_http_sender(),
        worker_heartbeat_to_receiver(),
        worker_send_pi_serial(),
    )

if __name__ == "__main__":
    asyncio.run(main())
