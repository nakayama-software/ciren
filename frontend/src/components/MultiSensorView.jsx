import { useState, useEffect, useMemo } from 'react'
import { useIsDark } from '../utils/useIsDark'
import { X, ExternalLink, Activity } from 'lucide-react'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Filler,
} from 'chart.js'
import { Line } from 'react-chartjs-2'
import { getHistory } from '../lib/api'
import { getSensorInfo, isIMUSensor, IMU_STYPES, getReadingKey, buildIMUFromLatest } from '../utils/sensors'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Filler)

const MAX_POINTS = 60

// ─── Single-sensor feed hook ─────────────────────────────────────────────────
function useSensorFeed(deviceId, ctrlId, portNum, sensorType, open, wsRef) {
  const [readings, setReadings] = useState([])

  useEffect(() => {
    if (!open || !deviceId || ctrlId == null || portNum == null || sensorType == null) {
      setReadings([])
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const data = await getHistory(deviceId, ctrlId, portNum, 720, sensorType)
        if (cancelled) return
        if (Array.isArray(data)) {
          const sorted = [...data].sort((a, b) => new Date(a.server_ts) - new Date(b.server_ts))
          setReadings(sorted.slice(-MAX_POINTS))
        }
      } catch {}
    })()
    return () => { cancelled = true }
  }, [open, deviceId, ctrlId, portNum, sensorType])

  useEffect(() => {
    if (!open || !wsRef?.current) return
    const ws = wsRef.current
    const handler = (evt) => {
      try {
        const msg = JSON.parse(evt.data)
        if (msg.type !== 'sensor_data') return
        const p = msg.payload
        if (p.ftype === 0x05) return  // skip HB_TYPED — only DATA frames
        if (p.device_id !== deviceId) return
        if (Number(p.ctrl_id) !== Number(ctrlId)) return
        if (Number(p.port_num) !== Number(portNum)) return
        if (Number(p.sensor_type) !== Number(sensorType)) return
        setReadings((prev) => [...prev, { value: p.value, server_ts: p.ts }].slice(-MAX_POINTS))
      } catch {}
    }
    ws.addEventListener('message', handler)
    return () => ws.removeEventListener('message', handler)
  }, [open, deviceId, ctrlId, portNum, sensorType, wsRef])

  return readings
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function fmtTime(r) {
  const d = new Date(r.server_ts || '')
  if (isNaN(d)) return ''
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
}

function buildBaseOpts(isDark) {
  const tick = isDark ? 'rgba(148,163,184,0.8)' : 'rgba(71,85,105,0.8)'
  const grid = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)'
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 0 },
    plugins: { legend: { display: false }, tooltip: { enabled: true, mode: 'index', intersect: false } },
    scales: {
      x: { ticks: { maxTicksLimit: 4, maxRotation: 0, font: { size: 9 }, color: tick }, grid: { display: false } },
      y: { ticks: { maxTicksLimit: 4, font: { size: 9 }, color: tick }, grid: { color: grid } },
    },
  }
}

// ─── Line Panel ───────────────────────────────────────────────────────────────
function LinePanel({ readings, sensorType }) {
  const isDark = useIsDark()
  const BASE_OPTS = useMemo(() => buildBaseOpts(isDark), [isDark])
  const info = getSensorInfo(Number(sensorType))
  const { chartData, liveDisplay } = useMemo(() => {
    const labels = readings.map(fmtTime)
    const values = readings.map((r) => {
      const n = parseFloat(String(r.value ?? '').trim())
      return Number.isFinite(n) ? n : null
    })
    const last = values[values.length - 1]
    const liveDisplay = last != null ? `${last.toFixed(2)} ${info.unit}` : '—'
    return {
      liveDisplay,
      chartData: {
        labels,
        datasets: [{ label: info.label, data: values, borderColor: 'rgb(6,182,212)', backgroundColor: 'rgba(6,182,212,0.1)', borderWidth: 1.5, pointRadius: 0, fill: true, tension: 0.3 }],
      },
    }
  }, [readings, info])

  return (
    <div className="flex flex-col h-full">
      <div className="text-xl font-bold text-slate-900 dark:text-white mb-2 flex-shrink-0">{liveDisplay}</div>
      <div className="flex-1 min-h-0">
        {readings.length > 1
          ? <Line data={chartData} options={BASE_OPTS} />
          : <div className="flex items-center justify-center h-full text-gray-400 text-sm">Collecting data…</div>}
      </div>
    </div>
  )
}

