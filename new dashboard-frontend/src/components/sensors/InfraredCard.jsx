import { AlertTriangle } from 'lucide-react'

export default function InfraredCard({ portNum, reading, status, onChartClick }) {
  const raw = reading?.value
  const motion = raw === 1 || raw === true || String(raw) === '1'

  const statusColorMap = { online: 'bg-green-500', stale: 'bg-yellow-400', offline: 'bg-red-500' }
  const statusColor = statusColorMap[status] || 'bg-slate-400 dark:bg-gray-600'

  return (
    <div
      role="button"
      onClick={onChartClick}
      className={`rounded-xl border p-4 transition-all cursor-pointer h-full flex flex-col ${
        motion
          ? 'border-red-500/40 bg-red-500/10 hover:border-red-500/60'
          : 'border-purple-500/20 bg-purple-500/10 hover:border-purple-500/40'
      }`}
    >
      <div className="flex items-center gap-3">
        <div className={`rounded-lg border p-2 shrink-0 ${motion ? 'bg-red-500/10 border-red-400/30' : 'bg-purple-500/10 border-purple-400/20'}`}>
          <AlertTriangle className={`w-5 h-5 ${motion ? 'text-red-500 animate-pulse' : 'text-purple-500'}`} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-slate-900 dark:text-white text-sm">Infrared</p>
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-gray-300">
            Port {portNum}
          </span>
        </div>
        <span className={`w-2 h-2 rounded-full shrink-0 ${statusColor}`} title={status || 'unknown'} />
      </div>

      <div className={`rounded-xl border p-4 flex items-center gap-4 transition-colors mt-3 flex-1 ${
        motion ? 'bg-red-500/10 border-red-400/30' : 'bg-slate-100/80 dark:bg-black/20 border-slate-200 dark:border-white/10'
      }`}>
        <div className="relative flex-shrink-0">
          <div className={`w-4 h-4 rounded-full ${motion ? 'bg-red-500' : 'bg-slate-300 dark:bg-slate-600'}`} />
          {motion && <div className="absolute inset-0 w-4 h-4 rounded-full bg-red-500 animate-ping opacity-60" />}
        </div>
        <div>
          <p className={`text-base font-bold ${motion ? 'text-red-600 dark:text-red-400' : 'text-slate-500 dark:text-gray-400'}`}>
            {raw === undefined || raw === null ? 'No Data' : motion ? 'Motion Detected' : 'Clear'}
          </p>
          <p className="text-[11px] text-slate-400 dark:text-gray-500 mt-0.5">
            {motion ? 'Motion detected' : 'No motion'}
          </p>
        </div>
      </div>
    </div>
  )
}
