#!/usr/bin/env node

const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const fs = require('fs');
const path = require('path');

const {
    parseNmeaForFix,
    fetchWithTimeout,
    getPiSerial,
    getRaspiCpuTempC,
    safeJson,
} = require('./helper');

// ------------------ Config ---------------------
const GPS_BAUD_RATE = 9600;
const ESP32_BAUD = 115200;
const PI_SERIAL_PREFIX = 'PI_SERIAL:';

const RASPI_DATA_URL = 'http://192.168.103.174:3000/api/raspi-data';
const RASPI_PUSH_INTERVAL_MS = 2 * 60 * 1000;

const SENSOR_DATA_URL = 'http://192.168.103.174:3000/api/sensor-data';
const SENSOR_POST_INTERVAL_MS = 100;

// ------------------ State ---------------------
let sensorPosting = false;
let pushing = false;

let latitude = null;
let longitude = null;
let altitude = null;
let lastTempC = null;

const piSerial = String(getPiSerial() || '').trim().toUpperCase() || 'UNKNOWN_PI_SERIAL';

let esp32PortInstance = null;
let espBuf = '';
let espLineBuf = '';
let espReady = false;

// ------------------ Port Handling ---------------------
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

function findGpsPortPath() {
    return (
        process.env.GPS_PORT ||
        findPortById(['qualcomm', 'if02']) ||
        '/dev/ttyUSB2'
    );
}

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

// ------------------ GPS Handling ---------------------
function sendATCommand(command, gpsPortInstance) {
    gpsPortInstance.write(`${command}\r\n`, (err) => {
        if (err) console.error('[GPS] AT send error:', err.message || err);
    });
}

function initializeGps(gpsPortInstance) {
    sendATCommand('AT', gpsPortInstance);
    setTimeout(() => sendATCommand('ATE0', gpsPortInstance), 1000);
    setTimeout(() => sendATCommand('AT+CGPS=1', gpsPortInstance), 2000);
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
        baudRate: GPS_BAUD_RATE,
        autoOpen: false,
    });

    const parser = gpsPortInstance.pipe(
        new ReadlineParser({ delimiter: '\r\n' })
    );

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
        const fix = parseNmeaForFix(data);
        if (fix.status === 'fix') {
            latitude = fix.lat;
            longitude = fix.lon;
            altitude = fix.alt_m;
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

// ------------------ ESP32 Sensor Parsing ---------------------
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
            byPort.set(portNumber, {
                port_number: portNumber,
                sensor_type: null,
                value: null,
            });
            continue;
        }

        const idVal = rest.match(/^ID=([^;]+);VAL=(.*)$/);
        if (idVal) {
            const sensorType = (idVal[1] || '').trim() || null;
            const value = (idVal[2] || '').trim() || null;
            byPort.set(portNumber, {
                port_number: portNumber,
                sensor_type: sensorType,
                value,
            });
            continue;
        }

        const idx = rest.indexOf('-');
        if (idx !== -1) {
            const sensorType = rest.slice(0, idx).trim() || null;
            const value = rest.slice(idx + 1).trim() || null;
            byPort.set(portNumber, {
                port_number: portNumber,
                sensor_type: sensorType,
                value,
            });
            continue;
        }

        byPort.set(portNumber, {
            port_number: portNumber,
            sensor_type: null,
            value: null,
        });
    }

    console.log('[SENSOR] piSerial:', piSerial, 'sensorID:', sensorID);

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

// ------------------ ESP32 Serial Handling ---------------------
function sendToEsp32(data) {
    if (!esp32PortInstance || !esp32PortInstance.writable) return;

    esp32PortInstance.write(data, (err) => {
        if (err) console.error('[ESP32] write error:', err.message || err);
    });
}

function handleEsp32Line(line) {
    const clean = String(line || '').trim();
    if (!clean) return;

    if (clean === '[READY]') {
        if (!espReady) {
            espReady = true;
            const serialToSend = String(piSerial).trim().toUpperCase();
            console.log('[ESP32] READY received, sending Raspberry Pi serial');
            sendToEsp32(`${PI_SERIAL_PREFIX}${serialToSend}\n`);
        }
        return;
    }

    if (clean === '[ACK_PI_SERIAL]') {
        console.log('[ESP32] ACK_PI_SERIAL received');
        return;
    }

    if (
        clean.startsWith('sensorID:') ||
        clean === '@sensor_data_start' ||
        clean === '@sensor_data_end' ||
        clean.startsWith('p')
    ) {
        return;
    }

    console.log('[ESP32] line:', clean);
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
        espBuf = '';
        espLineBuf = '';
        espReady = false;
    });

    esp32PortInstance.on('data', (chunk) => {
        const s = chunk.toString('utf8');
        if (!s) return;

        espBuf += s;
        espLineBuf += s;

        let nl;
        while ((nl = espLineBuf.indexOf('\n')) !== -1) {
            const line = espLineBuf.slice(0, nl).replace(/\r/g, '');
            espLineBuf = espLineBuf.slice(nl + 1);
            handleEsp32Line(line);
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
        esp32PortInstance = null;
        espBuf = '';
        espLineBuf = '';
        espReady = false;
        setTimeout(startEsp32Serial, 1500);
    });
}

// ------------------ RasPi Data Push ---------------------
async function postRaspiData() {
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

// ------------------ Scheduler ---------------------
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