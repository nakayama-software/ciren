require('dotenv').config();

const express = require('express');
const http = require('http');
const cors = require('cors');
const morgan = require('morgan');
const mongoose = require('mongoose');
const { Server } = require('socket.io');

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

const RaspiStatusSchema = new mongoose.Schema({
  raspi_serial_id: { type: String, unique: true, lowercase: true, index: true, trim: true },
  last_seen: { type: Date, default: Date.now },
  temp_c: { type: Number, default: null },
  uptime_s: { type: Number, default: null },
});
RaspiStatusSchema.index({ raspi_serial_id: 1 });
const RaspiStatus = mongoose.model('RaspiStatus', RaspiStatusSchema);

const UserAliasSchema = new mongoose.Schema({
  username: { type: String, unique: true, trim: true, lowercase: true },
  raspi_serial_id: { type: String, unique: true, index: true, trim: true, lowercase: true },
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
  timestamp: { type: Date, default: Date.now },
});
GpsDataSchema.index({ raspi_serial_id: 1, timestamp: -1 });
const GpsData = mongoose.model('GpsData', GpsDataSchema);

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
      node_id: String,
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

const NodeSamplesSchema = new mongoose.Schema({
  raspi_serial_id: { type: String, index: true, trim: true, lowercase: true },
  hub_id: { type: String, index: true, trim: true },
  port_id: { type: Number, index: true },
  sensor_type: { type: String, index: true },
  sensor_id: { type: String, index: true },
  value: mongoose.Schema.Types.Mixed,
  unit: String,
  readings: [
    {
      key: String,
      label: String,
      value: mongoose.Schema.Types.Mixed,
      unit: String,
      raw: String,
    },
  ],
  timestamp: { type: Date, default: Date.now },
});
NodeSamplesSchema.index({ raspi_serial_id: 1, hub_id: 1, port_id: 1, timestamp: 1 });
const NodeSamples = mongoose.model('NodeSamples', NodeSamplesSchema);

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

const PortSessionHistorySchema = new mongoose.Schema({
  raspi_serial_id: { type: String, index: true, trim: true, lowercase: true },
  hub_id: { type: String, index: true, trim: true },
  port_id: { type: Number, index: true },
  sensor_id: { type: String, index: true },
  sensor_type: { type: String },
  started_at: { type: Date },
  ended_at: { type: Date },
  stats: {
    total_readings: { type: Number, default: 0 },
    duration_hours: { type: Number, default: 0 },
    first_value: mongoose.Schema.Types.Mixed,
    last_value: mongoose.Schema.Types.Mixed,
    avg_value: mongoose.Schema.Types.Mixed,
    min_value: mongoose.Schema.Types.Mixed,
    max_value: mongoose.Schema.Types.Mixed,
  },
  deleted_at: { type: Date, default: Date.now },
  deletion_reason: {
    type: String,
    enum: ['sensor_changed', 'user_reset', 'auto_cleanup'],
    default: 'sensor_changed',
  },
});
PortSessionHistorySchema.index({ raspi_serial_id: 1, hub_id: 1, port_id: 1, started_at: -1 });
PortSessionHistorySchema.index({ sensor_id: 1 });
const PortSessionHistory = mongoose.model('PortSessionHistory', PortSessionHistorySchema);


