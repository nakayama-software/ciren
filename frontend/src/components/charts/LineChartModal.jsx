import { useEffect, useMemo, useState } from 'react'
import { X, BarChart3, Table as TableIcon } from 'lucide-react'
import { Line } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js'
import { getHistory } from '../../lib/api'
import { getSensorInfo, formatValue } from '../../utils/sensors'
import { useIsDark } from '../../utils/useIsDark'

ChartJS.register(LinearScale, PointElement, LineElement, Tooltip, Legend, Filler)

function fmtTick(ms, showDate = false) {
  const d = new Date(ms)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  if (showDate) {
    const mo = d.toLocaleDateString([], { month: 'short' })
    const dy = d.getDate()
    return `${dy} ${mo} ${hh}:${mm}`
  }
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}

const RANGE_OPTIONS = [
  { label: '1h',  hours: 1 },
  { label: '6h',  hours: 6 },
  { label: '24h', hours: 24 },
  { label: '7d',  hours: 168 },
  { label: '30d', hours: 720 },
]

// ── Table view component ─────────────────────────────────────────────────────
function DataTableSection({ label, labelColor, rows, unit, isDark }) {
  const sorted = useMemo(() => [...rows].reverse(), [rows])

  // Show date column when readings span multiple calendar days
  const multiDay = useMemo(() => {
    if (rows.length < 2) return false
    const first = new Date(rows[0].ts).toDateString()
    const last  = new Date(rows[rows.length - 1].ts).toDateString()
    return first !== last
  }, [rows])

  const fmtCell = (ts) => {
    const d = new Date(ts)
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    if (!multiDay) return time
    const date = d.toLocaleDateString([], { day: 'numeric', month: 'short' })
    return `${date}  ${time}`
  }

  const thCls = 'px-3 py-1.5 text-left text-[10px] font-medium uppercase tracking-wider sticky top-0 z-[1]'
  const thBg  = isDark ? 'bg-slate-800 text-gray-400' : 'bg-gray-50 text-gray-500'
  const tdCls = 'px-3 py-1 text-xs whitespace-nowrap'
  const tdAlt = isDark ? 'bg-slate-800/40' : 'bg-gray-50/50'

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className={`text-xs font-medium ${labelColor} mb-1`}>{label}</div>
      <div className="flex-1 min-h-0 overflow-auto rounded-md border border-black/10 dark:border-white/10">
        <table className="w-full border-collapse">
          <thead>
            <tr className={`${thCls} ${thBg} border-b border-black/10 dark:border-white/10`}>
              <th className={`${thCls} ${thBg} w-10`}>#</th>
              <th className={`${thCls} ${thBg}`}>{multiDay ? 'Date & Time' : 'Time'}</th>
              <th className={`${thCls} ${thBg} text-right`}>Value</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, i) => (
              <tr key={i} className={`border-b border-black/5 dark:border-white/5 ${i % 2 === 1 ? tdAlt : ''}`}>
                <td className={`${tdCls} text-gray-400 dark:text-gray-500`}>{i + 1}</td>
                <td className={`${tdCls} font-mono`}>{fmtCell(r.ts)}</td>
                <td className={`${tdCls} text-right font-mono`}>{formatValue(r.value)} {unit}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-1 text-[10px] text-gray-400 dark:text-gray-500">{rows.length} rows</div>
    </div>
  )
}

