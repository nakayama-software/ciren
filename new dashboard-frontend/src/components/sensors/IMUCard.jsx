import { Move3d } from 'lucide-react'
import { buildIMUFromLatest } from '../../utils/sensors'

function fmt(v, d = 1) {
  return (typeof v === 'number' && !Number.isNaN(v)) ? v.toFixed(d) : '--'
}

function AngleRow({ label, value, color }) {
  const pct = Math.min(100, Math.max(0, ((value + 180) / 360) * 100))
  return (
    <div className="flex items-center gap-2">
      <span className={`text-[10px] w-8 shrink-0 font-medium ${color}`}>{label}</span>
      <div className="relative flex-1 h-1.5 rounded-full bg-black/20 dark:bg-white/10 overflow-hidden">
        <div className="absolute left-1/2 top-0 bottom-0 w-px bg-white/20" />
        <div
          className={`absolute top-0 bottom-0 w-1.5 rounded-full ${color.replace('text-', 'bg-')}`}
          style={{ left: `calc(${pct}% - 3px)` }}
        />
      </div>
      <span className="text-[11px] font-mono w-14 text-right text-slate-700 dark:text-slate-200 tabular-nums">
        {fmt(value)}°
      </span>
    </div>
  )
}

export default function IMUCard({ ctrlId, portNum, latestData }) {
  const imu = buildIMUFromLatest(ctrlId, portNum, latestData)

  if (!imu) {
    return (
      <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 p-4">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-violet-500/10 border border-violet-400/20 p-2">
            <Move3d className="w-5 h-5 text-violet-500 dark:text-violet-300" />
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-slate-900 dark:text-white">IMU</p>
            <p className="text-xs text-slate-500 dark:text-gray-400">Port {portNum}</p>
            <p className="text-[11px] text-slate-400 dark:text-gray-500 mt-1">Waiting for IMU data…</p>
          </div>
        </div>
      </div>
    )
  }

  const { euler } = imu
  const hasEuler = euler?.pitch !== null || euler?.roll !== null || euler?.yaw !== null

  return (
    <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 p-4 h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-violet-500/10 border border-violet-400/20 p-2">
          <Move3d className="w-5 h-5 text-violet-500 dark:text-violet-300" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="font-semibold text-slate-900 dark:text-white">IMU</p>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-gray-300">
              Port {portNum}
            </span>
          </div>
          <p className="text-[11px] text-slate-500 dark:text-gray-400 mt-0.5">
            {hasEuler ? 'Pitch · Roll · Yaw' : 'Accel · Gyro'}
          </p>
        </div>
      </div>

      {/* Euler angle bars */}
      {hasEuler ? (
        <div className="rounded-xl bg-slate-100/80 dark:bg-black/20 border border-slate-200 dark:border-white/10 p-3 space-y-2 mt-3 flex-1">
          <AngleRow label="P" value={euler.pitch ?? 0} color="text-cyan-500" />
          <AngleRow label="R" value={euler.roll  ?? 0} color="text-violet-500" />
          <AngleRow label="Y" value={euler.yaw   ?? 0} color="text-emerald-500" />
        </div>
      ) : (
        /* Fallback: show whichever of accel/gyro is available */
        <div className="rounded-xl bg-slate-100/80 dark:bg-black/20 border border-slate-200 dark:border-white/10 p-3 space-y-2 mt-3 flex-1">
          {(imu.accelerometer?.x !== null || imu.accelerometer?.y !== null || imu.accelerometer?.z !== null) && (
            <div>
              <p className="text-[10px] text-slate-400 dark:text-gray-500 mb-1">Accel (m/s²)</p>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { k: 'X', v: imu.accelerometer?.x },
                  { k: 'Y', v: imu.accelerometer?.y },
                  { k: 'Z', v: imu.accelerometer?.z },
                ].map((a) => (
                  <div key={`a${a.k}`} className="rounded-lg bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 px-2 py-2">
                    <p className="text-[10px] text-slate-400 dark:text-gray-400">a{a.k}</p>
                    <p className="mt-0.5 text-sm font-mono text-slate-900 dark:text-white tabular-nums">
                      {typeof a.v === 'number' ? a.v.toFixed(3) : '--'}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
          {(imu.gyroscope?.x !== null || imu.gyroscope?.y !== null || imu.gyroscope?.z !== null) && (
            <div>
              <p className="text-[10px] text-slate-400 dark:text-gray-500 mb-1">Gyro (rad/s)</p>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { k: 'X', v: imu.gyroscope?.x },
                  { k: 'Y', v: imu.gyroscope?.y },
                  { k: 'Z', v: imu.gyroscope?.z },
                ].map((a) => (
                  <div key={`g${a.k}`} className="rounded-lg bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 px-2 py-2">
                    <p className="text-[10px] text-slate-400 dark:text-gray-400">g{a.k}</p>
                    <p className="mt-0.5 text-sm font-mono text-slate-900 dark:text-white tabular-nums">
                      {typeof a.v === 'number' ? a.v.toFixed(4) : '--'}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
