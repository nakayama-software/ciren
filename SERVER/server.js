// server.js
// IoT Monitoring Backend — flexible payloads + latest-temp helper
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
mongoose.connect(MONGO_URI)
  .then(() => console.log('[DB] MongoDB Connected'))
  .catch(err => {
    console.error('[DB] Connection error:', err.message);
    process.exit(1);
  });

// ===== SCHEMAS =====
const SensorDataSchema = new mongoose.Schema({
  raspi_serial_id: { type: String, index: true, trim: true, lowercase: true },
  timestamp: { type: Date, default: Date.now },
  // can be a single object or an array of objects — we accept both
  data: { type: mongoose.Schema.Types.Mixed, default: [] }
}, { strict: false });

const SensorData = mongoose.model('SensorData', SensorDataSchema);

const UserAliasSchema = new mongoose.Schema({
  username: { type: String, unique: true, trim: true, lowercase: true },
  raspi_serial_id: { type: String, unique: true, index: true, trim: true, lowercase: true }
});
const UserAlias = mongoose.model('UserAlias', UserAliasSchema);

const GpsDataSchema = new mongoose.Schema({
  raspi_serial_id: { type: String, index: true, trim: true, lowercase: true },
  lat: Number,
  lon: Number,
  speed_kmh: Number,
  altitude_m: Number,
  sats: Number,
  raw: mongoose.Schema.Types.Mixed,
  timestamp: { type: Date, default: Date.now }
});

// ✅ MUST BE BEFORE model creation
GpsDataSchema.index({ raspi_serial_id: 1, timestamp: -1 });

const GpsData = mongoose.model('GpsData', GpsDataSchema);




// ===== HELPERS =====
function normalizePayload(body) {
  const raspi_serial_id = body?.raspi_serial_id
    ? String(body.raspi_serial_id).toLowerCase().trim()
    : null;

  let records = null;

  if (Array.isArray(body?.data)) records = body.data;
  else if (typeof body?.data === 'object') records = [body.data];
  else if (typeof body?.metrics === 'object') records = [body.metrics];
  else if (typeof body?.temperature === 'number') records = [{ temp_c: body.temperature }];

  return {
    raspi_serial_id,
    records,
    timestamp: new Date()
  };
}


function extractTempC(doc) {
  if (!doc) return null;
  const arr = Array.isArray(doc.data) ? doc.data : [doc.data];
  const rec = arr.find(r =>
    r && (typeof r.temp_c === 'number' || typeof r.temperature === 'number' || typeof r.cpu_temp_c === 'number')
  );
  if (!rec) return null;
  return rec.temp_c ?? rec.cpu_temp_c ?? rec.temperature ?? null;
}

