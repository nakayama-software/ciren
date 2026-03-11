/**
 * CIREN Mock Server
 * ─────────────────────────────────────────────────────────────────────────────
 * Standalone Express + Socket.IO server that simulates the real CIREN backend.
 * No MongoDB required — all data lives in memory.
 *
 * Default demo user  (owns 2 Raspberry Pis):
 *   username        : "demo"
 *   raspi_serial_id : "mock00000000"  (7 sensors, Tokyo area)
 *   raspi_serial_id : "mock00000001"  (3 sensors, slightly different location)
 *
 * Endpoints:
 *   POST /api/register
 *   POST /api/login
 *   GET  /api/dashboard?username=<username>   → { raspis: [...] }
 *   GET  /api/sensor-readings?raspberry_serial_id=...&module_id=...&sensor_type=...&port_number=...&limit=...&skip=...
 *   DELETE /api/sensor-readings  (body: {raspberry_serial_id, module_id, sensor_type, port_number})
 *   GET  /api/status  (debug endpoint)
 *
 * Socket.IO events emitted:
 *   node-sample  — new sensor reading (emitted every second per sensor slot)
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const TICK_MS = 1000;
const MAX_READINGS = 2000;
const HISTORY_SEED = 300;

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());

// ─────────────────────────────────────────────────────────────────────────────
// IN-MEMORY STORES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * username (lowercase) → array of raspi_serial_ids
 * The first ID in the array is the "primary" raspi returned by /api/login.
 */
const users = { demo: ['mock00000000', 'mock00000001'] };

/** raspi_serial_id → username */
const raspiToUser = { mock00000000: 'demo', mock00000001: 'demo' };

/**
 * Readings store
 * key: "<raspi_id>::<module_id>::<port_number>::<sensor_type>"
 * value: SensorReading[]  (sorted oldest→newest, capped at MAX_READINGS)
 */
const readingsStore = new Map();

// ─────────────────────────────────────────────────────────────────────────────
// RASPI 1 — "mock00000000"  (full 7-sensor setup, Tokyo)
// ─────────────────────────────────────────────────────────────────────────────

const RASPI_ID   = 'mock00000000';
const MODULE_ID  = 'CTRL_01';

const SENSOR_SLOTS = [
  { port: 1, type: 'imu' },
  { port: 2, type: 'hum_temp' },
  { port: 3, type: 'us' },
  { port: 4, type: 'rotary_sensor' },
  { port: 5, type: 'voltage' },
  { port: 6, type: 'current' },
  { port: 7, type: 'vibration' },
];

const state1 = {
  imu:       { ax: 0.12,  ay: -0.05, az: 9.81,  gx: 0.002,  gy: -0.001, gz: 0.0005, temp: 28.5 },
  humTemp:   { temp: 28.0, hum: 65.0 },
  us:        { dist: 80.0 },
  rotary:    { pos: 0, lastDir: 'CW' },
  voltage:   { v: 3.72 },
  current:   { a: 0.52 },
  vibration: { ticks: 0 },
  raspiTemp: { t: 52.3 },
  gps:       { lat: 35.676200, lng: 139.650300, alt: 10.5 },
  uptime:    0,
};

const latestValues1 = {};

// ─────────────────────────────────────────────────────────────────────────────
// RASPI 2 — "mock00000001"  (3-sensor setup, slightly different location)
// ─────────────────────────────────────────────────────────────────────────────

const RASPI_2_ID  = 'mock00000001';
const MODULE_2_ID = 'CTRL_02';

const SENSOR_SLOTS_2 = [
  { port: 1, type: 'imu' },
  { port: 2, type: 'hum_temp' },
  { port: 3, type: 'voltage' },
];

const state2 = {
  imu:       { ax: 0.05,  ay:  0.02, az: 9.82,  gx: 0.001,  gy:  0.002, gz: 0.0001, temp: 27.0 },
  humTemp:   { temp: 24.5, hum: 55.0 },
  voltage:   { v: 4.10 },
  raspiTemp: { t: 48.7 },
  gps:       { lat: 35.678000, lng: 139.652000, alt: 8.3 },
  uptime:    0,
};

