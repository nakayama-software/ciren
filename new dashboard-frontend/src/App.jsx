import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Activity,
  Cpu,
  Sun,
  Moon,
  MapPin,
  Clock,
  Zap,
  Globe,
  Settings,
  LogOut,
  BatteryMedium,
  Signal,
} from 'lucide-react'
import {
  getDevice, getLatest, getUserDevices, clearToken, getToken,
} from './lib/api'
import { getNodeKey, getReadingKey, isIMUSensor } from './utils/sensors'
import { translations } from './utils/translation'
import ControllerDetailView from './components/ControllerDetailView'
import LeafletMap from './components/LeafletMap'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import DeviceManagementPage from './pages/DeviceManagementPage'

// Build WebSocket URL from env or derive from VITE_API_BASE
function buildWsUrl() {
  const wsUrl = import.meta.env.VITE_WS_URL
  // VITE_WS_URL: konversi http→ws, port apapun→3001
  if (wsUrl) return wsUrl.replace(/^https?/, 'ws').replace(/:\d+/, ':3001')

  const apiBase = import.meta.env.VITE_API_BASE
  if (apiBase) return apiBase.replace(/^https?/, 'ws').replace(/:\d+/, ':3001')

  return 'ws://localhost:3001'
}

const WS_URL = buildWsUrl()
const RECONNECT_DELAY = 3000

function getCtrlIds(nodes) {
  const seen = new Set()
  const ids = []
  for (const n of nodes) {
    const k = String(n.ctrl_id)
    if (!seen.has(k)) { seen.add(k); ids.push(k) }
  }
  return ids.sort()
}

// ─── Page constants ───────────────────────────────
const PAGE_LOGIN    = 'login'
const PAGE_REGISTER = 'register'
const PAGE_DEVICES  = 'devices'
const PAGE_DASH     = 'dashboard'

