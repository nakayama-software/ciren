// server.js
// IoT + GPS Backend with merged /api/data/:raspiID result
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
  data: { type: mongoose.Schema.Types.Mixed, default: [] },
  last_seen: { type: Date, default: Date.now }
}, { strict: false });

SensorDataSchema.index({ "data.sensor_controller_id": 1 });
SensorDataSchema.index({ raspi_serial_id: 1, timestamp: -1 });

const SensorData = mongoose.model('SensorData', SensorDataSchema);

const RaspiStatusSchema = new mongoose.Schema({
  raspi_serial_id: { type: String, unique: true, lowercase: true, index: true },
  last_seen: { type: Date, default: Date.now }
});
const RaspiStatus = mongoose.model('RaspiStatus', RaspiStatusSchema);



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

GpsDataSchema.index({ raspi_serial_id: 1, timestamp: -1 });

const GpsData = mongoose.model('GpsData', GpsDataSchema);


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
  const rec = arr.find(r =>
    r && (typeof r.temp_c === 'number' ||
      typeof r.temperature === 'number' ||
      typeof r.cpu_temp_c === 'number')
  );
  return rec ? (rec.temp_c ?? rec.cpu_temp_c ?? rec.temperature) : null;
}


// ===== LOG INCOMING NON-GET =====
app.use((req, _res, next) => {
  if (req.method !== 'GET') {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    try { console.log('BODY:', JSON.stringify(req.body).slice(0, 1000)); } catch { }
  }
  next();
});


// ======================= ROUTES =======================

// Health
app.get('/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// -------------------- IoT Data ------------------------
app.post('/api/iot-data', async (req, res) => {
  try {
    const { raspi_serial_id, records, timestamp } = normalizePayload(req.body || {});
    if (!raspi_serial_id || !records)
      return res.status(400).json({ error: 'Invalid IoT data' });

    const doc = new SensorData({ raspi_serial_id, data: records, timestamp });
    await doc.save();

    await RaspiStatus.findOneAndUpdate(
      { raspi_serial_id },
      { last_seen: new Date() },
      { upsert: true }
    );

    io.emit('new-data', {
      raspi_serial_id,
      timestamp: doc.timestamp,
      data: doc.data
    });

    res.status(201).json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// GET all IoT + GPS (MERGED) ✅
app.get('/api/data/:raspiID', async (req, res) => {
  const raspiID = String(req.params.raspiID).toLowerCase();

  try {
    const iotDocs = await SensorData
      .find({ raspi_serial_id: raspiID })
      .sort({ timestamp: -1 })
      .lean();

    const gpsDoc = await GpsData
      .findOne({ raspi_serial_id: raspiID })
      .sort({ timestamp: -1 })
      .lean();

    return res.json({
      raspi_serial_id: raspiID,
      iot: iotDocs,
      gps: gpsDoc || null
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
    temp_c: extractTempC(doc)
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

  if (!username || !raspi_serial_id)
    return res.status(400).json({ error: 'Invalid data' });

  try {
    if (await UserAlias.findOne({ username }))
      return res.status(400).json({ error: 'Username exists' });

    if (await UserAlias.findOne({ raspi_serial_id }))
      return res.status(400).json({ error: 'Serial exists' });

    const doc = new UserAlias({ username, raspi_serial_id });
    await doc.save();
    res.json({ success: true });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// -------------------- GPS API ------------------------
app.post('/api/gps', async (req, res) => {
  try {
    const body = req.body || {};
    const raspi_serial_id = String(body.raspi_serial_id || '').trim().toLowerCase();

    if (!raspi_serial_id)
      return res.status(400).json({ error: 'Missing raspi_serial_id' });

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
      timestamp: new Date()
    });

    await doc.save();

    // ✅ UPDATE last_seen (important)
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


app.get('/api/gps/:raspiID/latest', async (req, res) => {
  const raspiID = req.params.raspiID.toLowerCase();
  const doc = await GpsData.findOne({ raspi_serial_id: raspiID }).sort({ timestamp: -1 });
  if (!doc) return res.status(404).json({ message: 'No GPS data' });
  res.json(doc);
});

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
    diff_seconds: diffSec.toFixed(1)
  });
});

app.get('/api/controller/:controllerID', async (req, res) => {
  const id = String(req.params.controllerID).toLowerCase();
  const docs = await SensorData.find({
    "data.sensor_controller_id": id
  }).sort({ timestamp: -1 });

  if (!docs.length) return res.status(404).json({ message: 'No data for this controller_id' });

  res.json(docs);
});

app.get('/api/:raspiID/controllers', async (req, res) => {
  const id = String(req.params.raspiID).toLowerCase();

  const docs = await SensorData.find(
    { raspi_serial_id: id },
    { data: 1 }
  ).sort({ timestamp: -1 }).limit(50);

  const set = new Set();

  docs.forEach(doc => {
    const arr = Array.isArray(doc.data) ? doc.data : [doc.data];
    arr.forEach(r => {
      if (r.sensor_controller_id) {
        set.add(String(r.sensor_controller_id).toLowerCase());
      }
    });
  });

  res.json({
    raspi_serial_id: id,
    controllers: [...set]
  });
});


// ===== SOCKETS =====
io.on('connection', socket => {
  console.log('Client connected:', socket.id);
  socket.on('disconnect', () => console.log('Client disconnected:', socket.id));
});

// ===== START =====
server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
