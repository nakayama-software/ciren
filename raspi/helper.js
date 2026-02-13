import { execFile } from 'child_process';
import fs from 'fs';

export async function fetchWithTimeout(url, options = {}, timeoutMs = 5000) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const res = await fetch(url, { ...options, signal: controller.signal });
        return res;
    } finally {
        clearTimeout(t);
    }
}

export function readFileNumber(pathname) {
    try {
        const raw = fs.readFileSync(pathname, 'utf-8').trim();
        const n = Number(raw);
        return Number.isFinite(n) ? n : null;
    } catch {
        return null;
    }
}

export function safeJson(obj) {
    try {
        return JSON.stringify(obj, null, 2);
    } catch {
        return String(obj);
    }
}

//------------------------POST DATA ESP HELPER ------------------------

//----------------------- RASPI  -----------------------

export function getPiSerial() {
    const paths = [
        '/sys/firmware/devicetree/base/serial-number',
        '/proc/device-tree/serial-number',
        '/proc/cpuinfo',
    ];

    for (const p of paths.slice(0, 2)) {
        
        try {
            const serial = fs.readFileSync(p, 'utf-8').trim().replace(/\x00/g, '');
            console.log("2222");
            if (serial) return serial;
        } catch { }
    }

    try {

        const cpuinfo = fs.readFileSync('/proc/cpuinfo', 'utf-8');
        const serialMatch = cpuinfo
            .split('\n')
            .find((line) => line.toLowerCase().startsWith('serial'));

        console.log("serialMatch : ", serialMatch)
        if (serialMatch) return serialMatch.split(':')[1].trim();
    } catch { }

    return 'UNKNOWN_PI';
}

export function getRaspiCpuTempC() {
    return new Promise((resolve) => {
        execFile('vcgencmd', ['measure_temp'], { timeout: 1500 }, (err, stdout) => {
            if (!err && typeof stdout === 'string') {
                const m = stdout.match(/temp=([\d.]+)'C/i);
                if (m) {
                    const t = Number(m[1]);
                    if (Number.isFinite(t)) return resolve(t);
                }
            }

            const milli = readFileNumber('/sys/class/thermal/thermal_zone0/temp');
            if (milli !== null) return resolve(milli / 1000);

            resolve(null);
        });
    });
}



//-----------------------GPS HELPER -----------------------
export function parseNmeaForFix(line) {
    if (!line || line[0] !== '$') return { status: 'not_nmea' };

    const noChecksum = line.split('*')[0];
    const parts = noChecksum.split(',');

    const type = parts[0];
    const msg = type.slice(3);

    if (msg === 'GGA') return parseGGA(parts);
    if (msg === 'GNS') return parseGNS(parts);

    return { status: 'unsupported' };
}

function parseGGA(parts) {
    const latDm = parts[2];
    const latDir = parts[3];
    const lonDm = parts[4];
    const lonDir = parts[5];
    const fixQuality = parts[6];
    const altStr = parts[9];

    if (!latDm || !lonDm) return { status: 'nofix' };
    if (!fixQuality || fixQuality === '0') return { status: 'nofix' };

    let lat = dmToDd(latDm);
    let lon = dmToDd(lonDm);
    if (latDir === 'S') lat = -lat;
    if (lonDir === 'W') lon = -lon;

    const alt_m = altStr ? parseFloat(altStr) : null;

    return {
        status: 'fix',
        lat,
        lon,
        alt_m
    };
}

function parseGNS(parts) {
    const latDm = parts[2];
    const latDir = parts[3];
    const lonDm = parts[4];
    const lonDir = parts[5];
    const mode = parts[6];
    const altStr = parts[9];

    if (!latDm || !lonDm) return { status: 'nofix' };
    if (!mode || mode === 'NNN') return { status: 'nofix' };

    let lat = dmToDd(latDm);
    let lon = dmToDd(lonDm);
    if (latDir === 'S') lat = -lat;
    if (lonDir === 'W') lon = -lon;

    const alt_m = altStr ? parseFloat(altStr) : null;

    return {
        status: 'fix',
        lat,
        lon,
        alt_m
    };
}

export function dmToDd(dmStr) {
    let dm = parseFloat(dmStr);
    let d = Math.floor(dm / 100);
    let m = dm - d * 100;
    return d + (m / 60);
}