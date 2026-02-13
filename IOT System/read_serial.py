import serial
import time
from datetime import datetime

PORT = "COM5"
BAUDRATE = 9600
CHUNK = 64  # byte per baca

ser = serial.Serial(PORT, BAUDRATE, timeout=0.1)
time.sleep(2)

print("DEBUG RAW SERIAL:", PORT)

with open("serial_raw.bin", "ab") as bin_file, \
     open("serial_dump.txt", "a", encoding="utf-8") as txt_file:

    try:
        while True:
            data = ser.read(CHUNK)
            if data:
                ts = datetime.now().isoformat()

                # simpan RAW
                bin_file.write(data)
                bin_file.flush()

                # HEX + ASCII
                hex_data = data.hex(" ")
                ascii_data = "".join(chr(b) if 32 <= b <= 126 else "." for b in data)

                line = f"{ts} | HEX: {hex_data} | ASCII: {ascii_data}"
                print(line)

                txt_file.write(line + "\n")
                txt_file.flush()

    except KeyboardInterrupt:
        print("\nStop debug logger")

ser.close()
