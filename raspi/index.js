#!/usr/bin/env node

const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const fs = require('fs');
const { parseNmeaForFix, fetchWithTimeout, getPiSerial, getRaspiCpuTempC, safeJson } = require('./helper');
const path = require('path');

const gpsBaudRate = 115200;

const ESP32_BAUD = 115200;

// const RASPI_DATA_URL = 'http://192.168.10.5:3000/api/raspi-data';
const RASPI_DATA_URL = 'http://118.22.31.249:3000/api/raspi-data';
const RASPI_PUSH_INTERVAL_MS = 1 * 30 * 1000;

// const SENSOR_DATA_URL = 'http://192.168.10.5:3000/api/sensor-data';
const SENSOR_DATA_URL = 'http://118.22.31.249:3000/api/sensor-data';
const SENSOR_POST_INTERVAL_MS = 100;

const GPS_POLL_INTERVAL_MS = 5000; // polling AT+CGPSINFO tiap 5 detik

let sensorPosting = false;

let latitude = null;
let longitude = null;
let altitude = null;

let lastTempC = null;

const piSerial = getPiSerial();

let esp32PortInstance = null;
let espBuf = '';

let pushing = false;

// Serial ID handshake state
let piSerialAcked = false;
let piSerialRetryTimer = null;
const PI_SERIAL_RETRY_INTERVAL_MS = 3000;
const PI_SERIAL_SEND_DELAY_MS = 5000; // wait for USB enumeration noise to settle

// ------------------ PORT Handling ---------------------
function findPortById(keywords = []) {
    const base = '/dev/serial/by-id';
    if (!fs.existsSync(base)) return null;

    const entries = fs.readdirSync(base);
    const found = entries.find((name) => {
        const s = name.toLowerCase();
        return keywords.every((k) => s.includes(k.toLowerCase()));
    });

    return found ? path.join(base, found) : null;
}

function resolveRealPathSafe(devPath) {
    try {
        return fs.realpathSync(devPath);
    } catch {
        return devPath;
    }
}

// ------------------ GPS Handling ---------------------
function findGpsPortPath() {
    return (
        process.env.GPS_PORT ||
        findPortById(['qualcomm', 'if02']) ||
        '/dev/ttyUSB3'
    );
}

/**
 * Parse +CGPSINFO AT response dari modem (SIM7600/EC25/dll)
 * Format: +CGPSINFO: lat,N/S,lon,E/W,date,time,alt,speed,course
 * Contoh: +CGPSINFO: 3312.697511,N,13002.783355,E,120326,133349.0,39.7,0.0,
 *
 * Koordinat dalam format DDMM.MMMMMM, perlu dikonversi ke decimal degrees.
 */
function parseCgpsInfo(line) {
    // Tangani juga response kosong: "+CGPSINFO: ,,,,,,,,,"
    const m = line.match(
        /\+CGPSINFO:\s*([\d.]+),(N|S),([\d.]+),(E|W),([\d]*),([\d.]*),([\d.-]*),([\d.-]*)/i
    );
    if (!m) return null;

    const rawLat = parseFloat(m[1]);
    const rawLon = parseFloat(m[3]);

    if (isNaN(rawLat) || isNaN(rawLon)) return null;

    // Konversi DDMM.MMMM → decimal degrees
    const latDeg = Math.floor(rawLat / 100);
    let lat = latDeg + (rawLat - latDeg * 100) / 60;
    if (m[2].toUpperCase() === 'S') lat = -lat;

    const lonDeg = Math.floor(rawLon / 100);
    let lon = lonDeg + (rawLon - lonDeg * 100) / 60;
    if (m[4].toUpperCase() === 'W') lon = -lon;

    const alt = parseFloat(m[7]);

    return {
        lat,
        lon,
        alt_m: isNaN(alt) ? null : alt,
    };
}

function startGpsPolling(gpsPortInstance) {
    setInterval(() => {
        gpsPortInstance.write('AT+CGPSINFO\r\n', (err) => {
            if (err) console.error('[GPS] polling write error:', err.message || err);
        });
    }, GPS_POLL_INTERVAL_MS);
}

