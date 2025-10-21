import serial
import json
import requests
import threading
import time
from queue import Queue
from serial.tools import list_ports

# ==============================
# KONFIG
# ==============================
BAUD_RATE = 115200
REQUEST_TIMEOUT = 5
MAX_RETRY = 3

# GANTI sesuai server kamu:
# - Jika Express tanpa TLS: gunakan http://host:3000/...
# - Jika TLS valid: https://host:3000/...
VPS_API_URL = "http://192.168.103.174:3000/api/iot-data"  # CONTOH: Express HTTP
# VPS_API_URL = "https://projects.nakayamairon.com/ncs85283278/server/api/receive-data.php"  # contoh lain

data_queue = Queue(maxsize=1000)

SER_HANDLE = None
SER_LOCK = threading.Lock()  # supaya tulis serial thread-safe

PI_SERIAL = None

# ==============================
# DETEKSI PORT
# ==============================
def detect_serial_port():
    ports = list_ports.comports()
    for p in ports:
        if "USB" in p.device or "ACM" in p.device:
            print(f"[FOUND] Detected ESP32 at {p.device}")
            return p.device
    print("[ERROR] No ESP32 detected. Please plug in the device.")
    return None


# ==============================
# AMBIL SERIAL NUMBER RPI
# ==============================
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
    # fallback /proc/cpuinfo
    try:
        with open("/proc/cpuinfo") as f:
            for line in f:
                if line.lower().startswith("serial"):
                    return line.split(":")[1].strip()
    except Exception:
        pass
    return "UNKNOWN_PI"


# ==============================
# KIRIM DATA KE SERVER
# ==============================
def send_to_vps_worker():
    global SER_HANDLE, PI_SERIAL
    while True:
        data = data_queue.get()
        try:
            success = False
            for attempt in range(1, MAX_RETRY + 1):
                try:
                    # >>>>> PATCH PENTING: bungkus sesuai skema server
                    payload = {
                        "raspi_serial_id": str(PI_SERIAL or "UNKNOWN_PI"),
                        "data": [data],  # array of readings
                    }

                    resp = requests.post(VPS_API_URL, json=payload, timeout=REQUEST_TIMEOUT)
                    print(f"[VPS RESPONSE] {resp.status_code}: {resp.text}")
                    success = (200 <= resp.status_code < 300)
                    if success:
                        break
                except requests.exceptions.RequestException as e:
                    print(f"[RETRY {attempt}] VPS ERROR: {e}")
                    time.sleep(1)

            tag = b"[SVROK]\n" if success else b"[SVRERR]\n"
            with SER_LOCK:
                if SER_HANDLE and SER_HANDLE.writable():
                    try:
                        SER_HANDLE.write(tag)
                        SER_HANDLE.flush()
                    except Exception as e:
                        print(f"[TX HEARTBEAT ERROR] {e}")

            if not success:
                print("[FAILED] Gagal kirim setelah retry.")
        finally:
            data_queue.task_done()

# ==============================
# HEARTBEAT BERKALA (agar status tetap Online)
# ==============================
def periodic_heartbeat():
    global SER_HANDLE
    while True:
        with SER_LOCK:
            if SER_HANDLE and SER_HANDLE.writable():
                try:
                    SER_HANDLE.write(b"[SVROK]\n")
                    SER_HANDLE.flush()
                except Exception as e:
                    print(f"[HB ERROR] {e}")
        time.sleep(5)


# ==============================
# KIRIM PI SERIAL (saat konek & berkala)
# ==============================
def periodic_send_pi_serial(pi_serial):
    global SER_HANDLE
    while True:
        with SER_LOCK:
            if SER_HANDLE and SER_HANDLE.writable():
                try:
                    SER_HANDLE.write((pi_serial + "\n").encode("utf-8"))
                    SER_HANDLE.flush()
                except Exception as e:
                    print(f"[TX PI SERIAL ERROR] {e}")
        time.sleep(30)  # kirim ulang tiap 30 detik


# ==============================
# LOOP PEMBACA SERIAL
# ==============================
def read_serial_loop():
    global SER_HANDLE
    pi_serial = get_pi_serial()
    print(f"[PI SERIAL] {pi_serial}")

    port = detect_serial_port()
    if not port:
        print("[EXIT] Tidak ada ESP32 yang terdeteksi.")
        raise SystemExit(1)

    while True:
        try:
            with SER_LOCK:
                SER_HANDLE = serial.Serial(port, BAUD_RATE, timeout=1)
            print(f"[OK] Connected to {port} at {BAUD_RATE} baud")

            # Kirim Raspberry ID sekali saat koneksi terbuka
            with SER_LOCK:
                try:
                    SER_HANDLE.write((pi_serial + "\n").encode("utf-8"))
                    SER_HANDLE.flush()
                    print("[TX] Sent PI serial to ESP32")
                except Exception as e:
                    print(f"[TX ERROR] {e}")

            buffer = ""

            # loop baca
            while True:
                with SER_LOCK:
                    if SER_HANDLE.in_waiting:
                        buffer += SER_HANDLE.read(SER_HANDLE.in_waiting).decode(errors="ignore")

                while "\n" in buffer:
                    line, buffer = buffer.split("\n", 1)
                    line = line.strip("\r").strip()
                    if not line:
                        continue

                    print(f"[SERIAL] {line}")

                    if line.startswith("[FOR_PI]"):
                        json_part = line.replace("[FOR_PI]", "").strip()
                        try:
                            parsed = json.loads(json_part)
                            data_queue.put(parsed, timeout=1)
                            print(f"[QUEUE] Data parsed & queued: {parsed}")
                        except json.JSONDecodeError as e:
                            print(f"[JSON ERROR] {e}: {json_part}")
                    else:
                        print(f"[INFO] Non-JSON line ignored: {line}")

        except serial.SerialException as e:
            print(f"[DISCONNECTED] Lost connection: {e}")
            time.sleep(3)
            port = detect_serial_port() or port
        except Exception as e:
            print(f"[SERIAL ERROR] {e}")
            time.sleep(3)


# ==============================
# MAIN
# ==============================
if __name__ == "__main__":
    print("[STARTING] Serial → Server logger running")

    PI_SERIAL = get_pi_serial()
    print(f"[PI SERIAL] {PI_SERIAL}")

    # Thread pengiriman data ke server
    for _ in range(5):
        threading.Thread(target=send_to_vps_worker, daemon=True).start()

    # Thread heartbeat berkala
    threading.Thread(target=periodic_heartbeat, daemon=True).start()

    # Thread baca serial (akan open port & kirim Pi serial awal)
    threading.Thread(target=read_serial_loop, daemon=True).start()

    # Thread kirim Pi serial berkala (butuh waktu sampai SER_HANDLE terisi)
    pi_serial_value = get_pi_serial()
    threading.Thread(target=periodic_send_pi_serial, args=(pi_serial_value,), daemon=True).start()

    # Jaga main thread tetap hidup
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n[EXIT] Stopped by user.")
