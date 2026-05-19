import { useState, useEffect } from 'react'
import { X, Timer, CheckCircle, AlertTriangle, Wifi, WifiOff } from 'lucide-react'
import { setNodeConfig } from '../lib/api'

export default function NodeIntervalModal({ open, onClose, deviceId, ctrlId, portNum, currentIntervalMs, t }) {
  const tr = t?.nodeInterval || {}
  const [value, setValue]       = useState('')
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState(null)
  const [saveResult, setSaveResult] = useState(null)  // { delivered, warning? }

  useEffect(() => {
    if (!open) return
    setValue(currentIntervalMs != null ? String(currentIntervalMs) : '')
    setError(null)
    setSaving(false)
    setSaveResult(null)
  }, [open, currentIntervalMs])

  async function handleSave() {
    const ms = Number(value)
    if (!ms || ms < 100) {
      setError(tr.hint || 'Min 100 ms.')
      return
    }
    setSaving(true)
    setError(null)
    setSaveResult(null)
    try {
      const result = await setNodeConfig(deviceId, Number(ctrlId), Number(portNum), ms)
      setSaveResult(result)
      onClose(ms, result)
    } catch (e) {
      setError(e.message || tr.error || 'Failed to save')
      setSaving(false)
    }
  }

  if (!open) return null

  const formatMs = (v) => v >= 1000 ? `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}s` : `${v}ms`

  return (
    <div className="fixed inset-0 z-[1100] bg-black/50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-2xl border border-black/10 bg-white dark:bg-slate-900 dark:border-white/10 shadow-xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-black/10 dark:border-white/10">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-900 dark:text-white">
            <Timer className="w-4 h-4 text-cyan-500" />
            <span>{tr.title || 'Upload Interval'} — Ctrl {ctrlId} / Port {portNum}</span>
          </div>
          <button onClick={() => onClose()} className="p-1 rounded-md hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {tr.description || 'How often this sensor node uploads data to the server.'}
          </p>

          {currentIntervalMs != null && (
            <p className="text-xs text-cyan-600 dark:text-cyan-400">
              {tr.current ? tr.current(currentIntervalMs) : `Current: ${formatMs(currentIntervalMs)}`}
            </p>
          )}

          <div>
            <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">
              {tr.intervalMs || 'Interval (ms)'}
            </label>
            <input
              type="number"
              min="100"
              step="100"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSave()}
              placeholder={tr.placeholder || 'e.g. 5000'}
              className="w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm text-slate-900 placeholder-gray-400 outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 dark:border-white/10 dark:bg-slate-800 dark:text-white dark:placeholder-gray-500"
            />
          </div>

          <p className="text-[11px] text-gray-400 dark:text-gray-600">
            {tr.hint || 'Min 100 ms. Sensor controller applies this on next sync.'}
          </p>

          {error && (
            <p className="text-xs text-red-500">{error}</p>
          )}

          {saveResult && (
            <div className={`flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs ${
              saveResult.delivered
                ? 'bg-green-500/10 text-green-700 dark:text-green-400'
                : 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
            }`}>
              {saveResult.delivered ? (
                <><Wifi className="w-3 h-3" /> {tr.delivered || 'Config sent to device'}</>
              ) : (
                <><WifiOff className="w-3 h-3" /> {tr.queued || 'Saved — will apply when device reconnects'}</>
              )}
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-black/10 dark:border-white/10 flex justify-end gap-2">
          <button
            onClick={() => onClose()}
            className="rounded-lg border border-black/10 px-3 py-2 text-xs text-slate-700 hover:bg-slate-100 dark:border-white/10 dark:text-slate-300 dark:hover:bg-slate-800 cursor-pointer"
          >
            {tr.cancel || 'Cancel'}
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg bg-cyan-600 px-4 py-2 text-xs font-medium text-white hover:bg-cyan-700 disabled:opacity-60 cursor-pointer"
          >
            {saving ? (tr.saving || 'Saving...') : (tr.save || 'Save')}
          </button>
        </div>
      </div>
    </div>
  )
}