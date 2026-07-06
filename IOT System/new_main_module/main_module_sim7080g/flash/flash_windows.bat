@echo off
REM ============================================================
REM CIREN ESP32-S3 Firmware Flash Script (Windows)
REM ============================================================
REM
REM Prerequisites:
REM   - Python 3.x with esptool: pip install esptool
REM   - ESP32-S3 connected via USB-OTG port (NOT CH343 UART)
REM   - Put ESP32 into download mode: hold BOOT button, press RESET
REM
REM Usage:
REM   1. Connect ESP32-S3 via USB-OTG cable to your PC
REM   2. Run this script: flash_windows.bat COM5
REM      (replace COM5 with your actual COM port)
REM   3. Wait for flash to complete
REM
REM ============================================================

setlocal enabledelayedexpansion

REM --- Configuration ---
set CHIP=esp32s3
set FLASH_MODE=dio
set FLASH_FREQ=80m
set FLASH_SIZE=8MB
set BOOTLOADER=main_module_sim7080g.ino.bootloader.bin
set PARTITIONS=main_module_sim7080g.ino.partitions.bin
set BOOT_APP=boot_app0.bin
set FIRMWARE=main_module_sim7080g.ino.bin
set BAUD=460800

REM --- Check COM port ---
if "%~1"=="" (
    echo ERROR: COM port not specified!
    echo Usage: flash_windows.bat COMx
    echo Example: flash_windows.bat COM5
    echo.
    echo Available COM ports:
    python -m esptool scan
    exit /b 1
)

set PORT=%~1

echo ============================================================
echo  CIREN ESP32-S3 Firmware Flash
echo ============================================================
echo  Chip:       %CHIP%
echo  Port:       %PORT%
echo  Baud:       %BAUD%
echo  Flash Mode: %FLASH_MODE%
echo  Flash Freq:  %FLASH_FREQ%
echo  Flash Size:  %FLASH_SIZE%
echo ============================================================
echo.

REM --- Verify files exist ---
for %%f in (%BOOTLOADER% %PARTITIONS% %BOOT_APP% %FIRMWARE%) do (
    if not exist "%%f" (
        echo ERROR: File not found: %%f
        echo Make sure this script is in the same directory as the .bin files
        exit /b 1
    )
)

echo [1/4] Erasing flash...
python -m esptool --chip %CHIP% --port %PORT% --baud %BAUD% erase_flash
if errorlevel 1 (
    echo ERROR: Erase flash failed!
    exit /b 1
)

echo.
echo [2/4] Flashing bootloader...
python -m esptool --chip %CHIP% --port %PORT% --baud %BAUD% write_flash --flash_mode %FLASH_MODE% --flash_freq %FLASH_FREQ% --flash_size %FLASH_SIZE% 0x0 %BOOTLOADER%
if errorlevel 1 (
    echo ERROR: Bootloader flash failed!
    exit /b 1
)

echo.
echo [3/4] Flashing partitions and boot_app0...
python -m esptool --chip %CHIP% --port %PORT% --baud %BAUD% write_flash --flash_mode %FLASH_MODE% --flash_freq %FLASH_FREQ% --flash_size %FLASH_SIZE% 0x8000 %PARTITIONS% 0xe000 %BOOT_APP%
if errorlevel 1 (
    echo ERROR: Partitions flash failed!
    exit /b 1
)

echo.
echo [4/4] Flashing firmware...
python -m esptool --chip %CHIP% --port %PORT% --baud %BAUD% write_flash --flash_mode %FLASH_MODE% --flash_freq %FLASH_FREQ% --flash_size %FLASH_SIZE% 0x10000 %FIRMWARE%
if errorlevel 1 (
    echo ERROR: Firmware flash failed!
    exit /b 1
)

echo.
echo ============================================================
echo  Flash complete! ESP32-S3 will reboot automatically.
echo ============================================================
echo.
echo Next steps:
echo   1. Disconnect USB-OTG cable
echo   2. Power cycle the ESP32-S3
echo   3. Verify serial output at 115200 baud
echo.
pause