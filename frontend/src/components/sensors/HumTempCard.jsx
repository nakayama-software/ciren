import { useEffect, useState, useMemo, useRef } from 'react'
import { Thermometer, Droplets } from 'lucide-react'
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
import { getReadingKey, formatValue } from '../../utils/sensors'
import { getHistory } from '../../lib/api'
import { useIsDark } from '../../utils/useIsDark'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Filler)

const MAX_POINTS = 30

function timeAgo(ts, t) {
  if (!ts) return null
  const tr = t?.timeAgo || {}
  const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000)
  if (diff < 5) return tr.justNow || 'Just now'
  if (diff < 60) return tr.secondsAgo ? tr.secondsAgo(diff) : `${diff}s ago`
  if (diff < 3600) return tr.minutesAgo ? tr.minutesAgo(Math.floor(diff / 60)) : `${Math.floor(diff / 60)}m ago`
  return tr.hoursAgo ? tr.hoursAgo(Math.floor(diff / 3600)) : `${Math.floor(diff / 3600)}h ago`
}

function fmtTime(ts) {
  const d = new Date(ts)
  if (isNaN(d)) return ''
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

function buildChartOpts(isDark) {
  const tickColor  = isDark ? 'rgba(148,163,184,0.7)' : 'rgba(71,85,105,0.7)'
  const gridColor  = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 200 },
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        enabled: true,
        callbacks: {
          label: (ctx) => {
            const unit = ctx.datasetIndex === 0 ? '°C' : '%RH'
            return ` ${ctx.parsed.y?.toFixed(1)} ${unit}`
          },
        },
      },
    },
    scales: {
      x: {
        ticks: { maxTicksLimit: 4, maxRotation: 0, font: { size: 9 }, color: tickColor },
        grid: { display: false },
      },
      yTemp: {
        position: 'left',
        ticks: { maxTicksLimit: 3, font: { size: 9 }, color: 'rgba(249,115,22,0.8)' },
        grid: { color: gridColor },
      },
      yHum: {
        position: 'right',
        ticks: { maxTicksLimit: 3, font: { size: 9 }, color: 'rgba(99,102,241,0.8)' },
        grid: { display: false },
      },
    },
  }
}

