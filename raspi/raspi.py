# raspi_sender.py — Raspberry Pi Serial → Express Server (optimized)
import os
import serial
import json
import requests
import threading
import time
import psutil
from queue import Queue, Full
from serial.tools import list_ports
from datetime import datetime

# ===================== CONFIG =====================
BAUD_RATE = 115200
REQUEST_TIMEOUT = 5
MAX_RETRY = 3
SERIAL_DETECT_INTERVAL = 3

# Ganti ke URL backend kamu
VPS_API_URL = os.environ.get("VPS_API_URL", "http://127.0.0.1:3000/api/iot-data")

HEARTBEAT_TO_RECEIVER_SEC = 5      # kirim [SVROK] ke receiver tiap 5s
PUSH_SYS_METRICS_SEC = 5           # kirim RASPI_SYS tiap 5s
QUEUE_MAXSIZE = 2000

data_queue = Queue(maxsize=QUEUE_MAXSIZE)
SER_HANDLE = None
SER_LOCK = threading.Lock()
HTTP_SESSION = requests.Session()

PI_SERIAL = None

# ================== HELPERS =======================
def detect_serial_port():
  """Cari port USB ESP32 (receiver)"""
  ports = list_ports.comports()
  for p in ports:
    name = p.device.lower()
    if any(tag in name for tag in ("ttyusb", "ttyacm", "cu.usbserial", "cu.usbmodem")):
      print(f"[FOUND] ESP32 receiver at {p.device}")
      return p.device
  print("[WAIT] No ESP32 serial yet...")
  return None

def get_pi_serial():
  candidates = [
    "/sys/firmware/devicetree/base/serial-number",
    "/proc/device-tree/serial-number",
  ]
  for path in candidates:
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

def get_raspi_cpu_temp_c():
  # Prefer vcgencmd jika ada (akurasi bagus dan tak perlu root)
  try:
    import subprocess
    out = subprocess.check_output(["vcgencmd", "measure_temp"], text=True).strip()
    # output: temp=48.0'C
    if out.startswith("temp=") and out.endswith("'C"):
      return float(out[5:-2])
  except Exception:
    pass
  # Fallback ke file thermal
  try:
    with open("/sys/class/thermal/thermal_zone0/temp") as f:
      return int(f.read().strip()) / 1000.0
  except Exception:
    return None

def get_raspi_sys_metrics():
  temp_c = get_raspi_cpu_temp_c()
  # uptime
  try:
    with open("/proc/uptime") as f:
      uptime_s = float(f.read().split()[0])
  except Exception:
    uptime_s = None
  # load avg
  try:
    load1, load5, load15 = os.getloadavg()
  except Exception:
    load1 = load5 = load15 = None
  # mem
  try:
    vm = psutil.virtual_memory()
    mem_used_mb = int(vm.used / (1024 * 1024))
    mem_total_mb = int(vm.total / (1024 * 1024))
  except Exception:
    mem_used_mb = mem_total_mb = None

  return {
    "sensor_controller_id": "RASPI_SYS",
    "raspi_temp_c": temp_c,
    "uptime_s": uptime_s,
    "load1": load1,
    "load5": load5,
    "load15": load15,
    "mem_used_mb": mem_used_mb,
    "mem_total_mb": mem_total_mb,
    "ts_iso": datetime.utcnow().isoformat() + "Z"
  }

# ================== WORKERS ========================
def send_to_vps_worker():
  """Worker HTTP untuk mengirim ke server dengan retry."""
  global SER_HANDLE
  while True:
    data = data_queue.get()
    try:
      if not isinstance(data, dict):
        # pastikan dict
        data = {"_raw": str(data)}

      # Enrich minimal
      data.setdefault("_pi_serial", PI_SERIAL or "UNKNOWN_PI")
      data.setdefault("_received_ts", int(time.time()))

      payload = {
        "raspi_serial_id": str(PI_SERIAL or "UNKNOWN_PI"),
        "data": [data]
      }

      success = False
      for attempt in range(1, MAX_RETRY + 1):
        try:
          resp = HTTP_SESSION.post(VPS_API_URL, json=payload, timeout=REQUEST_TIMEOUT)
          print(f"[POST] {resp.status_code} {resp.text[:160]}")
          success = (200 <= resp.status_code < 300)
          if success: break
        except requests.exceptions.RequestException as e:
          print(f"[RETRY {attempt}] HTTP error: {e}")
          time.sleep(min(1 * attempt, 5))

      tag = b"[SVROK]\n" if success else b"[SVRERR]\n"
      with SER_LOCK:
        if SER_HANDLE and SER_HANDLE.writable():
          try:
            SER_HANDLE.write(tag)
            SER_HANDLE.flush()
          except Exception as e:
            print(f"[TX TAG ERROR] {e}")

      if not success:
        print("[FAILED] giving up this payload.")
    finally:
      data_queue.task_done()

