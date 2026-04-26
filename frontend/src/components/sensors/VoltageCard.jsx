import { Zap } from 'lucide-react'

const MAX_VOLTAGE = 5

export default function VoltageCard({ portNum, reading, status, onChartClick }) {
  const value = reading?.value != null ? Number(reading.value) : null
  const display = value !== null ? value.toFixed(3) : '--'
  const pct = value !== null ? Math.min(100, Math.max(0, (value / MAX_VOLTAGE) * 100)) : 0
  const barColor = pct > 80 ? 'bg-red-400' : pct > 50 ? 'bg-yellow-400' : 'bg-yellow-500'

  const statusColorMap = { online: 'bg-green-500', stale: 'bg-yellow-400', offline: 'bg-red-500' }
  const statusColor = statusColorMap[status] || 'bg-slate-400 dark:bg-gray-600'

  return (
    <div
      role="button"
      onClick={onChartClick}
      className="rounded-xl border border-yellow-500/20 bg-yellow-500/10 p-4 hover:border-yellow-500/40 transition-all cursor-pointer h-full flex flex-col"
    >
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-yellow-500/10 border border-yellow-500/20 p-2 shrink-0">
          <Zap className="w-5 h-5 text-yellow-500 dark:text-yellow-300" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-slate-900 dark:text-white text-sm">Voltage</p>
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-gray-300">
            Port {portNum}
          </span>
        </div>
        <span className={`w-2 h-2 rounded-full shrink-0 ${statusColor}`} title={status || 'unknown'} />
      </div>

      <div className="rounded-xl bg-slate-100/80 dark:bg-black/20 border border-slate-200 dark:border-white/10 p-3 mt-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] text-slate-500 dark:text-gray-400 font-medium">Current Value</span>
          <div className="text-right">
            <p className={`text-xl font-mono tabular-nums leading-none ${value !== null ? 'text-slate-900 dark:text-white' : 'text-slate-400 dark:text-gray-600'}`}>
              {display}
            </p>
            {value !== null && <p className="text-[11px] text-slate-400 dark:text-gray-500 mt-1">V</p>}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-slate-100/80 dark:bg-black/20 p-3 mt-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] text-slate-500 dark:text-gray-400 font-medium">Level</span>
          <span className="text-[11px] text-slate-700 dark:text-gray-300 font-mono tabular-nums">
            {value !== null ? `${pct.toFixed(0)}%` : '--'}
          </span>
        </div>
        <div className="w-full bg-slate-200 dark:bg-white/10 rounded-full h-2 overflow-hidden">
          <div className={`${barColor} h-2 rounded-full transition-[width] duration-300`} style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400 dark:text-gray-500 font-mono tabular-nums">
          <span>0</span>
          <span>{MAX_VOLTAGE} V</span>
        </div>
      </div>
    </div>
  )
}
