import { Activity, Radio } from 'lucide-react'
import { getSensorInfo, formatValue } from '../../utils/sensors'

function VibrationCard({ portNum, reading, status, onChartClick }) {
  const isActive = reading?.value === 1 || reading?.value === true || String(reading?.value) === '1'

  const statusColorMap = { online: 'bg-green-500', stale: 'bg-yellow-400', offline: 'bg-red-500' }
  const statusColor = statusColorMap[status] || 'bg-slate-400 dark:bg-gray-600'

  return (
    <div
      role="button"
      onClick={onChartClick}
      className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 hover:border-red-500/40 transition-all cursor-pointer h-full flex flex-col"
    >
      <div className="flex items-center gap-3">
        <div className={`rounded-lg border p-2 shrink-0 transition-colors ${isActive ? 'bg-red-500/10 border-red-400/30' : 'bg-slate-200/60 dark:bg-white/5 border-slate-300 dark:border-white/10'}`}>
          <Radio className={`w-5 h-5 ${isActive ? 'text-red-500 dark:text-red-400' : 'text-slate-400 dark:text-gray-500'}`} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-slate-900 dark:text-white text-sm">Vibration</p>
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-gray-300">
            Port {portNum}
          </span>
        </div>
        <span className={`w-2 h-2 rounded-full shrink-0 ${statusColor}`} title={status || 'unknown'} />
      </div>

      <div className={`rounded-xl border p-4 flex items-center gap-4 transition-colors mt-3 flex-1 ${
        isActive ? 'bg-red-500/10 border-red-400/30' : 'bg-slate-100/80 dark:bg-black/20 border-slate-200 dark:border-white/10'
      }`}>
        <div className="relative flex-shrink-0">
          <div className={`w-4 h-4 rounded-full ${isActive ? 'bg-red-500' : 'bg-slate-300 dark:bg-slate-600'}`} />
          {isActive && <div className="absolute inset-0 w-4 h-4 rounded-full bg-red-500 animate-ping opacity-60" />}
        </div>
        <div>
          <p className={`text-base font-bold ${isActive ? 'text-red-600 dark:text-red-400' : 'text-slate-500 dark:text-gray-400'}`}>
            {isActive ? 'VIBRATING' : 'IDLE'}
          </p>
          <p className="text-[11px] text-slate-400 dark:text-gray-500 mt-0.5">
            {isActive ? 'Vibration detected' : 'No vibration detected'}
          </p>
        </div>
      </div>
    </div>
  )
}

export default function GenericCard({ portNum, sensorType, reading, status, onChartClick }) {
  if (Number(sensorType) === 0x14) {
    return <VibrationCard portNum={portNum} reading={reading} status={status} onChartClick={onChartClick} />
  }

  const info = getSensorInfo(sensorType)
  const Icon = info.icon
  const value = reading?.value != null ? formatValue(reading.value) : '--'

  const statusColorMap = { online: 'bg-green-500', stale: 'bg-yellow-400', offline: 'bg-red-500' }
  const statusColor = statusColorMap[status] || 'bg-slate-400 dark:bg-gray-600'

  return (
    <div
      role="button"
      onClick={onChartClick}
      className={`rounded-xl border ${info.colors.border} ${info.colors.bg} p-4 hover:border-opacity-60 transition-all cursor-pointer h-full flex flex-col`}
    >
      <div className="flex items-center gap-3">
        <div className={`rounded-lg ${info.colors.bg} border ${info.colors.border} p-2 shrink-0`}>
          <Icon className={`w-5 h-5 ${info.colors.icon}`} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-slate-900 dark:text-white text-sm">{info.label}</p>
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-gray-300">
            Port {portNum}
          </span>
        </div>
        <span className={`w-2 h-2 rounded-full shrink-0 ${statusColor}`} title={status || 'unknown'} />
      </div>

      <div className="rounded-xl bg-slate-100/80 dark:bg-black/20 border border-slate-200 dark:border-white/10 p-3 mt-3 flex-1 flex flex-col justify-center">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] text-slate-500 dark:text-gray-400 font-medium">Value</span>
          <div className="text-right">
            <p className={`text-xl font-mono tabular-nums leading-none ${reading?.value != null ? 'text-slate-900 dark:text-white' : 'text-slate-400 dark:text-gray-600'}`}>
              {value}
            </p>
            {reading?.value != null && info.unit && (
              <p className="text-[11px] text-slate-400 dark:text-gray-500 mt-1">{info.unit}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