// Gabungan temperature (0x01) + humidity (0x02) dari port yang sama
export default function HumTempCard({ deviceId, ctrlId, portNum, latestData, status, now, onChartClick, t }) {
  const isDark = useIsDark()
  const chartOpts = useMemo(() => buildChartOpts(isDark), [isDark])
  const tempKey = getReadingKey(ctrlId, portNum, 0x01)
  const humKey  = getReadingKey(ctrlId, portNum, 0x02)
  const tempR   = latestData?.[tempKey] || null
  const humR    = latestData?.[humKey]  || null

  const tempVal = tempR?.value !== undefined ? formatValue(tempR.value) : '--'
  const humVal  = humR?.value  !== undefined ? formatValue(humR.value)  : '--'

  const nowMs  = now || Date.now()
  const lastTs = (tempR?.server_ts && humR?.server_ts)
    ? (new Date(tempR.server_ts) > new Date(humR.server_ts) ? tempR.server_ts : humR.server_ts)
    : (tempR?.server_ts || humR?.server_ts || null)

  let resolvedStatus = status
  if (!resolvedStatus && lastTs) {
    resolvedStatus = (nowMs - new Date(lastTs).getTime()) < 30000 ? 'online' : 'stale'
  }

  const statusColorMap = { online: 'bg-green-500', stale: 'bg-yellow-400', offline: 'bg-red-500' }
  const statusColor = statusColorMap[resolvedStatus] || 'bg-slate-400 dark:bg-gray-600'
  const ago = lastTs ? timeAgo(lastTs, t) : null

  // ── History untuk mini chart ──────────────────────────────────────
  // Simpan pasangan {ts, temp, hum} — keyed by menit agar tidak duplikat
  const [points, setPoints] = useState([])  // [{ts, temp, hum}]
  const prevTempTs = useRef(null)
  const prevHumTs  = useRef(null)

  // Fetch history saat mount
  useEffect(() => {
    if (!deviceId || ctrlId == null || portNum == null) return
    let cancelled = false
    ;(async () => {
      try {
        const [tData, hData] = await Promise.all([
          getHistory(deviceId, ctrlId, portNum, 720, 0x01),
          getHistory(deviceId, ctrlId, portNum, 720, 0x02),
        ])
        if (cancelled) return

        // Merge by ts rounded to 10s buckets
        const byTs = {}
        if (Array.isArray(tData)) {
          for (const r of tData) {
            const ts = r.server_ts ? new Date(r.server_ts).getTime() : null
            if (!ts) continue
            const bucket = Math.round(ts / 10000) * 10000
            byTs[bucket] = { ...(byTs[bucket] || {}), ts: bucket, temp: Number(r.value) }
          }
        }
        if (Array.isArray(hData)) {
          for (const r of hData) {
            const ts = r.server_ts ? new Date(r.server_ts).getTime() : null
            if (!ts) continue
            const bucket = Math.round(ts / 10000) * 10000
            byTs[bucket] = { ...(byTs[bucket] || {}), ts: bucket, hum: Number(r.value) }
          }
        }
        const merged = Object.values(byTs)
          .filter((p) => p.temp != null || p.hum != null)
          .sort((a, b) => a.ts - b.ts)
          .slice(-MAX_POINTS)
        if (!cancelled) setPoints(merged)
      } catch {}
    })()
    return () => { cancelled = true }
  }, [deviceId, ctrlId, portNum])

  // Append live readings saat latestData berubah
  useEffect(() => {
    if (!tempR?.server_ts || tempR.server_ts === prevTempTs.current) return
    prevTempTs.current = tempR.server_ts
    const ts = new Date(tempR.server_ts).getTime()
    const bucket = Math.round(ts / 10000) * 10000
    setPoints((prev) => {
      const idx = prev.findIndex((p) => p.ts === bucket)
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = { ...next[idx], temp: Number(tempR.value) }
        return next
      }
      return [...prev, { ts: bucket, temp: Number(tempR.value) }].slice(-MAX_POINTS)
    })
  }, [tempR])

  useEffect(() => {
    if (!humR?.server_ts || humR.server_ts === prevHumTs.current) return
    prevHumTs.current = humR.server_ts
    const ts = new Date(humR.server_ts).getTime()
    const bucket = Math.round(ts / 10000) * 10000
    setPoints((prev) => {
      const idx = prev.findIndex((p) => p.ts === bucket)
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = { ...next[idx], hum: Number(humR.value) }
        return next
      }
      return [...prev, { ts: bucket, hum: Number(humR.value) }].slice(-MAX_POINTS)
    })
  }, [humR])

  const chartData = useMemo(() => ({
    labels: points.map((p) => fmtTime(p.ts)),
    datasets: [
      {
        label: 'Temp',
        data: points.map((p) => p.temp ?? null),
        borderColor: 'rgb(249,115,22)',
        backgroundColor: 'rgba(249,115,22,0.08)',
        borderWidth: 1.5,
        pointRadius: 0,
        fill: false,
        tension: 0.3,
        yAxisID: 'yTemp',
        spanGaps: true,
      },
      {
        label: 'Humidity',
        data: points.map((p) => p.hum ?? null),
        borderColor: 'rgb(99,102,241)',
        backgroundColor: 'rgba(99,102,241,0.08)',
        borderWidth: 1.5,
        pointRadius: 0,
        fill: false,
        tension: 0.3,
        yAxisID: 'yHum',
        spanGaps: true,
      },
    ],
  }), [points])

  return (
    <div
      role="button"
      onClick={onChartClick}
      className="rounded-xl border border-teal-500/20 bg-teal-500/5 p-4 hover:border-teal-500/40 transition-all cursor-pointer h-full flex flex-col"
    >
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-teal-500/10 border border-teal-500/20 p-2 shrink-0">
          <Thermometer className="w-5 h-5 text-teal-500" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-slate-900 dark:text-white text-sm">Temp &amp; Humidity</p>
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-gray-300">
            Port {portNum}
          </span>
        </div>
        <span className={`ml-auto w-2 h-2 rounded-full shrink-0 ${statusColor}`} title={resolvedStatus || 'unknown'} />
      </div>

      {/* Values row */}
      <div className="rounded-xl bg-slate-100/80 dark:bg-black/20 border border-slate-200 dark:border-white/10 p-3 grid grid-cols-2 gap-3 mt-3">
        {/* Temperature */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1.5">
            <Thermometer className="w-3.5 h-3.5 text-orange-500" />
            <span className="text-[11px] text-slate-500 dark:text-gray-400">Temperature</span>
          </div>
          <div>
            <span className={`text-xl font-mono tabular-nums leading-none ${tempR ? 'text-slate-900 dark:text-white' : 'text-slate-400 dark:text-gray-600'}`}>
              {tempVal}
            </span>
            {tempR && <span className="text-[11px] text-slate-400 dark:text-gray-500 ml-1">°C</span>}
          </div>
        </div>

        {/* Humidity */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1.5">
            <Droplets className="w-3.5 h-3.5 text-indigo-500" />
            <span className="text-[11px] text-slate-500 dark:text-gray-400">Humidity</span>
          </div>
          <div>
            <span className={`text-xl font-mono tabular-nums leading-none ${humR ? 'text-slate-900 dark:text-white' : 'text-slate-400 dark:text-gray-600'}`}>
              {humVal}
            </span>
            {humR && <span className="text-[11px] text-slate-400 dark:text-gray-500 ml-1">%RH</span>}
          </div>
        </div>
      </div>

      {/* Mini dual-line chart */}
      <div className="mt-3 flex-1 min-h-0" style={{ minHeight: '90px' }}>
        {points.length > 1 ? (
          <>
            {/* Legend */}
            <div className="flex items-center gap-3 mb-1">
              <div className="flex items-center gap-1">
                <div className="w-4 h-0.5 rounded bg-orange-500" />
                <span className="text-[10px] text-slate-400 dark:text-gray-500">Temp °C</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-4 h-0.5 rounded bg-indigo-500" />
                <span className="text-[10px] text-slate-400 dark:text-gray-500">Hum %RH</span>
              </div>
            </div>
            <div className="h-[80px]">
              <Line data={chartData} options={chartOpts} />
            </div>
          </>
        ) : (
          <div className="h-full flex items-center justify-center text-[11px] text-slate-400 dark:text-gray-600">
            Collecting chart data…
          </div>
        )}
      </div>

      {ago && (
        <p className="text-[10px] text-slate-400 dark:text-gray-500 mt-2 text-right">
          {lastTs ? new Date(lastTs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : ''} · {ago}
        </p>
      )}
    </div>
  )
}
