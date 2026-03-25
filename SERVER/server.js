require('dotenv').config();

const express = require('express');
const http = require('http');
const cors = require('cors');
const morgan = require('morgan');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');

normalizeHubObject = require('./helper').normalizeHubObject;

const HOST = process.env.HOST || '0.0.0.0';
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/iot-monitoring';
const JWT_SECRET = process.env.JWT_SECRET || 'ciren-secret-key';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  // Mulai dari WebSocket langsung — tidak ada polling upgrade overhead
  transports: ['websocket', 'polling'],
  // Kurangi ping interval agar disconnect terdeteksi lebih cepat
  pingInterval: 10000,
  pingTimeout: 5000,
});

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(morgan('dev'));

mongoose
  .connect(MONGO_URI)
  .then(() => console.log('[DB] MongoDB Connected'))
  .catch((err) => { console.error('[DB] Connection error:', err.message); process.exit(1); });

// =============================================================================
// SCHEMAS
// =============================================================================

const GpsDataSchema = new mongoose.Schema(
  {
    altitude: { type: Number, default: null },
    latitude: { type: Number, default: null },
    longitude: { type: Number, default: null },
    timestamp_gps: { type: Date, default: Date.now },
  },
  { _id: false }
);

const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true, lowercase: true },
  password: { type: String, required: true },
  created_at: { type: Date, default: Date.now },
});
const User = mongoose.model('User', UserSchema);

const RaspberryPiSchema = new mongoose.Schema({
  raspberry_serial_id: { type: String, required: true, unique: true, trim: true, lowercase: true },
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  label: { type: String, default: null, trim: true },
  temperature: { type: Number, default: null },
  gps_data: { type: GpsDataSchema, default: () => ({}) },
  timestamp_raspberry: { type: Date, default: Date.now },
});
const RaspberryPi = mongoose.model('RaspberryPi', RaspberryPiSchema);

// ---------------------------------------------------------------------------
// SensorController — sensor_datas sebagai Mixed object (bukan array)
// Key = port_number (string "1".."8")
// Alasan: atomic $set per port → tidak ada VersionError saat multi-node
// concurrent POST. Update port 1 dan port 2 dari node berbeda tidak pernah
// konflik karena mereka menulis ke field yang berbeda.
// ---------------------------------------------------------------------------
const SensorControllerSchema = new mongoose.Schema(
  {
    module_id: { type: String, required: true, trim: true },
    raspberry_serial_id: { type: mongoose.Schema.Types.ObjectId, ref: 'RaspberryPi', required: true },
    sensor_datas: { type: mongoose.Schema.Types.Mixed, default: {} },
    last_seen: { type: Date, default: Date.now },
  },
  { timestamps: true }
);
SensorControllerSchema.index({ module_id: 1, raspberry_serial_id: 1 }, { unique: true });
const SensorController = mongoose.model('SensorController', SensorControllerSchema);

const SensorReadingSchema = new mongoose.Schema(
  {
    raspberry_serial_id: { type: String, required: true, trim: true, lowercase: true },
    module_id: { type: String, required: true, trim: true },
    port_number: { type: Number, required: true, min: 1, max: 10 },
    sensor_type: { type: String, default: null, trim: true, lowercase: true },
    value: { type: String, required: true },
    unit: { type: String, default: null, trim: true },
    timestamp_device: { type: Date, default: null },
    timestamp_server: { type: Date, default: Date.now },
  },
  { timestamps: false }
);
SensorReadingSchema.index({ raspberry_serial_id: 1, module_id: 1, sensor_type: 1, timestamp_server: -1 });
SensorReadingSchema.index({ raspberry_serial_id: 1, module_id: 1, port_number: 1, timestamp_server: -1 });
const SensorReading = mongoose.model('SensorReading', SensorReadingSchema);

