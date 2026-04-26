import { useEffect, useState } from 'react'
import { X, Loader2 } from 'lucide-react'
import { useIsDark } from '../utils/useIsDark'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { getHistory } from '../lib/api'
import { getSensorInfo } from '../utils/sensors'

function formatTs(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div className="rounded-lg border border-black/10 bg-white dark:border-white/10 dark:bg-slate-800 px-3 py-2 text-xs shadow-lg">
      <p className="text-slate-500 dark:text-gray-400 mb-1">{formatTs(d.server_ts)}</p>
      <p className="text-cyan-600 dark:text-cyan-300 font-semibold tabular-nums">{Number(d.value).toFixed(4)}</p>
    </div>
  )
}

export default function HistoryModal({ deviceId, ctrlId, portNum, sensorType, onClose }) {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const isDark = useIsDark()

  const info = getSensorInfo(sensorType)
  const tickColor  = isDark ? '#94a3b8' : '#64748b'
  const axisStroke = isDark ? '#334155' : '#e2e8f0'
  const colors = info.colors

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    getHistory(deviceId, ctrlId, portNum, 100)
      .then((rows) => {
        if (cancelled) return
        setData(rows || [])
      })
      .catch((err) => {
        if (cancelled) return
        setError(err.message || 'Failed to load history')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [deviceId, ctrlId, portNum])

  function handleBackdrop(e) {
    if (e.target === e.currentTarget) onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={handleBackdrop}
    >
      <div className="rounded-2xl border border-black/10 bg-white dark:border-white/10 dark:bg-slate-900 shadow-xl w-full max-w-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-black/10 dark:border-white/10">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <span>{info.label}</span>
              <span className="text-slate-400 dark:text-gray-500 font-normal">—</span>
              <span className="text-slate-500 dark:text-gray-400 font-normal">Ctrl {ctrlId} / Port {portNum}</span>
            </h2>
            <p className="text-xs text-slate-400 dark:text-gray-500 mt-0.5">Last 100 readings · {info.unit}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg bg-slate-100 dark:bg-white/10 p-1.5 text-slate-500 hover:text-slate-900 dark:text-gray-400 dark:hover:text-white transition-colors cursor-pointer"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 h-72 flex items-center justify-center">
          {loading && (
            <div className="flex flex-col items-center gap-2 text-slate-400 dark:text-gray-500">
              <Loader2 size={24} className="animate-spin" />
              <span className="text-xs">Loading history…</span>
            </div>
          )}

          {!loading && error && (
            <p className="text-sm text-red-500 dark:text-red-400">{error}</p>
          )}

          {!loading && !error && data.length === 0 && (
            <p className="text-sm text-slate-400 dark:text-gray-500">No data available for this node.</p>
          )}

          {!loading && !error && data.length > 0 && (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                <XAxis
                  dataKey="server_ts"
                  tickFormatter={formatTs}
                  tick={{ fill: tickColor, fontSize: 10 }}
                  axisLine={{ stroke: axisStroke }}
                  tickLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fill: tickColor, fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  width={48}
                  tickFormatter={(v) => Number(v).toFixed(2)}
                />
                <Tooltip content={<CustomTooltip />} />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="#06b6d4"
                  strokeWidth={1.5}
                  dot={false}
                  activeDot={{ r: 4, fill: '#06b6d4', stroke: '#0e7490' }}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-black/10 dark:border-white/10 flex justify-end">
          <button
            onClick={onClose}
            className="inline-flex items-center gap-2 rounded-md border border-black/10 bg-black/5 px-3 py-1 text-xs text-gray-700 hover:bg-black/10 dark:border-white/10 dark:bg-white/10 dark:text-gray-200 dark:hover:bg-white/20 transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
