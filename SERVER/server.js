// server.js (patched/clean)
// IoT + GPS Backend with Raspi Heartbeat & HubData normalization

require('dotenv').config();

const express = require('express');
const http = require('http');
const cors = require('cors');
const morgan = require('morgan');
const mongoose = require('mongoose');
const { Server } = require('socket.io');

// ===== CONFIG =====
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/iot-monitoring';

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// ===== MIDDLEWARE =====
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(morgan('dev'));

// ===== DB =====
mongoose
  .connect(MONGO_URI)
  .then(() => console.log('[DB] MongoDB Connected'))
  .catch((err) => {
    console.error('[DB] Connection error:', err.message);
    process.exit(1);
  });

// ===== SCHEMAS =====
// Legacy, tetap dipertahankan untuk kompatibilitas /api/iot-data
const SensorDataSchema = new mongoose.Schema(
  {
    raspi_serial_id: { type: String, index: true, trim: true, lowercase: true },
    timestamp: { type: Date, default: Date.now },
    data: { type: mongoose.Schema.Types.Mixed, default: [] },
    last_seen: { type: Date, default: Date.now },
  },
  { strict: false }
);
SensorDataSchema.index({ 'data.sensor_controller_id': 1 });
SensorDataSchema.index({ raspi_serial_id: 1, timestamp: -1 });
const SensorData = mongoose.model('SensorData', SensorDataSchema);

// Raspi status/heartbeat
const RaspiStatusSchema = new mongoose.Schema({
  raspi_serial_id: { type: String, unique: true, lowercase: true, index: true, trim: true },
  last_seen: { type: Date, default: Date.now },
  temp_c: { type: Number, default: null },
  uptime_s: { type: Number, default: null },
});
RaspiStatusSchema.index({ raspi_serial_id: 1 });
const RaspiStatus = mongoose.model('RaspiStatus', RaspiStatusSchema);

// User alias
const UserAliasSchema = new mongoose.Schema({
  username: { type: String, unique: true, trim: true, lowercase: true },
  raspi_serial_id: { type: String, unique: true, index: true, trim: true, lowercase: true },
});
const UserAlias = mongoose.model('UserAlias', UserAliasSchema);

// GPS
const GpsDataSchema = new mongoose.Schema({
  raspi_serial_id: { type: String, index: true, trim: true, lowercase: true },
  lat: Number,
  lon: Number,
  speed_kmh: Number,
  altitude_m: Number,
  sats: Number,
  raw: mongoose.Schema.Types.Mixed,
  timestamp: { type: Date, default: Date.now },
});
GpsDataSchema.index({ raspi_serial_id: 1, timestamp: -1 });
const GpsData = mongoose.model('GpsData', GpsDataSchema);

// === NEW: HubData (normalisasi data dari ESP32/hub/controller)
const HubDataSchema = new mongoose.Schema({
  raspi_serial_id: { type: String, index: true, trim: true, lowercase: true },
  hub_id: { type: String, index: true, trim: true },
  timestamp: { type: Date, default: Date.now },
  signal_strength: { type: Number, default: null },
  battery_level: { type: Number, default: null },
  latitude: { type: Number, default: null },
  longitude: { type: Number, default: null },
  // nodes: array terstruktur hasil parse port-1..8
  nodes: [
    {
      node_id: String, // ex: P1..P8
      sensor_type: String, // ex: temperature, humidity, etc
      value: mongoose.Schema.Types.Mixed, // number/string
      unit: String, // °C, %, etc
    },
  ],
  // optional raw store (opsional)
  raw: mongoose.Schema.Types.Mixed,
});
HubDataSchema.index({ raspi_serial_id: 1, timestamp: -1 });
HubDataSchema.index({ hub_id: 1, timestamp: -1 });
const HubData = mongoose.model('HubData', HubDataSchema);

// ===== HELPERS =====
function normalizePayload(body) {
  const raspi_serial_id = body?.raspi_serial_id
    ? String(body.raspi_serial_id).trim().toLowerCase()
    : null;

  let records = null;
  if (Array.isArray(body?.data)) records = body.data;
  else if (typeof body?.data === 'object') records = [body.data];
  else if (typeof body?.metrics === 'object') records = [body.metrics];
  else if (typeof body?.temperature === 'number') records = [{ temp_c: body.temperature }];

  return { raspi_serial_id, records, timestamp: new Date() };
}

function extractTempC(doc) {
  if (!doc) return null;
  const arr = Array.isArray(doc.data) ? doc.data : [doc.data];
  const rec = arr.find(
    (r) =>
      r &&
      (typeof r.temp_c === 'number' ||
        typeof r.temperature === 'number' ||
        typeof r.cpu_temp_c === 'number' ||
        typeof r.raspi_temp_c === 'number')
  );
  return rec ? rec.temp_c ?? rec.raspi_temp_c ?? rec.cpu_temp_c ?? rec.temperature : null;
}

