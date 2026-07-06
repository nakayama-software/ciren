#!/bin/bash
# ============================================================
# CIREN ESP32-S3 Firmware Flash Script (Linux/Mac)
# ============================================================
#
# Prerequisites:
#   - Python 3.x with esptool: pip install esptool
#   - ESP32-S3 connected via USB-OTG port
#   - Put ESP32 into download mode: hold BOOT, press RESET
#
# Usage:
#   chmod +x flash_linux.sh
#   ./flash_linux.sh /dev/ttyUSB0
#
# ============================================================

CHIP="esp32s3"
FLASH_MODE="dio"
FLASH_FREQ="80m"
FLASH_SIZE="8MB"
BOOTLOADER="main_module_sim7080g.ino.bootloader.bin"
PARTITIONS="main_module_sim7080g.ino.partitions.bin"
BOOT_APP="boot_app0.bin"
FIRMWARE="main_module_sim7080g.ino.bin"
BAUD="460800"

PORT="${1:-}"
if [ -z "$PORT" ]; then
    echo "ERROR: Serial port not specified!"
    echo "Usage: $0 /dev/ttyUSB0"
    echo ""
    echo "Available ports:"
    python3 -m esptool scan 2>/dev/null || ls /dev/ttyUSB* /dev/ttyACM* 2>/dev/null
    exit 1
fi

echo "============================================================"
echo " CIREN ESP32-S3 Firmware Flash"
echo "============================================================"
echo " Chip:       $CHIP"
echo " Port:       $PORT"
echo " Baud:       $BAUD"
echo "============================================================"
echo ""

# Verify files
for f in "$BOOTLOADER" "$PARTITIONS" "$BOOT_APP" "$FIRMWARE"; do
    if [ ! -f "$f" ]; then
        echo "ERROR: File not found: $f"
        exit 1
    fi
done

echo "[1/4] Erasing flash..."
python3 -m esptool --chip "$CHIP" --port "$PORT" --baud "$BAUD" erase_flash || exit 1

echo ""
echo "[2/4] Flashing bootloader..."
python3 -m esptool --chip "$CHIP" --port "$PORT" --baud "$BAUD" \
    write_flash --flash_mode "$FLASH_MODE" --flash_freq "$FLASH_FREQ" --flash_size "$FLASH_SIZE" \
    0x0 "$BOOTLOADER" || exit 1

echo ""
echo "[3/4] Flashing partitions and boot_app0..."
python3 -m esptool --chip "$CHIP" --port "$PORT" --baud "$BAUD" \
    write_flash --flash_mode "$FLASH_MODE" --flash_freq "$FLASH_FREQ" --flash_size "$FLASH_SIZE" \
    0x8000 "$PARTITIONS" 0xe000 "$BOOT_APP" || exit 1

echo ""
echo "[4/4] Flashing firmware..."
python3 -m esptool --chip "$CHIP" --port "$PORT" --baud "$BAUD" \
    write_flash --flash_mode "$FLASH_MODE" --flash_freq "$FLASH_FREQ" --flash_size "$FLASH_SIZE" \
    0x10000 "$FIRMWARE" || exit 1

echo ""
echo "============================================================"
echo " Flash complete! ESP32-S3 will reboot automatically."
echo "============================================================"