function normalizeHubObject(hubObj = {}) {
  const scidRaw = hubObj.sensor_controller_id ?? hubObj.sensor_controller ?? 'UNKNOWN';
  const hub_id = String(scidRaw).trim();

  if (!hub_id || hub_id.toUpperCase() === 'RASPI_SYS' || hubObj._type === 'raspi_status') return null;

  const nodes = [];

  for (let i = 1; i <= 8; i++) {
    const key = `port-${i}`;
    if (!hubObj[key]) continue;

    const raw = hubObj[key];

    const idMatch = raw.match(/ID=([^;]+)/i);
    const valMatch = raw.match(/VAL=(.+)/i);
    if (!idMatch || !valMatch) return null;

    const sensorType = String(idMatch[1] || '').trim().toLowerCase();
    const payload = String(valMatch[1] || '').trim();

    nodes.push({
      node_id: `P${i}`,
      sensor_type: sensorType,
      value: payload,
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

app.post('/api/register-alias', async (req, res) => {
  try {
    const { username, raspi_serial_id } = req.body || {};
    if (!username || !raspi_serial_id) {
      return res.status(400).json({ error: 'Missing username or raspi_serial_id' });
    }

    const uname = String(username).trim().toLowerCase();
    const raspiID = String(raspi_serial_id).trim().toLowerCase();

    const exists = await UserAlias.findOne({
      $or: [{ username: uname }, { raspi_serial_id: raspiID }],
    });

    if (exists) {
      return res.status(400).json({ error: 'Username or device already registered' });
    }

    const user = await UserAlias.create({ username: uname, raspi_serial_id: raspiID });
    console.log(`[User] Registered ${uname} → ${raspiID}`);
    return res.json({ success: true, user });
  } catch (err) {
    console.error('Register error:', err);
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username } = req.body || {};
    if (!username) return res.status(400).json({ error: 'Missing username' });

    const uname = String(username).trim().toLowerCase();
    const user = await UserAlias.findOne({ username: uname });

    if (!user) return res.status(404).json({ error: 'User not found' });

    return res.json({
      success: true,
      username: user.username,
      raspi_serial_id: user.raspi_serial_id,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.get('/api/resolve/:username', async (req, res) => {
  try {
    const uname = String(req.params.username || '').trim().toLowerCase();
    const user = await UserAlias.findOne({ username: uname });

    if (!user) return res.status(404).json({ error: 'User not found' });

    return res.json({
      username: user.username,
      raspi_serial_id: user.raspi_serial_id,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.get('/api/data/:raspiID', async (req, res) => {
  try {
    const raspiID = String(req.params.raspiID || '').trim().toLowerCase();
    if (!raspiID) return res.status(400).json({ error: 'Missing raspiID' });

    const status = await RaspiStatus.findOne({ raspi_serial_id: raspiID }).lean();
    const raspi_status = status
      ? { last_seen: status.last_seen, temp_c: status.temp_c, uptime_s: status.uptime_s }
      : null;

    const hubsRaw = await HubData.find({ raspi_serial_id: raspiID })
      .sort({ timestamp: -1 })
      .limit(200)
      .lean();

    const hubs = {};
    for (const h of hubsRaw) {
      if (!h.hub_id) continue;
      if (!hubs[h.hub_id]) hubs[h.hub_id] = [];
      hubs[h.hub_id].push(h);
    }

    const gpsDoc = await GpsData.findOne({ raspi_serial_id: raspiID }).sort({ timestamp: -1 }).lean();

    return res.json({
      raspi_serial_id: raspiID,
      raspi_status,
      hubs,
      hubs_count: Object.keys(hubs).length,
      gps: gpsDoc || null,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

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

    const from = req.query.from ? new Date(String(req.query.from)) : null;
    const to = req.query.to ? new Date(String(req.query.to)) : null;

    if (from || to) {
      q.timestamp = {};
      if (from) q.timestamp.$gte = from;
      if (to) q.timestamp.$lte = to;
    }

    const docs = await NodeSamples.find(q).sort({ timestamp: 1 }).limit(limit).lean();

    const items = docs.map((d) => ({
      ts: d.timestamp,
      value: d.value,
      unit: d.unit,
      sensor_type: d.sensor_type,
      sensor_id: d.sensor_id,
    }));

    return res.json({
      ok: true,
      meta: { count: items.length, raspi_serial_id, hub_id, port_id },
      items,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.get('/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

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
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/hub-data', async (req, res) => {
  try {
    const raspi_serial_id = String(req.body?.raspi_serial_id || '').trim().toLowerCase();
    if (!raspi_serial_id) return res.status(400).json({ error: 'Missing raspi_serial_id' });

    const payload = req.body?.data;
    const array = Array.isArray(payload) ? payload : payload ? [payload] : [];
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
          console.log(`✅ NEW SENSOR on Port P${port_id}: ${node.sensor_type} (${newSensorId})`);
        } else if (existing.current_sensor_type !== node.sensor_type) {
          console.log(
            `⚠️ SENSOR CHANGED on Port P${port_id}: ${existing.current_sensor_type} → ${node.sensor_type}`
          );

          const stats = await calculatePortStats(raspi_serial_id, normalized.hub_id, port_id);

          await PortSessionHistory.create({
            raspi_serial_id,
            hub_id: normalized.hub_id,
            port_id,
            sensor_id: existing.current_sensor_id,
            sensor_type: existing.current_sensor_type,
            started_at: existing.last_updated,
            ended_at: now,
            stats,
            deleted_at: now,
            deletion_reason: 'sensor_changed',
          });

          const deleteResult = await NodeSamples.deleteMany({
            raspi_serial_id,
            hub_id: normalized.hub_id,
            port_id,
          });

          console.log(`🗑️ DELETED ${deleteResult.deletedCount} readings from old sensor`);

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

          io.emit('sensor-changed', {
            raspi_serial_id,
            hub_id: normalized.hub_id,
            port_id,
            old_sensor: existing.current_sensor_type,
            new_sensor: node.sensor_type,
            deleted_readings: deleteResult.deletedCount,
            stats,
          });
        } else {
          node.sensor_id = existing.current_sensor_id;

          await HubNodeMap.updateOne(
            { raspi_serial_id, hub_id: normalized.hub_id, port_id },
            { $set: { last_updated: now } }
          );
        }

        await NodeSamples.create({
          raspi_serial_id,
          hub_id: normalized.hub_id,
          port_id,
          sensor_type: node.sensor_type,
          sensor_id: node.sensor_id,
          value: node.value,
          unit: node.unit,
          readings: node.readings || [],
          timestamp: now,
        });

        io.emit("node-sample", {
          raspi_serial_id,
          hub_id: normalized.hub_id,
          port_id,
          ts: now.toISOString(),
          sensor_type: node.sensor_type,
          sensor_id: node.sensor_id,
          value: node.value,
          unit: node.unit,
          readings: node.readings || [],
        });
      }
    }

    if (docsToInsert.length > 0) await HubData.insertMany(docsToInsert);

    await RaspiStatus.findOneAndUpdate({ raspi_serial_id }, { last_seen: now }, { upsert: true });

    io.emit('hub-data', { raspi_serial_id, count: docsToInsert.length, ts: now });
    return res.json({ success: true, inserted: docsToInsert.length });
  } catch (err) {
    console.error('Error in /api/hub-data:', err);
    return res.status(500).json({ error: err.message });
  }
});

async function calculatePortStats(raspi_serial_id, hub_id, port_id) {
  const readings = await NodeSamples.find({ raspi_serial_id, hub_id, port_id })
    .sort({ timestamp: 1 })
    .lean();

  if (readings.length === 0) {
    return { total_readings: 0, duration_hours: 0 };
  }

  const first = readings[0];
  const last = readings[readings.length - 1];
  const duration_hours = (last.timestamp - first.timestamp) / (1000 * 60 * 60);

  const stats = {
    total_readings: readings.length,
    duration_hours: Math.round(duration_hours * 10) / 10,
    first_value: first.value,
    last_value: last.value,
  };

  const numericValues = readings.map((r) => r.value).filter((v) => typeof v === 'number' && !isNaN(v));

  if (numericValues.length > 0) {
    stats.avg_value = numericValues.reduce((a, b) => a + b) / numericValues.length;
    stats.min_value = Math.min(...numericValues);
    stats.max_value = Math.max(...numericValues);
  }

  return stats;
}

app.post('/api/reset-port', async (req, res) => {
  try {
    const { raspi_serial_id, hub_id, port_id, confirm } = req.body;

    if (!raspi_serial_id || !hub_id || port_id === undefined) {
      return res.status(400).json({ error: 'Missing parameters' });
    }

    const raspiID = String(raspi_serial_id).trim().toLowerCase();
    const hubID = String(hub_id).trim();
    const portNum = Number(port_id);

    const currentMap = await HubNodeMap.findOne({
      raspi_serial_id: raspiID,
      hub_id: hubID,
      port_id: portNum,
    });

    if (!currentMap) {
      return res.json({ success: false, message: 'No active sensor on this port' });
    }

    const readingsCount = await NodeSamples.countDocuments({
      raspi_serial_id: raspiID,
      hub_id: hubID,
      port_id: portNum,
    });

    if (!confirm) {
      const stats = await calculatePortStats(raspiID, hubID, portNum);

      return res.json({
        success: false,
        requires_confirmation: true,
        current_sensor: {
          sensor_type: currentMap.current_sensor_type,
          sensor_id: currentMap.current_sensor_id,
          started_at: currentMap.last_updated,
          total_readings: readingsCount,
          stats,
        },
        message: `This will delete ${readingsCount} readings. Please confirm.`,
      });
    }

    console.log(`🔄 MANUAL RESET Port P${portNum} (user confirmed)`);

    const stats = await calculatePortStats(raspiID, hubID, portNum);

    await PortSessionHistory.create({
      raspi_serial_id: raspiID,
      hub_id: hubID,
      port_id: portNum,
      sensor_id: currentMap.current_sensor_id,
      sensor_type: currentMap.current_sensor_type,
      started_at: currentMap.last_updated,
      ended_at: new Date(),
      stats,
      deleted_at: new Date(),
      deletion_reason: 'user_reset',
    });

    const deleteResult = await NodeSamples.deleteMany({
      raspi_serial_id: raspiID,
      hub_id: hubID,
      port_id: portNum,
    });

    const newSensorId = `${hubID}-P${portNum}-${Date.now()}`;

    await HubNodeMap.findOneAndUpdate(
      { raspi_serial_id: raspiID, hub_id: hubID, port_id: portNum },
      { current_sensor_id: newSensorId, last_updated: new Date() },
      { upsert: true }
    );

    io.emit('port-reset', {
      raspi_serial_id: raspiID,
      hub_id: hubID,
      port_id: portNum,
      deleted_readings: deleteResult.deletedCount,
      new_sensor_id: newSensorId,
      stats,
    });

    return res.json({
      success: true,
      message: 'Port reset successfully',
      newSensorId,
      deleted_readings: deleteResult.deletedCount,
      stats,
    });
  } catch (err) {
    console.error('Reset port error:', err);
    return res.status(500).json({ error: err.message });
  }
});

app.get('/api/port-history/:raspiId/:hubId/:portId', async (req, res) => {
  try {
    const { raspiId, hubId, portId } = req.params;

    const raspiID = String(raspiId).trim().toLowerCase();
    const hubID = String(hubId).trim();
    const portNum = Number(portId);

    const current = await HubNodeMap.findOne({
      raspi_serial_id: raspiID,
      hub_id: hubID,
      port_id: portNum,
    });

    let currentStats = null;
    if (current) currentStats = await calculatePortStats(raspiID, hubID, portNum);

    const archived = await PortSessionHistory.find({
      raspi_serial_id: raspiID,
      hub_id: hubID,
      port_id: portNum,
    })
      .sort({ ended_at: -1 })
      .limit(10)
      .lean();

    return res.json({
      ok: true,
      current_session: current
        ? {
          sensor_id: current.current_sensor_id,
          sensor_type: current.current_sensor_type,
          started_at: current.last_updated,
          status: 'active',
          stats: currentStats,
        }
        : null,
      archived_sessions: archived.map((a) => ({
        sensor_id: a.sensor_id,
        sensor_type: a.sensor_type,
        started_at: a.started_at,
        ended_at: a.ended_at,
        stats: a.stats,
        deletion_reason: a.deletion_reason,
      })),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/gps', async (req, res) => {
  try {
    const body = req.body || {};

    const raspi_serial_id = String(body.raspi_serial_id || '').trim().toLowerCase();
    if (!raspi_serial_id) return res.status(400).json({ error: 'Missing raspi_serial_id' });

    if (body.lat === undefined || body.lon === undefined) {
      return res.status(400).json({ error: 'Missing coordinates' });
    }

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
    return res.json({ success: true, updated: true, gps: gpsDoc });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  socket.on('disconnect', () => console.log('Client disconnected:', socket.id));
});

server.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
