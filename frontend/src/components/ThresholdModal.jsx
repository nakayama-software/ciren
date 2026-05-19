import { useState, useEffect } from 'react'
import { X, AlertTriangle, Trash2 } from 'lucide-react'
import { getSensorInfo } from '../utils/sensors'
import { getThreshold, setThreshold, clearThreshold } from '../utils/thresholds'

export default function ThresholdModal({ open, onClose, deviceId, ctrlId, portNum, sensorType, t }) {
  const tr = t?.threshold || {}
  const [minVal, setMinVal] = useState('')
  const [maxVal, setMaxVal] = useState('')

  const info = getSensorInfo(Number(sensorType))

  useEffect(() => {
    if (!open) return
    const th = getThreshold(deviceId, ctrlId, portNum, sensorType)
    setMinVal(th.min != null ? String(th.min) : '')
    setMaxVal(th.max != null ? String(th.max) : '')
  }, [open, deviceId, ctrlId, portNum, sensorType])

  function handleSave() {
    setThreshold(deviceId, ctrlId, portNum, sensorType, { min: minVal, max: maxVal })
    onClose()
  }

  function handleClear() {
    clearThreshold(deviceId, ctrlId, portNum, sensorType)
    setMinVal('')
    setMaxVal('')
    onClose()
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[1100] bg-black/50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-2xl border border-black/10 bg-white dark:bg-slate-900 dark:border-white/10 shadow-xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-black/10 dark:border-white/10">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-900 dark:text-white">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            <span>{tr.title || 'Threshold'} — {info.label}</span>
          </div>
          <button onClick={onClose} className="p-1 rounded-md hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {tr.description || 'Alert when value goes outside these bounds. Leave blank to skip that side.'}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">
                {tr.min || 'Min'} ({info.unit || '—'})
              </label>
              <input
                type="number"
                value={minVal}
                onChange={(e) => setMinVal(e.target.value)}
                placeholder={tr.noLimit || 'no limit'}
                className="w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm text-slate-900 placeholder-gray-400 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-white/10 dark:bg-slate-800 dark:text-white dark:placeholder-gray-500"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">
                {tr.max || 'Max'} ({info.unit || '—'})
              </label>
              <input
                type="number"
                value={maxVal}
                onChange={(e) => setMaxVal(e.target.value)}
                placeholder={tr.noLimit || 'no limit'}
                className="w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm text-slate-900 placeholder-gray-400 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-white/10 dark:bg-slate-800 dark:text-white dark:placeholder-gray-500"
              />
            </div>
          </div>

          {/* Ctrl/Port info */}
          <p className="text-[11px] text-gray-400 dark:text-gray-600">
            Ctrl {ctrlId} / Port {portNum} · {tr.storedLocally || 'stored locally per browser'}
          </p>
        </div>

        <div className="px-4 py-3 border-t border-black/10 dark:border-white/10 flex items-center justify-between gap-2">
          <button
            onClick={handleClear}
            className="inline-flex items-center gap-1.5 rounded-lg border border-black/10 px-3 py-2 text-xs text-red-600 hover:bg-red-50 dark:border-white/10 dark:text-red-400 dark:hover:bg-red-500/10 transition-colors cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            {tr.clear || 'Clear'}
          </button>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="rounded-lg border border-black/10 px-3 py-2 text-xs text-slate-700 hover:bg-slate-100 dark:border-white/10 dark:text-slate-300 dark:hover:bg-slate-800 cursor-pointer"
            >
              {tr.cancel || 'Cancel'}
            </button>
            <button
              onClick={handleSave}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-700 cursor-pointer"
            >
              {tr.save || 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