def periodic_heartbeat():
  """Heartbeat ke receiver supaya status server di OLED tetap segar."""
  global SER_HANDLE
  while True:
    with SER_LOCK:
      if SER_HANDLE and SER_HANDLE.writable():
        try:
          SER_HANDLE.write(b"[SVROK]\n")
          SER_HANDLE.flush()
        except Exception as e:
          print(f"[HB ERROR] {e}")
    time.sleep(HEARTBEAT_TO_RECEIVER_SEC)

def periodic_send_pi_serial():
  """Kirim serial RasPi berkala ke receiver untuk ditampilkan."""
  global SER_HANDLE
  while True:
    s = (PI_SERIAL or "UNKNOWN_PI") + "\n"
    with SER_LOCK:
      if SER_HANDLE and SER_HANDLE.writable():
        try:
          SER_HANDLE.write(s.encode("utf-8"))
          SER_HANDLE.flush()
        except Exception as e:
          print(f"[TX PI SERIAL ERROR] {e}")
    time.sleep(30)

def periodic_push_sys_metrics():
  """Selalu kirim RASPI_SYS tiap interval (walau tidak ada node)."""
  while True:
    try:
      metrics = get_raspi_sys_metrics()
      try:
        data_queue.put(metrics, timeout=1)
      except Full:
        print("[QUEUE] Full, dropping RASPI_SYS")
    except Exception as e:
      print(f"[SYS METRICS ERROR] {e}")
    time.sleep(PUSH_SYS_METRICS_SEC)

def read_serial_loop():
  """Baca baris dari ESP32 receiver. Forward JSON bertanda [FOR_PI]."""
  global SER_HANDLE
  while True:
    port = detect_serial_port()
    if not port:
      time.sleep(SERIAL_DETECT_INTERVAL)
      continue

    try:
      with SER_LOCK:
        SER_HANDLE = serial.Serial(port, BAUD_RATE, timeout=1)
      print(f"[SERIAL] Connected to {port} @{BAUD_RATE}")

      # kirim PI serial saat connect
      with SER_LOCK:
        try:
          SER_HANDLE.write(((PI_SERIAL or "UNKNOWN_PI") + "\n").encode("utf-8"))
          SER_HANDLE.flush()
          print("[TX] sent PI serial to receiver")
        except Exception as e:
          print(f"[TX INIT ERROR] {e}")

      buffer = ""
      while True:
        with SER_LOCK:
          if SER_HANDLE.in_waiting:
            buffer += SER_HANDLE.read(SER_HANDLE.in_waiting).decode(errors="ignore")

        while "\n" in buffer:
          line, buffer = buffer.split("\n", 1)
          line = line.strip("\r").strip()
          if not line:
            continue

          if line.startswith("[FOR_PI]"):
            json_part = line.replace("[FOR_PI]", "", 1).strip()
            if json_part.startswith("{") and json_part.endswith("}"):
              try:
                parsed = json.loads(json_part)
                try:
                  data_queue.put(parsed, timeout=1)
                  print("[QUEUE] hub JSON queued")
                except Full:
                  print("[QUEUE] Full, dropping hub JSON")
              except json.JSONDecodeError as e:
                print(f"[JSON ERROR] {e}: {json_part[:200]}")
            else:
              print(f"[WARN] Non-object/malformed JSON: {json_part[:160]}")
          else:
            # abaikan baris lain
            pass

        time.sleep(0.01)

    except serial.SerialException as e:
      print(f"[DISCONNECTED] {e}")
      time.sleep(SERIAL_DETECT_INTERVAL)
    except Exception as e:
      print(f"[SERIAL ERROR] {e}")
      time.sleep(SERIAL_DETECT_INTERVAL)

# ====================== MAIN ======================
if __name__ == "__main__":
  print("[START] RasPi sender")
  PI_SERIAL = get_pi_serial()
  print(f"[PI SERIAL] {PI_SERIAL}")

  # Worker HTTP
  for _ in range(4):
    threading.Thread(target=send_to_vps_worker, daemon=True).start()

  # Periodic tasks
  threading.Thread(target=periodic_heartbeat, daemon=True).start()
  threading.Thread(target=periodic_send_pi_serial, daemon=True).start()
  threading.Thread(target=periodic_push_sys_metrics, daemon=True).start()

  # Serial reader
  threading.Thread(target=read_serial_loop, daemon=True).start()

  # Keep alive
  try:
    while True:
      time.sleep(1)
  except KeyboardInterrupt:
    print("\n[EXIT] Stopped.")
