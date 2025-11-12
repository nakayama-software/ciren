// server.js — IoT + GPS Backend (plug & play + modular hubs)
// versi dengan NodeSamples dan HubNodeMap

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

// ===== DB CONNECT =====
mongoose
  .connect(MONGO_URI)
  .then(() => console.log('[DB] MongoDB Connected'))
  .catch((err) => {
    console.error('[DB] Connection error:', err.message);
    process.exit(1);
  });

// ===== SCHEMAS =====

// Legacy schema untuk kompatibilitas lama
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

// Raspi heartbeat/status
const RaspiStatusSchema = new mongoose.Schema({
  raspi_serial_id: { type: String, unique: true, lowercase: true, index: true, trim: true },
  last_seen: { type: Date, default: Date.now },
  temp_c: { type: Number, default: null },
  uptime_s: { type: Number, default: null },
});
RaspiStatusSchema.index({ raspi_serial_id: 1 });
const RaspiStatus = mongoose.model('RaspiStatus', RaspiStatusSchema);

// User alias mapping
const UserAliasSchema = new mongoose.Schema({
  username: { type: String, unique: true, trim: true, lowercase: true },
  raspi_serial_id: { type: String, unique: true, index: true, trim: true, lowercase: true },
});
const UserAlias = mongoose.model('UserAlias', UserAliasSchema);

// GPS data
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

// Hub data (raw payload)
const HubDataSchema = new mongoose.Schema({
  raspi_serial_id: { type: String, index: true, trim: true, lowercase: true },
  hub_id: { type: String, index: true, trim: true },
  timestamp: { type: Date, default: Date.now },
  signal_strength: { type: Number, default: null },
  battery_level: { type: Number, default: null },
  latitude: { type: Number, default: null },
  longitude: { type: Number, default: null },
  nodes: [
    {
      node_id: String, // ex: P1..P8
      sensor_type: String,
      value: mongoose.Schema.Types.Mixed,
      unit: String,
    },
  ],
  raw: mongoose.Schema.Types.Mixed,
});
HubDataSchema.index({ raspi_serial_id: 1, timestamp: -1 });
HubDataSchema.index({ hub_id: 1, timestamp: -1 });
const HubData = mongoose.model('HubData', HubDataSchema);

// === NEW: NodeSamples (time-series per port)
const NodeSamplesSchema = new mongoose.Schema({
  raspi_serial_id: { type: String, index: true, trim: true, lowercase: true },
  hub_id: { type: String, index: true, trim: true },
  port_id: { type: Number, index: true },
  sensor_type: { type: String, index: true },
  sensor_id: { type: String, index: true },
  value: mongoose.Schema.Types.Mixed,
  unit: String,
  timestamp: { type: Date, default: Date.now },
});
NodeSamplesSchema.index({ raspi_serial_id: 1, hub_id: 1, port_id: 1, timestamp: 1 });
const NodeSamples = mongoose.model('NodeSamples', NodeSamplesSchema);

// === NEW: HubNodeMap (status sensor aktif per port)
const HubNodeMapSchema = new mongoose.Schema({
  raspi_serial_id: { type: String, index: true, trim: true, lowercase: true },
  hub_id: { type: String, index: true, trim: true },
  port_id: { type: Number, index: true },
  current_sensor_type: { type: String },
  current_sensor_id: { type: String },
  last_updated: { type: Date, default: Date.now },
});
HubNodeMapSchema.index({ raspi_serial_id: 1, hub_id: 1, port_id: 1 }, { unique: true });
const HubNodeMap = mongoose.model('HubNodeMap', HubNodeMapSchema);


// ===== HELPERS =====
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

// ===== ROUTES =====

// -------------------- USER REGISTER ------------------------
app.post('/api/register-alias', async (req, res) => {
  try {
    const { username, raspi_serial_id } = req.body || {};
    if (!username || !raspi_serial_id) {
      return res.status(400).json({ error: 'Missing username or raspi_serial_id' });
    }

    const uname = String(username).trim().toLowerCase();
    const raspiID = String(raspi_serial_id).trim().toLowerCase();

    // Pastikan belum ada username atau raspi yang sama
    const exists = await UserAlias.findOne({
      $or: [{ username: uname }, { raspi_serial_id: raspiID }],
    });
    if (exists) {
      return res.status(400).json({ error: 'Username or device already registered' });
    }

    const user = await UserAlias.create({ username: uname, raspi_serial_id: raspiID });
    console.log(`[User] Registered ${uname} → ${raspiID}`);
    res.json({ success: true, user });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: err.message });
  }
});