function buildHumTempOpts(isDark) {
  const base = buildBaseOpts(isDark)
  const grid = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)'
  return {
    ...base,
    plugins: {
      legend: { display: false },
      tooltip: {
        enabled: true, mode: 'index', intersect: false,
        callbacks: { label: (ctx) => ` ${ctx.parsed.y?.toFixed(1)} ${ctx.datasetIndex === 0 ? '°C' : '%RH'}` },
      },
    },
    scales: {
      x: base.scales.x,
      yTemp: { position: 'left',  ticks: { maxTicksLimit: 3, font: { size: 9 }, color: 'rgba(249,115,22,0.8)' }, grid: { color: grid } },
      yHum:  { position: 'right', ticks: { maxTicksLimit: 3, font: { size: 9 }, color: 'rgba(99,102,241,0.8)' }, grid: { display: false } },
    },
  }
}

function HumTempPanel({ deviceId, ctrlId, portNum, open, wsRef, latestData }) {
  const isDark = useIsDark()
  const HUM_TEMP_OPTS = useMemo(() => buildHumTempOpts(isDark), [isDark])
  const tempReadings = useSensorFeed(deviceId, ctrlId, portNum, 0x01, open, wsRef)
  const humReadings  = useSensorFeed(deviceId, ctrlId, portNum, 0x02, open, wsRef)

  const tempKey = getReadingKey(ctrlId, portNum, 0x01)
  const humKey  = getReadingKey(ctrlId, portNum, 0x02)
  const latestTemp = latestData?.[tempKey]?.value
  const latestHum  = latestData?.[humKey]?.value

  const liveTemp = tempReadings.length ? Number(tempReadings[tempReadings.length - 1].value).toFixed(1) : (latestTemp != null ? Number(latestTemp).toFixed(1) : '—')
  const liveHum  = humReadings.length  ? Number(humReadings[humReadings.length - 1].value).toFixed(1)  : (latestHum  != null ? Number(latestHum).toFixed(1)  : '—')

  const hasData = tempReadings.length > 1 || humReadings.length > 1
  const maxLen  = Math.max(tempReadings.length, humReadings.length)

  const chartData = useMemo(() => {
    // align both arrays to same length using the longer one's timestamps
    const base = tempReadings.length >= humReadings.length ? tempReadings : humReadings
    return {
      labels: base.map(fmtTime),
      datasets: [
        {
          label: 'Temp',
          data: tempReadings.map((r) => { const n = parseFloat(r.value); return Number.isFinite(n) ? n : null }),
          borderColor: 'rgb(249,115,22)',
          backgroundColor: 'rgba(249,115,22,0.06)',
          borderWidth: 1.5, pointRadius: 0, fill: false, tension: 0.3,
          yAxisID: 'yTemp', spanGaps: true,
        },
        {
          label: 'Humidity',
          data: humReadings.map((r) => { const n = parseFloat(r.value); return Number.isFinite(n) ? n : null }),
          borderColor: 'rgb(99,102,241)',
          backgroundColor: 'rgba(99,102,241,0.06)',
          borderWidth: 1.5, pointRadius: 0, fill: false, tension: 0.3,
          yAxisID: 'yHum', spanGaps: true,
        },
      ],
    }
  }, [tempReadings, humReadings, maxLen])

  return (
    <div className="flex flex-col h-full">
      {/* Live values */}
      <div className="flex gap-4 mb-3 flex-shrink-0">
        <div>
          <span className="text-[10px] text-orange-400 font-medium uppercase tracking-wider">Temp</span>
          <p className="text-2xl font-bold text-slate-900 dark:text-white tabular-nums leading-tight">
            {liveTemp}<span className="text-sm font-normal text-slate-400 ml-1">°C</span>
          </p>
        </div>
        <div className="w-px bg-black/10 dark:bg-white/10" />
        <div>
          <span className="text-[10px] text-indigo-400 font-medium uppercase tracking-wider">Humidity</span>
          <p className="text-2xl font-bold text-slate-900 dark:text-white tabular-nums leading-tight">
            {liveHum}<span className="text-sm font-normal text-slate-400 ml-1">%RH</span>
          </p>
        </div>
      </div>
      {/* Legend */}
      <div className="flex gap-3 mb-1 flex-shrink-0">
        <div className="flex items-center gap-1"><div className="w-4 h-0.5 rounded bg-orange-500" /><span className="text-[10px] text-slate-400">°C</span></div>
        <div className="flex items-center gap-1"><div className="w-4 h-0.5 rounded bg-indigo-500" /><span className="text-[10px] text-slate-400">%RH</span></div>
      </div>
      {/* Chart */}
      <div className="flex-1 min-h-0">
        {hasData
          ? <Line data={chartData} options={HUM_TEMP_OPTS} />
          : <div className="flex items-center justify-center h-full text-gray-400 text-sm">Collecting data…</div>}
      </div>
    </div>
  )
}