// wsRef: { current: WebSocket | null } — passed from parent so modal can listen
export default function LineChartModal({ open, onClose, deviceId, ctrlId, portNum, sensorType, isHumTemp, wsRef }) {
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState(null)
  const [rows, setRows] = useState([])           // single-sensor mode: [{ts, value}]
  const [humRows, setHumRows] = useState([])      // HumTemp mode: humidity [{ts, value}]
  const [tempRows, setTempRows] = useState([])     // HumTemp mode: temperature [{ts, value}]
  const [hours, setHours] = useState(24)
  const [viewMode, setViewMode] = useState('chart')  // 'chart' | 'table'
  const isDark = useIsDark()

  const info = getSensorInfo(sensorType)

  // Reset range when modal opens for a new sensor
  useEffect(() => {
    if (open) { setHours(24); setViewMode('chart') }
  }, [open, deviceId, ctrlId, portNum, sensorType])

  // ── Fetch history ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) { setRows([]); setTempRows([]); setHumRows([]); return }
    if (!deviceId || ctrlId == null || portNum == null) {
      setErr('Invalid context'); return
    }
    const ac = new AbortController()

    async function load() {
      setLoading(true)
      setErr(null)
      try {
        if (isHumTemp) {
          // Fetch both temperature and humidity history
          const [tData, hData] = await Promise.all([
            getHistory(deviceId, ctrlId, portNum, hours, 0x01),
            getHistory(deviceId, ctrlId, portNum, hours, 0x02),
          ])
          if (ac.signal.aborted) return
          const mapRow = (r) => {
            const tsMs = r.server_ts ? new Date(r.server_ts).getTime() : null
            const v = r.value !== undefined ? Number(r.value) : null
            if (!tsMs || !Number.isFinite(tsMs) || v === null || !Number.isFinite(v)) return null
            return { ts: tsMs, value: v }
          }
          const tMapped = (tData || []).map(mapRow).filter(Boolean).sort((a, b) => a.ts - b.ts)
          const hMapped = (hData || []).map(mapRow).filter(Boolean).sort((a, b) => a.ts - b.ts)
          setTempRows(tMapped)
          setHumRows(hMapped)
        } else {
          // Single sensor mode
          const data = await getHistory(deviceId, ctrlId, portNum, hours, sensorType)
          if (ac.signal.aborted) return
          const mapped = (data || [])
            .map((r) => {
              const tsMs = r.server_ts ? new Date(r.server_ts).getTime() : null
              const v = r.value !== undefined ? Number(r.value) : null
              if (!tsMs || !Number.isFinite(tsMs) || v === null || !Number.isFinite(v)) return null
              return { ts: tsMs, value: v }
            })
            .filter(Boolean)
            .sort((a, b) => a.ts - b.ts)
          setRows(mapped)
        }
      } catch (e) {
        if (!ac.signal.aborted) setErr(e.message || String(e))
      } finally {
        if (!ac.signal.aborted) setLoading(false)
      }
    }

    load()
    return () => ac.abort()
  }, [open, deviceId, ctrlId, portNum, sensorType, isHumTemp, hours])

  // ── Subscribe to WS for live updates ────────────────────────────────────
  useEffect(() => {
    if (!open || !wsRef?.current) return

    const ws = wsRef.current
    const handler = (evt) => {
      try {
        const msg = JSON.parse(evt.data)
        if (msg.type !== 'sensor_data') return
        const p = msg.payload
        if (p.ftype === 0x05) return  // skip HB_TYPED — only DATA frames go into chart
        if (p.device_id !== deviceId) return
        if (Number(p.ctrl_id) !== Number(ctrlId)) return
        if (Number(p.port_num) !== Number(portNum)) return
        const v = Number(p.value)
        if (!Number.isFinite(v)) return
        const ts = p.ts ? new Date(p.ts).getTime() : Date.now()

        if (isHumTemp) {
          const st = Number(p.sensor_type)
          const merge = (prev) => {
            const merged = [...prev, { ts, value: v }].sort((a, b) => a.ts - b.ts)
            return merged.length > 2000 ? merged.slice(-2000) : merged
          }
          if (st === 0x01) setTempRows(merge)
          else if (st === 0x02) setHumRows(merge)
        } else {
          if (p.sensor_type !== undefined && Number(p.sensor_type) !== Number(sensorType)) return
          setRows((prev) => {
            const merged = [...prev, { ts, value: v }].sort((a, b) => a.ts - b.ts)
            return merged.length > 2000 ? merged.slice(-2000) : merged
          })
        }
      } catch {}
    }
    ws.addEventListener('message', handler)
    return () => ws.removeEventListener('message', handler)
  }, [open, wsRef, deviceId, ctrlId, portNum, sensorType, isHumTemp])

  // ── Title ───────────────────────────────────────────────────────────────
  const title = isHumTemp
    ? `Ctrl ${ctrlId} / P${portNum} — Temperature & Humidity`
    : `Ctrl ${ctrlId} / P${portNum} — ${info.label}`

  // ── Chart data & options ────────────────────────────────────────────────
  const chartData = useMemo(() => {
    if (isHumTemp) {
      return {
        datasets: [
          {
            label: 'Temperature (°C)',
            data: tempRows.map((r) => ({ x: r.ts, y: r.value })),
            borderColor: 'rgb(249,115,22)',
            backgroundColor: 'rgba(249,115,22,0.10)',
            pointRadius: 0,
            tension: 0.25,
            spanGaps: true,
            fill: true,
            yAxisID: 'yTemp',
          },
          {
            label: 'Humidity (%RH)',
            data: humRows.map((r) => ({ x: r.ts, y: r.value })),
            borderColor: 'rgb(99,102,241)',
            backgroundColor: 'rgba(99,102,241,0.10)',
            pointRadius: 0,
            tension: 0.25,
            spanGaps: true,
            fill: true,
            yAxisID: 'yHum',
          },
        ],
      }
    }

    const valueData = rows.map((r) => ({ x: r.ts, y: r.value }))
    return {
      datasets: [{
        label: `${info.label} (${info.unit})`,
        data: valueData,
        borderColor: 'rgb(99,102,241)',
        backgroundColor: 'rgba(99,102,241,0.15)',
        pointRadius: 0,
        tension: 0.25,
        spanGaps: true,
        fill: true,
      }],
    }
  }, [rows, tempRows, humRows, info, isHumTemp])

  const chartOptions = useMemo(() => {
    const tickColor = isDark ? 'rgba(148,163,184,0.8)' : 'rgba(71,85,105,0.8)'
    const gridColor = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)'
    const legendColor = isDark ? '#cbd5e1' : '#475569'

    const base = {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      parsing: false,
      normalized: true,
      interaction: { mode: 'nearest', intersect: false },
      plugins: {
        legend: {
          display: true,
          position: 'top',
          labels: { color: legendColor, font: { size: 11 } },
        },
        tooltip: {
          callbacks: {
            title: (items) => {
              const x = items?.[0]?.parsed?.x
              return x ? new Date(x).toLocaleString() : ''
            },
            label: (item) => {
              const y = item?.parsed?.y
              if (typeof y !== 'number') return `${item.dataset.label}: -`
              return `${item.dataset.label}: ${parseFloat(y.toFixed(1))}`
            },
          },
        },
      },
      scales: {
        x: {
          type: 'linear',
          ticks: { callback: (v) => fmtTick(Number(v), hours >= 24), maxTicksLimit: 8, color: tickColor },
          grid: { color: gridColor },
        },
      },
    }

    if (isHumTemp) {
      base.scales.yTemp = {
        position: 'left',
        ticks: { callback: (v) => `${Number(v).toFixed(1)}°C`, color: 'rgba(249,115,22,0.8)', maxTicksLimit: 6 },
        grid: { color: gridColor },
      }
      base.scales.yHum = {
        position: 'right',
        ticks: { callback: (v) => `${Number(v).toFixed(0)}%`, color: 'rgba(99,102,241,0.8)', maxTicksLimit: 6 },
        grid: { display: false },
      }
    } else {
      base.scales.y = {
        ticks: { callback: (v) => parseFloat(Number(v).toFixed(2)).toString(), color: tickColor },
        grid: { color: gridColor },
      }
    }

    return base
  }, [isDark, isHumTemp, hours])

  // ── Point count for footer ──────────────────────────────────────────────
  const totalPoints = isHumTemp ? tempRows.length + humRows.length : rows.length

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[1000] bg-black/50 flex items-center justify-center p-2 sm:p-4">
      <div className="w-full max-w-3xl rounded-2xl border border-black/10 bg-white dark:bg-slate-900 dark:border-white/10 shadow-xl flex flex-col max-h-[calc(100dvh-16px)] sm:max-h-[calc(100dvh-32px)]">
        {/* Header: title row + controls row (stacked on mobile) */}
        <div className="px-4 py-3 border-b border-black/10 dark:border-white/10 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between shrink-0">
          {/* Title + close */}
          <div className="flex items-center justify-between gap-2 min-w-0">
            <div className="text-sm font-medium text-slate-900 dark:text-white truncate">{title}</div>
            <button onClick={onClose} className="p-1 rounded-md hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer shrink-0" aria-label="Close">
              <X className="w-4 h-4" />
            </button>
          </div>
          {/* Controls: range + view toggle */}
          <div className="flex items-center gap-2 shrink-0">
            <div className="inline-flex rounded-md border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 p-0.5 gap-0.5">
              {RANGE_OPTIONS.map((opt) => (
                <button
                  key={opt.label}
                  onClick={() => setHours(opt.hours)}
                  className={`px-2 py-1 text-xs rounded cursor-pointer transition-colors ${
                    hours === opt.hours
                      ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                      : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <div className="inline-flex rounded-md border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 p-0.5 gap-0.5">
              <button
                onClick={() => setViewMode('chart')}
                className={`p-1 rounded cursor-pointer transition-colors ${
                  viewMode === 'chart'
                    ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                    : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
                }`}
                title="Chart view"
              >
                <BarChart3 className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setViewMode('table')}
                className={`p-1 rounded cursor-pointer transition-colors ${
                  viewMode === 'table'
                    ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                    : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
                }`}
                title="Table view"
              >
                <TableIcon className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
        <div className="p-4 flex-1 min-h-0 overflow-y-auto">
          {loading && <div className="text-center text-sm text-gray-600 dark:text-gray-300">Loading…</div>}
          {err && !loading && <div className="text-center text-sm text-red-600 dark:text-red-400">{err}</div>}
          {!loading && !err && totalPoints === 0 && (
            <div className="text-center text-sm text-gray-600 dark:text-gray-300">No data yet.</div>
          )}
          {!loading && !err && totalPoints > 0 && viewMode === 'chart' && (
            <div className="h-[320px] sm:h-[380px]">
              <Line data={chartData} options={chartOptions} />
              <div className="mt-2 text-[11px] text-gray-600 dark:text-gray-400">
                Points: {totalPoints}
                {isHumTemp ? ' (Temp: ' + tempRows.length + ', Hum: ' + humRows.length + ')' : ' · Unit: ' + info.unit}
              </div>
            </div>
          )}
          {!loading && !err && totalPoints > 0 && viewMode === 'table' && (
            <div className="h-[320px] sm:h-[380px] flex flex-col">
              {isHumTemp ? (
                <>
                  <DataTableSection
                    label="Temperature (°C)"
                    labelColor="text-orange-500"
                    rows={tempRows}
                    unit="°C"
                    isDark={isDark}
                  />
                  <div className="border-t border-black/10 dark:border-white/10 my-2" />
                  <DataTableSection
                    label="Humidity (%RH)"
                    labelColor="text-indigo-500"
                    rows={humRows}
                    unit="%RH"
                    isDark={isDark}
                  />
                </>
              ) : (
                <DataTableSection
                  label={`${info.label} (${info.unit})`}
                  labelColor="text-indigo-500"
                  rows={rows}
                  unit={info.unit}
                  isDark={isDark}
                />
              )}
            </div>
          )}
        </div>
        <div className="px-4 py-3 border-t border-black/10 dark:border-white/10 flex justify-end shrink-0">
          <button onClick={onClose} className="text-sm rounded-md border border-black/10 dark:border-white/10 px-3 py-1 hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer">
            Close
          </button>
        </div>
      </div>
    </div>
  )
}