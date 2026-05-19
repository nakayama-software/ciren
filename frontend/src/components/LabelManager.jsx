import { useState, useEffect, useRef } from 'react'
import { Plus, Tag, X, Check, AlertTriangle } from 'lucide-react'
import { getSensorInfo, isIMUSensor } from '../utils/sensors'

const LS_KEY = (deviceId) => `ciren-labels-${deviceId}`

function loadLabels(deviceId) {
  try {
    const raw = localStorage.getItem(LS_KEY(deviceId))
    if (raw) return JSON.parse(raw)

    // Migration: scan for old per-ctrl keys ciren-labels-${deviceId}-${ctrlId}
    const migrated = []
    const prefix = `ciren-labels-${deviceId}-`
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (!k?.startsWith(prefix)) continue
      const ctrlIdStr = k.slice(prefix.length)
      try {
        const old = JSON.parse(localStorage.getItem(k) || '[]')
        for (const label of old) {
          migrated.push({
            ...label,
            sensors: (label.sensors || []).map((s) => ({ ...s, ctrlId: ctrlIdStr })),
          })
        }
        localStorage.removeItem(k)
      } catch {}
    }
    if (migrated.length) saveLabels(deviceId, migrated)
    return migrated
  } catch {
    return []
  }
}

function saveLabels(deviceId, labels) {
  try {
    localStorage.setItem(LS_KEY(deviceId), JSON.stringify(labels))
  } catch {}
}

// Unique key per sensor across all controllers
function sensorKey(ctrlId, portNum, sensorType) {
  return `${ctrlId}-${portNum}-${sensorType}`
}

// Label shown in selector + tooltip
function sensorLabel(ctrlId, portNum, sensorType, allHumTempPorts) {
  const pk = `${ctrlId}_${portNum}`
  if (isIMUSensor(sensorType)) return `C${ctrlId} P${portNum} — IMU`
  if (allHumTempPorts?.has(pk) && Number(sensorType) === 0x01) return `C${ctrlId} P${portNum} — Temp / Humidity`
  return `C${ctrlId} P${portNum} — ${getSensorInfo(Number(sensorType)).label}`
}