// ─── IMU Panel ────────────────────────────────────────────────────────────────
function IMUPanel({ deviceId, ctrlId, portNum, open, wsRef, latestData }) {
  // Initialize from latestData so we have values immediately
  const [imuData, setImuData] = useState(() => {
    if (!latestData) return null
    const init = {}
    let hasAny = false
    for (const st of IMU_STYPES) {
      const key = getReadingKey(ctrlId, portNum, st)
      const r = latestData[key]
      if (r?.value != null) { init[st] = Number(r.value); hasAny = true }
    }
    // Also try buildIMUFromLatest for port-mismatch scenarios
    if (!hasAny) {
      const built = buildIMUFromLatest(ctrlId, portNum, latestData)
      if (built) {
        const map = {
          0x03: built.accelerometer?.x, 0x04: built.accelerometer?.y, 0x05: built.accelerometer?.z,
          0x06: built.gyroscope?.x,     0x07: built.gyroscope?.y,     0x08: built.gyroscope?.z,
          0x10: built.euler?.pitch,     0x11: built.euler?.roll,      0x12: built.euler?.yaw,
        }
        for (const [k, v] of Object.entries(map)) if (v != null) { init[Number(k)] = v; hasAny = true }
      }
    }
    return hasAny ? init : null
  })

  // Subscribe to live WS updates
  useEffect(() => {
    if (!open || !wsRef?.current) return
    const ws = wsRef.current
    const handler = (evt) => {
      try {
        const msg = JSON.parse(evt.data)
        if (msg.type !== 'sensor_data') return
        const p = msg.payload
        if (p.ftype === 0x05) return  // skip HB_TYPED — only DATA frames
        if (p.device_id !== deviceId) return
        if (Number(p.ctrl_id) !== Number(ctrlId)) return
        if (Number(p.port_num) !== Number(portNum)) return
        if (!IMU_STYPES.has(Number(p.sensor_type))) return
        setImuData((prev) => ({ ...(prev || {}), [Number(p.sensor_type)]: Number(p.value) }))
      } catch {}
    }
    ws.addEventListener('message', handler)
    return () => ws.removeEventListener('message', handler)
  }, [open, deviceId, ctrlId, portNum, wsRef])

  const fmt3 = (t) => imuData?.[t] != null ? imuData[t].toFixed(3) : '—'
  const fmt1 = (t) => imuData?.[t] != null ? imuData[t].toFixed(1) : '—'

  const sections = [
    {
      title: 'Accelerometer',
      color: 'text-violet-400',
      rows: [['X', fmt3(0x03), 'm/s²'], ['Y', fmt3(0x04), 'm/s²'], ['Z', fmt3(0x05), 'm/s²']],
    },
    {
      title: 'Gyroscope',
      color: 'text-indigo-400',
      rows: [['X', fmt3(0x06), 'rad/s'], ['Y', fmt3(0x07), 'rad/s'], ['Z', fmt3(0x08), 'rad/s']],
    },
    {
      title: 'Euler Angles',
      color: 'text-cyan-400',
      rows: [['Pitch', fmt1(0x10), '°'], ['Roll', fmt1(0x11), '°'], ['Yaw', fmt1(0x12), '°']],
    },
  ]

  return (
    <div className="flex flex-col h-full justify-center gap-3">
      {!imuData
        ? <div className="text-gray-400 text-sm text-center">Waiting for data…</div>
        : sections.map(({ title, color, rows }) => (
            <div key={title}>
              <p className={`text-[10px] font-semibold uppercase tracking-wider mb-1.5 ${color}`}>{title}</p>
              <div className="grid grid-cols-3 gap-x-3 gap-y-1">
                {rows.map(([label, val, unit]) => (
                  <div key={label} className="flex flex-col">
                    <span className="text-[10px] text-gray-500 dark:text-gray-400">{label}</span>
                    <span className="text-sm font-mono font-semibold text-slate-900 dark:text-white tabular-nums leading-tight">
                      {val}<span className="text-[10px] font-normal text-gray-400 ml-0.5">{unit}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))
      }
    </div>
  )
}

// ─── Rotary Panel ─────────────────────────────────────────────────────────────
function RotaryPanel({ readings }) {
  const position = useMemo(() => {
    let p = 0
    for (const r of readings) {
      const parts = String(r.value ?? '').split(',')
      const dir = parts[0]
      const delta = parseInt(parts[1]) || 0
      p += dir === 'CW' ? delta : -delta
    }
    return p
  }, [readings])
  const last = readings[readings.length - 1]
  const lastDir = last ? String(last.value ?? '').split(',')[0] : null
  return (
    <div className="flex flex-col items-center justify-center h-full gap-2">
      <div className="text-5xl font-bold text-slate-900 dark:text-white tabular-nums">{position}</div>
      <div className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider">steps</div>
      {lastDir && (
        <div className={`text-sm font-semibold px-3 py-1 rounded-full ${lastDir === 'CW' ? 'bg-green-500/15 text-green-600 dark:text-green-400' : 'bg-red-500/15 text-red-600 dark:text-red-400'}`}>
          {lastDir === 'CW' ? '↻ CW' : '↺ CCW'}
        </div>
      )}
      {!last && <div className="text-gray-400 text-sm">Waiting for data…</div>}
    </div>
  )
}

// ─── Vibration Panel ──────────────────────────────────────────────────────────
function VibrationPanel({ readings }) {
  const lastVal = readings[readings.length - 1]?.value
  const isActive = String(lastVal ?? '').toLowerCase() === 'true' || Number(lastVal) === 1
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3">
      <div className={`w-16 h-16 rounded-full flex items-center justify-center border-2 transition-all duration-300 ${isActive ? 'bg-red-500/20 border-red-500 animate-pulse' : 'bg-slate-100 dark:bg-slate-700/50 border-slate-300 dark:border-slate-600'}`}>
        <Activity className={`w-8 h-8 ${isActive ? 'text-red-500' : 'text-slate-400'}`} />
      </div>
      <span className={`text-base font-bold tracking-wide ${isActive ? 'text-red-500' : 'text-slate-500 dark:text-slate-400'}`}>
        {readings.length === 0 ? '—' : isActive ? 'VIBRATING' : 'IDLE'}
      </span>
    </div>
  )
}

// ─── Sensor Panel wrapper ─────────────────────────────────────────────────────
function SensorPanel({ deviceId, ctrlId, sensor, open, wsRef, onPopOut, latestData }) {
  const { portNum, sensorType } = sensor
  const st = Number(sensorType)
  const isIMU    = isIMUSensor(st)
  const isHumTemp = st === 0x01

  const readings = useSensorFeed(
    deviceId, ctrlId, portNum,
    (isIMU || isHumTemp) ? null : sensorType,
    open && !isIMU && !isHumTemp,
    wsRef
  )

  const info  = getSensorInfo(st)
  const label = isIMU ? 'IMU' : isHumTemp ? 'Temp & Humidity' : info.label

  function renderBody() {
    if (isIMU)     return <IMUPanel     deviceId={deviceId} ctrlId={ctrlId} portNum={portNum} open={open} wsRef={wsRef} latestData={latestData} />
    if (isHumTemp) return <HumTempPanel deviceId={deviceId} ctrlId={ctrlId} portNum={portNum} open={open} wsRef={wsRef} latestData={latestData} />
    if (st === 0x13) return <RotaryPanel readings={readings} />
    if (st === 0x14) return <VibrationPanel readings={readings} />
    return <LinePanel readings={readings} sensorType={sensorType} />
  }

  return (
    <div className="rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-slate-800 p-4 flex flex-col" style={{ minHeight: '260px' }}>
      <div className="flex items-start justify-between mb-3 flex-shrink-0">
        <div>
          <span className="text-[10px] font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500">C{ctrlId} P{portNum}</span>
          <h4 className="text-sm font-semibold text-slate-900 dark:text-white leading-tight">{label}</h4>
        </div>
        <button
          onClick={() => onPopOut(sensor)}
          title="Open full view"
          className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors flex-shrink-0"
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="flex-1 min-h-0">{renderBody()}</div>
    </div>
  )
}

// ─── Main modal ───────────────────────────────────────────────────────────────
export default function MultiSensorView({ open, onClose, label, deviceId, wsRef, onPopOut, latestData }) {
  if (!open || !label) return null
  const { name, sensors } = label
  const ctrlIds = [...new Set(sensors.map(s => String(s.ctrlId)).filter(Boolean))]
  const gridClass =
    sensors.length === 1 ? 'grid-cols-1'
    : sensors.length <= 4 ? 'grid-cols-1 md:grid-cols-2'
    : 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="relative w-full max-w-5xl max-h-[90vh] flex flex-col rounded-2xl border border-black/10 dark:border-white/10 bg-slate-50 dark:bg-slate-900 shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-black/10 dark:border-white/10 flex-shrink-0 bg-white dark:bg-slate-800/80">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{name}</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {sensors.length} sensor{sensors.length !== 1 ? 's' : ''}
              {ctrlIds.length > 1 && ` · ${ctrlIds.length} controllers`}
              {' · Live Grid View'}
            </p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 transition-colors">
            <X className="w-5 h-5 text-gray-600 dark:text-gray-400" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          <div className={`grid ${gridClass} gap-4`}>
            {sensors.map((sensor) => (
              <SensorPanel
                key={`${sensor.ctrlId}-${sensor.portNum}-${sensor.sensorType}`}
                deviceId={deviceId}
                ctrlId={sensor.ctrlId}
                sensor={sensor}
                open={open}
                wsRef={wsRef}
                onPopOut={onPopOut}
                latestData={latestData}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
