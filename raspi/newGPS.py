# pip install pyserial
import serial, time, re, json
from datetime import datetime

PORT = "/dev/ttyUSB3"
BAUD = 115200

PATTERN = re.compile(
    r"\+CGPSINFO:\s*([^,]+),(N|S),([^,]+),(E|W),(\d{6}),(\d{6}(?:\.\d+)?),([^,]*),([^,]*),?"
)

def dm_to_dd(dm_str: str) -> float:
    dm = float(dm_str)
    degrees = int(dm // 100)
    minutes = dm - (degrees * 100)
    return degrees + minutes / 60.0

def parse(line: str):
    m = PATTERN.search(line)
    if not m:
        return None
    lat_dm, lat_dir, lon_dm, lon_dir, dmy, hms, alt, spd = m.groups()
    lat = dm_to_dd(lat_dm); lon = dm_to_dd(lon_dm)
    if lat_dir == "S": lat = -lat
    if lon_dir == "W": lon = -lon
    dt_utc = None
    try:
        dt_utc = datetime.strptime(dmy + hms.split(".")[0], "%d%m%y%H%M%S")
    except Exception:
        pass
    return {
        "lat": lat, "lon": lon,
        "alt_m": float(alt) if alt.strip() else None,
        "speed_knots": float(spd) if spd.strip() else None,
        "utc": dt_utc.isoformat() + "Z" if dt_utc else None
    }

def send_cmd(ser: serial.Serial, cmd: str, wait=0.2):
    ser.reset_input_buffer()
    ser.write((cmd + "\r\n").encode("ascii"))
    time.sleep(wait)
    out = ser.read_all().decode("ascii", errors="ignore")
    return out

def main():
    with serial.Serial(PORT, BAUD, timeout=1) as ser:
        # (Optional) power on/start GNSS for your module:
        # send_cmd(ser, "AT+CGPS=1")
        while True:
            resp = send_cmd(ser, "AT+CGPSINFO", wait=0.5)
            for line in resp.splitlines():
                if "+CGPSINFO:" in line:
                    data = parse(line)
                    if data:
                        print(json.dumps(data, ensure_ascii=False))
            time.sleep(1.0)

if __name__ == "__main__":
    main()
