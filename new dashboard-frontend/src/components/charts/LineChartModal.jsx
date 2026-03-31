import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
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
import { getSensorInfo } from '../../utils/sensors'

ChartJS.register(LinearScale, PointElement, LineElement, Tooltip, Legend, Filler)

function fmtTick(ms) {
  const d = new Date(ms)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}

// wsRef: { current: WebSocket | null } — passed from parent so modal can listen
export default function LineChartModal({ open, onClose, deviceId, ctrlId, portNum, sensorType, wsRef }) {
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState(null)
  const [rows, setRows] = useState([])

  const info = getSensorInfo(sensorType)

  useEffect(() => {
    if (!open) { setRows([]); return }
    if (!deviceId || ctrlId == null || portNum == null) {
      setErr('Invalid context'); return
    }
    const ac = new AbortController()

    async function load() {
      setLoading(true)
      setErr(null)
      try {
        const data = await getHistory(deviceId, ctrlId, portNum, 24, sensorType)
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
      } catch (e) {
        if (!ac.signal.aborted) setErr(e.message || String(e))
      } finally {
        if (!ac.signal.aborted) setLoading(false)
      }
    }

    load()
    return () => ac.abort()
  }, [open, deviceId, ctrlId, portNum, sensorType])

  // Subscribe to WS for live updates
  useEffect(() => {
    if (!open || !wsRef?.current) return

    const ws = wsRef.current
    const handler = (evt) => {
      try {
        const msg = JSON.parse(evt.data)
        if (msg.type !== 'sensor_data') return
        const p = msg.payload
        if (p.device_id !== deviceId) return
        if (Number(p.ctrl_id) !== Number(ctrlId)) return
        if (Number(p.port_num) !== Number(portNum)) return
        if (p.sensor_type !== undefined && Number(p.sensor_type) !== Number(sensorType)) return
        const v = Number(p.value)
        if (!Number.isFinite(v)) return
        const ts = p.ts ? new Date(p.ts).getTime() : Date.now()
        setRows((prev) => {
          const merged = [...prev, { ts, value: v }].sort((a, b) => a.ts - b.ts)
          return merged.length > 2000 ? merged.slice(-2000) : merged
        })
      } catch {}
    }
    ws.addEventListener('message', handler)
    return () => ws.removeEventListener('message', handler)
  }, [open, wsRef, deviceId, ctrlId, portNum, sensorType])

  const title = `Ctrl ${ctrlId} / P${portNum} — ${info.label}`

  const chartData = useMemo(() => {
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
  }, [rows, info])

  const chartOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    parsing: false,
    normalized: true,
    interaction: { mode: 'nearest', intersect: false },
    plugins: {
      legend: { display: true, position: 'top' },
      tooltip: {
        callbacks: {
          title: (items) => {
            const x = items?.[0]?.parsed?.x
            return x ? new Date(x).toLocaleString() : ''
          },
          label: (item) => {
            const y = item?.parsed?.y
            if (typeof y !== 'number') return `${item.dataset.label}: -`
            return `${item.dataset.label}: ${y.toFixed(3)}`
          },
        },
      },
    },
    scales: {
      x: {
        type: 'linear',
        ticks: { callback: (v) => fmtTick(Number(v)), maxTicksLimit: 8 },
        grid: { display: true },
      },
      y: {
        ticks: { callback: (v) => String(v) },
        grid: { display: true },
      },
    },
  }), [])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[1000] bg-black/50 flex items-center justify-center p-4">
      <div className="w-full max-w-3xl rounded-2xl border border-black/10 bg-white dark:bg-slate-900 dark:border-white/10 shadow-xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-black/10 dark:border-white/10">
          <div className="text-sm font-medium text-slate-900 dark:text-white">{title}</div>
          <button onClick={onClose} className="p-1 rounded-md hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4">
          {loading && <div className="text-center text-sm text-gray-600 dark:text-gray-300">Loading…</div>}
          {err && !loading && <div className="text-center text-sm text-red-600 dark:text-red-400">{err}</div>}
          {!loading && !err && rows.length === 0 && (
            <div className="text-center text-sm text-gray-600 dark:text-gray-300">No data yet.</div>
          )}
          {!loading && !err && rows.length > 0 && (
            <div className="h-[380px]">
              <Line data={chartData} options={chartOptions} />
              <div className="mt-2 text-[11px] text-gray-600 dark:text-gray-400">
                Points: {rows.length} · Unit: {info.unit}
              </div>
            </div>
          )}
        </div>
        <div className="px-4 py-3 border-t border-black/10 dark:border-white/10 flex justify-end">
          <button onClick={onClose} className="text-sm rounded-md border border-black/10 dark:border-white/10 px-3 py-1 hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer">
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