function startGpsAuto() {
    const portPath = findGpsPortPath();

    if (!portPath) {
        console.error('[GPS] port not found, retrying...');
        setTimeout(startGpsAuto, 1500);
        return;
    }

    const gpsPortInstance = new SerialPort({
        path: portPath,
        baudRate: gpsBaudRate,
        autoOpen: false,
    });

    const parser = gpsPortInstance.pipe(new ReadlineParser({ delimiter: '\r\n' }));

    gpsPortInstance.open((err) => {
        if (err) {
            console.error('[GPS] open error:', err.message || err);
            setTimeout(startGpsAuto, 1500);
            return;
        }
    });

    gpsPortInstance.on('open', () => {
        console.log(`[GPS] connected on ${portPath}`);
        initializeGps(gpsPortInstance);
    });

    parser.on('data', (data) => {
        const line = data.trim();
        if (!line) return;

        // Coba parse NMEA standar terlebih dahulu ($GPGGA, $GPRMC, dll)
        const fix = parseNmeaForFix(line);
        if (fix && fix.status === 'fix') {
            latitude = fix.lat;
            longitude = fix.lon;
            altitude = fix.alt_m;
            console.log(`[GPS] NMEA fix: lat=${latitude}, lon=${longitude}, alt=${altitude}`);
            return;
        }

        // Fallback: parse +CGPSINFO dari AT polling
        if (line.includes('+CGPSINFO:')) {
            const cgps = parseCgpsInfo(line);
            if (cgps) {
                latitude = cgps.lat;
                longitude = cgps.lon;
                altitude = cgps.alt_m;
                console.log(`[GPS] CGPSINFO fix: lat=${latitude}, lon=${longitude}, alt=${altitude}`);
            } else {
                console.log('[GPS] CGPSINFO: no fix yet');
            }
        }
    });

    gpsPortInstance.on('error', (err) => {
        console.error('[GPS] error:', err.message || err);
    });

    gpsPortInstance.on('close', () => {
        console.warn('[GPS] disconnected, reconnecting...');
        setTimeout(startGpsAuto, 1500);
    });
}

function sendATCommand(command, gpsPortInstance) {
    gpsPortInstance.write(`${command}\r\n`, (err) => {
        if (err) console.error('Error sending AT command:', err);
    });
}

function initializeGps(gpsPortInstance) {
    sendATCommand('AT', gpsPortInstance);
    setTimeout(() => sendATCommand('ATE0', gpsPortInstance), 1000);
    setTimeout(() => sendATCommand('AT+CGPS=1', gpsPortInstance), 2000);
    // Mulai polling AT+CGPSINFO setelah modem siap
    setTimeout(() => startGpsPolling(gpsPortInstance), 3000);
}


// ------------------ ESP32 Serial Handling ---------------------
async function findEsp32PortPath() {
    if (process.env.ESP32_PORT) return process.env.ESP32_PORT;

    const byId = findPortById(['silicon', 'labs']);
    if (byId) return byId;

    const gpsPath = findGpsPortPath();
    const gpsRealPath = resolveRealPathSafe(gpsPath);

    const ports = await SerialPort.list();

    const byVidPid = ports.find(
        (p) =>
            String(p.vendorId || '').toLowerCase() === '10c4' &&
            String(p.productId || '').toLowerCase() === 'ea60'
    );
    if (byVidPid?.path && resolveRealPathSafe(byVidPid.path) !== gpsRealPath) {
        return byVidPid.path;
    }

    const fallback = ports.find((p) => {
        const dev = String(p.path || '');
        if (!dev) return false;

        const realDev = resolveRealPathSafe(dev);
        if (realDev === gpsRealPath) return false;

        const devLower = dev.toLowerCase();
        return (
            devLower.includes('ttyusb') ||
            devLower.includes('ttyacm') ||
            devLower.includes('cu.usbserial') ||
            devLower.includes('cu.usbmodem')
        );
    });

    return fallback?.path || null;
}

// RESULT EXAMPLE:
//  {
//   "sensor_controller_id": "1",
//   "datas": [
//     {
//       "port_number": 1,
//       "sensor_type": "Imu",
//       "value": "1.91,0.64,9.81|0.00,0.01,-0.00|28.32"
//     },
//     {
//       "port_number": 2,
//       "sensor_type": "hum_temp",
//       "value": "24.20,56.00"
//     },
//     {
//       "port_number": 3,
//       "sensor_type": null,
//       "value": null
//     },
//     ...
//     {
//       "port_number": 8,
//       "sensor_type": null,
//       "value": null
//     }
//   ]
// }

