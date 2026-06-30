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
} from 'chart.js'
import { getHistory } from '../../lib/api'
import { useIsDark } from '../../utils/useIsDark'

ChartJS.register(LinearScale, PointElement, LineElement, Tooltip, Legend)

function fmtTick(ms, showDate = false) {
  const d = new Date(ms)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  if (showDate) {
    const mo = d.toLocaleDateString([], { month: 'short' })
    return `${d.getDate()} ${mo} ${hh}:${mm}`
  }
  return `${hh}:${mm}:${String(d.getSeconds()).padStart(2, '0')}`
}

const RANGE_OPTIONS = [
  { label: '1h',  hours: 1 },
  { label: '6h',  hours: 6 },
  { label: '24h', hours: 24 },
  { label: '7d',  hours: 168 },
]

const CTRL_COLORS = [
  'rgb(249,115,22)',
  'rgb(99,102,241)',
  'rgb(20,184,166)',
  'rgb(236,72,153)',
  'rgb(234,179,8)',
]

function sharedBounds(allValues) {
  if (allValues.length === 0) return null
  const mn = Math.min(...allValues)
  const mx = Math.max(...allValues)
  const pad = Math.max((mx - mn) * 0.1, 0.5)
  return {
    min: parseFloat((mn - pad).toFixed(2)),
    max: parseFloat((mx + pad).toFixed(2)),
  }
}

function makeChartOpts(bounds, tickFmt, isDark, hours) {
  const tickColor = isDark ? 'rgba(148,163,184,0.8)' : 'rgba(71,85,105,0.8)'
  const gridColor = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)'

  // Show the full selected time range on x-axis, not just the data range.
  const xMax = Date.now()
  const xMin = xMax - hours * 3600 * 1000

  return {
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
        labels: { color: isDark ? '#cbd5e1' : '#475569', font: { size: 11 } },
      },
      tooltip: {
        callbacks: {
          title: items => items?.[0]?.parsed?.x ? new Date(items[0].parsed.x).toLocaleString() : '',
          label: item => `${item.dataset.label}: ${parseFloat(Number(item.parsed.y).toFixed(2))}`,
        },
      },
    },
    scales: {
      x: {
        type: 'linear',
        min: xMin,
        max: xMax,
        ticks: { callback: v => fmtTick(Number(v), hours >= 24), maxTicksLimit: 8, color: tickColor },
        grid: { color: gridColor },
      },
      y: {
        ...(bounds ? { min: bounds.min, max: bounds.max } : {}),
        ticks: { callback: tickFmt, color: tickColor, maxTicksLimit: 6 },
        grid: { color: gridColor },
      },
    },
  }
}

