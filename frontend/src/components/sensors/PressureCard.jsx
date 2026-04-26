import { Gauge } from 'lucide-react'

export default function PressureCard({ portNum, reading, status, onChartClick }) {
  const value = reading?.value != null ? Number(reading.value) : null
  const display = value !== null ? value.toFixed(2) : '--'

  const statusColorMap = { online: 'bg-green-500', stale: 'bg-yellow-400', offline: 'bg-red-500' }
  const statusColor = statusColorMap[status] || 'bg-slate-400 dark:bg-gray-600'

  return (
    <div
      role="button"
      onClick={onChartClick}
      className="rounded-xl border border-yellow-400/20 bg-yellow-400/10 p-4 hover:border-yellow-400/40 transition-all cursor-pointer h-full flex flex-col"
    >
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-yellow-400/10 border border-yellow-400/20 p-2 shrink-0">
          <Gauge className="w-5 h-5 text-yellow-400" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-slate-900 dark:text-white text-sm">Pressure</p>
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-gray-300">
            Port {portNum}
          </span>
        </div>
        <span className={`w-2 h-2 rounded-full shrink-0 ${statusColor}`} title={status || 'unknown'} />
      </div>

      <div className="rounded-xl bg-slate-100/80 dark:bg-black/20 border border-slate-200 dark:border-white/10 p-3 mt-3 flex-1 flex flex-col justify-center">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] text-slate-500 dark:text-gray-400 font-medium">Current Value</span>
          <div className="text-right">
            <p className={`text-xl font-mono tabular-nums leading-none ${value !== null ? 'text-slate-900 dark:text-white' : 'text-slate-400 dark:text-gray-600'}`}>
              {display}
            </p>
            {value !== null && <p className="text-[11px] text-slate-400 dark:text-gray-500 mt-1">hPa</p>}
          </div>
        </div>
      </div>
    </div>
  )
}
