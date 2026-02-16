require('dotenv').config();

const express = require('express');
const http = require('http');
const cors = require('cors');
const morgan = require('morgan');
const mongoose = require('mongoose');
const { Server } = require('socket.io');
const { log } = require('console');

normalizeHubObject = require('./helper').normalizeHubObject;

const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/iot-monitoring';

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

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

//----------------- NEW SCHEMA ---------------------
const GpsDataSchema = new mongoose.Schema(
  {
    altitude: { type: Number, default: null },
    latitude: { type: Number, default: null },
    longitude: { type: Number, default: null },
    timestamp_gps: { type: Date, default: Date.now },
  },
  { _id: false }
);

const RaspberryPiSchema = new mongoose.Schema({
  raspberry_serial_id: { type: String, required: true, unique: true, trim: true, lowercase: true },
  username: { type: String, required: true, trim: true, lowercase: true },
  temperature: { type: Number, default: null },
  gps_data: { type: GpsDataSchema, default: () => ({}) },

  timestamp_raspberry: { type: Date, default: Date.now },
});

const RaspberryPi = mongoose.model('RaspberryPi', RaspberryPiSchema);

const SensorDataSchema = new mongoose.Schema({
  port_number: { type: Number, required: true, enum: [1, 2, 3, 4, 5, 6, 7, 8] },
  sensor_data: { type: String, required: true },
});

const SensorControllerSchema = new mongoose.Schema({
  module_id: { type: String, required: true, trim: true },
  raspberry_serial_id: { type: mongoose.Schema.Types.ObjectId, ref: 'RaspberryPi', required: true },
  sensor_datas: [SensorDataSchema],
  last_seen: { type: Date, default: Date.now },
});

const SensorController = mongoose.model('SensorController', SensorControllerSchema);