// =============================================================================
// AUTH MIDDLEWARE
// =============================================================================

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  jwt.verify(token, JWT_SECRET, (err, payload) => {
    if (err) return res.status(403).json({ error: 'Invalid or expired token' });
    req.user = payload;
    next();
  });
}

// =============================================================================
// AUTH ROUTES
// =============================================================================

app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ error: 'Missing username or password' });
    const existing = await User.findOne({ username: username.toLowerCase().trim() });
    if (existing)
      return res.status(400).json({ error: 'Username already taken' });
    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({ username, password: hashed });
    return res.status(201).json({ success: true, username: user.username });
  } catch (err) {
    console.error('Register error:', err);
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ error: 'Missing username or password' });
    const user = await User.findOne({ username: username.toLowerCase().trim() });
    if (!user)
      return res.status(404).json({ error: 'User not found' });
    const valid = await bcrypt.compare(password, user.password);
    if (!valid)
      return res.status(401).json({ error: 'Invalid password' });
    const token = jwt.sign({ id: user._id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
    return res.json({ success: true, token, username: user.username });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// =============================================================================
// RASPI MANAGEMENT ROUTES
// =============================================================================

app.get('/api/raspis', authenticateToken, async (req, res) => {
  try {
    const raspis = await RaspberryPi.find({ user_id: req.user.id }).lean();
    return res.json({ success: true, raspis });
  } catch (err) {
    console.error('Get raspis error:', err);
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/raspis', authenticateToken, async (req, res) => {
  try {
    const { raspberry_serial_id, label } = req.body;
    if (!raspberry_serial_id)
      return res.status(400).json({ error: 'Missing raspberry_serial_id' });
    const serial = raspberry_serial_id.toLowerCase().trim();
    const existing = await RaspberryPi.findOne({ raspberry_serial_id: serial });
    if (existing)
      return res.status(400).json({ error: 'raspberry_serial_id already registered' });
    const raspi = await RaspberryPi.create({ raspberry_serial_id: serial, user_id: req.user.id, label: label || null });
    return res.status(201).json({ success: true, raspi });
  } catch (err) {
    console.error('Add raspi error:', err);
    return res.status(500).json({ error: err.message });
  }
});

app.put('/api/raspis/:raspberry_serial_id', authenticateToken, async (req, res) => {
  try {
    const serial = req.params.raspberry_serial_id.toLowerCase().trim();
    const { label } = req.body;
    const raspi = await RaspberryPi.findOneAndUpdate(
      { raspberry_serial_id: serial, user_id: req.user.id },
      { $set: { label: label ?? null } },
      { new: true }
    );
    if (!raspi)
      return res.status(404).json({ error: 'Raspberry Pi not found or not owned by user' });
    return res.json({ success: true, raspi });
  } catch (err) {
    console.error('Update raspi error:', err);
    return res.status(500).json({ error: err.message });
  }
});

app.delete('/api/raspis/:raspberry_serial_id', authenticateToken, async (req, res) => {
  try {
    const serial = req.params.raspberry_serial_id.toLowerCase().trim();
    const raspi = await RaspberryPi.findOne({ raspberry_serial_id: serial, user_id: req.user.id });
    if (!raspi)
      return res.status(404).json({ error: 'Raspberry Pi not found or not owned by user' });
    const [readingResult, controllerResult] = await Promise.all([
      SensorReading.deleteMany({ raspberry_serial_id: serial }),
      SensorController.deleteMany({ raspberry_serial_id: raspi._id }),
    ]);
    await RaspberryPi.deleteOne({ _id: raspi._id });
    return res.json({
      success: true,
      deleted_readings: readingResult.deletedCount,
      deleted_controllers: controllerResult.deletedCount,
    });
  } catch (err) {
    console.error('Delete raspi error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// =============================================================================
// DASHBOARD ROUTE
// =============================================================================

app.get('/api/dashboard', authenticateToken, async (req, res) => {
  try {
    const raspberryPis = await RaspberryPi.find({ user_id: req.user.id }).lean();
    if (!raspberryPis.length)
      return res.status(404).json({ error: 'No Raspberry Pi found for this user' });

    const raspis = [];

    for (const raspberryPi of raspberryPis) {
      const sensorControllers = await SensorController.find({
        raspberry_serial_id: raspberryPi._id,
      }).lean();

      raspis.push({
        raspberry_serial_id: raspberryPi.raspberry_serial_id,
        label: raspberryPi.label,
        temperature: raspberryPi.temperature,
        gps_data: raspberryPi.gps_data,
        sensor_controllers: sensorControllers.map((ctrl) => ({
          module_id: ctrl.module_id,
          timestamp: ctrl.last_seen,
          // Konversi object {1:{...}, 2:{...}} ke array agar kompatibel frontend
          sensor_datas: Object.values(ctrl.sensor_datas || {}).sort(
            (a, b) => (a.port_number || 0) - (b.port_number || 0)
          ),
        })),
        timestamp_raspberry: raspberryPi.timestamp_raspberry,
        raspi_status: { uptime_s: null },
      });
    }

    return res.json({ raspis });
  } catch (err) {
    console.error('Dashboard error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// =============================================================================
// RASPI ID CACHE — hindari DB lookup di setiap POST sensor-data
// RaspberryPi dokumen sangat jarang berubah, aman di-cache in-memory.
// Key: raspberry_serial_id (string) → Value: raspberryPi._id (ObjectId string)
// TTL: 5 menit — setelah itu lookup DB lagi untuk jaga konsistensi.
// =============================================================================
const raspiIdCache = new Map(); // serial → { _id, cachedAt }
const RASPI_CACHE_TTL_MS = 5 * 60 * 1000;

async function getRaspiId(raspiSerial) {
  const cached = raspiIdCache.get(raspiSerial);
  if (cached && (Date.now() - cached.cachedAt) < RASPI_CACHE_TTL_MS) {
    return cached._id;
  }
  const doc = await RaspberryPi.findOne(
    { raspberry_serial_id: raspiSerial },
    { _id: 1 }
  ).lean();
  if (!doc) return null;
  raspiIdCache.set(raspiSerial, { _id: doc._id, cachedAt: Date.now() });
  return doc._id;
}

// POST /api/raspi-data — update suhu & GPS dari gateway ESP32
app.post('/api/raspi-data', async (req, res) => {
  try {
    const { raspberry_serial_id, datas } = req.body;

    if (!raspberry_serial_id || !datas || !Array.isArray(datas))
      return res.status(400).json({ error: 'Missing raspberry_serial_id or invalid datas' });

    const temperatureObj = datas.find(d => d.temperature !== undefined);
    const gpsObj = [...datas].reverse().find(d =>
      d.altitude !== undefined && d.longitude !== undefined
    );

    const update = { timestamp_raspberry: new Date() };
    if (temperatureObj?.temperature !== undefined)
      update.temperature = temperatureObj.temperature;
    if (gpsObj) {
      update.gps_data = {
        altitude: gpsObj.altitude,
        latitude: gpsObj.latitude,
        longitude: gpsObj.longitude,
        timestamp_gps: gpsObj.timestamp_gps ? new Date(gpsObj.timestamp_gps) : new Date(),
      };
    }

    const raspberryPi = await RaspberryPi.findOneAndUpdate(
      { raspberry_serial_id: raspberry_serial_id.toLowerCase().trim() },
      { $set: update },
      { new: true }
    );

    if (!raspberryPi)
      return res.status(404).json({ error: 'Raspberry Pi not found' });

    return res.json({ success: true, raspberryPi });
  } catch (err) {
    console.error('Raspberry Pi data error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/sensor-data — insert sensor readings dari ESP32 sensor controller
// Fix race condition: atomic $set per port (tidak pakai findOne + save)
// Aman untuk 8 sensor node POST bersamaan tanpa VersionError
app.post('/api/sensor-data', async (req, res) => {
  try {
    const { sensor_controller_id, raspberry_serial_id, datas } = req.body;


    if (!sensor_controller_id || !raspberry_serial_id || !Array.isArray(datas))
      return res.status(400).json({
        error: 'Missing sensor_controller_id, raspberry_serial_id, or invalid datas',
      });

    const raspiSerial = String(raspberry_serial_id).toLowerCase().trim();
    const moduleId = String(sensor_controller_id).trim();

    // Gunakan cache — hindari DB round-trip di setiap POST sensor-data
    const raspiObjectId = await getRaspiId(raspiSerial);
    if (!raspiObjectId)
      return res.status(404).json({ error: 'Raspberry Pi not found' });
    const raspberryPi = { _id: raspiObjectId };

    const now = new Date();
    const readings = [];
    const skipped = [];

    // Atomic $set — setiap port menulis ke key berbeda
    // sensor_datas.1.value, sensor_datas.2.value, dst.
    // 8 node POST bersamaan tidak konflik → tidak ada VersionError
    const atomicSet = { last_seen: now };

    for (const d of datas) {
      const port_number = Number(d?.port_number);

      if (!port_number || port_number < 1 || port_number > 10) {
        skipped.push({ port_number: d?.port_number ?? null, reason: 'invalid_port_number' });
        continue;
      }

      const sensor_type_raw = d?.sensor_type;
      const sensor_type =
        sensor_type_raw === null || sensor_type_raw === undefined
          ? null
          : (String(sensor_type_raw).trim().toLowerCase() || null);

      const value_raw = d?.value;
      const value =
        value_raw === null || value_raw === undefined
          ? null
          : (typeof value_raw === 'string' && value_raw.trim() === '' ? null : value_raw);

      const unit = d?.unit ?? null;
      const timestamp_device = d?.timestamp_device ? new Date(d.timestamp_device) : null;

      const sensorTypePart = sensor_type ?? 'null';
      const valuePart = value === null ? 'null' : String(value);

      // Key per port — tidak overlap antar sensor node
      atomicSet[`sensor_datas.${port_number}.port_number`] = port_number;
      atomicSet[`sensor_datas.${port_number}.sensor_type`] = sensor_type;
      atomicSet[`sensor_datas.${port_number}.value`] = value;
      atomicSet[`sensor_datas.${port_number}.unit`] = unit;
      atomicSet[`sensor_datas.${port_number}.sensor_data`] =
        `${port_number}-${sensorTypePart}-${valuePart}`;
      atomicSet[`sensor_datas.${port_number}.last_seen`] = now;

      if (!sensor_type || value === null) {
        skipped.push({
          port_number,
          reason: !sensor_type ? 'missing_sensor_type' : 'missing_value',
        });
        continue;
      }

      readings.push({
        raspberry_serial_id: raspiSerial,
        module_id: moduleId,
        port_number,
        sensor_type,
        value,
        unit,
        timestamp_device,
        timestamp_server: now,
      });
    }

    // ─── EMIT DULU, DB BELAKANGAN ───────────────────────────────────────────
    // Root cause delay 2-5 detik:
    //   Sebelumnya emit dilakukan SETELAH await Promise.all([insertMany, upsert])
    //   → frontend harus tunggu seluruh DB round-trip (50-500ms) baru dapat data.
    //   Ditambah ESP32 juga harus tunggu response → next POST tertunda.
    //
    // Fix: emit socket + respond ke ESP32 langsung dari `readings` array,
    //   lalu DB write jalan fire-and-forget di background.
    //   Latency frontend: <5ms setelah POST tiba di server.
    // ────────────────────────────────────────────────────────────────────────

    // 1. Emit ke semua frontend client — SEBELUM DB write
    for (const doc of readings) {
      io.emit('node-sample', {
        raspberry_serial_id: doc.raspberry_serial_id,
        module_id: doc.module_id,
        port_number: doc.port_number,
        sensor_type: doc.sensor_type,
        value: String(doc.value),
        unit: doc.unit ?? null,
        timestamp_device: doc.timestamp_device ?? null,
        timestamp_server: doc.timestamp_server ?? now,
      });
    }

    // 2. Respond ke ESP32 langsung — tidak perlu tunggu DB
    res.json({
      success: true,
      inserted_count: readings.length,
      skipped_count: skipped.length,
      skipped,
    });

    // 3. DB write jalan di background — ESP32 sudah dapat 200 OK
    if (readings.length) {
      SensorReading.insertMany(readings, { ordered: false })
        .catch(err => console.error('[DB] insertMany error:', err.message));
    }

    SensorController.findOneAndUpdate(
      { module_id: moduleId, raspberry_serial_id: raspberryPi._id },
      {
        $set: atomicSet,
        $setOnInsert: { module_id: moduleId, raspberry_serial_id: raspberryPi._id },
      },
      { upsert: true, new: false } // new:false — tidak perlu baca doc hasil
    ).catch(err => console.error('[DB] upsert controller error:', err.message));
  } catch (err) {
    console.error('Sensor data error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// =============================================================================
// SENSOR READINGS ROUTES
// =============================================================================

app.get('/api/sensor-readings', async (req, res) => {
  try {
    const {
      raspberry_serial_id,
      module_id,
      sensor_type,
      port_number,
      from,
      to,
      limit = 200,
      skip = 0,
    } = req.query;

    if (!raspberry_serial_id || !module_id || !sensor_type)
      return res.status(400).json({ error: 'Missing raspberry_serial_id, module_id, or sensor_type' });

    const filter = {
      raspberry_serial_id: String(raspberry_serial_id).toLowerCase().trim(),
      module_id: String(module_id).trim(),
      sensor_type: String(sensor_type).toLowerCase().trim(),
    };

    if (port_number !== undefined) filter.port_number = Number(port_number);

    if (from || to) {
      filter.timestamp_server = {};
      if (from) filter.timestamp_server.$gte = new Date(from);
      if (to) filter.timestamp_server.$lte = new Date(to);
    }

    const lim = Math.min(Number(limit) || 200, 2000);
    const sk = Math.max(Number(skip) || 0, 0);

    const items = await SensorReading.find(filter)
      .sort({ timestamp_server: -1 })
      .skip(sk)
      .limit(lim)
      .lean();

    return res.json({ success: true, count: items.length, items, next_skip: sk + items.length });
  } catch (err) {
    console.error('Get sensor readings error:', err);
    return res.status(500).json({ error: err.message });
  }
});

app.delete('/api/sensor-readings', async (req, res) => {
  try {
    const { raspberry_serial_id, module_id, sensor_type, port_number, from, to } = req.body || {};

    if (!raspberry_serial_id || !module_id || !sensor_type)
      return res.status(400).json({ error: 'Missing raspberry_serial_id, module_id, or sensor_type' });

    const filter = {
      raspberry_serial_id: String(raspberry_serial_id).toLowerCase().trim(),
      module_id: String(module_id).trim(),
      sensor_type: String(sensor_type).toLowerCase().trim(),
    };

    if (port_number !== undefined) filter.port_number = Number(port_number);

    if (from || to) {
      filter.timestamp_server = {};
      if (from) filter.timestamp_server.$gte = new Date(from);
      if (to) filter.timestamp_server.$lte = new Date(to);
    }

    const result = await SensorReading.deleteMany(filter);
    return res.json({ success: true, deleted_count: result.deletedCount ?? 0 });
  } catch (err) {
    console.error('Delete sensor readings error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// =============================================================================
// SOCKET.IO
// =============================================================================

io.on('connection', (socket) => {
  socket.on('disconnect', () => console.log('Client disconnected:', socket.id));
});

// =============================================================================
// START
// =============================================================================

server.listen(PORT, HOST, () => {
  console.log(`Server running at http://${HOST}:${PORT}`);
});