function parseEsp32SensorBlock(sensorID, sensorDataBlock) {
    const lines = sensorDataBlock.split(/\r?\n/);

    const byPort = new Map();
    for (let p = 1; p <= 8; p++) {
        byPort.set(p, { port_number: p, sensor_type: null, value: null });
    }

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;

        const m = line.match(/^p(\d+)-(.*)$/);
        if (!m) continue;

        const portNumber = Number(m[1]);
        if (!Number.isFinite(portNumber) || portNumber < 1 || portNumber > 8) continue;

        const rest = (m[2] || '').trim();
        if (!rest) continue;

        if (rest === 'null-null') {
            byPort.set(portNumber, { port_number: portNumber, sensor_type: null, value: null });
            continue;
        }

        const idVal = rest.match(/^ID=([^;]+);VAL=(.*)$/);
        if (idVal) {
            const sensorType = (idVal[1] || '').trim() || null;
            const value = (idVal[2] || '').trim() || null;
            byPort.set(portNumber, { port_number: portNumber, sensor_type: sensorType, value });
            continue;
        }

        const idx = rest.indexOf('-');
        if (idx !== -1) {
            const sensorType = rest.slice(0, idx).trim() || null;
            const value = rest.slice(idx + 1).trim() || null;
            byPort.set(portNumber, { port_number: portNumber, sensor_type: sensorType, value });
            continue;
        }

        byPort.set(portNumber, { port_number: portNumber, sensor_type: null, value: null });
    }

    console.log('piSerial:', piSerial, 'sensorID:', sensorID);

    return {
        sensor_controller_id: String(sensorID),
        raspberry_serial_id: piSerial,
        datas: Array.from(byPort.values()).sort((a, b) => a.port_number - b.port_number),
    };
}


function drainLatestEsp32Payload() {
    const ID_MARK = 'sensorID:';
    const START_MARK = '@sensor_data_start';
    const END_MARK = '@sensor_data_end';

    let latestPayload = null;

    while (true) {
        const idIdx = espBuf.indexOf(ID_MARK);
        const startIdx = espBuf.indexOf(START_MARK);
        const endIdx = espBuf.indexOf(END_MARK);

        if (idIdx === -1 || startIdx === -1 || endIdx === -1) break;

        if (!(idIdx < startIdx && startIdx < endIdx)) {
            const minPos = Math.min(...[idIdx, startIdx, endIdx].filter((x) => x >= 0));
            espBuf = espBuf.slice(minPos + 1);
            continue;
        }

        const idLineEnd = espBuf.indexOf('\n', idIdx);
        if (idLineEnd === -1) break;

        const sensorID = espBuf.slice(idIdx + ID_MARK.length, idLineEnd).trim();
        const dataStart = startIdx + START_MARK.length;
        const sensorDataBlock = espBuf.slice(dataStart, endIdx).trim();

        espBuf = espBuf.slice(endIdx + END_MARK.length);

        if (!sensorID) continue;

        const payload = parseEsp32SensorBlock(sensorID, sensorDataBlock);
        if (!payload?.datas?.length) continue;

        latestPayload = payload;
    }

    return latestPayload;
}


function sendToEsp32(data) {
    if (!esp32PortInstance || !esp32PortInstance.writable) return;
    esp32PortInstance.write(data, (err) => {
        if (err) console.error('[ESP32] write error:', err.message || err);
    });
}

function sendPiSerialId() {
    sendToEsp32(`${piSerial}\n`);
    console.log(`[ESP32] Sent Pi Serial ID: ${piSerial}`);
}

function startPiSerialRetry() {
    stopPiSerialRetry();
    // Delay first send to let USB enumeration noise settle
    piSerialRetryTimer = setTimeout(() => {
        sendPiSerialId();
        // Retry periodically until ESP32 acknowledges
        piSerialRetryTimer = setInterval(() => {
            if (piSerialAcked) {
                stopPiSerialRetry();
                return;
            }
            console.log('[ESP32] No ACK yet, resending Pi Serial ID...');
            sendPiSerialId();
        }, PI_SERIAL_RETRY_INTERVAL_MS);
    }, PI_SERIAL_SEND_DELAY_MS);
}

function stopPiSerialRetry() {
    if (piSerialRetryTimer !== null) {
        clearTimeout(piSerialRetryTimer);
        clearInterval(piSerialRetryTimer);
        piSerialRetryTimer = null;
    }
}

async function startEsp32Serial() {
    const portPath = await findEsp32PortPath();
    if (!portPath) {
        console.error('[ESP32] Port not found. Set env ESP32_PORT=/dev/ttyUSBx');
        setTimeout(startEsp32Serial, 1500);
        return;
    }

    esp32PortInstance = new SerialPort({
        path: portPath,
        baudRate: ESP32_BAUD,
        autoOpen: false,
    });

    esp32PortInstance.open((err) => {
        if (err) {
            console.error('[ESP32] open error:', err.message || err);
            setTimeout(startEsp32Serial, 1500);
            return;
        }
    });

    esp32PortInstance.on('open', () => {
        console.log(`[ESP32] Connected on ${portPath}`);
        piSerialAcked = false;
        startPiSerialRetry();
    });

    esp32PortInstance.on('data', (chunk) => {
        const s = chunk.toString('utf8');
        if (!s) return;
        espBuf += s;

        // Handle Pi Serial ID acknowledgement from ESP32
        if (!piSerialAcked && espBuf.includes('[PIID_ACK]')) {
            piSerialAcked = true;
            stopPiSerialRetry();
            console.log('[ESP32] Pi Serial ID acknowledged by ESP32');
            espBuf = espBuf.replace(/\[PIID_ACK\]/g, '');
        }

        if (espBuf.length > 200000) {
            espBuf = espBuf.slice(-100000);
        }
    });

    esp32PortInstance.on('error', (e) => {
        console.error('[ESP32] error:', e.message || e);
    });

    esp32PortInstance.on('close', () => {
        console.warn('[ESP32] disconnected, reconnecting...');
        stopPiSerialRetry();
        piSerialAcked = false;
        esp32PortInstance = null;
        espBuf = '';
        setTimeout(startEsp32Serial, 1500);
    });
}

