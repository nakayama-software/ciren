require('dotenv').config();

const express    = require('express');
const http       = require('http');
const cors       = require('cors');
const morgan     = require('morgan');
const mongoose   = require('mongoose');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const { Server } = require('socket.io');

normalizeHubObject = require('./helper').normalizeHubObject;

const PORT      = process.env.PORT       || 3000;
const MONGO_URI = process.env.MONGO_URI  || 'mongodb://localhost:27017/iot-monitoring';
const JWT_SECRET = process.env.JWT_SECRET || 'ciren-secret-key';

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(morgan('dev'));

mongoose
  .connect(MONGO_URI)
  .then(() => console.log('[DB] MongoDB Connected'))
  .catch((err) => {
    console.error('[DB] Connection error:', err.message);
    process.exit(1);
  });

// =============================================================================
// SCHEMAS
// =============================================================================

// --- GPS (embedded, no _id) --------------------------------------------------
const GpsDataSchema = new mongoose.Schema(
  {
    altitude:      { type: Number, default: null },
    latitude:      { type: Number, default: null },
    longitude:     { type: Number, default: null },
    timestamp_gps: { type: Date,   default: Date.now },
  },
  { _id: false }
);

// --- User --------------------------------------------------------------------
const UserSchema = new mongoose.Schema({
  username:   { type: String, required: true, unique: true, trim: true, lowercase: true },
  password:   { type: String, required: true },
  created_at: { type: Date, default: Date.now },
});

const User = mongoose.model('User', UserSchema);

// --- RaspberryPi -------------------------------------------------------------
const RaspberryPiSchema = new mongoose.Schema({
  raspberry_serial_id: { type: String, required: true, unique: true, trim: true, lowercase: true },
  user_id:             { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  label:               { type: String, default: null, trim: true },
  temperature:         { type: Number, default: null },
  gps_data:            { type: GpsDataSchema, default: () => ({}) },
  timestamp_raspberry: { type: Date, default: Date.now },
});

const RaspberryPi = mongoose.model('RaspberryPi', RaspberryPiSchema);

// --- SensorController --------------------------------------------------------
const SensorDataSchema = new mongoose.Schema({
  port_number: { type: Number, required: true, enum: [1, 2, 3, 4, 5, 6, 7, 8] },
  sensor_data: { type: String, required: true },
});

const SensorControllerSchema = new mongoose.Schema({
  module_id:           { type: String, required: true, trim: true },
  raspberry_serial_id: { type: mongoose.Schema.Types.ObjectId, ref: 'RaspberryPi', required: true },
  sensor_datas:        [SensorDataSchema],
  last_seen:           { type: Date, default: Date.now },
});

const SensorController = mongoose.model('SensorController', SensorControllerSchema);

// --- SensorReading -----------------------------------------------------------
const SensorReadingSchema = new mongoose.Schema(
  {
    raspberry_serial_id: { type: String, required: true, trim: true, lowercase: true },
    module_id:           { type: String, required: true, trim: true },
    port_number:         { type: Number, required: true, min: 1, max: 8 },
    sensor_type:         { type: String, default: null, trim: true, lowercase: true },
    value:               { type: String, required: true },
    unit:                { type: String, default: null, trim: true },
    timestamp_device:    { type: Date, default: null },
    timestamp_server:    { type: Date, default: Date.now },
  },
  { timestamps: false }
);

SensorReadingSchema.index({ raspberry_serial_id: 1, module_id: 1, sensor_type: 1,   timestamp_server: -1 });
SensorReadingSchema.index({ raspberry_serial_id: 1, module_id: 1, port_number: 1,   timestamp_server: -1 });

const SensorReading = mongoose.model('SensorReading', SensorReadingSchema);

// =============================================================================
// AUTH MIDDLEWARE
// =============================================================================

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token      = authHeader && authHeader.split(' ')[1]; // "Bearer <token>"

  if (!token) return res.status(401).json({ error: 'No token provided' });

  jwt.verify(token, JWT_SECRET, (err, payload) => {
    if (err) return res.status(403).json({ error: 'Invalid or expired token' });
    req.user = payload; // { id, username }
    next();
  });
}

// =============================================================================
// AUTH ROUTES  (public)
// =============================================================================

