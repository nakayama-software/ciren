import { RadioTower } from 'lucide-react'

const MAX_DISTANCE = 300

export default function UltrasonicCard({ portNum, reading, status, onChartClick }) {
  const value = reading?.value != null ? Number(reading.value) : null
  const display = value !== null ? value.toFixed(1) : '--'
  const pct = value !== null ? Math.min(100, Math.max(0, (value / MAX_DISTANCE) * 100)) : 0

  const statusColorMap = { online: 'bg-green-500', stale: 'bg-yellow-400', offline: 'bg-red-500' }
  const statusColor = statusColorMap[status] || 'bg-slate-400 dark:bg-gray-600'

  return (
    <div
      role="button"
      onClick={onChartClick}
      className="rounded-xl border border-teal-500/20 bg-teal-500/10 p-4 hover:border-teal-500/40 transition-all cursor-pointer h-full flex flex-col"
    >
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-teal-500/10 border border-teal-500/20 p-2 shrink-0">
          <RadioTower className="w-5 h-5 text-teal-600 dark:text-teal-300" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-slate-900 dark:text-white text-sm">Ultrasonic</p>
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-gray-300">
            Port {portNum}
          </span>
        </div>
        <span className={`w-2 h-2 rounded-full shrink-0 ${statusColor}`} title={status || 'unknown'} />
      </div>

      <div className="rounded-xl bg-slate-100/80 dark:bg-black/20 border border-slate-200 dark:border-white/10 p-3 mt-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] text-slate-500 dark:text-gray-400 font-medium">Distance</span>
          <div className="text-right">
            <p className={`text-xl font-mono tabular-nums leading-none ${value !== null ? 'text-slate-900 dark:text-white' : 'text-slate-400 dark:text-gray-600'}`}>
              {display}
            </p>
            {value !== null && <p className="text-[11px] text-slate-400 dark:text-gray-500 mt-1">cm</p>}
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
          <div className="bg-teal-500 dark:bg-teal-400 h-2 rounded-full transition-[width] duration-300" style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400 dark:text-gray-500 font-mono tabular-nums">
          <span>0</span>
          <span>{MAX_DISTANCE} cm</span>
        </div>
      </div>
    </div>
  )
}
