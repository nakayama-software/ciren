import { useState, useEffect, useCallback } from 'react'
import { getAreas, createArea, deleteArea } from '../lib/api'
import { translations } from '../utils/translation'
import ForkliftMap from './ForkliftMap'

// Shown above "Sensor Controllers" for the currently selected main module tab.
// Scoped to ONE device_id (unlike a global cross-device map) — hides itself
// entirely if this device has never reported any GPS reading AND has no
// saved areas (a device with only saved areas — e.g. forklift GPS temporarily
// offline — should still show its zones).
//
// `forklifts` is owned by App.jsx (initial REST snapshot + live WS merge in
// its own onmessage handler), not fetched/subscribed here — that keeps GPS
// updates bound to whichever socket is currently live across reconnects,
// instead of a listener stuck on a socket instance from first mount.
export default function GpsControllersSection({ deviceId, forklifts = [], lang = 'en' }) {
  const t = translations[lang]?.dashboard || translations.en.dashboard

  const [areas, setAreas]         = useState([])
  const [loaded, setLoaded]       = useState(false)
  const [selectedKey, setSelectedKey] = useState(null)
  const [focusTick, setFocusTick] = useState(0)
  const [drawing, setDrawing]     = useState(false)

  // Bumps focusTick on every click, even re-clicking the already-selected
  // node — otherwise ForkliftMap's fly-to-selection effect wouldn't re-fire
  // when the key string hasn't actually changed.
  const handleSelectForklift = useCallback((key) => {
    setSelectedKey(key)
    setFocusTick((t) => t + 1)
  }, [])

  // ── Load saved areas for this device ──
  const loadAreas = useCallback(async () => {
    if (!deviceId) return
    try {
      const areaData = await getAreas(deviceId)
      setAreas(Array.isArray(areaData) ? areaData : [])
    } catch {
      setAreas([])
    } finally {
      setLoaded(true)
    }
  }, [deviceId])

  useEffect(() => {
    setLoaded(false)
    loadAreas()
  }, [loadAreas])

  // ── Draw / label / delete areas ────────────────────────────────────
  const handleAreaDrawn = useCallback(async (points) => {
    setDrawing(false)
    const label = window.prompt(t.areaLabelPrompt || 'Name this area:')
    if (!label || !label.trim()) return
    try {
      const area = await createArea(deviceId, { label: label.trim(), points })
      setAreas(prev => [...prev, area])
    } catch (e) {
      console.error('Failed to save area:', e)
    }
  }, [deviceId, t])

  const handleDeleteArea = useCallback(async (areaId) => {
    try {
      await deleteArea(deviceId, areaId)
      setAreas(prev => prev.filter(a => a._id !== areaId))
    } catch (e) {
      console.error('Failed to delete area:', e)
    }
  }, [deviceId])

  // Not loaded yet, or this device has never reported GPS and has no saved areas
  if (!loaded || (forklifts.length === 0 && areas.length === 0)) return null

  return (
    <div data-tour="gps-controllers" className="mb-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-base font-semibold text-slate-900 dark:text-white">
          {t.gpsControllers || 'GPS Controllers'}
        </h3>
        <button
          onClick={() => setDrawing(d => !d)}
          className={`text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors cursor-pointer ${
            drawing
              ? 'bg-cyan-500/20 text-cyan-600 border-cyan-500/40 dark:text-cyan-400'
              : 'border-black/10 bg-black/5 text-gray-600 hover:bg-black/10 dark:border-white/10 dark:bg-white/10 dark:text-gray-300 dark:hover:bg-white/20'
          }`}
          title={t.finishDrawing || 'Click map to add points, double-click to finish'}
        >
          {drawing ? (t.finishDrawing || 'Click map to add points, double-click to finish') : (t.drawArea || 'Draw Area')}
        </button>
      </div>
      <div className="h-72 md:h-96 rounded-2xl border border-black/10 bg-white/50 backdrop-blur-sm dark:border-white/10 dark:bg-white/5 overflow-hidden">
        <ForkliftMap
          forklifts={forklifts}
          selectedKey={selectedKey}
          onSelectForklift={handleSelectForklift}
          focusTick={focusTick}
          waitingText={t.waitingGps || 'Waiting for GPS data…'}
          lang={lang}
          areas={areas}
          drawing={drawing}
          onAreaDrawn={handleAreaDrawn}
          onDeleteArea={handleDeleteArea}
        />
      </div>
    </div>
  )
}