const latestValues2 = {};

// ─────────────────────────────────────────────────────────────────────────────
// UNIT MAP  (shared across both raspis)
// ─────────────────────────────────────────────────────────────────────────────

const SENSOR_UNITS = {
  imu:          null,
  hum_temp:     null,
  us:           'cm',
  rotary_sensor:null,
  voltage:      'V',
  current:      'A',
  vibration:    null,
};

// ─────────────────────────────────────────────────────────────────────────────
// HELPER MATH
// ─────────────────────────────────────────────────────────────────────────────

const rand  = (min, max) => min + Math.random() * (max - min);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const uid   = () => Math.random().toString(36).slice(2, 10);

// ─────────────────────────────────────────────────────────────────────────────
// VALUE GENERATORS  (each takes the relevant sub-state object by reference)
// ─────────────────────────────────────────────────────────────────────────────

function genIMU(s) {
  s.ax   = clamp(s.ax   + rand(-0.06,  0.06),  -3.0,  3.0);
  s.ay   = clamp(s.ay   + rand(-0.06,  0.06),  -3.0,  3.0);
  s.az   = clamp(s.az   + rand(-0.03,  0.03),   9.5, 10.1);
  s.gx   = clamp(s.gx   + rand(-0.005, 0.005), -0.5,  0.5);
  s.gy   = clamp(s.gy   + rand(-0.005, 0.005), -0.5,  0.5);
  s.gz   = clamp(s.gz   + rand(-0.002, 0.002), -0.1,  0.1);
  s.temp = clamp(s.temp + rand(-0.1,   0.1),   24.0, 36.0);
  const f2 = (n) => n.toFixed(2);
  const f4 = (n) => n.toFixed(4);
  return `${f2(s.ax)},${f2(s.ay)},${f2(s.az)}|${f4(s.gx)},${f4(s.gy)},${f4(s.gz)}|${s.temp.toFixed(2)}`;
}

function genHumTemp(s) {
  s.temp = clamp(s.temp + rand(-0.2, 0.2), 10.0, 45.0);
  s.hum  = clamp(s.hum  + rand(-0.4, 0.4), 20.0, 95.0);
  return `${s.temp.toFixed(1)},${s.hum.toFixed(1)}`;
}

function genUltrasonic(s) {
  s.dist = clamp(s.dist + rand(-3, 3), 3.0, 400.0);
  return s.dist.toFixed(1);
}

function genRotary(s) {
  if (Math.random() < 0.2) return null;
  const dir   = Math.random() < 0.6 ? 'CW' : 'CCW';
  const delta = Math.ceil(rand(1, 5));
  s.pos      += dir === 'CW' ? delta : -delta;
  s.lastDir   = dir;
  return `${dir},${delta}`;
}

function genVoltage(s) {
  s.v = clamp(s.v + rand(-0.015, 0.015), 2.7, 4.25);
  return s.v.toFixed(3);
}

function genCurrent(s) {
  s.a = clamp(s.a + rand(-0.04, 0.04), 0.05, 2.5);
  return s.a.toFixed(3);
}

function genVibration(s) {
  s.ticks++;
  const burst = s.ticks % 30 === 0;
  return (burst || Math.random() < 0.08) ? 'true' : 'false';
}

