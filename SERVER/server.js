// server.js — Express + Mongo + Socket.IO (opsional) — Optimized

require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

/* =================== CONFIG =================== */
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/iot-monitoring';
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

/* ================== BOOTSTRAP ================== */
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: CORS_ORIGIN } });

app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json({ limit: '1mb' }));

/* ================== DATABASE =================== */
mongoose
  .connect(MONGO_URI, { autoIndex: true })
  .then(() => console.log('[MongoDB] Connected'))
  .catch((err) => { console.error('[MongoDB] Error:', err); process.exit(1); });

const SensorDataSchema = new mongoose.Schema({
  raspi_serial_id: { type: String, index: true, trim: true, lowercase: true },
  timestamp: { type: Date, default: Date.now },           // timestamp dari klien (jika ada)
  received_ts: { type: Date, default: Date.now },          // cap waktu server
  data: { type: Array, default: [] }                       // fleksibel (objek hub & RASPI_SYS)
}, { minimize: false });

// Indeks penting
SensorDataSchema.index({ raspi_serial_id: 1, received_ts: -1 });
SensorDataSchema.index({ received_ts: -1 });

const SensorData = mongoose.model('SensorData', SensorDataSchema);

const UserAliasSchema = new mongoose.Schema({
  username: { type: String, unique: true, trim: true, lowercase: true },
  raspi_serial_id: { type: String, unique: true, index: true, trim: true, lowercase: true }
});
const UserAlias = mongoose.model('UserAlias', UserAliasSchema);

/* ================ SOCKET.IO ==================== */
io.on('connection', (socket) => {
  console.log('[Socket.IO] Client connected:', socket.id);
});

/* =================== ROUTES ==================== */

// Healthcheck
app.get('/api/health', (_req, res) => res.json({ ok: true, t: new Date() }));

// Register alias username <-> raspi_serial_id
app.post('/api/register-alias', async (req, res) => {
  const { username, raspi_serial_id } = req.body || {};
  if (!username || !raspi_serial_id) return res.status(400).json({ error: 'Invalid data' });
  try {
    const existsUser = await UserAlias.findOne({ username });
    if (existsUser) return res.status(400).json({ error: 'Username already taken' });

    const existsRaspi = await UserAlias.findOne({ raspi_serial_id });
    if (existsRaspi) return res.status(400).json({ error: 'Serial ID already taken' });

    await new UserAlias({ username, raspi_serial_id }).save();
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Resolve username atau angka -> raspi_serial_id
app.get('/api/resolve/:input', async (req, res) => {
  const input = String(req.params.input).trim().toLowerCase();
  try {
    if (/^\d+$/.test(input)) {
      // angka → treat as serial id di UserAlias
      const alias = await UserAlias.findOne({ raspi_serial_id: input });
      if (!alias) return res.status(404).json({ message: 'Raspi serial ID belum terdaftar' });
      return res.json({ raspi_serial_id: alias.raspi_serial_id, username: alias.username });
    }
    const alias = await UserAlias.findOne({ username: input });
    if (!alias) return res.status(404).json({ message: 'Username tidak ditemukan' });
    return res.json({ raspi_serial_id: alias.raspi_serial_id, username: alias.username });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Terima data dari RasPi (via Python forwarder)
app.post('/api/iot-data', async (req, res) => {
  try {
    const { raspi_serial_id, data } = req.body || {};
    if (!raspi_serial_id || !Array.isArray(data)) {
      return res.status(400).json({ error: 'Bad payload. Expect { raspi_serial_id, data: [...] }' });
    }

    const doc = new SensorData({
      raspi_serial_id,
      data,
      received_ts: new Date()
    });

    await doc.save();
    io.emit('new-data', { raspi_serial_id, id: doc._id.toString(), received_ts: doc.received_ts });
    res.status(201).json({ success: true });
  } catch (err) {
    console.error('[SAVE ERROR]', err);
    res.status(500).json({ error: err.message });
  }
});

// Data query (opsional: since, limit, type)
app.get('/api/data/:raspiID', async (req, res) => {
  const raspiID = String(req.params.raspiID).toLowerCase();
  const limit = Math.min(parseInt(req.query.limit || '500', 10), 2000);
  const since = req.query.since ? new Date(req.query.since) : null;
  const type = req.query.type; // e.g. 'RASPI_SYS'

  const q = { raspi_serial_id: raspiID };
  if (since && !isNaN(since.getTime())) q.received_ts = { $gte: since };
  if (type) q['data.sensor_controller_id'] = type;

  try {
    const rows = await SensorData.find(q).sort({ received_ts: -1 }).limit(limit);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Status RasPi (online/offline + metrik terbaru)
app.get('/api/raspi/:raspiID/status', async (req, res) => {
  try {
    const raspiID = String(req.params.raspiID).toLowerCase();
    const WINDOW_MS = parseInt(process.env.RASPI_STATUS_WINDOW_MS || '15000', 10);

    const doc = await SensorData.findOne({
      raspi_serial_id: raspiID,
      'data.sensor_controller_id': 'RASPI_SYS'
    }).sort({ received_ts: -1 }).lean();

    const now = Date.now();
    let online = false;
    let metrics = null;
    let last_ts = null;

    if (doc) {
      last_ts = new Date(doc.received_ts).getTime();
      online = (now - last_ts) <= WINDOW_MS;
      metrics = (doc.data || []).find(d => d && d.sensor_controller_id === 'RASPI_SYS') || null;
    }

    res.json({
      raspi_serial_id: raspiID,
      online,
      last_received_ts: doc ? doc.received_ts : null,
      metrics
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Riwayat metrik RasPi (hanya RASPI_SYS)
app.get('/api/raspi/:raspiID/metrics', async (req, res) => {
  try {
    const raspiID = String(req.params.raspiID).toLowerCase();
    const limit = Math.min(parseInt(req.query.limit || '50', 10), 1000);

    const docs = await SensorData.find({
      raspi_serial_id: raspiID,
      'data.sensor_controller_id': 'RASPI_SYS'
    }).sort({ received_ts: -1 }).limit(limit).lean();

    const rows = [];
    for (const doc of docs) {
      const sys = (doc.data || []).find(d => d && d.sensor_controller_id === 'RASPI_SYS');
      if (sys) rows.push({ received_ts: doc.received_ts, timestamp: doc.timestamp, ...sys });
    }
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ================== START ====================== */
server.listen(PORT, () => {
  console.log(`[Server] Listening on http://localhost:${PORT}`);
});