// ── Main component ────────────────────────────────────────────────────────────
export default function CompareChartModal({
  open, onClose, deviceId, portNum, ctrlIds = [], isHumTemp,
}) {
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState(null)
  const [hours, setHours] = useState(24)
  // dataByCtrl: { [ctrlId]: { temp: [{ts,value}], hum: [{ts,value}] } }  (isHumTemp)
  //           | { [ctrlId]: [{ts,value}] }                                (single)
  const [dataByCtrl, setDataByCtrl] = useState({})
  const isDark = useIsDark()

  useEffect(() => {
    if (open) setHours(24)
  }, [open, deviceId, portNum])

  const ctrlIdsKey = ctrlIds.join(',')

  useEffect(() => {
    if (!open || ctrlIds.length === 0) { setDataByCtrl({}); return }
    const ac = new AbortController()

    async function load() {
      setLoading(true)
      setErr(null)
      try {
        const mapRow = r => {
          const tsMs = r.server_ts ? new Date(r.server_ts).getTime() : null
          const v = r.value !== undefined ? Number(r.value) : null
          if (!tsMs || !Number.isFinite(tsMs) || v === null || !Number.isFinite(v)) return null
          return { ts: tsMs, value: v }
        }

        const results = {}
        await Promise.all(ctrlIds.map(async cid => {
          if (isHumTemp) {
            const [tData, hData] = await Promise.all([
              getHistory(deviceId, cid, portNum, hours, 0x01),
              getHistory(deviceId, cid, portNum, hours, 0x02),
            ])
            if (ac.signal.aborted) return
            results[cid] = {
              temp: (tData || []).map(mapRow).filter(Boolean).sort((a, b) => a.ts - b.ts),
              hum:  (hData || []).map(mapRow).filter(Boolean).sort((a, b) => a.ts - b.ts),
            }
          } else {
            const data = await getHistory(deviceId, cid, portNum, hours)
            if (ac.signal.aborted) return
            results[cid] = (data || []).map(mapRow).filter(Boolean).sort((a, b) => a.ts - b.ts)
          }
        }))
        if (!ac.signal.aborted) setDataByCtrl(results)
      } catch (e) {
        if (!ac.signal.aborted) setErr(e.message || String(e))
      } finally {
        if (!ac.signal.aborted) setLoading(false)
      }
    }
    load()
    return () => ac.abort()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, deviceId, portNum, ctrlIdsKey, isHumTemp, hours])

  // ── Shared Y bounds (same scale across all controllers) ────────────────────
  const { tempBounds, humBounds, singleBounds } = useMemo(() => {
    if (isHumTemp) {
      const allTemp = ctrlIds.flatMap(cid => (dataByCtrl[cid]?.temp || []).map(r => r.value))
      const allHum  = ctrlIds.flatMap(cid => (dataByCtrl[cid]?.hum  || []).map(r => r.value))
      return { tempBounds: sharedBounds(allTemp), humBounds: sharedBounds(allHum), singleBounds: null }
    }
    const all = ctrlIds.flatMap(cid => (Array.isArray(dataByCtrl[cid]) ? dataByCtrl[cid] : []).map(r => r.value))
    return { tempBounds: null, humBounds: null, singleBounds: sharedBounds(all) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataByCtrl, ctrlIdsKey, isHumTemp])

  function makeDatasets(getRows) {
    return {
      datasets: ctrlIds.map((cid, i) => ({
        label: `Ctrl ${cid}`,
        data: getRows(cid).map(r => ({ x: r.ts, y: r.value })),
        borderColor: CTRL_COLORS[i % CTRL_COLORS.length],
        backgroundColor: 'transparent',
        pointRadius: 0,
        borderWidth: 1.5,
        tension: hours >= 168 ? 0.4 : 0.25,
        spanGaps: true,
        fill: false,
      })),
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[1000] bg-black/50 flex items-center justify-center p-2 sm:p-4">
      <div className="w-full max-w-3xl rounded-2xl border border-black/10 bg-white dark:bg-slate-900 dark:border-white/10 shadow-xl flex flex-col max-h-[calc(100dvh-16px)] sm:max-h-[calc(100dvh-32px)]">

        {/* Header */}
        <div className="px-4 py-3 border-b border-black/10 dark:border-white/10 flex items-center justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <div className="text-sm font-medium text-slate-900 dark:text-white truncate">
              Compare — Port {portNum} · {ctrlIds.map(c => `Ctrl ${c}`).join(' vs ')}
            </div>
            <div className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">
              Shared Y-axis scale across all controllers
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="inline-flex rounded-md border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 p-0.5 gap-0.5">
              {RANGE_OPTIONS.map(opt => (
                <button
                  key={opt.label}
                  onClick={() => setHours(opt.hours)}
                  className={`px-2 py-1 text-xs rounded cursor-pointer transition-colors ${
                    hours === opt.hours
                      ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                      : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
                  }`}
                >{opt.label}</button>
              ))}
            </div>
            <button onClick={onClose} className="p-1 rounded-md hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer" aria-label="Close">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-4 flex-1 min-h-0 overflow-y-auto flex flex-col gap-5">
          {loading && <div className="text-center text-sm text-gray-400">Loading…</div>}
          {err && !loading && <div className="text-center text-sm text-red-500">{err}</div>}

          {!loading && !err && isHumTemp && (
            <>
              {/* Temperature chart */}
              <div>
                <div className="text-xs font-semibold text-orange-500 mb-2">
                  Temperature (°C)
                  {tempBounds && (
                    <span className="ml-2 text-gray-400 dark:text-gray-500 font-normal">
                      Y: {tempBounds.min} – {tempBounds.max}°C
                    </span>
                  )}
                </div>
                <div className="h-[200px] sm:h-[230px]">
                  <Line
                    data={makeDatasets(cid => dataByCtrl[cid]?.temp || [])}
                    options={makeChartOpts(tempBounds, v => `${Number(v).toFixed(1)}°C`, isDark, hours)}
                  />
                </div>
              </div>
              {/* Humidity chart */}
              <div>
                <div className="text-xs font-semibold text-indigo-500 mb-2">
                  Humidity (%RH)
                  {humBounds && (
                    <span className="ml-2 text-gray-400 dark:text-gray-500 font-normal">
                      Y: {humBounds.min} – {humBounds.max}%
                    </span>
                  )}
                </div>
                <div className="h-[200px] sm:h-[230px]">
                  <Line
                    data={makeDatasets(cid => dataByCtrl[cid]?.hum || [])}
                    options={makeChartOpts(humBounds, v => `${Number(v).toFixed(0)}%`, isDark, hours)}
                  />
                </div>
              </div>
            </>
          )}

          {!loading && !err && !isHumTemp && (
            <div className="h-[380px]">
              <Line
                data={makeDatasets(cid => Array.isArray(dataByCtrl[cid]) ? dataByCtrl[cid] : [])}
                options={makeChartOpts(singleBounds, v => parseFloat(Number(v).toFixed(2)).toString(), isDark, hours)}
              />
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