export default function App() {
  // ---------- theme ----------
  const [theme, setTheme] = useState(() => localStorage.getItem('ciren-theme') || 'dark')

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'dark') root.classList.add('dark')
    else root.classList.remove('dark')
    localStorage.setItem('ciren-theme', theme)
  }, [theme])

  function toggleTheme() { setTheme((t) => (t === 'dark' ? 'light' : 'dark')) }

  // ---------- language ----------
  const [lang, setLang] = useState(() => localStorage.getItem('ciren-lang') || 'ja')
  useEffect(() => { localStorage.setItem('ciren-lang', lang) }, [lang])
  const t = translations[lang] || translations.en

  // ---------- clock ----------
  const [currentTime, setCurrentTime] = useState(new Date())
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])
  const now = currentTime.getTime()

  // ---------- auth ----------
  const [page, setPage] = useState(() => getToken() ? PAGE_DEVICES : PAGE_LOGIN)
  const [username, setUsername] = useState(
    () => localStorage.getItem('ciren-username') || ''
  )

  function handleLogin(uname) {
    localStorage.setItem('ciren-username', uname)
    setUsername(uname)
    setPage(PAGE_DEVICES)
  }

  function handleLogout() {
    clearToken()
    localStorage.removeItem('ciren-username')
    setUsername('')
    setDevices({})
    setLatestData({})
    setNodeStatus({})
    setSelectedDeviceId(null)
    setSelectedCtrlId(null)
    setPage(PAGE_LOGIN)
  }

  // ---------- dashboard data ----------
  const [devices, setDevices] = useState({})
  // latestData: { [deviceId]: { [getReadingKey(ctrl_id, port_num, sensor_type)]: reading } }
  const [latestData, setLatestData] = useState({})
  const [nodeStatus, setNodeStatus] = useState({})
  const [selectedDeviceId, setSelectedDeviceId] = useState(null)
  const [selectedCtrlId, setSelectedCtrlId] = useState(null)
  const [wsStatus, setWsStatus] = useState('connecting')

  const wsRef = useRef(null)
  const reconnectTimer = useRef(null)
  const mountedRef = useRef(true)

  // ---------- load devices from user account ----------
  async function loadUserDevices() {
    try {
      const userDevIds = await getUserDevices()
      if (!mountedRef.current) return

      const devMap = {}
      const latMap = {}

      await Promise.allSettled(
        userDevIds.map(async (deviceId) => {
          try {
            // getLatest returns one reading per (ctrl_id, port_num, sensor_type) — correct for all sensor types
            const [detail, latestArr] = await Promise.all([
              getDevice(deviceId),
              getLatest(deviceId),
            ])
            const { nodes, ...deviceFields } = detail
            devMap[deviceId] = { device: deviceFields, nodes: nodes || [] }

            // Build latestData map keyed by getReadingKey
            const nodeReadings = {}
            if (Array.isArray(latestArr)) {
              latestArr.forEach((r) => {
                if (r.sensor_type !== undefined) {
                  const key = getReadingKey(r.ctrl_id, r.port_num, r.sensor_type)
                  nodeReadings[key] = r
                }
              })
            }
            latMap[deviceId] = nodeReadings
          } catch {
            devMap[deviceId] = { device: { device_id: deviceId }, nodes: [] }
            latMap[deviceId] = {}
          }
        })
      )

      if (!mountedRef.current) return
      setDevices(devMap)
      setLatestData(latMap)

      const firstId = Object.keys(devMap)[0]
      if (firstId) setSelectedDeviceId(firstId)
    } catch (err) {
      console.error('Failed to load user devices:', err)
    }
  }

  function handleGoToDashboard() {
    setSelectedCtrlId(null)
    setPage(PAGE_DASH)
    loadUserDevices()
  }

  // Load data when entering dashboard
  useEffect(() => {
    if (page === PAGE_DASH) {
      mountedRef.current = true
      loadUserDevices()
      return () => { mountedRef.current = false }
    }
  }, [page])

  // ---------- WebSocket ----------
  const connect = useCallback(() => {
    if (!mountedRef.current) return
    setWsStatus('connecting')
    const ws = new WebSocket(WS_URL)
    wsRef.current = ws

    ws.onopen = () => {
      if (!mountedRef.current) return
      setWsStatus('connected')
    }

    ws.onmessage = (evt) => {
      if (!mountedRef.current) return
      try {
        const msg = JSON.parse(evt.data)
        const { type, payload } = msg

        if (type === 'sensor_data') {
          const { device_id, ctrl_id, port_num, sensor_type, value, ts } = payload
          // Key by sensor_type for IMU multi-axis support
          const rKey = getReadingKey(ctrl_id, port_num, sensor_type)
          // Also update node status key (without sensor_type)
          const nKey = getNodeKey(ctrl_id, port_num)
          setLatestData((prev) => ({
            ...prev,
            [device_id]: {
              ...(prev[device_id] || {}),
              [rKey]: { ctrl_id, port_num, sensor_type, value, server_ts: ts },
            },
          }))
          // Mark node as online
          setNodeStatus((prev) => ({
            ...prev,
            [device_id]: { ...(prev[device_id] || {}), [nKey]: 'online' },
          }))
        } else if (type === 'device_status') {
          const { device_id, ...rest } = payload
          setDevices((prev) => {
            if (!prev[device_id]) return prev
            return {
              ...prev,
              [device_id]: {
                ...prev[device_id],
                device: { ...prev[device_id].device, ...rest, device_id },
              },
            }
          })
        } else if (type === 'node_status') {
          const { device_id, ctrl_id, port_num, status } = payload
          const key = getNodeKey(ctrl_id, port_num)
          setNodeStatus((prev) => ({
            ...prev,
            [device_id]: { ...(prev[device_id] || {}), [key]: status },
          }))
        }
      } catch {
        // ignore malformed
      }
    }

    ws.onclose = () => {
      if (!mountedRef.current) return
      setWsStatus('disconnected')
      reconnectTimer.current = setTimeout(connect, RECONNECT_DELAY)
    }

    ws.onerror = () => { ws.close() }
  }, [])

  useEffect(() => {
    if (page !== PAGE_DASH) return
    mountedRef.current = true
    connect()
    return () => {
      mountedRef.current = false
      if (wsRef.current) wsRef.current.close()
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
    }
  }, [connect, page])

  // ---------- derived ----------
  const selectedEntry = selectedDeviceId ? devices[selectedDeviceId] : null
  const selectedDevice = selectedEntry?.device || null
  const selectedNodes = selectedEntry?.nodes || []
  const selectedLatest = selectedDeviceId ? (latestData[selectedDeviceId] || {}) : {}
  const selectedNodeStatus = selectedDeviceId ? (nodeStatus[selectedDeviceId] || {}) : {}

  const deviceIds = Object.keys(devices)

  const wsColors = {
    connected:    'bg-green-400',
    connecting:   'bg-yellow-400 animate-pulse',
    disconnected: 'bg-red-500',
  }
  const wsLabels = {
    connected:    'Live',
    connecting:   'Connecting…',
    disconnected: 'Disconnected',
  }

  const ctrlIds = getCtrlIds(selectedNodes)

  function isCtrlOnline(ctrlId) {
    const ctrlNodes = selectedNodes.filter((n) => String(n.ctrl_id) === String(ctrlId))
    if (ctrlNodes.length === 0) return false
    const maxTs = Math.max(
      ...ctrlNodes
        .flatMap((n) => {
          // Check all readings for this node across all sensor types
          const nodeReadings = Object.entries(selectedLatest)
            .filter(([k]) => k.startsWith(`${n.ctrl_id}_${n.port_num}_`))
            .map(([, r]) => r?.server_ts ? new Date(r.server_ts).getTime() : 0)
          return [...nodeReadings, n.last_seen ? new Date(n.last_seen).getTime() : 0]
        })
    )
    return maxTs > 0 && (now - maxTs) < 30000
  }

  const hasGpsFix = selectedDevice?.gps_fix === true || selectedDevice?.gps_fix === 1

  // Devices with GPS fix for the map
  const devicesForMap = Object.values(devices)
    .map((e) => e.device)
    .filter(Boolean)

  // ══════════════════════════════════════════════════
  // Shared page shell (background + blur orbs)
  // ══════════════════════════════════════════════════
  const shell = (children, showHeader = false) => (
    <div
      className="min-h-screen font-['Noto_Sans_JP','Hiragino_Kaku_Gothic_ProN','Yu_Gothic_UI',system-ui,sans-serif]
                 selection:bg-cyan-300/30 selection:text-white
                 bg-slate-50 text-slate-900 dark:text-white
                 dark:bg-gradient-to-br dark:from-slate-950 dark:via-slate-900 dark:to-slate-950
                 transition-colors duration-500"
    >
      {/* Background blur orbs */}
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute -top-32 -right-24 h-64 w-64 rounded-full bg-cyan-500/10 blur-3xl" />
        <div className="absolute -bottom-32 -left-24 h-64 w-64 rounded-full bg-indigo-500/10 blur-3xl" />
      </div>

      {showHeader && (
        <header className="sticky top-0 z-40 border-b border-black/10 bg-white/80 backdrop-blur-sm dark:border-white/10 dark:bg-slate-900/80">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="flex h-14 items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-r from-cyan-500 to-indigo-500">
                  <Activity size={16} className="text-white" />
                </div>
                <div>
                  <span className="text-base font-bold tracking-widest text-slate-900 dark:text-white">CIREN</span>
                  {selectedDevice && (
                    <span className="ml-2 text-xs text-slate-400 dark:text-gray-500 hidden sm:inline">
                      {selectedDevice.device_id}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                {/* WS status */}
                <div className="inline-flex items-center gap-1.5 rounded-md border border-black/10 bg-black/5 px-2.5 py-1 text-xs text-gray-700 dark:border-white/10 dark:bg-white/10 dark:text-gray-300">
                  <span className={`w-1.5 h-1.5 rounded-full ${wsColors[wsStatus]}`} />
                  <span>{wsLabels[wsStatus]}</span>
                </div>

                {/* Clock */}
                <div className="hidden sm:inline-flex items-center gap-1.5 rounded-md border border-black/10 bg-black/5 px-2.5 py-1 text-xs text-gray-700 dark:border-white/10 dark:bg-white/10 dark:text-gray-300">
                  <Clock size={11} />
                  <span>{currentTime.toLocaleTimeString()}</span>
                </div>

                {/* Language */}
                <div className="inline-flex rounded-md bg-black/5 border border-black/10 dark:border-white/10 dark:bg-white/10 p-0.5 gap-0.5">
                  {['ja', 'en'].map((l) => (
                    <button key={l} onClick={() => setLang(l)}
                      className={`px-2.5 py-1 text-xs rounded cursor-pointer transition-colors ${lang === l
                        ? (theme === 'dark' ? 'bg-white text-slate-900' : 'bg-slate-900 text-white')
                        : 'text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white'
                      }`}>
                      {l === 'ja' ? '日本語' : 'EN'}
                    </button>
                  ))}
                </div>

                {/* Manage devices */}
                <button
                  onClick={() => setPage(PAGE_DEVICES)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-black/10 bg-black/5 px-3 py-1 text-xs text-gray-700 hover:bg-black/10 dark:border-white/10 dark:bg-white/10 dark:text-gray-200 dark:hover:bg-white/20 transition-colors cursor-pointer"
                  title="Manage devices"
                >
                  <Settings size={13} />
                  <span className="hidden sm:inline">Devices</span>
                </button>

                {/* Logout */}
                <button
                  onClick={handleLogout}
                  className="inline-flex items-center gap-1.5 rounded-md border border-black/10 bg-black/5 px-3 py-1 text-xs text-gray-700 hover:bg-black/10 dark:border-white/10 dark:bg-white/10 dark:text-gray-200 dark:hover:bg-white/20 transition-colors cursor-pointer"
                >
                  <LogOut size={13} />
                  <span className="hidden sm:inline">Sign out</span>
                </button>

                {/* Theme */}
                <button
                  onClick={toggleTheme}
                  className="inline-flex items-center gap-2 rounded-md border border-black/10 bg-black/5 px-3 py-1 text-xs text-gray-700 hover:bg-black/10 dark:border-white/10 dark:bg-white/10 dark:text-gray-200 dark:hover:bg-white/20 transition-colors cursor-pointer"
                  aria-label="Toggle theme"
                >
                  {theme === 'dark' ? <Sun size={13} /> : <Moon size={13} />}
                </button>
              </div>
            </div>
          </div>
        </header>
      )}

      <div className="relative z-10">{children}</div>
    </div>
  )

  // ══════════════════════════════════════════════════
  // Page routing
  // ══════════════════════════════════════════════════
  if (page === PAGE_LOGIN) {
    return shell(
      <LoginPage
        onLogin={handleLogin}
        onGoRegister={() => setPage(PAGE_REGISTER)}
        theme={theme}
        toggleTheme={toggleTheme}
      />
    )
  }

  if (page === PAGE_REGISTER) {
    return shell(
      <RegisterPage
        onLogin={handleLogin}
        onGoLogin={() => setPage(PAGE_LOGIN)}
        theme={theme}
        toggleTheme={toggleTheme}
      />
    )
  }

  if (page === PAGE_DEVICES) {
    return shell(
      <DeviceManagementPage
        username={username}
        onGoToDashboard={handleGoToDashboard}
        onLogout={handleLogout}
        theme={theme}
        toggleTheme={toggleTheme}
      />
    )
  }

  // ── Dashboard ─────────────────────────────────────
  return shell(
    <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6 space-y-6">

      {/* Device tabs */}
      {deviceIds.length > 1 && (
        <div className="flex items-center gap-2 flex-wrap">
          {deviceIds.map((id) => {
            const isActive = id === selectedDeviceId
            return (
              <button
                key={id}
                onClick={() => { setSelectedDeviceId(id); setSelectedCtrlId(null) }}
                className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer
                  ${isActive
                    ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                    : 'border border-black/10 bg-black/5 text-gray-700 hover:bg-black/10 dark:border-white/10 dark:bg-white/10 dark:text-gray-200 dark:hover:bg-white/20'
                  }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${devices[id]?.device?.status === 'online' ? 'bg-green-400' : 'bg-slate-400'}`} />
                {id}
              </button>
            )
          })}
        </div>
      )}

      {/* No device state */}
      {!selectedDevice && (
        <div className="rounded-2xl border border-black/10 bg-white/80 p-12 backdrop-blur-sm dark:border-white/10 dark:bg-slate-800/60 shadow-sm text-center">
          <Cpu className="mx-auto mb-3 w-10 h-10 text-slate-300 dark:text-gray-600" />
          <p className="text-slate-500 dark:text-gray-400">
            {deviceIds.length === 0 ? 'No devices found. Waiting for data…' : 'Select a device above.'}
          </p>
        </div>
      )}

      {/* Device overview */}
      {selectedDevice && !selectedCtrlId && (
        <>
          {/* Map + Status panel */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

            {/* Map col-span-2 */}
            <div className="lg:col-span-2 rounded-2xl border border-black/10 bg-white/80 p-4 backdrop-blur-sm dark:border-white/10 dark:bg-slate-800/60 shadow-sm h-[26rem] relative">
              <h2 className="text-base font-medium tracking-tight text-slate-900 dark:text-white flex items-center gap-2 mb-3">
                <MapPin className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />
                <span>{t.dashboard?.devicePositions || 'Device Positions'}</span>
              </h2>
              <div className="w-full h-[calc(100%-2.5rem)]">
                <LeafletMap devices={devicesForMap} selectedDeviceId={selectedDeviceId} />
              </div>
              {!hasGpsFix && (
                <div className="absolute top-3 right-3 bg-red-600 text-white text-xs font-medium px-3 py-2 rounded-lg shadow-lg animate-pulse z-[100]">
                  GPS not connected
                </div>
              )}
            </div>

            {/* Main module status panel */}
            <div className="rounded-2xl border border-black/10 bg-white/80 p-4 backdrop-blur-sm dark:border-white/10 dark:bg-slate-800/60 shadow-sm flex flex-col gap-3">
              <h3 className="text-sm font-semibold text-slate-700 dark:text-gray-300">
                {t.dashboard?.mainModuleStatus || 'Main Module Status'}
              </h3>

              {/* GPS */}
              <div className="rounded-xl border border-black/10 bg-white/70 p-3 dark:border-white/10 dark:bg-slate-800/60 flex items-center gap-3">
                <MapPin size={16} className={`shrink-0 ${hasGpsFix ? 'text-cyan-500' : 'text-red-500'}`} />
                <div className="min-w-0">
                  <p className="text-xs font-medium text-slate-600 dark:text-gray-400">GPS</p>
                  {hasGpsFix && selectedDevice.gps_lat != null ? (
                    <p className="text-xs font-mono text-slate-900 dark:text-white truncate mt-0.5">
                      {Number(selectedDevice.gps_lat).toFixed(6)}, {Number(selectedDevice.gps_lon).toFixed(6)}
                    </p>
                  ) : (
                    <p className="text-xs text-red-500 dark:text-red-400 mt-0.5 font-medium">No GPS fix</p>
                  )}
                </div>
              </div>

              {/* Battery */}
              <div className="rounded-xl border border-black/10 bg-white/70 p-3 dark:border-white/10 dark:bg-slate-800/60 flex items-center gap-3">
                <BatteryMedium size={16} className="text-green-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-slate-600 dark:text-gray-400">
                    {t.dashboard?.battery || 'Battery'}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <div className="flex-1 h-1.5 rounded-full bg-slate-200 dark:bg-white/10 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-green-500 transition-all"
                        style={{ width: `${Math.min(100, selectedDevice.batt_pct ?? 0)}%` }}
                      />
                    </div>
                    <span className="text-xs font-mono text-slate-900 dark:text-white shrink-0">
                      {selectedDevice.batt_pct != null ? `${selectedDevice.batt_pct}%` : '—'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Signal */}
              <div className="rounded-xl border border-black/10 bg-white/70 p-3 dark:border-white/10 dark:bg-slate-800/60 flex items-center gap-3">
                <Signal size={16} className="text-indigo-500 shrink-0" />
                <div>
                  <p className="text-xs font-medium text-slate-600 dark:text-gray-400">
                    {t.dashboard?.signal || 'Signal'}
                  </p>
                  <p className="text-xs font-mono text-slate-900 dark:text-white mt-0.5">
                    {selectedDevice.rssi != null ? `${selectedDevice.rssi} dBm` : '—'}
                  </p>
                </div>
              </div>

              {/* Controllers */}
              <div className="rounded-xl border border-black/10 bg-white/70 p-3 dark:border-white/10 dark:bg-slate-800/60 flex items-center gap-3">
                <Cpu size={16} className="text-indigo-500 shrink-0" />
                <div>
                  <p className="text-xs font-medium text-slate-600 dark:text-gray-400">Controllers</p>
                  <p className="text-xs text-slate-900 dark:text-white mt-0.5">
                    {ctrlIds.filter(isCtrlOnline).length} online · {ctrlIds.length} registered
                  </p>
                </div>
              </div>

              {/* Firmware */}
              <div className="rounded-xl border border-black/10 bg-white/70 p-3 dark:border-white/10 dark:bg-slate-800/60 flex items-center gap-3">
                <Zap size={16} className="text-yellow-500 shrink-0" />
                <div>
                  <p className="text-xs font-medium text-slate-600 dark:text-gray-400">Firmware</p>
                  <p className="text-xs font-mono text-slate-900 dark:text-white mt-0.5">
                    {selectedDevice.fw_version || '—'}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Controller cards */}
          <div>
            <h3 className="text-base font-semibold mb-4 text-slate-900 dark:text-white">
              {t.dashboard?.sensorControllers || 'Sensor Controllers'}
            </h3>
            {(() => {
              const onlineCtrlIds = ctrlIds.filter(isCtrlOnline)
              if (ctrlIds.length === 0) {
                return (
                  <div className="rounded-2xl border border-black/10 bg-white/80 p-8 backdrop-blur-sm dark:border-white/10 dark:bg-slate-800/60 shadow-sm text-center">
                    <p className="text-sm text-slate-400 dark:text-gray-500">
                      {t.dashboard?.noHubDetected || 'No sensor controllers registered for this device.'}
                    </p>
                  </div>
                )
              }
              if (onlineCtrlIds.length === 0) {
                return (
                  <div className="rounded-2xl border border-black/10 bg-white/80 p-8 backdrop-blur-sm dark:border-white/10 dark:bg-slate-800/60 shadow-sm text-center">
                    <Cpu className="mx-auto mb-3 w-8 h-8 text-slate-300 dark:text-gray-600" />
                    <p className="text-sm text-slate-400 dark:text-gray-500">
                      {ctrlIds.length} controller{ctrlIds.length !== 1 ? 's' : ''} registered — waiting for data…
                    </p>
                  </div>
                )
              }
              return (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {onlineCtrlIds.map((ctrlId) => {
                    const ctrlNodes = selectedNodes.filter((n) => String(n.ctrl_id) === String(ctrlId))
                    return (
                      <div
                        key={ctrlId}
                        className="rounded-xl border border-black/10 bg-white/80 p-4 backdrop-blur-sm dark:border-white/10 dark:bg-slate-800/60 shadow-sm hover:border-black/20 dark:hover:border-white/30 transition-all"
                      >
                        <div className="flex items-center gap-3 mb-3">
                          <div className="h-10 w-10 rounded-lg bg-gradient-to-r from-cyan-500 to-indigo-500 flex items-center justify-center shrink-0">
                            <Cpu className="w-5 h-5 text-white" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-slate-900 dark:text-white truncate">Controller {ctrlId}</p>
                            <p className="text-xs text-slate-500 dark:text-gray-400">
                              {ctrlNodes.length} node{ctrlNodes.length !== 1 ? 's' : ''}
                            </p>
                          </div>
                          <span className="text-xs font-medium px-2 py-0.5 rounded-full shrink-0 bg-green-500/10 text-green-700 dark:text-green-400">
                            {t.dashboard?.online || 'Online'}
                          </span>
                        </div>
                        <button
                          onClick={() => setSelectedCtrlId(ctrlId)}
                          className="w-full rounded-lg bg-slate-900 py-2 text-xs font-medium text-white hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100 transition-colors cursor-pointer"
                        >
                          {t.dashboard?.viewDetails || 'View Details'}
                        </button>
                      </div>
                    )
                  })}
                </div>
              )
            })()}
          </div>

          {/* Footer */}
          <div className="text-center text-[11px] text-slate-400 dark:text-gray-600 pb-2">
            {t.dashboard?.footer || '© 2025 CIREN Dashboard'}
          </div>
        </>
      )}

      {/* Controller detail */}
      {selectedDevice && selectedCtrlId && (
        <ControllerDetailView
          ctrlId={selectedCtrlId}
          deviceId={selectedDeviceId}
          nodes={selectedNodes}
          latestData={selectedLatest}
          nodeStatus={selectedNodeStatus}
          now={now}
          onBack={() => setSelectedCtrlId(null)}
          wsRef={wsRef}
          t={t}
        />
      )}
    </main>,
    true  // showHeader = true for dashboard
  )
}
