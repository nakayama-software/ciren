import { useState, useEffect, useCallback, useMemo } from 'react'
import { Pause, Play, Trash2 } from 'lucide-react'
import { getDeviceLogs, getLogs, clearDeviceLogs } from '../lib/api'
import { translations } from '../utils/translation'

const LEVEL_COLORS = {
  INFO:  'bg-blue-500/20 text-blue-400 border-blue-500/30',
  WARN:  'bg-amber-500/20 text-amber-400 border-amber-500/30',
  ERROR: 'bg-red-500/20 text-red-400 border-red-500/30',
}

const LEVEL_DOT = {
  INFO:  'bg-blue-400',
  WARN:  'bg-amber-400',
  ERROR: 'bg-red-400',
}

const MAX_LOGS = 1000

function formatTs(ts) {
  if (!ts) return ''
  const d = ts instanceof Date ? ts : new Date(ts)
  if (isNaN(d)) return String(ts)
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 })
}

// Deduplication key for log entries — server_ts + tag + msg is unique per log
function logKey(log) {
  return `${log.server_ts || ''}|${log.tag || ''}|${log.msg || ''}`
}

export default function LogsPage({ username, onGoToDashboard, theme, toggleTheme, liveLogs, deviceIds, lang: langProp }) {
  const lang = langProp || 'en'
  const t = translations[lang]?.logs || translations.en.logs

  // Stabilize deviceIds to prevent infinite effect loops
  const deviceIdsStr = deviceIds?.join(',') || ''
  const stableDeviceIds = deviceIdsStr.split(',').filter(Boolean)

  const [selectedDevice, setSelectedDevice] = useState(deviceIds?.[0] || '')
  const [showAll, setShowAll] = useState(false)
  const [levelFilter, setLevelFilter] = useState(['INFO', 'WARN', 'ERROR'])
  const [tagFilter, setTagFilter] = useState('')
  const [paused, setPaused] = useState(false)
  const [historyLogs, setHistoryLogs] = useState([])   // from API, newest-first
  const [loading, setLoading] = useState(false)

  // Stabilize levelFilter as a string for dependency comparison
  const levelFilterStr = levelFilter.join(',')

  // ── Load historical logs from API ─────────────────────
  const loadHistory = useCallback(async () => {
    setLoading(true)
    try {
      let data
      if (showAll) {
        data = await getLogs({
          device_ids: stableDeviceIds.join(','),
          level: levelFilterStr,
          limit: 200,
        })
      } else if (selectedDevice) {
        data = await getDeviceLogs(selectedDevice, {
          level: levelFilterStr,
          limit: 200,
        })
      } else {
        data = []
      }
      setHistoryLogs(data)  // API returns newest-first (server_ts: -1)
    } catch (e) {
      console.error('Failed to load logs:', e)
    } finally {
      setLoading(false)
    }
  }, [selectedDevice, showAll, levelFilterStr, deviceIdsStr])

  useEffect(() => { loadHistory() }, [loadHistory])

  // ── Merge history + live logs with deduplication ───────
  // Live logs from WS arrive chronologically (oldest at index 0).
  // History logs from API are newest-first (server_ts: -1).
  // We merge both, deduplicate by (server_ts, tag, msg), then sort
  // by server_ts descending so newest always appears at the top.
  // When paused, live logs are excluded so the display freezes.
  const logs = useMemo(() => {
    const filteredLive = paused
      ? []
      : (showAll
          ? (liveLogs || [])
          : (liveLogs || []).filter(l => l.device_id === selectedDevice))

    const all = [...filteredLive, ...historyLogs]

    // Deduplicate
    const seen = new Set()
    const deduped = []
    for (const log of all) {
      const key = logKey(log)
      if (seen.has(key)) continue
      seen.add(key)
      deduped.push(log)
      if (deduped.length >= MAX_LOGS) break
    }

    // Sort newest-first by server_ts (ISO 8601 strings sort correctly)
    deduped.sort((a, b) => (b.server_ts || '').localeCompare(a.server_ts || ''))

    return deduped
  }, [historyLogs, liveLogs, paused, showAll, selectedDevice])

  // ── Pause / Resume ─────────────────────────────────
  const togglePause = useCallback(() => {
    setPaused(p => !p)
  }, [])

  // ── Clear logs ──────────────────────────────────────
  const handleClear = useCallback(async () => {
    if (!selectedDevice) return
    if (!window.confirm(t?.clearConfirm || 'Clear all logs for this device?')) return
    try {
      await clearDeviceLogs(selectedDevice)
      setHistoryLogs([])
    } catch (e) {
      console.error('Failed to clear logs:', e)
    }
  }, [selectedDevice, t])

  // ── Filter logs for display ──────────────────────────
  const filteredLogs = logs.filter(log => {
    if (!levelFilter.includes(log.level)) return false
    if (tagFilter && log.tag !== tagFilter) return false
    return true
  })

  // ── Collect unique tags from logs ────────────────────
  const uniqueTags = useMemo(
    () => [...new Set(logs.map(l => l.tag).filter(Boolean))].sort(),
    [logs]
  )

  // ── Level filter toggle ─────────────────────────────
  const toggleLevel = (level) => {
    setLevelFilter(prev => {
      if (prev.includes(level)) {
        return prev.filter(l => l !== level)
      }
      return [...prev, level]
    })
  }

  const allLevels = ['INFO', 'WARN', 'ERROR']

  return (
    <div className="h-full flex flex-col">
      {/* Sticky Header */}
      <div className="sticky top-0 z-10 bg-slate-50 dark:bg-slate-950 flex flex-wrap items-center gap-3 py-3 px-1 border-b border-black/5 dark:border-white/5">
        {/* Device selector */}
        <select
          value={showAll ? '__all__' : selectedDevice}
          onChange={e => {
            if (e.target.value === '__all__') {
              setShowAll(true)
            } else {
              setShowAll(false)
              setSelectedDevice(e.target.value)
            }
          }}
          className="rounded-lg border border-black/10 bg-white/5 px-3 py-2 text-sm dark:border-white/10 dark:bg-white/10 dark:text-gray-200"
        >
          <option value="__all__">{t?.allDevices || 'All Devices'}</option>
          {(deviceIds || []).map(id => (
            <option key={id} value={id}>{id}</option>
          ))}
        </select>

        {/* Level filter chips */}
        <div className="flex items-center gap-1">
          {allLevels.map(level => (
            <button
              key={level}
              onClick={() => toggleLevel(level)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors cursor-pointer ${
                levelFilter.includes(level)
                  ? LEVEL_COLORS[level]
                  : 'bg-black/5 text-gray-400 border-black/10 dark:bg-white/5 dark:border-white/10 dark:text-gray-500'
              }`}
            >
              {level}
            </button>
          ))}
        </div>

        {/* Tag filter */}
        <select
          value={tagFilter}
          onChange={e => setTagFilter(e.target.value)}
          className="rounded-lg border border-black/10 bg-white/5 px-3 py-2 text-sm dark:border-white/10 dark:bg-white/10 dark:text-gray-200"
        >
          <option value="">{t?.allTags || 'All Tags'}</option>
          {uniqueTags.map(tag => (
            <option key={tag} value={tag}>{tag}</option>
          ))}
        </select>

        {/* Pause / Resume */}
        <button
          onClick={togglePause}
          className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
            paused
              ? 'bg-amber-500/20 text-amber-400 border-amber-500/30'
              : 'bg-black/5 text-gray-600 border-black/10 dark:bg-white/10 dark:text-gray-300 dark:border-white/10'
          }`}
          title={paused ? (t?.resume || 'Resume') : (t?.pause || 'Pause')}
        >
          {paused ? <Play size={14} /> : <Pause size={14} />}
          {paused ? (t?.resume || 'Resume') : (t?.pause || 'Pause')}
        </button>

        {/* Clear */}
        {selectedDevice && !showAll && (
          <button
            onClick={handleClear}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors cursor-pointer"
            title={t?.clear || 'Clear logs'}
          >
            <Trash2 size={14} />
            {t?.clear || 'Clear'}
          </button>
        )}

        {/* Back */}
        <button
          onClick={onGoToDashboard}
          className="ml-auto inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-black/10 bg-black/5 text-gray-600 hover:bg-black/10 dark:border-white/10 dark:bg-white/10 dark:text-gray-300 dark:hover:bg-white/20 transition-colors cursor-pointer"
        >
          ← {t?.back || 'Back'}
        </button>
      </div>

      {/* Log stream */}
      <div className="flex-1 overflow-y-auto rounded-2xl border border-black/10 bg-white/50 backdrop-blur-sm dark:border-white/10 dark:bg-white/5 font-mono text-xs leading-relaxed mt-3">
        {loading && historyLogs.length === 0 && (
          <div className="text-center py-8 text-gray-400">{t?.loading || 'Loading logs...'}</div>
        )}

        {filteredLogs.length === 0 && !loading && (
          <div className="text-center py-8 text-gray-400">{t?.noLogs || 'No logs yet'}</div>
        )}

        {filteredLogs.map((log, i) => (
          <div
            key={log._id || `${log.server_ts}-${log.tag}-${log.msg}-${i}`}
            className="flex items-start gap-2 px-4 py-1.5 border-b border-black/5 dark:border-white/5 hover:bg-black/5 dark:hover:bg-white/5"
          >
            {/* Level badge */}
            <span className={`inline-flex items-center justify-center px-1.5 py-0.5 rounded text-[10px] font-bold border ${LEVEL_COLORS[log.level] || 'bg-gray-500/20 text-gray-400 border-gray-500/30'}`}>
              {log.level}
            </span>

            {/* Timestamp */}
            <span className="text-gray-400 dark:text-gray-500 whitespace-nowrap tabular-nums min-w-[72px]">
              {formatTs(log.server_ts || log.ts)}
            </span>

            {/* Tag */}
            <span className="text-cyan-600 dark:text-cyan-400 whitespace-nowrap min-w-[48px]">
              [{log.tag}]
            </span>

            {/* Device ID (when showing all) */}
            {showAll && (
              <span className="text-purple-600 dark:text-purple-400 whitespace-nowrap text-[10px] bg-purple-500/10 px-1 rounded">
                {log.device_id}
              </span>
            )}

            {/* Message */}
            <span className="text-gray-800 dark:text-gray-200 break-all">
              {log.msg}
            </span>
          </div>
        ))}
      </div>

      {/* Stats bar */}
      <div className="mt-2 flex items-center gap-4 text-[11px] text-gray-400 dark:text-gray-500">
        <span className="flex items-center gap-1">
          <span className={`w-1.5 h-1.5 rounded-full ${paused ? 'bg-amber-400' : 'bg-green-400'}`} />
          {paused ? (t?.paused || 'Paused') : (t?.live || 'Live')}
        </span>
        <span>{t?.total || 'Total'}: {filteredLogs.length}</span>
        <span>
          {levelFilter.map(l => (
            <span key={l} className="inline-flex items-center gap-0.5 mr-2">
              <span className={`w-1.5 h-1.5 rounded-full ${LEVEL_DOT[l]}`} />
              {l}
            </span>
          ))}
        </span>
      </div>
    </div>
  )
}