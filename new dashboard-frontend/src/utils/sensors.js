import {
  Activity,
  Thermometer,
  Droplets,
  Move3d,
  RotateCw,
  RadioTower,
  Zap,
  Sun,
  Gauge,
  AlertTriangle,
  Radio,
} from 'lucide-react'

export const SENSOR_INFO = {
  0x01: {
    label: 'Temperature',
    unit: '°C',
    icon: Thermometer,
    colors: { icon: 'text-orange-500', bg: 'bg-orange-500/10', border: 'border-orange-500/20' },
  },
  0x02: {
    label: 'Humidity',
    unit: '%RH',
    icon: Droplets,
    colors: { icon: 'text-blue-500', bg: 'bg-blue-500/10', border: 'border-blue-500/20' },
  },
  0x03: {
    label: 'Accel X',
    unit: 'm/s²',
    icon: Move3d,
    colors: { icon: 'text-violet-500', bg: 'bg-violet-500/10', border: 'border-violet-500/20' },
  },
  0x04: {
    label: 'Accel Y',
    unit: 'm/s²',
    icon: Move3d,
    colors: { icon: 'text-violet-500', bg: 'bg-violet-500/10', border: 'border-violet-500/20' },
  },
  0x05: {
    label: 'Accel Z',
    unit: 'm/s²',
    icon: Move3d,
    colors: { icon: 'text-violet-500', bg: 'bg-violet-500/10', border: 'border-violet-500/20' },
  },
  0x06: {
    label: 'Gyro X',
    unit: 'rad/s',
    icon: RotateCw,
    colors: { icon: 'text-indigo-500', bg: 'bg-indigo-500/10', border: 'border-indigo-500/20' },
  },
  0x07: {
    label: 'Gyro Y',
    unit: 'rad/s',
    icon: RotateCw,
    colors: { icon: 'text-indigo-500', bg: 'bg-indigo-500/10', border: 'border-indigo-500/20' },
  },
  0x08: {
    label: 'Gyro Z',
    unit: 'rad/s',
    icon: RotateCw,
    colors: { icon: 'text-indigo-500', bg: 'bg-indigo-500/10', border: 'border-indigo-500/20' },
  },
  0x09: {
    label: 'Distance',
    unit: 'cm',
    icon: RadioTower,
    colors: { icon: 'text-teal-500', bg: 'bg-teal-500/10', border: 'border-teal-500/20' },
  },
  0x0A: {
    label: 'Temperature (1-Wire)',
    unit: '°C',
    icon: Thermometer,
    colors: { icon: 'text-red-500', bg: 'bg-red-500/10', border: 'border-red-500/20' },
  },
  0x0B: {
    label: 'Voltage',
    unit: 'V',
    icon: Zap,
    colors: { icon: 'text-yellow-500', bg: 'bg-yellow-500/10', border: 'border-yellow-500/20' },
  },
  0x0C: {
    label: 'Current',
    unit: 'A',
    icon: Activity,
    colors: { icon: 'text-orange-500', bg: 'bg-orange-500/10', border: 'border-orange-500/20' },
  },
  0x0D: {
    label: 'Light Intensity',
    unit: 'lux',
    icon: Sun,
    colors: { icon: 'text-amber-400', bg: 'bg-amber-400/10', border: 'border-amber-400/20' },
  },
  0x0E: {
    label: 'Pressure',
    unit: 'hPa',
    icon: Gauge,
    colors: { icon: 'text-yellow-400', bg: 'bg-yellow-400/10', border: 'border-yellow-400/20' },
  },
  0x0F: {
    label: 'Infrared',
    unit: '',
    icon: AlertTriangle,
    colors: { icon: 'text-purple-500', bg: 'bg-purple-500/10', border: 'border-purple-500/20' },
  },
  0x13: {
    label: 'Rotary',
    unit: 'step',
    icon: RotateCw,
    colors: { icon: 'text-amber-500', bg: 'bg-amber-500/10', border: 'border-amber-500/20' },
  },
  0x14: {
    label: 'Vibration',
    unit: '',
    icon: Radio,
    colors: { icon: 'text-red-500', bg: 'bg-red-500/10', border: 'border-red-500/20' },
  },
  0x10: {
    label: 'Pitch',
    unit: '°',
    icon: Activity,
    colors: { icon: 'text-violet-500', bg: 'bg-violet-500/10', border: 'border-violet-500/20' },
  },
  0x11: {
    label: 'Roll',
    unit: '°',
    icon: Activity,
    colors: { icon: 'text-violet-500', bg: 'bg-violet-500/10', border: 'border-violet-500/20' },
  },
  0x12: {
    label: 'Yaw',
    unit: '°',
    icon: Activity,
    colors: { icon: 'text-violet-500', bg: 'bg-violet-500/10', border: 'border-violet-500/20' },
  },
}