export default function LabelManager({ deviceId, allDisplayNodes, allHumTempPorts, onOpenLabel, t }) {
  const tr = t?.labels || {}
  const [labels, setLabels] = useState([])
  const [invalidatedNames, setInvalidatedNames] = useState([])
  const [showCreate, setShowCreate] = useState(false)
  const [newLabelName, setNewLabelName] = useState('')
  const [selectedSensors, setSelectedSensors] = useState([])
  const lastSigRef = useRef(null)

  useEffect(() => {
    setLabels(loadLabels(deviceId))
  }, [deviceId])

  // Auto-invalidate labels when active nodes change
  useEffect(() => {
    const activePairs = new Set(
      allDisplayNodes.map((n) => sensorKey(String(n.ctrl_id), n.port_num, n.sensor_type))
    )
    const sig = [...activePairs].sort().join('|')
    if (sig === lastSigRef.current) return
    lastSigRef.current = sig

    setLabels((prev) => {
      if (!prev.length) return prev
      const valid = []
      const removed = []
      for (const label of prev) {
        const allPresent = label.sensors.every((s) =>
          activePairs.has(sensorKey(String(s.ctrlId), s.portNum, s.sensorType))
        )
        if (allPresent) valid.push(label)
        else removed.push(label.name)
      }
      if (removed.length) {
        saveLabels(deviceId, valid)
        setInvalidatedNames((prev2) => [...prev2, ...removed.filter((n) => !prev2.includes(n))])
        return valid
      }
      return prev
    })
  }, [allDisplayNodes, deviceId])

  function handleCreateLabel() {
    const name = newLabelName.trim()
    if (!name || selectedSensors.length === 0) return
    const newLabel = {
      id: `label-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name,
      createdAt: new Date().toISOString(),
      sensors: selectedSensors,
    }
    const updated = [...labels, newLabel]
    setLabels(updated)
    saveLabels(deviceId, updated)
    setNewLabelName('')
    setSelectedSensors([])
    setShowCreate(false)
  }

  function handleDeleteLabel(id, e) {
    e.stopPropagation()
    const updated = labels.filter((l) => l.id !== id)
    setLabels(updated)
    saveLabels(deviceId, updated)
  }

  function toggleSensor(ctrlId, portNum, sensorType) {
    const key = sensorKey(ctrlId, portNum, sensorType)
    setSelectedSensors((prev) => {
      const exists = prev.some((s) => sensorKey(String(s.ctrlId), s.portNum, s.sensorType) === key)
      if (exists) return prev.filter((s) => sensorKey(String(s.ctrlId), s.portNum, s.sensorType) !== key)
      return [...prev, { ctrlId, portNum, sensorType }]
    })
  }

  function cancelCreate() {
    setShowCreate(false)
    setNewLabelName('')
    setSelectedSensors([])
  }

  if (allDisplayNodes.length === 0) return null

  // Group nodes by ctrl_id for the selector
  const ctrlGroups = {}
  for (const node of allDisplayNodes) {
    const cid = String(node.ctrl_id)
    if (!ctrlGroups[cid]) ctrlGroups[cid] = []
    ctrlGroups[cid].push(node)
  }
  const multiCtrl = Object.keys(ctrlGroups).length > 1

  return (
    <div className="mt-6 pt-6 border-t border-black/10 dark:border-white/10">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <Tag className="w-4 h-4 text-cyan-500 shrink-0" />
          <h3 className="text-base font-medium text-slate-900 dark:text-white">{tr.title || 'Analysis Labels'}</h3>
          {labels.length > 0 && (
            <span className="text-xs bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 px-1.5 py-0.5 rounded-full">
              {labels.length}
            </span>
          )}
        </div>
        <button
          onClick={() => setShowCreate((v) => !v)}
          className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-600 dark:text-cyan-400 transition-colors shrink-0"
        >
          <Plus className="w-4 h-4" />
          {tr.newLabel || 'New Label'}
        </button>
      </div>

      {invalidatedNames.map((name) => (
        <div key={name} className="flex items-center justify-between rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 mb-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-yellow-600 dark:text-yellow-400 flex-shrink-0" />
            <p className="text-sm text-yellow-800 dark:text-yellow-200">
              {tr.invalidated ? tr.invalidated(name) : <>Label <strong>"{name}"</strong> was deleted because its sensors are no longer active.</>}
            </p>
          </div>
          <button
            onClick={() => setInvalidatedNames((prev) => prev.filter((n) => n !== name))}
            className="p-1 rounded hover:bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 flex-shrink-0 ml-2"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}

      {showCreate && (
        <div className="rounded-xl border border-black/10 dark:border-white/10 bg-slate-50 dark:bg-slate-900/50 p-4 mb-4">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">{tr.createTitle || 'New Analysis Label'}</p>
          <input
            type="text"
            value={newLabelName}
            onChange={(e) => setNewLabelName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreateLabel()}
            placeholder={tr.namePlaceholder || 'Label name (e.g. Analysis 1)'}
            className="w-full rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-cyan-500 mb-3"
          />
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">{tr.selectSensors || 'Select sensors to include:'}</p>

          {/* Sensor selector — grouped by controller when multiple ctrls exist */}
          <div className="space-y-3 mb-3">
            {Object.entries(ctrlGroups).map(([cid, cidNodes]) => (
              <div key={cid}>
                {multiCtrl && (
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-gray-500 mb-1.5">
                    Controller {cid}
                  </p>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {cidNodes.map((node) => {
                    const key = sensorKey(String(node.ctrl_id), node.port_num, node.sensor_type)
                    const checked = selectedSensors.some(
                      (s) => sensorKey(String(s.ctrlId), s.portNum, s.sensorType) === key
                    )
                    return (
                      <label
                        key={key}
                        className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 cursor-pointer transition-colors ${
                          checked
                            ? 'border-cyan-500/50 bg-cyan-500/10'
                            : 'border-black/10 dark:border-white/10 bg-white dark:bg-slate-800'
                        }`}
                        onClick={() => toggleSensor(String(node.ctrl_id), node.port_num, node.sensor_type)}
                      >
                        <div
                          className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
                            checked ? 'bg-cyan-500 border-cyan-500' : 'border-gray-400 dark:border-gray-500'
                          }`}
                        >
                          {checked && <Check className="w-3 h-3 text-white" />}
                        </div>
                        <span className="text-sm text-slate-900 dark:text-white select-none">
                          {sensorLabel(String(node.ctrl_id), node.port_num, node.sensor_type, allHumTempPorts)}
                        </span>
                      </label>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-400">
              {tr.sensorsSelected
                ? tr.sensorsSelected(selectedSensors.length)
                : `${selectedSensors.length} sensor${selectedSensors.length !== 1 ? 's' : ''} selected`}
            </span>
            <div className="flex gap-2">
              <button
                onClick={cancelCreate}
                className="px-3 py-1.5 rounded-lg border border-black/10 dark:border-white/10 text-sm text-slate-900 dark:text-white hover:bg-black/5 dark:hover:bg-white/10"
              >
                {tr.cancel || 'Cancel'}
              </button>
              <button
                onClick={handleCreateLabel}
                disabled={!newLabelName.trim() || selectedSensors.length === 0}
                className="px-3 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-600 text-white text-sm disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {tr.create || 'Create Label'}
              </button>
            </div>
          </div>
        </div>
      )}

      {labels.length === 0 && !showCreate && (
        <p className="text-sm text-gray-400 dark:text-gray-500 italic leading-relaxed py-1">
          {tr.empty || 'No labels yet. Click "New Label" to combine multiple sensor views.'}
        </p>
      )}

      {labels.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {labels.map((label) => (
            <div
              key={label.id}
              className="group flex items-center gap-2 rounded-full border border-cyan-500/30 bg-cyan-500/10 pl-3 pr-2 py-1.5 cursor-pointer hover:bg-cyan-500/20 hover:border-cyan-500/50 transition-colors"
              onClick={() => onOpenLabel(label)}
              title={label.sensors.map((s) => sensorLabel(String(s.ctrlId), s.portNum, s.sensorType, allHumTempPorts)).join(', ')}
            >
              <Tag className="w-3.5 h-3.5 text-cyan-500 flex-shrink-0" />
              <span className="text-sm font-medium text-cyan-700 dark:text-cyan-300">{label.name}</span>
              <span className="text-xs text-cyan-600/60 dark:text-cyan-400/60">({label.sensors.length})</span>
              <button
                onClick={(e) => handleDeleteLabel(label.id, e)}
                className="p-0.5 rounded-full hover:bg-red-500/20 text-cyan-400 hover:text-red-500 transition-colors"
                title="Delete label"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