const SensorReadingSchema = new mongoose.Schema(
  {
    raspberry_serial_id: { type: String, required: true, trim: true, lowercase: true },
    module_id: { type: String, required: true, trim: true },

    port_number: { type: Number, required: true, min: 1, max: 8 },
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


//-------------------------------------------------------------

app.post('/api/register', async (req, res) => {
  try {
    const { raspberry_serial_id, username } = req.body;

    if (!raspberry_serial_id || !username) {
      return res.status(400).json({ error: 'Missing raspberry_serial_id or username' });
    }

    // Check if Raspberry Pi with the same serial_id already exists
    const existingRaspberryPi = await RaspberryPi.findOne({ raspberry_serial_id });
    if (existingRaspberryPi) {
      return res.status(400).json({ error: 'Raspberry Pi with this serial_id already registered' });
    }

    const raspberryPi = new RaspberryPi({
      raspberry_serial_id,
      username,
    });

    await raspberryPi.save();
    return res.status(201).json({ success: true, raspberryPi });
  } catch (err) {
    console.error('Register error:', err);
    return res.status(500).json({ error: err.message });
  }
});


app.post('/api/login', async (req, res) => {
  try {
    const { username, raspberry_serial_id } = req.body;

    if (!username && !raspberry_serial_id) {
      return res.status(400).json({ error: 'Missing username or raspberry_serial_id' });
    }

    let query = {};
    if (username) {
      query.username = username.toLowerCase();
    } else if (raspberry_serial_id) {
      query.raspberry_serial_id = raspberry_serial_id.toLowerCase();
    }

    const user = await RaspberryPi.findOne(query);
    if (!user) return res.status(404).json({ error: 'User not found' });

    return res.json({
      success: true,
      raspberry_serial_id: user.raspberry_serial_id,
      username: user.username,
      temperature: user.temperature,
      gps_data: user.gps_data,
      timestamp_raspberry: user.timestamp_raspberry,
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: err.message });
  }
});


app.get('/api/dashboard', async (req, res) => {
  try {
    const { username } = req.query;  // Use query instead of params

    if (!username) {
      return res.status(400).json({ error: 'Missing username' });
    }

    const raspberryPi = await RaspberryPi.findOne({ username: username.toLowerCase() }).lean();
    if (!raspberryPi) return res.status(404).json({ error: 'Raspberry Pi not found' });

    const sensorControllers = await SensorController.find({ raspberry_serial_id: raspberryPi._id }).lean();

    // Prepare dashboard data response
    const dashboardData = {
      raspberry_serial_id: raspberryPi.raspberry_serial_id,
      username: raspberryPi.username,
      temperature: raspberryPi.temperature,
      gps_data: raspberryPi.gps_data,
      sensor_controllers: sensorControllers,
      timestamp_raspberry: raspberryPi.timestamp_raspberry,
    };

    return res.json({ success: true, dashboardData });
  } catch (err) {
    console.error('Dashboard error:', err);
    return res.status(500).json({ error: err.message });
  }
});


app.post('/api/raspi-data', async (req, res) => {
  try {
    // console.log(req.body);

    const { raspberry_serial_id, datas } = req.body;

    if (!raspberry_serial_id || !datas || !Array.isArray(datas)) {
      return res.status(400).json({ error: 'Missing raspberry_serial_id or invalid datas' });
    }

    const temperatureObj = datas.find(d => d.temperature !== undefined);
    const gpsObj = [...datas].reverse().find(d =>
      d.altitude !== undefined && d.longitude !== undefined
    );

    const update = {
      timestamp_raspberry: new Date(),
    };

    if (temperatureObj?.temperature !== undefined) {
      update.temperature = temperatureObj.temperature;
    }

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

    if (!raspberryPi) {
      return res.status(404).json({ error: 'Raspberry Pi not found' });
    }

    return res.json({ success: true, raspberryPi });
  } catch (err) {
    console.error('Raspberry Pi data error:', err);
    return res.status(500).json({ error: err.message });
  }
});


app.post('/api/sensor-data', async (req, res) => {
  try {
    const { sensor_controller_id, raspberry_serial_id, datas } = req.body;

    // console.log("datas : ", datas);

    if (!sensor_controller_id || !raspberry_serial_id || !Array.isArray(datas)) {
      return res.status(400).json({ error: 'Missing sensor_controller_id, raspberry_serial_id, or invalid datas' });
    }

    const raspiSerial = String(raspberry_serial_id).toLowerCase().trim();
    const moduleId = String(sensor_controller_id).trim();

    const raspberryPi = await RaspberryPi.findOne({ raspberry_serial_id: raspiSerial });
    if (!raspberryPi) return res.status(404).json({ error: 'Raspberry Pi not found' });

    const now = new Date();

    const controllerUpdates = [];

    const readings = [];
    const skipped = [];

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
        module_id: moduleId,
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
      module_id: moduleId,
      raspberry_serial_id: raspberryPi._id,
    });

    if (!sensorController) {
      sensorController = new SensorController({
        module_id: moduleId,
        raspberry_serial_id: raspberryPi._id,
        sensor_datas: [],
      });
    }

    for (const u of controllerUpdates) {
      const sensorTypePart = u.sensor_type ?? 'null';
      const valuePart = u.value === null ? 'null' : String(u.value);
      const sensorDataStr = `${u.port_number}-${sensorTypePart}-${valuePart}`;

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
        _id: String(doc._id),
        raspberry_serial_id: doc.raspberry_serial_id,
        module_id: doc.module_id,
        port_number: doc.port_number,
        sensor_type: doc.sensor_type,
        value: doc.value,
        unit: doc.unit ?? null,
        timestamp_device: doc.timestamp_device ?? null,
        timestamp_server: doc.timestamp_server ?? now,
      });
    }

    return res.json({
      success: true,
      inserted_count: inserted.length,
      skipped_count: skipped.length,
      skipped,
      sensorController,
    });
  } catch (err) {
    console.error('Sensor data error:', err);
    return res.status(500).json({ error: err.message });
  }
});



app.get('/api/sensor-readings', async (req, res) => {
  try {
    // console.log("1111");

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

    if (!raspberry_serial_id || !module_id || !sensor_type) {
      return res.status(400).json({ error: 'Missing raspberry_serial_id, module_id, or sensor_type' });
    }

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

    return res.json({
      success: true,
      count: items.length,
      items,
      next_skip: sk + items.length,
    });
  } catch (err) {
    console.error('Get sensor readings error:', err);
    return res.status(500).json({ error: err.message });
  }
});

app.delete('/api/sensor-readings', async (req, res) => {
  try {
    const { raspberry_serial_id, module_id, sensor_type, port_number, from, to } = req.body || {};

    if (!raspberry_serial_id || !module_id || !sensor_type) {
      return res.status(400).json({ error: 'Missing raspberry_serial_id, module_id, or sensor_type' });
    }

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

    return res.json({
      success: true,
      deleted_count: result.deletedCount ?? 0,
    });
  } catch (err) {
    console.error('Delete sensor readings error:', err);
    return res.status(500).json({ error: err.message });
  }
});

io.on('connection', (socket) => {
  // console.log('Client connected:', socket.id);
  socket.on('disconnect', () => console.log('Client disconnected:', socket.id));
});

server.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
