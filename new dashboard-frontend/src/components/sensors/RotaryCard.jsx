import { RotateCw } from 'lucide-react'

export default function RotaryCard({ portNum, reading, status, onChartClick }) {
  // value: positive = CW steps accumulated, negative = CCW
  const value = reading?.value != null ? Number(reading.value) : null
  const steps = value !== null ? Math.abs(value).toFixed(0) : '--'
  const direction = value === null ? '—' : value > 0 ? 'CW' : value < 0 ? 'CCW' : 'Idle'
  const dirColor = direction === 'CW' ? 'text-green-600 dark:text-green-400' : direction === 'CCW' ? 'text-red-500 dark:text-red-400' : 'text-slate-400'

  const statusColorMap = { online: 'bg-green-500', stale: 'bg-yellow-400', offline: 'bg-red-500' }
  const statusColor = statusColorMap[status] || 'bg-slate-400 dark:bg-gray-600'

  return (
    <div
      role="button"
      onClick={onChartClick}
      className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 hover:border-amber-500/40 transition-all cursor-pointer h-full flex flex-col"
    >
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-2 shrink-0">
          <RotateCw className="w-5 h-5 text-amber-500 dark:text-amber-300" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-slate-900 dark:text-white text-sm">Rotary Sensor</p>
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-gray-300">
            Port {portNum}
          </span>
        </div>
        <span className={`w-2 h-2 rounded-full shrink-0 ${statusColor}`} title={status || 'unknown'} />
      </div>

      <div className="grid grid-cols-2 gap-3 mt-3 flex-1 content-start">
        <div className="rounded-xl bg-slate-100/80 dark:bg-black/20 border border-slate-200 dark:border-white/10 p-3">
          <p className="text-[11px] text-slate-500 dark:text-gray-400 font-medium mb-1">Steps</p>
          <p className={`text-lg font-mono tabular-nums leading-none ${value !== null ? 'text-slate-900 dark:text-white' : 'text-slate-400 dark:text-gray-600'}`}>
            {steps}
          </p>
        </div>
        <div className="rounded-xl bg-slate-100/80 dark:bg-black/20 border border-slate-200 dark:border-white/10 p-3">
          <p className="text-[11px] text-slate-500 dark:text-gray-400 font-medium mb-1">Direction</p>
          <p className={`text-lg font-mono tabular-nums leading-none font-semibold ${dirColor}`}>
            {direction}
          </p>
        </div>
      </div>
    </div>
  )
}