function parseTypeValue(raw) {
  if (!raw || typeof raw !== 'string' || !raw.includes('-')) {
    return { type: 'unknown', value: raw, unit: '' };
  }
  const [typeRaw, valRaw] = raw.split('-', 2);
  const type = String(typeRaw || '').trim().toLowerCase();
  const m = String(valRaw ?? '').trim().match(/^(-?\d+(?:\.\d+)?)(.*)$/);
  if (!m) return { type, value: valRaw?.trim() ?? '', unit: '' };
  const num = Number(m[1]);
  const unit = (m[2] || '').trim() || inferUnit(type);
  return {
    type: type === 'light' ? 'light_intensity' : type,
    value: Number.isNaN(num) ? (valRaw?.trim() ?? '') : num,
    unit,
  };
}
function inferUnit(type) {
  if (type === 'temperature') return '°C';
  if (type === 'humidity') return '%';
  if (type === 'pressure') return 'hPa';
  if (type === 'ultrasonic') return 'cm';
  if (type === 'light' || type === 'light_intensity') return 'lux';
  return '';
}

function normalizeHubObject(hubObj = {}) {
  // Ambil ID hub dari sensor_controller_id/sensor_controller
  const scidRaw = hubObj.sensor_controller_id ?? hubObj.sensor_controller ?? 'UNKNOWN';
  const hub_id = String(scidRaw).trim();
  if (!hub_id || hub_id.toUpperCase() === 'RASPI_SYS' || hubObj._type === 'raspi_status') return null;

  const nodes = [];
  for (let i = 1; i <= 8; i++) {
    const key = `port-${i}`;
    if (!hubObj[key]) continue;
    const parsed = parseTypeValue(hubObj[key]);
    nodes.push({
      node_id: `P${i}`,
      sensor_type: parsed.type,
      value: parsed.value,
      unit: parsed.unit,
    });
  }
  return {
    hub_id,
    signal_strength: hubObj.signal_strength ?? null,
    battery_level: hubObj.battery_level ?? null,
    latitude: hubObj.latitude ?? null,
    longitude: hubObj.longitude ?? null,
    nodes,
    raw: hubObj,
  };
}

// ===== LOG INCOMING NON-GET (optional debug) =====
app.use((req, _res, next) => {
  // if (req.method !== 'GET') {
  //   console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  //   try { console.log('BODY:', JSON.stringify(req.body).slice(0, 1000)); } catch {}
  // }
  next();
});

// ======================= ROUTES =======================

