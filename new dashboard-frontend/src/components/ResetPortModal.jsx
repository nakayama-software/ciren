import { useState, useEffect } from 'react'
import { X, AlertTriangle, Trash2, Clock, Activity } from 'lucide-react'
import { apiFetch } from '../lib/api'

export default function ResetPortModal({
  open,
  onClose,
  deviceId,
  ctrlId,
  portNum,
  sensorType,
  onSuccess,
}) {
  const [loading, setLoading] = useState(true)
  const [info, setInfo] = useState(null)
  const [resetting, setResetting] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (open) fetchPortInfo()
  }, [open, deviceId, ctrlId, portNum, sensorType])

  async function fetchPortInfo() {
    try {
      setLoading(true)
      setError(null)
      setInfo(null)

      if (!deviceId || ctrlId == null || portNum == null || sensorType == null) {
        setError('Missing deviceId, ctrlId, portNum, or sensorType')
        return
      }

      // Fetch all readings for this port to get count and date range
      const params = new URLSearchParams({
        ctrl_id: String(ctrlId),
        port_num: String(portNum),
        sensor_type: String(sensorType),
        limit: '1000',
      })

      const data = await apiFetch(`/api/devices/${deviceId}/data?${params}`)
      const items = Array.isArray(data) ? data : []

      if (items.length === 0) {
        setError('No active sensor data on this port')
        return
      }

      const timestamps = items.map(r => new Date(r.server_ts).getTime()).filter(Boolean)
      const newest = timestamps.length ? new Date(Math.max(...timestamps)) : null
      const oldest = timestamps.length ? new Date(Math.min(...timestamps)) : null
      const durationMs = newest && oldest ? newest.getTime() - oldest.getTime() : null

      setInfo({
        total_readings: items.length,
        started_at: oldest?.toISOString() ?? null,
        duration_hours: durationMs !== null ? durationMs / (1000 * 60 * 60) : null,
      })
    } catch (err) {
      setError(err.message || 'Failed to fetch port info')
    } finally {
      setLoading(false)
    }
  }

  async function handleConfirmReset() {
    try {
      setResetting(true)
      setError(null)

      const params = new URLSearchParams({
        ctrl_id: String(ctrlId),
        port_num: String(portNum),
        sensor_type: String(sensorType),
      })

      const data = await apiFetch(`/api/devices/${deviceId}/data?${params}`, { method: 'DELETE' })

      if (data.ok) {
        onSuccess?.({ deletedReadings: data.deleted ?? 0 })
        onClose()
      } else {
        setError(data.error || 'Reset failed')
      }
    } catch (err) {
      setError(err.message || 'Failed to reset port')
    } finally {
      setResetting(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="relative w-full max-w-lg mx-4 rounded-2xl border border-black/10 bg-white dark:border-white/10 dark:bg-slate-800 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-6 border-b border-black/10 dark:border-white/10">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-red-500/10">
              <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Reset Port</h2>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Controller {ctrlId} · Port {portNum}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 transition-colors">
            <X className="w-5 h-5 text-gray-600 dark:text-gray-400" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {loading && (
            <div className="text-center py-8">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-500" />
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-3">Loading port info...</p>
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-4">
              <p className="text-sm text-yellow-800 dark:text-yellow-200">{error}</p>
            </div>
          )}

          {!loading && !error && info && (
            <>
              <div className="rounded-lg border border-black/10 bg-slate-50 dark:border-white/10 dark:bg-slate-900/50 p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Current Sensor</span>
                  <span className="px-2 py-1 rounded-full bg-green-500/20 text-green-600 dark:text-green-400 text-xs font-medium">Active</span>
                </div>
                <div>
                  <span className="text-sm text-gray-600 dark:text-gray-400">Started: </span>
                  <span className="text-sm font-medium text-slate-900 dark:text-white">
                    {info.started_at ? new Date(info.started_at).toLocaleString() : '—'}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-black/10 bg-white dark:border-white/10 dark:bg-slate-800 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Activity className="w-4 h-4 text-cyan-500" />
                    <span className="text-xs text-gray-600 dark:text-gray-400">Readings</span>
                  </div>
                  <div className="text-2xl font-bold text-slate-900 dark:text-white">
                    {info.total_readings.toLocaleString()}
                  </div>
                </div>
                <div className="rounded-lg border border-black/10 bg-white dark:border-white/10 dark:bg-slate-800 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Clock className="w-4 h-4 text-indigo-500" />
                    <span className="text-xs text-gray-600 dark:text-gray-400">Duration</span>
                  </div>
                  <div className="text-2xl font-bold text-slate-900 dark:text-white">
                    {typeof info.duration_hours === 'number' ? `${info.duration_hours.toFixed(1)}h` : '—'}
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4">
                <div className="flex items-start gap-3">
                  <Trash2 className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <h4 className="text-sm font-medium text-red-900 dark:text-red-200 mb-1">Data Will Be Deleted</h4>
                    <p className="text-sm text-red-800 dark:text-red-300">
                      All <strong>{info.total_readings.toLocaleString()} readings</strong> from this sensor will be permanently deleted.
                    </p>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 p-6 border-t border-black/10 dark:border-white/10">
          <button onClick={onClose} disabled={resetting} className="px-4 py-2 rounded-lg border border-black/10 bg-white hover:bg-black/5 text-slate-900 dark:border-white/10 dark:bg-slate-800 dark:text-white dark:hover:bg-white/10 transition-colors disabled:opacity-50">
            Cancel
          </button>
          <button
            onClick={handleConfirmReset}
            disabled={resetting || loading || !!error || !info}
            className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {resetting ? (
              <>
                <div className="inline-block animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                <span>Resetting...</span>
              </>
            ) : (
              <>
                <Trash2 className="w-4 h-4" />
                <span>Delete & Reset</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