// ===== LOG INCOMING (non-GET) =====
app.use((req, _res, next) => {
  if (req.method !== 'GET') {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} ct=${req.headers['content-type']}`);
    // Avoid huge logs or PII — trim to 1k chars
    try { console.log('BODY:', JSON.stringify(req.body).slice(0, 1000)); } catch { }
  }
  next();
});

// ===== ROUTES =====

// Health
app.get('/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// Ingest IoT data — flexible shapes
app.post('/api/iot-data', async (req, res) => {
  try {
    const { raspi_serial_id, records, timestamp } = normalizePayload(req.body || {});
    if (!raspi_serial_id || !records) {
      return res.status(400).json({
        error: 'Bad payload. Send one of: {raspi_serial_id, data:[...] } | {raspi_serial_id, data:{...}} | {raspi_serial_id, metrics:{...}} | {raspi_serial_id, temperature:Number}'
      });
    }

    const doc = new SensorData({ raspi_serial_id, data: records, timestamp });
    await doc.save();

    io.emit('new-data', {
      raspi_serial_id,
      timestamp: doc.timestamp,
      data: doc.data
    });

    return res.status(201).json({ success: true });
  } catch (err) {
    console.error('[SAVE ERROR]', err);
    return res.status(500).json({ error: err.message });
  }
});

// Latest raw document for a raspi
app.get('/api/user/:raspiID/latest', async (req, res) => {
  const raspiID = String(req.params.raspiID).toLowerCase();
  const data = await SensorData.findOne({ raspi_serial_id: raspiID }).sort({ timestamp: -1 });
  if (data) return res.json(data);
  return res.status(404).json({ message: 'Not found' });
});

// All docs for a raspi (desc)
app.get('/api/data/:raspiID', async (req, res) => {
  const raspiID = String(req.params.raspiID).toLowerCase();
  try {
    const data = await SensorData.find({ raspi_serial_id: raspiID }).sort({ timestamp: -1 });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Latest temperature helper
app.get('/api/temp/:raspiID/latest', async (req, res) => {
  const raspiID = String(req.params.raspiID).toLowerCase();
  const doc = await SensorData.findOne({ raspi_serial_id: raspiID }).sort({ timestamp: -1 });
  if (!doc) return res.status(404).json({ message: 'No data' });

  const temp_c = extractTempC(doc);
  return res.json({
    raspi_serial_id: raspiID,
    timestamp: doc.timestamp,
    temp_c
  });
});

// Alias resolve (treat IDs as strings consistently)
app.get('/api/resolve/:input', async (req, res) => {
  const input = String(req.params.input).toLowerCase();
  let alias = null;
  if (/^\d+$/.test(input)) {
    alias = await UserAlias.findOne({ raspi_serial_id: input });
  } else {
    alias = await UserAlias.findOne({ username: input });
  }
  if (!alias) return res.status(404).json({ message: 'Alias not found' });
  return res.json({ raspi_serial_id: alias.raspi_serial_id, username: alias.username });
});

// Register alias
app.post('/api/register-alias', async (req, res) => {
  const username = req.body?.username ? String(req.body.username).toLowerCase().trim() : null;
  const raspi_serial_id = req.body?.raspi_serial_id ? String(req.body.raspi_serial_id).toLowerCase().trim() : null;
  if (!username || !raspi_serial_id) return res.status(400).json({ error: 'Invalid data' });

  try {
    if (await UserAlias.findOne({ username })) return res.status(400).json({ error: 'Username already taken' });
    if (await UserAlias.findOne({ raspi_serial_id })) return res.status(400).json({ error: 'Serial ID already taken' });

    const newAlias = new UserAlias({ username, raspi_serial_id });
    await newAlias.save();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/gps', async (req, res) => {
  try {
    const body = req.body || {};
    const raspi_serial_id = String(body.raspi_serial_id || "").trim().toLowerCase();

    if (!raspi_serial_id)
      return res.status(400).json({ error: "Missing raspi_serial_id" });

    // coord validation (0 is valid)
    if (body.lat === undefined || body.lon === undefined)
      return res.status(400).json({ error: "Missing GPS coordinates" });

    const payload = {
      raspi_serial_id,
      lat: Number(body.lat),
      lon: Number(body.lon),
      speed_kmh: Number(body.speed_kmh || 0),
      altitude_m: Number(body.altitude_m || 0),
      sats: Number(body.sats || 0),
      raw: body.raw || null,
      timestamp: new Date()
    };

    const doc = new GpsData(payload);
    await doc.save();

    io.emit("gps-update", {
      raspi_serial_id: doc.raspi_serial_id,
      lat: doc.lat,
      lon: doc.lon,
      speed_kmh: doc.speed_kmh,
      altitude_m: doc.altitude_m,
      sats: doc.sats,
      timestamp: doc.timestamp
    });

    res.json({ success: true });

  } catch (err) {
    console.error("[GPS ERROR]", err);
    res.status(500).json({ error: err.message });
  }
});


app.get('/api/gps/:raspiID/latest', async (req, res) => {
  const raspiID = req.params.raspiID.toLowerCase();
  const doc = await GpsData.findOne({ raspi_serial_id: raspiID })
                           .sort({ timestamp: -1 });
  if (!doc) return res.status(404).json({ message: "No GPS data" });
  res.json(doc);
});

// ===== SOCKETS =====
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  socket.on('disconnect', () => console.log('Client disconnected:', socket.id));
});

// ===== START =====
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
