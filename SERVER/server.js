const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

// === CONFIG ===
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

// === MIDDLEWARE ===
app.use(cors());
app.use(express.json());

// === DB CONNECTION ===
mongoose.connect('mongodb://localhost:27017/iot-monitoring')
  .then(() => console.log('MongoDB Connected'))
  .catch(err => console.error(err));

// === SCHEMA ===
const SensorDataSchema = new mongoose.Schema({
  raspi_serial_id: Number,
  timestamp: { type: Date, default: Date.now },
  data: Array
});
const SensorData = mongoose.model('SensorData', SensorDataSchema);

const UserAliasSchema = new mongoose.Schema({
  username: { type: String, unique: true },
  raspi_serial_id: Number
});
const UserAlias = mongoose.model('UserAlias', UserAliasSchema);


// === API ROUTE ===
app.post('/api/iot-data', async (req, res) => {
  try {
    const newData = new SensorData(req.body);
    await newData.save();

    // Emit ke client realtime
    io.emit('new-data', newData);

    res.status(201).json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/user/:raspiID/latest', async (req, res) => {
  const raspiID = req.params.raspiID;

  const data = await SensorData.findOne({ raspi_serial_id: raspiID }).sort({ timestamp: -1 });
  console.log("ttt", data);

  if (data) {
    res.json(data);
  } else {
    res.status(404).json({ message: 'User not found' });
  }
});

// Cek apakah "raspiID" adalah alias username
app.get('/api/resolve/:input', async (req, res) => {
  const input = req.params.input;
  let raspi_serial_id = null;
  let username = null;

  // Jika input adalah angka → cari dari SensorData
  if (/^\d+$/.test(input)) {
    const alias = await UserAlias.findOne({ raspi_serial_id: parseInt(input) });
    if (!alias) return res.status(404).json({ message: "Raspi serial ID belum terdaftar" });
    raspi_serial_id = alias.raspi_serial_id;
    username = alias.username;
  } else {
    const alias = await UserAlias.findOne({ username: input });
    if (!alias) return res.status(404).json({ message: "Username tidak ditemukan" });
    raspi_serial_id = alias.raspi_serial_id;
    username = alias.username;
  }

  return res.json({ raspi_serial_id, username });
});


app.post('/api/register-alias', async (req, res) => {
  const { username, raspi_serial_id } = req.body;
  if (!username || !raspi_serial_id) return res.status(400).json({ error: "Invalid data" });

  try {
    const exists = await UserAlias.findOne({ username });
    if (exists) return res.status(400).json({ error: "Username already taken" });

    const raspi_ID_exists = await UserAlias.findOne({ raspi_serial_id });
    if (raspi_ID_exists) return res.status(400).json({ error: "Serial ID already taken" });

    const newAlias = new UserAlias({ username, raspi_serial_id });
    await newAlias.save();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/data/:raspiID', async (req, res) => {
  const raspiID = req.params.raspiID;
  try {
    const data = await SensorData.find({ raspi_serial_id: raspiID }).sort({ timestamp: -1 });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// === SOCKET.IO ===
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
});

// === START SERVER ===
server.listen(3000, () => {
  console.log('Server berjalan di http://localhost:3000');
});
