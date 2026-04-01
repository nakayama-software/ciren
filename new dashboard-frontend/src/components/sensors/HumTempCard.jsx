import { Thermometer, Droplets } from 'lucide-react'
import { getReadingKey, formatValue } from '../../utils/sensors'

function timeAgo(ts) {
  if (!ts) return null
  const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000)
  if (diff < 5) return 'Just now'
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  return `${Math.floor(diff / 3600)}h ago`
}

// Gabungan temperature (0x01) + humidity (0x02) dari port yang sama
export default function HumTempCard({ ctrlId, portNum, latestData, status, now, onChartClick }) {
  const tempKey = getReadingKey(ctrlId, portNum, 0x01)
  const humKey  = getReadingKey(ctrlId, portNum, 0x02)
  const tempR   = latestData?.[tempKey] || null
  const humR    = latestData?.[humKey]  || null

  const tempVal  = tempR?.value !== undefined ? formatValue(tempR.value) : '--'
  const humVal   = humR?.value  !== undefined ? formatValue(humR.value)  : '--'

  const nowMs    = now || Date.now()
  const lastTs   = (tempR?.server_ts && humR?.server_ts)
    ? (new Date(tempR.server_ts) > new Date(humR.server_ts) ? tempR.server_ts : humR.server_ts)
    : (tempR?.server_ts || humR?.server_ts || null)

  let resolvedStatus = status
  if (!resolvedStatus && lastTs) {
    resolvedStatus = (nowMs - new Date(lastTs).getTime()) < 30000 ? 'online' : 'stale'
  }

  const statusColorMap = {
    online:  'bg-green-500',
    stale:   'bg-yellow-400',
    offline: 'bg-red-500',
  }
  const statusColor = statusColorMap[resolvedStatus] || 'bg-slate-400 dark:bg-gray-600'
  const ago = lastTs ? timeAgo(lastTs) : null

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

      {/* Values */}
      <div className="rounded-xl bg-slate-100/80 dark:bg-black/20 border border-slate-200 dark:border-white/10 p-3 grid grid-cols-2 gap-3 mt-3 flex-1">
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
            <Droplets className="w-3.5 h-3.5 text-blue-500" />
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

      {ago && (
        <p className="text-[10px] text-slate-400 dark:text-gray-500 mt-2 text-right">{ago}</p>
      )}
    </div>
  )
}