// POST /api/register  —  { username, password }
app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password)
      return res.status(400).json({ error: 'Missing username or password' });

    const existing = await User.findOne({ username: username.toLowerCase().trim() });
    if (existing)
      return res.status(400).json({ error: 'Username already taken' });

    const hashed = await bcrypt.hash(password, 10);
    const user   = await User.create({ username, password: hashed });

    return res.status(201).json({ success: true, username: user.username });
  } catch (err) {
    console.error('Register error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/login  —  { username, password }
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

    const token = jwt.sign(
      { id: user._id, username: user.username },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.json({ success: true, token, username: user.username });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// =============================================================================
// RASPI MANAGEMENT ROUTES  (protected)
// =============================================================================

// GET /api/raspis  —  list semua raspi milik user yang sedang login
app.get('/api/raspis', authenticateToken, async (req, res) => {
  try {
    const raspis = await RaspberryPi.find({ user_id: req.user.id }).lean();
    return res.json({ success: true, raspis });
  } catch (err) {
    console.error('Get raspis error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/raspis  —  tambah raspi baru ke akun user
// body: { raspberry_serial_id, label? }
app.post('/api/raspis', authenticateToken, async (req, res) => {
  try {
    const { raspberry_serial_id, label } = req.body;

    if (!raspberry_serial_id)
      return res.status(400).json({ error: 'Missing raspberry_serial_id' });

    const serial = raspberry_serial_id.toLowerCase().trim();

    // Cek apakah serial ID sudah terdaftar (milik user lain atau diri sendiri)
    const existing = await RaspberryPi.findOne({ raspberry_serial_id: serial });
    if (existing)
      return res.status(400).json({ error: 'raspberry_serial_id already registered' });

    const raspi = await RaspberryPi.create({
      raspberry_serial_id: serial,
      user_id: req.user.id,
      label:   label || null,
    });

    return res.status(201).json({ success: true, raspi });
  } catch (err) {
    console.error('Add raspi error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// PUT /api/raspis/:raspberry_serial_id  —  update label raspi
// body: { label }
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

// DELETE /api/raspis/:raspberry_serial_id  —  hapus raspi + semua datanya
app.delete('/api/raspis/:raspberry_serial_id', authenticateToken, async (req, res) => {
  try {
    const serial = req.params.raspberry_serial_id.toLowerCase().trim();

    // Pastikan raspi milik user yang sedang login
    const raspi = await RaspberryPi.findOne({ raspberry_serial_id: serial, user_id: req.user.id });
    if (!raspi)
      return res.status(404).json({ error: 'Raspberry Pi not found or not owned by user' });

    // Hapus SensorReading
    const readingResult = await SensorReading.deleteMany({ raspberry_serial_id: serial });

    // Hapus SensorController
    const controllerResult = await SensorController.deleteMany({ raspberry_serial_id: raspi._id });

    // Hapus RaspberryPi
    await RaspberryPi.deleteOne({ _id: raspi._id });

    return res.json({
      success:            true,
      deleted_readings:   readingResult.deletedCount,
      deleted_controllers: controllerResult.deletedCount,
    });
  } catch (err) {
    console.error('Delete raspi error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// =============================================================================
// DASHBOARD ROUTE  (protected)
// =============================================================================

// GET /api/dashboard  —  semua raspi + controller + sensor terbaru milik user
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
        label:               raspberryPi.label,
        temperature:         raspberryPi.temperature,
        gps_data:            raspberryPi.gps_data,
        sensor_controllers:  sensorControllers.map((ctrl) => ({
          module_id:    ctrl.module_id,
          timestamp:    ctrl.last_seen,
          sensor_datas: ctrl.sensor_datas,
        })),
        timestamp_raspberry: raspberryPi.timestamp_raspberry,
        raspi_status: {
          uptime_s: null,
        },
      });
    }

    return res.json({ raspis });
  } catch (err) {
    console.error('Dashboard error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// =============================================================================
// HARDWARE ROUTES  (no auth — device-to-server)
// =============================================================================

// POST /api/raspi-data  —  update suhu & GPS dari Raspberry Pi fisik
app.post('/api/raspi-data', async (req, res) => {
  try {
    const { raspberry_serial_id, datas } = req.body;

    if (!raspberry_serial_id || !datas || !Array.isArray(datas))
      return res.status(400).json({ error: 'Missing raspberry_serial_id or invalid datas' });

    const temperatureObj = datas.find(d => d.temperature !== undefined);
    const gpsObj         = [...datas].reverse().find(d =>
      d.altitude !== undefined && d.longitude !== undefined
    );

    const update = { timestamp_raspberry: new Date() };

    if (temperatureObj?.temperature !== undefined)
      update.temperature = temperatureObj.temperature;

    if (gpsObj) {
      update.gps_data = {
        altitude:      gpsObj.altitude,
        latitude:      gpsObj.latitude,
        longitude:     gpsObj.longitude,
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

// POST /api/sensor-data  —  insert sensor readings dari ESP32 controller
app.post('/api/sensor-data', async (req, res) => {
  try {
    const { sensor_controller_id, raspberry_serial_id, datas } = req.body;

    if (!sensor_controller_id || !raspberry_serial_id || !Array.isArray(datas))
      return res.status(400).json({ error: 'Missing sensor_controller_id, raspberry_serial_id, or invalid datas' });

    const raspiSerial = String(raspberry_serial_id).toLowerCase().trim();
    const moduleId    = String(sensor_controller_id).trim();

    const raspberryPi = await RaspberryPi.findOne({ raspberry_serial_id: raspiSerial });
    if (!raspberryPi)
      return res.status(404).json({ error: 'Raspberry Pi not found' });

    const now              = new Date();
    const controllerUpdates = [];
    const readings          = [];
    const skipped           = [];

    for (const d of datas) {
      const port_number = Number(d?.port_number);

      if (!port_number || port_number < 1 || port_number > 10) {
        skipped.push({ port_number: d?.port_number ?? null, reason: 'invalid_port_number' });
        continue;
      }

      const sensor_type_raw = d?.sensor_type;
      const sensor_type     =
        sensor_type_raw === null || sensor_type_raw === undefined
          ? null
          : (String(sensor_type_raw).trim().toLowerCase() || null);

      const value_raw = d?.value;
      const value     =
        value_raw === null || value_raw === undefined
          ? null
          : (typeof value_raw === 'string' && value_raw.trim() === '' ? null : value_raw);

      const unit             = d?.unit ?? null;
      const timestamp_device = d?.timestamp_device ? new Date(d.timestamp_device) : null;

      controllerUpdates.push({ port_number, sensor_type, value, unit, timestamp_device });

      if (!sensor_type || value === null) {
        skipped.push({
          port_number,
          reason: !sensor_type ? 'missing_sensor_type' : 'missing_value',
        });
        continue;
      }

      readings.push({
        raspberry_serial_id: raspiSerial,
        module_id:           moduleId,
        port_number,
        sensor_type,
        value,
        unit,
        timestamp_device,
        timestamp_server: now,
      });
    }

    const inserted = readings.length
      ? await SensorReading.insertMany(readings, { ordered: true })
      : [];

    let sensorController = await SensorController.findOne({
      module_id:           moduleId,
      raspberry_serial_id: raspberryPi._id,
    });

    if (!sensorController) {
      sensorController = new SensorController({
        module_id:           moduleId,
        raspberry_serial_id: raspberryPi._id,
        sensor_datas:        [],
      });
    }

    for (const u of controllerUpdates) {
      const sensorTypePart = u.sensor_type ?? 'null';
      const valuePart      = u.value === null ? 'null' : String(u.value);
      const sensorDataStr  = `${u.port_number}-${sensorTypePart}-${valuePart}`;

      const existing = sensorController.sensor_datas.find(
        x => Number(x.port_number) === Number(u.port_number)
      );

      if (existing) {
        existing.sensor_data = sensorDataStr;
      } else {
        sensorController.sensor_datas.push({ port_number: u.port_number, sensor_data: sensorDataStr });
      }
    }

    sensorController.markModified('sensor_datas');
    await sensorController.save();

    for (const doc of inserted) {
      io.emit('node-sample', {
        _id:                 String(doc._id),
        raspberry_serial_id: doc.raspberry_serial_id,
        module_id:           doc.module_id,
        port_number:         doc.port_number,
        sensor_type:         doc.sensor_type,
        value:               doc.value,
        unit:                doc.unit ?? null,
        timestamp_device:    doc.timestamp_device ?? null,
        timestamp_server:    doc.timestamp_server ?? now,
      });
    }

    return res.json({
      success:          true,
      inserted_count:   inserted.length,
      skipped_count:    skipped.length,
      skipped,
      sensorController,
    });
  } catch (err) {
    console.error('Sensor data error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// =============================================================================
// SENSOR READINGS ROUTES
// =============================================================================

// GET /api/sensor-readings
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
      skip  = 0,
    } = req.query;

    if (!raspberry_serial_id || !module_id || !sensor_type)
      return res.status(400).json({ error: 'Missing raspberry_serial_id, module_id, or sensor_type' });

    const filter = {
      raspberry_serial_id: String(raspberry_serial_id).toLowerCase().trim(),
      module_id:           String(module_id).trim(),
      sensor_type:         String(sensor_type).toLowerCase().trim(),
    };

    if (port_number !== undefined) filter.port_number = Number(port_number);

    if (from || to) {
      filter.timestamp_server = {};
      if (from) filter.timestamp_server.$gte = new Date(from);
      if (to)   filter.timestamp_server.$lte = new Date(to);
    }

    const lim   = Math.min(Number(limit) || 200, 2000);
    const sk    = Math.max(Number(skip)  || 0,   0);

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

// DELETE /api/sensor-readings
app.delete('/api/sensor-readings', async (req, res) => {
  try {
    const { raspberry_serial_id, module_id, sensor_type, port_number, from, to } = req.body || {};

    if (!raspberry_serial_id || !module_id || !sensor_type)
      return res.status(400).json({ error: 'Missing raspberry_serial_id, module_id, or sensor_type' });

    const filter = {
      raspberry_serial_id: String(raspberry_serial_id).toLowerCase().trim(),
      module_id:           String(module_id).trim(),
      sensor_type:         String(sensor_type).toLowerCase().trim(),
    };

    if (port_number !== undefined) filter.port_number = Number(port_number);

    if (from || to) {
      filter.timestamp_server = {};
      if (from) filter.timestamp_server.$gte = new Date(from);
      if (to)   filter.timestamp_server.$lte = new Date(to);
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

server.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));