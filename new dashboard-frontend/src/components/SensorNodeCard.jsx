import { getSensorInfo, formatValue, isIMUSensor } from '../utils/sensors'
import IMUCard from './sensors/IMUCard'
import HumTempCard from './sensors/HumTempCard'

function timeAgo(ts) {
  if (!ts) return null
  const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000)
  if (diff < 5) return 'Just now'
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  return `${Math.floor(diff / 3600)}h ago`
}

export default function SensorNodeCard({
  ctrlId,
  portNum,
  sensorType,
  reading,
  status,
  now,
  latestData,
  isHumTemp,
  onChartClick,
  onIMU3DClick,
}) {
  const nowMs = now || Date.now()

  // IMU sensor: render aggregated IMU card
  if (isIMUSensor(sensorType) && latestData) {
    return (
      <div
        role="button"
        onClick={onIMU3DClick}
        className="rounded-xl border border-violet-500/20 bg-violet-500/10 p-4 hover:border-violet-500/40 transition-all cursor-pointer"
      >
        <IMUCard ctrlId={ctrlId} portNum={portNum} latestData={latestData} />
        <div className="mt-3 pt-3 border-t border-black/10 dark:border-white/10">
          <p className="text-[10px] text-center text-violet-600 dark:text-violet-400">Click to open 3D view</p>
        </div>
      </div>
    )
  }

  // HumTemp combined card: port dengan temperature (0x01) sekaligus humidity (0x02)
  if (Number(sensorType) === 0x01 && isHumTemp) {
    return (
      <HumTempCard
        ctrlId={ctrlId}
        portNum={portNum}
        latestData={latestData}
        status={status}
        now={nowMs}
        onChartClick={onChartClick}
      />
    )
  }

  const info = getSensorInfo(sensorType)
  const Icon = info.icon
  const colors = info.colors

  const hasReading = reading !== null && reading !== undefined && reading.value !== undefined
  const displayValue = hasReading ? formatValue(reading.value) : '--'
  const lastTs = reading?.server_ts ?? reading?.device_ts ?? null

  let resolvedStatus = status
  if (!resolvedStatus && hasReading && lastTs) {
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
      className={`rounded-xl border ${colors.border} ${colors.bg} p-4 hover:border-opacity-60 transition-all cursor-pointer`}
    >
      {/* Header */}
      <div className="flex items-center gap-3 mb-3">
        <div className={`rounded-lg ${colors.bg} border ${colors.border} p-2 shrink-0`}>
          <Icon className={`w-5 h-5 ${colors.icon}`} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-slate-900 dark:text-white text-sm truncate">{info.label}</p>
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-gray-300">
            Port {portNum}
          </span>
        </div>
        <span className={`ml-auto w-2 h-2 rounded-full shrink-0 ${statusColor}`} title={resolvedStatus || 'unknown'} />
      </div>

      {/* Value */}
      <div className="rounded-xl bg-slate-100/80 dark:bg-black/20 border border-slate-200 dark:border-white/10 p-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] text-slate-500 dark:text-gray-400 font-medium">Current Value</span>
          <div className="text-right">
            <p className={`text-xl font-mono tabular-nums leading-none ${hasReading ? 'text-slate-900 dark:text-white' : 'text-slate-400 dark:text-gray-600'}`}>
              {displayValue}
            </p>
            {hasReading && (
              <p className="text-[11px] text-slate-400 dark:text-gray-500 mt-1">{info.unit}</p>
            )}
          </div>
        </div>
      </div>

      {ago && (
        <p className="text-[10px] text-slate-400 dark:text-gray-500 mt-2 text-right">{ago}</p>
      )}
    </div>
  )
}