/** Dispatch to the correct generator given a type and the full state object. */
function generateValue(type, st) {
  switch (type) {
    case 'imu':           return genIMU(st.imu);
    case 'hum_temp':      return genHumTemp(st.humTemp);
    case 'us':            return genUltrasonic(st.us);
    case 'rotary_sensor': return genRotary(st.rotary);
    case 'voltage':       return genVoltage(st.voltage);
    case 'current':       return genCurrent(st.current);
    case 'vibration':     return genVibration(st.vibration);
    default:              return '0';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// READINGS STORE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function storeKey(raspiId, moduleId, port, sensorType) {
  return `${raspiId}::${moduleId}::${port}::${sensorType}`;
}

function pushReading(raspiId, moduleId, port, sensorType, value, tsMs) {
  const key  = storeKey(raspiId, moduleId, port, sensorType);
  const list = readingsStore.get(key) || [];
  list.push({
    _id:                `mock-${port}-${uid()}`,
    raspberry_serial_id: raspiId,
    module_id:           moduleId,
    port_number:         port,
    sensor_type:         sensorType,
    value,
    unit:                SENSOR_UNITS[sensorType] ?? null,
    timestamp_device:    null,
    timestamp_server:    new Date(tsMs).toISOString(),
  });
  if (list.length > MAX_READINGS) list.splice(0, list.length - MAX_READINGS);
  readingsStore.set(key, list);
  return list[list.length - 1];
}

// ─────────────────────────────────────────────────────────────────────────────
// PRE-POPULATE HISTORY
// ─────────────────────────────────────────────────────────────────────────────

function seedForRaspi(raspiId, moduleId, slots, st, latest) {
  const now = Date.now();
  for (const { port, type } of slots) {
    for (let i = HISTORY_SEED; i >= 1; i--) {
      const value = generateValue(type, st);
      if (value === null) continue;
      pushReading(raspiId, moduleId, port, type, value, now - i * TICK_MS);
    }
    const value = generateValue(type, st);
    latest[port] = { type, value: value ?? '0' };
  }
}

function seedHistory() {
  seedForRaspi(RASPI_ID,   MODULE_ID,   SENSOR_SLOTS,   state1, latestValues1);
  seedForRaspi(RASPI_2_ID, MODULE_2_ID, SENSOR_SLOTS_2, state2, latestValues2);
  console.log(`[MOCK] History seeded (${HISTORY_SEED} readings × ${SENSOR_SLOTS.length + SENSOR_SLOTS_2.length} sensors across 2 raspis)`);
}

seedHistory();

// ─────────────────────────────────────────────────────────────────────────────
// PERIODIC TICK  — generate new readings & broadcast via Socket.IO
// ─────────────────────────────────────────────────────────────────────────────

function tickForRaspi(raspiId, moduleId, slots, st, latest) {
  st.uptime++;
  st.raspiTemp.t = clamp(st.raspiTemp.t + rand(-0.3, 0.3), 40, 75);
  st.gps.lat    += rand(-0.000005, 0.000005);
  st.gps.lng    += rand(-0.000005, 0.000005);

  for (const { port, type } of slots) {
    const value = generateValue(type, st);
    if (value === null) continue;

    latest[port] = { type, value };
    const doc = pushReading(raspiId, moduleId, port, type, value, Date.now());

    io.emit('node-sample', {
      _id:                 doc._id,
      raspberry_serial_id: doc.raspberry_serial_id,
      module_id:           doc.module_id,
      hub_id:              doc.module_id,
      port_number:         doc.port_number,
      sensor_type:         doc.sensor_type,
      value:               doc.value,
      unit:                doc.unit,
      timestamp_device:    null,
      timestamp_server:    doc.timestamp_server,
    });
  }
}

function tick() {
  tickForRaspi(RASPI_ID,   MODULE_ID,   SENSOR_SLOTS,   state1, latestValues1);
  tickForRaspi(RASPI_2_ID, MODULE_2_ID, SENSOR_SLOTS_2, state2, latestValues2);
}

setInterval(tick, TICK_MS);

// ─────────────────────────────────────────────────────────────────────────────
// BUILD DASHBOARD RESPONSE
// ─────────────────────────────────────────────────────────────────────────────

function buildRaspiPayload(raspiId, moduleId, slots, latest, st) {
  const now = new Date().toISOString();

  const sensorDatas = slots.map(({ port, type }) => {
    const { value } = latest[port] || { value: '0' };
    return {
      port_number:  port,
      sensor_data: `${port}-${type}-${value}`,
    };
  });

  return {
    raspberry_serial_id: raspiId,
    temperature:         parseFloat(st.raspiTemp.t.toFixed(1)),
    gps_data: {
      altitude:        parseFloat(st.gps.alt.toFixed(1)),
      latitude:        parseFloat(st.gps.lat.toFixed(6)),
      longitude:       parseFloat(st.gps.lng.toFixed(6)),
      timestamp_gps:   now,
      raspi_serial_id: raspiId,
    },
    sensor_controllers: [
      {
        module_id:    moduleId,
        timestamp:    now,
        sensor_datas: sensorDatas,
      },
    ],
    timestamp_raspberry: now,
    raspi_status: {
      uptime_s: st.uptime,
    },
  };
}

/**
 * Returns { raspis: [...] } — each element is one raspi's full payload.
 * Dashboard.jsx iterates raspis[] to build the multi-raspi UI.
 */
function buildDashboard(username) {
  const raspiIds = users[username.toLowerCase().trim()];
  if (!raspiIds) return null;

  const idList = Array.isArray(raspiIds) ? raspiIds : [raspiIds];

  const raspis = idList.map((id) => {
    if (id === RASPI_ID)   return buildRaspiPayload(RASPI_ID,   MODULE_ID,   SENSOR_SLOTS,   latestValues1, state1);
    if (id === RASPI_2_ID) return buildRaspiPayload(RASPI_2_ID, MODULE_2_ID, SENSOR_SLOTS_2, latestValues2, state2);
    return null;
  }).filter(Boolean);

  return { raspis };
}

// ─────────────────────────────────────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────────────────────────────────────

// POST /api/register
app.post('/api/register', (req, res) => {
  const { username, raspberry_serial_id } = req.body || {};
  if (!username || !raspberry_serial_id)
    return res.status(400).json({ error: 'Missing username or raspberry_serial_id' });

  const uname  = username.toLowerCase().trim();
  const serial = raspberry_serial_id.toLowerCase().trim();

  if (users[uname])
    return res.status(400).json({ error: 'Username already registered' });

  users[uname]       = [serial];   // stored as array
  raspiToUser[serial] = uname;
  console.log(`[MOCK] Registered user: "${uname}" → "${serial}"`);
  return res.status(201).json({ success: true, username: uname, raspberry_serial_id: serial });
});

// POST /api/login
app.post('/api/login', (req, res) => {
  const { username, raspberry_serial_id } = req.body || {};
  const uname  = (username || '').toLowerCase().trim();
  const serial = (raspberry_serial_id || '').toLowerCase().trim();

  if (!uname && !serial)
    return res.status(400).json({ error: 'Missing username or raspberry_serial_id' });

  const raspiIds     = uname ? users[uname] : null;
  const idList       = Array.isArray(raspiIds) ? raspiIds : raspiIds ? [raspiIds] : [];
  const resolvedSerial = idList[0] || serial;  // primary raspi for backward compat
  const resolvedUser = serial ? raspiToUser[serial] : uname;

  if (!resolvedSerial && !resolvedUser)
    return res.status(404).json({ error: 'User not found' });

  return res.json({
    success:             true,
    username:            resolvedUser || uname,
    raspberry_serial_id: resolvedSerial || serial,
  });
});

// GET /api/dashboard?username=...
app.get('/api/dashboard', (req, res) => {
  const { username } = req.query;
  if (!username) return res.status(400).json({ error: 'Missing username' });

  const data = buildDashboard(username);
  if (!data) return res.status(404).json({ error: 'User not found' });

  return res.json(data);
});

// GET /api/sensor-readings
app.get('/api/sensor-readings', (req, res) => {
  const {
    raspberry_serial_id,
    module_id,
    sensor_type,
    port_number,
    limit = 200,
    skip  = 0,
  } = req.query;

  if (!raspberry_serial_id || !module_id || !sensor_type)
    return res.status(400).json({ error: 'Missing raspberry_serial_id, module_id, or sensor_type' });

  const pn  = port_number !== undefined ? Number(port_number) : NaN;
  const key = storeKey(
    raspberry_serial_id.toLowerCase().trim(),
    module_id.trim(),
    isNaN(pn) ? null : pn,
    sensor_type.toLowerCase().trim(),
  );

  const all   = [...(readingsStore.get(key) || [])].reverse();
  const lim   = Math.min(Number(limit) || 200, 2000);
  const sk    = Math.max(Number(skip)  || 0,   0);
  const items = all.slice(sk, sk + lim);

  return res.json({
    success:   true,
    count:     items.length,
    items,
    next_skip: sk + items.length,
  });
});

// DELETE /api/sensor-readings  (Reset Port feature)
app.delete('/api/sensor-readings', (req, res) => {
  const { raspberry_serial_id, module_id, sensor_type, port_number } = req.body || {};

  if (!raspberry_serial_id || !module_id || !sensor_type)
    return res.status(400).json({ error: 'Missing raspberry_serial_id, module_id, or sensor_type' });

  const pn  = port_number !== undefined ? Number(port_number) : NaN;
  const key = storeKey(
    raspberry_serial_id.toLowerCase().trim(),
    module_id.trim(),
    isNaN(pn) ? null : pn,
    sensor_type.toLowerCase().trim(),
  );

  const deleted = (readingsStore.get(key) || []).length;
  readingsStore.set(key, []);
  console.log(`[MOCK] Reset port: deleted ${deleted} readings (${key})`);

  return res.json({ success: true, deleted_count: deleted });
});

// GET /api/status  (debug / health-check)
app.get('/api/status', (req, res) => {
  function raspiSummary(raspiId, moduleId, slots, latest, st) {
    const sensors = {};
    for (const { port, type } of slots) {
      const key   = storeKey(raspiId, moduleId, port, type);
      const count = (readingsStore.get(key) || []).length;
      sensors[`P${port}:${type}`] = { count, latest: latest[port]?.value };
    }
    return { uptime_s: st.uptime, raspi_temp_c: st.raspiTemp.t.toFixed(1), gps: st.gps, sensors };
  }

  return res.json({
    mock_server: 'CIREN Mock Server v2.0 (multi-raspi)',
    registered_users: Object.keys(users),
    raspis: {
      [RASPI_ID]:   raspiSummary(RASPI_ID,   MODULE_ID,   SENSOR_SLOTS,   latestValues1, state1),
      [RASPI_2_ID]: raspiSummary(RASPI_2_ID, MODULE_2_ID, SENSOR_SLOTS_2, latestValues2, state2),
    },
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SOCKET.IO
// ─────────────────────────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  console.log(`[WS] Client connected: ${socket.id}`);
  socket.on('disconnect', () => console.log(`[WS] Client disconnected: ${socket.id}`));
});

// ─────────────────────────────────────────────────────────────────────────────
// START
// ─────────────────────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║      CIREN Mock Server v2.0  —  Running          ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log(`  URL  : http://localhost:${PORT}`);
  console.log('');
  console.log('  Demo account (2 Raspberry Pis):');
  console.log('    username        : demo');
  console.log(`    raspi #1        : ${RASPI_ID}  (${SENSOR_SLOTS.length} sensors)`);
  console.log(`    raspi #2        : ${RASPI_2_ID}  (${SENSOR_SLOTS_2.length} sensors)`);
  console.log('');
  console.log('  Quick start:');
  console.log(`    Dashboard       : http://localhost:5173/ciren/demo/dashboard`);
  console.log(`    Status / debug  : http://localhost:${PORT}/api/status`);
  console.log('');
  console.log(`  Raspi #1 sensors (1/sec):`);
  SENSOR_SLOTS.forEach(({ port, type }) => console.log(`    Port ${port}  →  ${type}`));
  console.log(`  Raspi #2 sensors (1/sec):`);
  SENSOR_SLOTS_2.forEach(({ port, type }) => console.log(`    Port ${port}  →  ${type}`));
  console.log('');
});