const FALLBACK = {
  label: 'Sensor',
  unit: '',
  icon: Activity,
  colors: { icon: 'text-slate-500', bg: 'bg-slate-500/10', border: 'border-slate-500/20' },
}

export function getSensorInfo(type) {
  return SENSOR_INFO[type] ?? FALLBACK
}

export function formatValue(value) {
  if (value === null || value === undefined) return '--'
  return Number(value).toFixed(2)
}

// Key for node identification (ctrl_id + port_num)
export function getNodeKey(ctrl_id, port_num) {
  return `${ctrl_id}_${port_num}`
}

// Key for tracking a specific reading including sensor_type
export function getReadingKey(ctrl_id, port_num, sensor_type) {
  return `${ctrl_id}_${port_num}_${sensor_type}`
}

// IMU-related sensor types
export const IMU_STYPES = new Set([0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x10, 0x11, 0x12])

export function isIMUSensor(sensorType) {
  return IMU_STYPES.has(Number(sensorType))
}

// Count how many display cards a list of nodes would produce
// (IMU counts as 1 per port, Temp+Humidity on same port counts as 1)
export function countDisplayNodes(nodes) {
  const humTempPorts = new Set()
  for (const n of nodes) {
    if (Number(n.sensor_type) === 0x01) humTempPorts.add(`${n.ctrl_id}_${n.port_num}`)
  }
  const seenIMUPorts = new Set()
  let count = 0
  for (const n of nodes) {
    const st = Number(n.sensor_type)
    const pk = `${n.ctrl_id}_${n.port_num}`
    if (isIMUSensor(st)) {
      if (seenIMUPorts.has(pk)) continue
      seenIMUPorts.add(pk)
    } else if (humTempPorts.has(pk) && st === 0x02) {
      continue  // humidity collapsed with temperature
    }
    count++
  }
  return count
}

// Build IMU data object from latestData map for a specific (ctrl_id, port_num)
// Jika port_num yang terdaftar tidak punya data, scan semua port untuk ctrl_id ini
// (handle port mismatch antara MongoDB registrasi dan data aktual)
export function buildIMUFromLatest(ctrl_id, port_num, latestData) {
  const get = (pnum, stype) => {
    const key = getReadingKey(ctrl_id, pnum, stype)
    const r = latestData[key]
    return (r?.value !== undefined && r.value !== null) ? Number(r.value) : null
  }

  // Cari port aktual: coba registered port_num dulu, lalu scan jika tidak ada data
  let actualPort = port_num
  const hasDataAt = (pnum) => [...IMU_STYPES].some(st => get(pnum, st) !== null)

  if (!hasDataAt(port_num)) {
    for (const key of Object.keys(latestData)) {
      const parts = key.split('_')
      if (parts.length !== 3) continue
      const [cid, pnum, st] = [Number(parts[0]), Number(parts[1]), Number(parts[2])]
      if (cid === Number(ctrl_id) && IMU_STYPES.has(st)) {
        actualPort = pnum
        break
      }
    }
  }

  const ax = get(actualPort, 0x03), ay = get(actualPort, 0x04), az = get(actualPort, 0x05)
  const gx = get(actualPort, 0x06), gy = get(actualPort, 0x07), gz = get(actualPort, 0x08)
  const pitch = get(actualPort, 0x10), roll = get(actualPort, 0x11), yaw = get(actualPort, 0x12)

  // Return non-null if we have ANY IMU data (accel OR euler angles)
  const hasAccel = ax !== null || ay !== null || az !== null
  const hasGyro  = gx !== null || gy !== null || gz !== null
  const hasEuler = pitch !== null || roll !== null || yaw !== null
  if (!hasAccel && !hasGyro && !hasEuler) return null

  return {
    accelerometer: { x: ax, y: ay, z: az },
    gyroscope:     { x: gx, y: gy, z: gz },
    euler:         { pitch, roll, yaw },
    _port: actualPort,  // port aktual yang dipakai (bisa berbeda dari port_num terdaftar)
  }
}