// ------------------ RasPi Data Push ---------------------

async function postRaspiData() {
    // Example payload:
    // {
    //   "raspberry_serial_id": "00000000abcdef",
    //   "datas": [
    //     { "temperature": 36.8 },
    //     {
    //       "altitude": 12.3,
    //       "latitude": -6.2001,
    //       "longitude": 106.8167,
    //       "timestamp_gps": "2026-02-13T00:20:10.000Z"
    //     }
    //   ]
    // }

    const tempC = await getRaspiCpuTempC();
    if (tempC !== null) lastTempC = tempC;

    const temperatureToSend = tempC !== null ? tempC : lastTempC;

    const datas = [];
    datas.push({ temperature: temperatureToSend });

    if (latitude !== null && longitude !== null) {
        datas.push({
            altitude,
            latitude,
            longitude,
            timestamp_gps: new Date().toISOString(),
        });
    }

    const payload = {
        raspberry_serial_id: piSerial,
        datas,
    };

    try {
        const res = await fetchWithTimeout(
            RASPI_DATA_URL,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            },
            5000
        );

        if (!res.ok) {
            const txt = await res.text().catch(() => '');
            console.error(`[RASPI-DATA] HTTP ${res.status} ${txt.slice(0, 200)}`);
            return false;
        }

        console.log('[RASPI-DATA] sent OK:', safeJson(payload));
        return true;
    } catch (e) {
        console.error('[RASPI-DATA] send error:', e.message || e);
        return false;
    }
}


async function postSensorData(payload) {
    // Example payload to send:
    // {
    //   "sensor_controller_id": "3",
    //   "raspberry_serial_id": "00000000abcdef",
    //   "datas": [
    //     { "port_number": 1, "sensor_type": "dht22", "value": 28.4 },
    //     { "port_number": 2, "sensor_type": "soil", "value": 640 },
    //     { "port_number": 3, "sensor_type": "ldr", "value": 123 },
    //     { "port_number": 4, "sensor_type": null, "value": null },
    //     { "port_number": 5, "sensor_type": null, "value": null },
    //     { "port_number": 6, "sensor_type": null, "value": null },
    //     { "port_number": 7, "sensor_type": null, "value": null },
    //     { "port_number": 8, "sensor_type": null, "value": null }
    //   ]
    // }

    try {
        const res = await fetchWithTimeout(
            SENSOR_DATA_URL,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            },
            5000
        );

        if (!res.ok) {
            const txt = await res.text().catch(() => '');
            console.error(`[SENSOR-DATA] HTTP ${res.status} ${txt.slice(0, 200)}`);
            return false;
        }

        console.log('[SENSOR-DATA] sent OK:', safeJson(payload));
        return true;
    } catch (e) {
        console.error('[SENSOR-DATA] send error:', e?.message || e);
        return false;
    }
}


function startRaspiDataScheduler() {
    const tick = async () => {
        if (pushing) return;
        pushing = true;
        try {
            await postRaspiData();
        } finally {
            pushing = false;
        }
    };

    tick();
    setInterval(tick, RASPI_PUSH_INTERVAL_MS);
}

function startSensorPostScheduler() {
    const tick = async () => {
        if (sensorPosting) return;
        sensorPosting = true;

        try {
            const payload = drainLatestEsp32Payload();
            if (!payload) return;

            const ok = await postSensorData(payload);
            sendToEsp32(ok ? '[SVROK]\n' : '[SVRERR]\n');
        } finally {
            sensorPosting = false;
        }
    };

    setInterval(tick, SENSOR_POST_INTERVAL_MS);
}

// ------------------ Main ---------------------
console.log('Raspberry Pi Serial Number:', piSerial);
startGpsAuto();
startEsp32Serial();
startRaspiDataScheduler();
startSensorPostScheduler();