// Health
app.get('/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// -------------------- Raspi Heartbeat (NEW) ------------------------
app.post('/api/raspi-heartbeat', async (req, res) => {
  try {
    const raspi_serial_id = String(req.body?.raspi_serial_id || '').trim().toLowerCase();
    if (!raspi_serial_id) return res.status(400).json({ error: 'Missing raspi_serial_id' });

    const temp_c = typeof req.body?.temp_c === 'number' ? req.body.temp_c : null;
    const uptime_s = typeof req.body?.uptime_s === 'number' ? req.body.uptime_s : null;

    // Upsert status
    const status = await RaspiStatus.findOneAndUpdate(
      { raspi_serial_id },
      { last_seen: new Date(), temp_c, uptime_s },
      { upsert: true, new: true }
    );

    // Optional: simpan juga ke SensorData legacy agar /api/data tetap melihat RASPI_SYS
    const doc = new SensorData({
      raspi_serial_id,
      timestamp: new Date(),
      data: [{ sensor_controller_id: 'RASPI_SYS', raspi_temp_c: temp_c, uptime_s }],
    });
    await doc.save();

    io.emit('raspi-heartbeat', { raspi_serial_id, last_seen: status.last_seen, temp_c, uptime_s });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------- Hub Data from ESP32 (NEW) ------------------------
app.post('/api/hub-data', async (req, res) => {
  try {
    // console.log("1111 : ",req.body);
    
    const raspi_serial_id = String(req.body?.raspi_serial_id || '').trim().toLowerCase();
    if (!raspi_serial_id) return res.status(400).json({ error: 'Missing raspi_serial_id' });

    const payload = req.body?.data;
    const array = Array.isArray(payload) ? payload : (payload ? [payload] : []);
    if (array.length === 0) return res.status(400).json({ error: 'Empty data' });

    const now = new Date();
    const docsToInsert = [];

    for (const hubObj of array) {
      const normalized = normalizeHubObject(hubObj);
      if (!normalized) continue;

      docsToInsert.push(
        new HubData({
          raspi_serial_id,
          hub_id: normalized.hub_id,
          timestamp: now,
          signal_strength: normalized.signal_strength,
          battery_level: normalized.battery_level,
          latitude: normalized.latitude,
          longitude: normalized.longitude,
          nodes: normalized.nodes,
          raw: normalized.raw,
        })
      );
    }

    if (docsToInsert.length === 0) {
      // Tidak ada hub valid—tetap update last_seen agar status Raspi tetap hidup
      await RaspiStatus.findOneAndUpdate(
        { raspi_serial_id },
        { last_seen: now },
        { upsert: true }
      );
      return res.json({ success: true, inserted: 0 });
    }

    await HubData.insertMany(docsToInsert);

    // Update last_seen Raspi ketika ada data hub
    await RaspiStatus.findOneAndUpdate(
      { raspi_serial_id },
      { last_seen: now },
      { upsert: true }
    );

    io.emit('hub-data', {
      raspi_serial_id,
      count: docsToInsert.length,
      ts: now,
    });

    res.json({ success: true, inserted: docsToInsert.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------- IoT Data (LEGACY/compat) ------------------------
app.post('/api/iot-data', async (req, res) => {
  // console.log("222 : ",req.body);
  try {
    const { raspi_serial_id, records, timestamp } = normalizePayload(req.body || {});
    if (!raspi_serial_id || !records) return res.status(400).json({ error: 'Invalid IoT data' });

    // Simpan legacy
    const doc = new SensorData({ raspi_serial_id, data: records, timestamp });
    await doc.save();

    // Update RaspiStatus jika ada RASPI_SYS di records
    const arr = Array.isArray(records) ? records : [records];
    const sys = arr.find((h) => {
      const scid = (h?.sensor_controller_id ?? h?.sensor_controller ?? '').toString().toUpperCase();
      return scid === 'RASPI_SYS' || h?._type === 'raspi_status';
    });
    if (sys) {
      const temp_c =
        typeof sys.raspi_temp_c === 'number'
          ? sys.raspi_temp_c
          : typeof sys.cpu_temp_c === 'number'
          ? sys.cpu_temp_c
          : typeof sys.temperature === 'number'
          ? sys.temperature
          : null;
      const uptime_s = typeof sys.uptime_s === 'number' ? sys.uptime_s : null;

      await RaspiStatus.findOneAndUpdate(
        { raspi_serial_id },
        { last_seen: new Date(), temp_c, uptime_s },
        { upsert: true }
      );
    } else {
      // Tetap update last_seen karena ada aktivitas dari Raspi
      await RaspiStatus.findOneAndUpdate(
        { raspi_serial_id },
        { last_seen: new Date() },
        { upsert: true }
      );
    }

    io.emit('new-data', { raspi_serial_id, timestamp: doc.timestamp, data: doc.data });

    res.status(201).json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------- GPS API ------------------------
app.post('/api/gps', async (req, res) => {
  try {
    const body = req.body || {};
    const raspi_serial_id = String(body.raspi_serial_id || '').trim().toLowerCase();

    if (!raspi_serial_id) return res.status(400).json({ error: 'Missing raspi_serial_id' });
    if (body.lat === undefined || body.lon === undefined)
      return res.status(400).json({ error: 'Missing coordinates' });

    const doc = new GpsData({
      raspi_serial_id,
      lat: Number(body.lat),
      lon: Number(body.lon),
      speed_kmh: Number(body.speed_kmh || 0),
      altitude_m: Number(body.altitude_m || 0),
      sats: Number(body.sats || 0),
      raw: body.raw || null,
      timestamp: new Date(),
    });

    await doc.save();

    await RaspiStatus.findOneAndUpdate(
      { raspi_serial_id },
      { last_seen: new Date() },
      { upsert: true }
    );

    io.emit('gps-update', doc);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------- MERGED DATA (clean + grouped hubs) ------------------------
app.get('/api/data/:raspiID', async (req, res) => {
  const raspiID = String(req.params.raspiID).toLowerCase();
  try {
    const status = await RaspiStatus.findOne({ raspi_serial_id: raspiID }).lean();

    // Ambil max 200 hub logs
    const hubsRaw = await HubData.find({ raspi_serial_id: raspiID })
      .sort({ timestamp: -1 })
      .limit(200)
      .lean();

    // ==== GROUP BY HUB ID ====
    const hubs = {};
    for (const h of hubsRaw) {
      if (!h.hub_id) continue;
      if (!hubs[h.hub_id]) hubs[h.hub_id] = [];
      hubs[h.hub_id].push(h);
    }

    // GPS
    const gpsDoc = await GpsData.findOne({ raspi_serial_id: raspiID })
      .sort({ timestamp: -1 })
      .lean();

    res.json({
      raspi_serial_id: raspiID,
      raspi_status: status
        ? {
            last_seen: status.last_seen,
            temp_c: status.temp_c,
            uptime_s: status.uptime_s,
          }
        : null,
      hubs,                // ✅ GROUPED HUBS
      hubs_count: Object.keys(hubs).length,
      gps: gpsDoc || null,
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------- HUB SPECIFIC ------------------------
app.get('/api/hub/:raspiID/:hubID', async (req, res) => {
  const raspiID = String(req.params.raspiID).toLowerCase();
  const hubID = String(req.params.hubID).trim();

  try {
    const logs = await HubData.find({
      raspi_serial_id: raspiID,
      hub_id: hubID,
    })
      .sort({ timestamp: -1 })
      .limit(200)
      .lean();

    if (!logs.length)
      return res.status(404).json({ message: 'Hub not found or empty' });

    res.json({
      hub_id: hubID,
      raspi_serial_id: raspiID,
      latest: logs[0],
      history: logs,
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// -------------------- Temperature Helper ------------------------
app.get('/api/temp/:raspiID/latest', async (req, res) => {
  const raspiID = req.params.raspiID.toLowerCase();
  const doc = await SensorData.findOne({ raspi_serial_id: raspiID }).sort({ timestamp: -1 });
  if (!doc) return res.status(404).json({ message: 'No data' });

  res.json({
    raspi_serial_id: raspiID,
    timestamp: doc.timestamp,
    temp_c: extractTempC(doc),
  });
});

app.get('/api/hubs/:raspiID', async (req, res) => {
  const raspiID = String(req.params.raspiID).toLowerCase();

  const hubIDs = await HubData.distinct('hub_id', { raspi_serial_id: raspiID });

  res.json({
    raspi_serial_id: raspiID,
    hubs: hubIDs,
    count: hubIDs.length,
  });
});

// -------------------- Alias ------------------------
app.get('/api/resolve/:input', async (req, res) => {
  const input = String(req.params.input).toLowerCase();
  const alias = /^\d+$/.test(input)
    ? await UserAlias.findOne({ raspi_serial_id: input })
    : await UserAlias.findOne({ username: input });

  if (!alias) return res.status(404).json({ message: 'Alias not found' });
  res.json(alias);
});

app.post('/api/register-alias', async (req, res) => {
  const username = req.body?.username?.trim().toLowerCase();
  const raspi_serial_id = req.body?.raspi_serial_id?.trim().toLowerCase();

  if (!username || !raspi_serial_id) return res.status(400).json({ error: 'Invalid data' });

  try {
    if (await UserAlias.findOne({ username })) return res.status(400).json({ error: 'Username exists' });
    if (await UserAlias.findOne({ raspi_serial_id })) return res.status(400).json({ error: 'Serial exists' });

    const doc = new UserAlias({ username, raspi_serial_id });
    await doc.save();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------- Status API ------------------------
app.get('/api/status/:raspiID', async (req, res) => {
  const id = String(req.params.raspiID).toLowerCase();
  const status = await RaspiStatus.findOne({ raspi_serial_id: id });

  if (!status) return res.json({ raspi_serial_id: id, online: false });

  const lastSeen = new Date(status.last_seen);
  const diffSec = (Date.now() - lastSeen.getTime()) / 1000;

  return res.json({
    raspi_serial_id: id,
    online: diffSec < 10,
    last_seen: status.last_seen,
    diff_seconds: Number(diffSec.toFixed(1)),
    temp_c: status.temp_c ?? null,
    uptime_s: status.uptime_s ?? null,
  });
});

// -------------------- Controller queries (legacy helper) ------------------------
app.get('/api/controller/:controllerID', async (req, res) => {
  const id = String(req.params.controllerID).toLowerCase();
  const docs = await SensorData.find({
    'data.sensor_controller_id': id,
  }).sort({ timestamp: -1 });

  if (!docs.length) return res.status(404).json({ message: 'No data for this controller_id' });
  res.json(docs);
});

app.get('/api/:raspiID/controllers', async (req, res) => {
  const id = String(req.params.raspiID).toLowerCase();

  const docs = await SensorData.find({ raspi_serial_id: id }, { data: 1 })
    .sort({ timestamp: -1 })
    .limit(50);

  const set = new Set();
  docs.forEach((doc) => {
    const arr = Array.isArray(doc.data) ? doc.data : [doc.data];
    arr.forEach((r) => {
      if (r?.sensor_controller_id) set.add(String(r.sensor_controller_id).toLowerCase());
    });
  });

  res.json({ raspi_serial_id: id, controllers: [...set] });
});

// ===== SOCKETS =====
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  socket.on('disconnect', () => console.log('Client disconnected:', socket.id));
});

// ===== START =====
server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
