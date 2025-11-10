# pip install pyserial
import serial, time, re, logging
from datetime import datetime

PORT = "/dev/ttyUSB3"   # ← set to your AT port (NOT the NMEA port)
BAUD = 115200

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s: %(message)s",
    datefmt="%H:%M:%S"
)

PATTERN = re.compile(
    r"\+CGPSINFO:\s*([^,]*),([NS]?),(.*?),([EW]?),(.*?),(.*?),(.*?),(.*?),?$"
)

def dm_to_dd(dm_str: str) -> float:
    dm = float(dm_str)
    d = int(dm // 100)
    m = dm - d * 100
    return d + m / 60.0

def parse_cgpsinfo(line: str):
    m = PATTERN.search(line)
    if not m:
        return {"status": "invalid", "raw": line}

    lat_dm, lat_dir, lon_dm, lon_dir, dmy, hms, alt, spd = [g.strip() for g in m.groups()]

    # No-fix if lat/lon missing (modules return +CGPSINFO: ,,,,,,,,)
    if not lat_dm or not lon_dm:
        return {"status": "nofix"}

    try:
        lat = dm_to_dd(lat_dm)
        lon = dm_to_dd(lon_dm)
        if lat_dir == "S": lat = -lat
        if lon_dir == "W": lon = -lon
    except Exception:
        return {"status": "invalid", "raw": line}

    ts = None
    try:
        if dmy and hms:
            ts = datetime.strptime(dmy + hms.split(".")[0], "%d%m%y%H%M%S")
    except Exception:
        pass

    return {
        "status": "fix",
        "lat": lat,
        "lon": lon,
        "alt_m": float(alt) if alt else None,
        "speed_knots": float(spd) if spd else None,
        "utc": ts.isoformat() + "Z" if ts else None
    }

def send_cmd(ser: serial.Serial, cmd: str, wait=0.4, expect="OK"):
    ser.reset_input_buffer()
    ser.write((cmd + "\r\n").encode("ascii"))
    time.sleep(wait)
    out = ser.read_all().decode("ascii", errors="ignore")
    if expect and expect not in out:
        logging.debug("CMD %s got: %s", cmd, out.strip())
    return out

def ensure_gnss_on(ser: serial.Serial):
    # Basic sanity
    send_cmd(ser, "AT")
    send_cmd(ser, "ATE0")                 # echo off (optional)
    # Full functionality (can take a moment; some modules briefly re-enumerate)
    resp = send_cmd(ser, "AT+CFUN=1", wait=0.8)
    # Power on GNSS for SIMCom-style AT
    resp = send_cmd(ser, "AT+CGPS=1", wait=0.8)
    # Optional: confirm
    # Some modules support AT+CGPS? or AT+CGPSSTATUS -- adjust per model
    return True

def main():
    last_status = None
    last_warn_ts = 0
    WARN_COOLDOWN_S = 5

    with serial.Serial(PORT, BAUD, timeout=1) as ser:
        logging.info("Opening %s @ %d", PORT, BAUD)
        ensure_gnss_on(ser)

        while True:
            # Poll GPS info
            resp = send_cmd(ser, "AT+CGPSINFO", wait=0.5, expect=None)
            for line in resp.splitlines():
                if "+CGPSINFO:" not in line:
                    continue
                st = parse_cgpsinfo(line)

                if st["status"] == "fix":
                    if last_status != "fix":
                        logging.info("GPS fix acquired.")
                    logging.info(
                        "Lat=%.8f Lon=%.8f Alt=%s(m) Spd=%s(knots) UTC=%s",
                        st["lat"], st["lon"],
                        st.get("alt_m"), st.get("speed_knots"), st.get("utc")
                    )
                    last_status = "fix"

                elif st["status"] == "nofix":
                    now = time.time()
                    if last_status != "nofix" or (now - last_warn_ts) > WARN_COOLDOWN_S:
                        logging.warning("GPS has no fix — waiting for satellites…")
                        last_warn_ts = now
                    last_status = "nofix"

                else:
                    logging.debug("Unrecognized: %s", st.get("raw", line))

            time.sleep(1.0)

if __name__ == "__main__":
    main()
