import { Wifi, Signal, MapPin, Cpu, Clock } from 'lucide-react'

function timeAgo(ts, now) {
  if (!ts) return 'Never'
  const diff = Math.floor((now - new Date(ts).getTime()) / 1000)
  if (diff < 5) return 'Just now'
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

function InfoRow({ icon: Icon, label, children }) {
  return (
    <div className="rounded-xl border border-black/10 bg-white/70 p-3 backdrop-blur-sm dark:border-white/10 dark:bg-slate-800/60 flex items-center justify-between gap-3">
      <span className="text-gray-600 dark:text-gray-400 flex items-center gap-2 text-sm shrink-0">
        <Icon size={14} />
        {label}
      </span>
      <div className="text-right text-sm font-medium text-slate-900 dark:text-white">
        {children}
      </div>
    </div>
  )
}

export default function DeviceStatusCard({ device, now }) {
  if (!device) return null

  const isOnline = device.status === 'online'
  const hasGpsFix = device.gps_fix === true || device.gps_fix === 1
  const nowMs = now || Date.now()

  return (
    <div className="rounded-2xl border border-black/10 bg-white/80 p-4 backdrop-blur-sm dark:border-white/10 dark:bg-slate-800/60 shadow-sm">
      {/* Card header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-gray-300">Main Module Status</h3>
        <span
          className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full
            ${isOnline
              ? 'bg-green-500/10 text-green-700 dark:text-green-400'
              : 'bg-red-500/10 text-red-700 dark:text-red-400'
            }`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-green-500' : 'bg-red-500'}`} />
          {isOnline ? 'ONLINE' : 'OFFLINE'}
        </span>
      </div>

      <div className="space-y-2">
        <InfoRow icon={Wifi} label="Connection">
          {device.conn_mode ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-cyan-500/10 text-cyan-700 dark:text-cyan-400 border border-cyan-500/20">
              {device.conn_mode}
            </span>
          ) : (
            <span className="text-slate-400 dark:text-gray-500">—</span>
          )}
        </InfoRow>

        <InfoRow icon={MapPin} label="GPS">
          {hasGpsFix && device.gps_lat != null && device.gps_lon != null ? (
            <span className="font-mono text-xs">
              {Number(device.gps_lat).toFixed(6)}, {Number(device.gps_lon).toFixed(6)}
            </span>
          ) : (
            <span className="text-slate-400 dark:text-gray-500 text-xs">No GPS fix</span>
          )}
        </InfoRow>

        <InfoRow icon={Signal} label="RSSI">
          {device.rssi != null ? (
            <span className="font-mono text-xs">{device.rssi} dBm</span>
          ) : (
            <span className="text-slate-400 dark:text-gray-500">—</span>
          )}
        </InfoRow>

        <InfoRow icon={Cpu} label="Firmware">
          <span className="font-mono text-xs">{device.fw_version || '—'}</span>
        </InfoRow>

        <InfoRow icon={Clock} label="Last Seen">
          <span className="text-xs">{timeAgo(device.last_seen, nowMs)}</span>
        </InfoRow>
      </div>
    </div>
  )
}