// -------------------- USER LOGIN (resolve username to Raspi) ------------------------
app.post('/api/login', async (req, res) => {
  try {
    const { username } = req.body || {};
    if (!username) return res.status(400).json({ error: 'Missing username' });

    const uname = String(username).trim().toLowerCase();
    const user = await UserAlias.findOne({ username: uname });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      success: true,
      username: user.username,
      raspi_serial_id: user.raspi_serial_id,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------- RESOLVE (for Dashboard) ------------------------
app.get('/api/resolve/:username', async (req, res) => {
  try {
    const uname = String(req.params.username || '').trim().toLowerCase();
    const user = await UserAlias.findOne({ username: uname });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({
      username: user.username,
      raspi_serial_id: user.raspi_serial_id,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// -------------------- MERGED DATA (grouped hubs + latest GPS) --------
app.get('/api/data/:raspiID', async (req, res) => {
  try {
    const raspiID = String(req.params.raspiID || '').trim().toLowerCase();
    if (!raspiID) return res.status(400).json({ error: 'Missing raspiID' });

    // ringkas status
    const status = await RaspiStatus.findOne({ raspi_serial_id: raspiID }).lean();
    const raspi_status = status
      ? { last_seen: status.last_seen, temp_c: status.temp_c, uptime_s: status.uptime_s }
      : null;

    // ambil log hub terbaru
    const hubsRaw = await HubData.find({ raspi_serial_id: raspiID })
      .sort({ timestamp: -1 })
      .limit(200)
      .lean();

    // group by hub_id
    const hubs = {};
    for (const h of hubsRaw) {
      if (!h.hub_id) continue;
      if (!hubs[h.hub_id]) hubs[h.hub_id] = [];
      hubs[h.hub_id].push(h);
    }

    // gps terbaru
    const gpsDoc = await GpsData.findOne({ raspi_serial_id: raspiID })
      .sort({ timestamp: -1 })
      .lean();

    res.json({
      raspi_serial_id: raspiID,
      raspi_status,
      hubs,
      hubs_count: Object.keys(hubs).length,
      gps: gpsDoc || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------- PORT HISTORY (NodeSamples) ------------------------
// GET /api/port-history?raspi_serial_id=...&hub_id=...&port_id=1&from=ISO&to=ISO&limit=1000
app.get('/api/port-history', async (req, res) => {
  try {
    const raspi_serial_id = String(req.query.raspi_serial_id || '').trim().toLowerCase();
    const hub_id = String(req.query.hub_id || '').trim();
    const port_id = Number(req.query.port_id);

    if (!raspi_serial_id || !hub_id || !port_id) {
      return res.status(400).json({ error: 'Missing raspi_serial_id / hub_id / port_id' });
    }

    const limit = Math.min(Number(req.query.limit || 1000), 5000);
    const q = { raspi_serial_id, hub_id, port_id };

    // rentang waktu optional
    const from = req.query.from ? new Date(String(req.query.from)) : null;
    const to   = req.query.to   ? new Date(String(req.query.to))   : null;
    if (from || to) {
      q.timestamp = {};
      if (from) q.timestamp.$gte = from;
      if (to)   q.timestamp.$lte = to;
    }

    // urut naik (agar enak diplot)
    const docs = await NodeSamples.find(q)
      .sort({ timestamp: 1 })
      .limit(limit)
      .lean();

    const items = docs.map(d => ({
      ts: d.timestamp,
      value: d.value,
      unit: d.unit,
      sensor_type: d.sensor_type,
      sensor_id: d.sensor_id,
    }));

    res.json({
      ok: true,
      meta: { count: items.length, raspi_serial_id, hub_id, port_id },
      items
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Health
app.get('/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// -------------------- Raspi Heartbeat ------------------------
app.post('/api/raspi-heartbeat', async (req, res) => {
  try {
    const raspi_serial_id = String(req.body?.raspi_serial_id || '').trim().toLowerCase();
    if (!raspi_serial_id) return res.status(400).json({ error: 'Missing raspi_serial_id' });
    const temp_c = typeof req.body?.temp_c === 'number' ? req.body.temp_c : null;
    const uptime_s = typeof req.body?.uptime_s === 'number' ? req.body.uptime_s : null;
    await RaspiStatus.findOneAndUpdate(
      { raspi_serial_id },
      { last_seen: new Date(), temp_c, uptime_s },
      { upsert: true, new: true }
    );
    io.emit('raspi-heartbeat', { raspi_serial_id, temp_c, uptime_s });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------- Hub Data (with NodeSamples) ------------------------
app.post('/api/hub-data', async (req, res) => {
  try {
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

      // Simpan ke HubData
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

      // Loop tiap node
      for (const node of normalized.nodes) {
        const port_id = Number(node.node_id.replace('P', ''));
        const existing = await HubNodeMap.findOne({
          raspi_serial_id,
          hub_id: normalized.hub_id,
          port_id,
        });

        if (!existing) {
          const newSensorId = `${normalized.hub_id}-P${port_id}-${Date.now()}`;
          await HubNodeMap.create({
            raspi_serial_id,
            hub_id: normalized.hub_id,
            port_id,
            current_sensor_type: node.sensor_type,
            current_sensor_id: newSensorId,
            last_updated: now,
          });
          node.sensor_id = newSensorId;
        } else if (existing.current_sensor_type !== node.sensor_type) {
          await NodeSamples.deleteMany({
            raspi_serial_id,
            hub_id: normalized.hub_id,
            port_id,
          });
          const newSensorId = `${normalized.hub_id}-P${port_id}-${Date.now()}`;
          await HubNodeMap.updateOne(
            { raspi_serial_id, hub_id: normalized.hub_id, port_id },
            {
              $set: {
                current_sensor_type: node.sensor_type,
                current_sensor_id: newSensorId,
                last_updated: now,
              },
            }
          );
          node.sensor_id = newSensorId;
        } else {
          node.sensor_id = existing.current_sensor_id;
        }

        await NodeSamples.create({
          raspi_serial_id,
          hub_id: normalized.hub_id,
          port_id,
          sensor_type: node.sensor_type,
          sensor_id: node.sensor_id,
          value: node.value,
          unit: node.unit,
          timestamp: now,
        });
      }
    }

    if (docsToInsert.length > 0) await HubData.insertMany(docsToInsert);
    await RaspiStatus.findOneAndUpdate({ raspi_serial_id }, { last_seen: now }, { upsert: true });
    io.emit('hub-data', { raspi_serial_id, count: docsToInsert.length, ts: now });
    res.json({ success: true, inserted: docsToInsert.length });
  } catch (err) {
    console.error('Error in /api/hub-data:', err);
    res.status(500).json({ error: err.message });
  }
});

// -------------------- RESET PORT DATA ------------------------
app.post('/api/reset-port', async (req, res) => {
  try {
    const { raspi_serial_id, hub_id, port_id } = req.body;
    if (!raspi_serial_id || !hub_id || !port_id)
      return res.status(400).json({ error: 'Missing parameters' });
    const raspiID = String(raspi_serial_id).trim().toLowerCase();
    const hubID = String(hub_id).trim();
    const portNum = Number(port_id);
    await NodeSamples.deleteMany({ raspi_serial_id: raspiID, hub_id: hubID, port_id: portNum });
    const newSensorId = `${hubID}-P${portNum}-${Date.now()}`;
    await HubNodeMap.findOneAndUpdate(
      { raspi_serial_id: raspiID, hub_id: hubID, port_id: portNum },
      { current_sensor_id: newSensorId, last_updated: new Date() },
      { upsert: true }
    );
    res.json({ success: true, message: 'Port reset successfully', newSensorId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------- GPS API ------------------------
app.post('/api/gps', async (req, res) => {
  try {
    const body = req.body || {};

    // console.log("body : ",body);
    
    const raspi_serial_id = String(body.raspi_serial_id || '').trim().toLowerCase();
    if (!raspi_serial_id) return res.status(400).json({ error: 'Missing raspi_serial_id' });
    if (body.lat === undefined || body.lon === undefined)
      return res.status(400).json({ error: 'Missing coordinates' });
    const gpsDoc = await GpsData.findOneAndUpdate(
      { raspi_serial_id },
      {
        $set: {
          lat: Number(body.lat),
          lon: Number(body.lon),
          speed_kmh: Number(body.speed_kmh || 0),
          altitude_m: Number(body.altitude_m || 0),
          sats: Number(body.sats || 0),
          raw: body.raw || null,
          timestamp: new Date(),
        },
      },
      { upsert: true, new: true }
    );
    await RaspiStatus.findOneAndUpdate(
      { raspi_serial_id },
      { last_seen: new Date() },
      { upsert: true }
    );
    io.emit('gps-update', gpsDoc);
    res.json({ success: true, updated: true, gps: gpsDoc });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------- SOCKET ------------------------
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  socket.on('disconnect', () => console.log('Client disconnected:', socket.id));
});

// ===== START SERVER =====
server.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
