import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Activity,
  Cpu,
  Sun,
  Moon,
  Zap,
  Globe,
  Settings,
  LogOut,
  Signal,
  Wifi,
  Battery,
  Menu,
  X,
} from 'lucide-react'
import {
  getDevice, getLatest, getUserDevices, clearToken, getToken,
} from './lib/api'
import { getNodeKey, getReadingKey, isIMUSensor, countDisplayNodes } from './utils/sensors'
import { translations } from './utils/translation'
import ControllerDetailView from './components/ControllerDetailView'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import DeviceManagementPage from './pages/DeviceManagementPage'

// Build WebSocket URL from env or derive from VITE_API_BASE
// WS now shares the same port as the HTTP server
function buildWsUrl() {
  const wsUrl = import.meta.env.VITE_WS_URL
  if (wsUrl) return wsUrl.replace(/^http/, 'ws')  // http→ws, https→wss

  const apiBase = import.meta.env.VITE_API_BASE
  if (apiBase) return apiBase.replace(/^http/, 'ws')

  return 'ws://localhost:3000'
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

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

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
  useEffect(() => { devicesRef.current = devices }, [devices])
  // latestData: { [deviceId]: { [getReadingKey(ctrl_id, port_num, sensor_type)]: reading } }
  const [latestData, setLatestData] = useState({})
  const [nodeStatus, setNodeStatus] = useState({})
  const [selectedDeviceId, setSelectedDeviceId] = useState(null)
  const [selectedCtrlId, setSelectedCtrlId] = useState(null)
  const [wsStatus, setWsStatus] = useState('connecting')
  const [devicesLoading, setDevicesLoading] = useState(false)
  const [ctrlHbTs, setCtrlHbTs] = useState({})  // { "${deviceId}_${ctrlId}": timestamp }

  const wsRef = useRef(null)
  const reconnectTimer = useRef(null)
  const mountedRef = useRef(true)
  const nodeRefreshTimers = useRef({})
  const devicesRef = useRef({})
  const detailRef = useRef(null)

  // ---------- load devices from user account ----------
  async function loadUserDevices() {
    setDevicesLoading(true)
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
    } finally {
      if (mountedRef.current) setDevicesLoading(false)
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
    const token = getToken()
    const wsUrlWithToken = token ? `${WS_URL}?token=${encodeURIComponent(token)}` : WS_URL
    const ws = new WebSocket(wsUrlWithToken)
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
          const { device_id, ctrl_id, port_num, sensor_type, value, ts, ftype } = payload
          const rKey = getReadingKey(ctrl_id, port_num, sensor_type)

          // Update ctrl HB timestamp — both HB_TYPED and DATA_TYPED keep ctrl alive
          const hbKey = `${device_id}_${ctrl_id}`
          setCtrlHbTs((prev) => ({ ...prev, [hbKey]: Date.now() }))

          // Mark this specific sensor_type as online (sensor_type-aware key prevents
          // a temp HB from marking ghost IMU entries on the same port as active)
          setNodeStatus((prev) => ({
            ...prev,
            [device_id]: { ...(prev[device_id] || {}), [rKey]: 'online' },
          }))

          // Only update displayed value for DATA frames — HB_TYPED (0x05) hanya untuk indikator online
          if (ftype !== 0x05) {
            setLatestData((prev) => ({
              ...prev,
              [device_id]: {
                ...(prev[device_id] || {}),
                [rKey]: { ctrl_id, port_num, sensor_type, value, server_ts: ts },
              },
            }))
            // ctrl_id baru terdeteksi dari DATA (tanpa HELLO) — misal saat ctrl_id ganti tanpa unplug
            const currentNodes = devicesRef.current[device_id]?.nodes || []
            const nodeKnown = currentNodes.some(
              (n) => String(n.ctrl_id) === String(ctrl_id) && String(n.port_num) === String(port_num)
            )
            if (!nodeKnown) {
              clearTimeout(nodeRefreshTimers.current[device_id])
              nodeRefreshTimers.current[device_id] = setTimeout(async () => {
                if (!mountedRef.current) return
                try {
                  const { nodes, ...deviceFields } = await getDevice(device_id)
                  setDevices((prev) => {
                    if (!prev[device_id]) return prev
                    // Never replace with empty — could be transient DB state during reboot
                    const safeNodes = (nodes && nodes.length > 0) ? nodes : prev[device_id].nodes
                    return {
                      ...prev,
                      [device_id]: {
                        ...prev[device_id],
                        device: { ...prev[device_id].device, ...deviceFields },
                        nodes: safeNodes,
                      },
                    }
                  })
                } catch { /* ignore */ }
              }, 1000)
            }
          }
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
          const { device_id, ctrl_id, port_num, sensor_type, status, event } = payload
          // HELLO includes sensor_type → use sensor_type-aware key
          // STALE has no sensor_type → use port-level key (marks entire port stale)
          const key = sensor_type != null
            ? getReadingKey(ctrl_id, port_num, sensor_type)
            : getNodeKey(ctrl_id, port_num)
          setNodeStatus((prev) => ({
            ...prev,
            [device_id]: { ...(prev[device_id] || {}), [key]: status },
          }))
          // Saat HELLO: debounce refresh nodes dari API (tunggu 1s semua HELLO selesai)
          // Ini handle: node baru, ctrl_id ganti, node pindah port
          if (event === 'hello') {
            clearTimeout(nodeRefreshTimers.current[device_id])
            nodeRefreshTimers.current[device_id] = setTimeout(async () => {
              if (!mountedRef.current) return
              try {
                const { nodes, ...deviceFields } = await getDevice(device_id)
                setDevices((prev) => {
                  if (!prev[device_id]) return prev
                  // Never replace with empty — could be transient DB state during reboot
                  const safeNodes = (nodes && nodes.length > 0) ? nodes : prev[device_id].nodes
                  return {
                    ...prev,
                    [device_id]: {
                      ...prev[device_id],
                      device: { ...prev[device_id].device, ...deviceFields },
                      nodes: safeNodes,
                    },
                  }
                })
              } catch { /* ignore */ }
            }, 1000)
          }
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

  // Clear data for a specific port after reset — removes nodes and latestData entries
  function handlePortReset(deviceId, ctrlId, portNum) {
    // Remove nodes from devices state
    setDevices(prev => {
      const entry = prev[deviceId]
      if (!entry) return prev
      const filteredNodes = entry.nodes.filter(
        n => !(String(n.ctrl_id) === String(ctrlId) && String(n.port_num) === String(portNum))
      )
      return { ...prev, [deviceId]: { ...entry, nodes: filteredNodes } }
    })
    // Remove latestData entries for this (ctrlId, portNum)
    setLatestData(prev => {
      const deviceData = prev[deviceId]
      if (!deviceData) return prev
      const updated = { ...deviceData }
      for (const key of Object.keys(updated)) {
        // reading key format: "ctrlId_portNum_sensorType"
        if (key.startsWith(`${ctrlId}_${portNum}_`)) {
          delete updated[key]
        }
      }
      return { ...prev, [deviceId]: updated }
    })
    // Remove nodeStatus entries (both port-level key and all sensor_type-specific keys)
    setNodeStatus(prev => {
      const deviceStatus = prev[deviceId]
      if (!deviceStatus) return prev
      const updated = { ...deviceStatus }
      for (const key of Object.keys(updated)) {
        if (key === `${ctrlId}_${portNum}` || key.startsWith(`${ctrlId}_${portNum}_`)) {
          delete updated[key]
        }
      }
      return { ...prev, [deviceId]: updated }
    })
  }

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
    // Live HB_TYPED arrives every 15s — check if received within 30s
    const hbKey = `${selectedDeviceId}_${ctrlId}`
    const lastHb = ctrlHbTs[hbKey]
    if (lastHb != null && (now - lastHb) < 30000) return true

    // Fallback: node.last_seen from API (covers first 30s before any HB arrives on page load)
    const ctrlNodes = selectedNodes.filter((n) => String(n.ctrl_id) === String(ctrlId))
    const maxLastSeen = Math.max(
      ...ctrlNodes.map((n) => n.last_seen ? new Date(n.last_seen).getTime() : 0),
      0
    )
    return maxLastSeen > 0 && (now - maxLastSeen) < 30000
  }

  const connMode = selectedDevice?.conn_mode || null


  // ══════════════════════════════════════════════════
  // Shared page shell (background + blur orbs)
  // ══════════════════════════════════════════════════
  const shell = (children, showHeader = false) => (
    <div
      className="min-h-screen font-['Noto_Sans_JP','Hiragino_Kaku_Gothic_ProN','Yu_Gothic_UI',system-ui,sans-serif]
                 selection:bg-emerald-300/30 selection:text-white
                 bg-slate-50 text-slate-900 dark:text-white
                 dark:bg-slate-950
                 transition-colors duration-300"
    >

      {showHeader && (
        <header className="sticky top-0 z-40 bg-white/90 dark:bg-slate-950/90 backdrop-blur-sm border-b border-black/5 dark:border-white/5">
          <div className="mx-auto max-w-7xl px-5 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between py-4">

              {/* Left: logo */}
              <div className="flex items-center gap-2 sm:gap-3">
                <div className="flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-full bg-black/5 dark:bg-white/10 shrink-0">
                  <Activity className="h-4 w-4 sm:h-5 sm:w-5 text-slate-700 dark:text-white" />
                </div>
                <div>
                  <p className="text-sm sm:text-base font-semibold tracking-tight text-slate-900 dark:text-white leading-none">CIREN</p>
                  <p className="hidden sm:block text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    {selectedDevice ? selectedDevice.device_id : (t.dashboard?.subtitle || 'IoT Monitoring')}
                  </p>
                </div>
              </div>

              {/* ── Desktop nav (≥640px) ── */}
              <div className="hidden sm:flex items-center gap-3">
                {/* WS status */}
                <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${wsColors[wsStatus]}`} />
                  <span>{wsLabels[wsStatus]}</span>
                </div>
                {/* Clock */}
                <span className="text-xs text-gray-400 dark:text-gray-500 tabular-nums hidden lg:inline">
                  {currentTime.toLocaleTimeString()}
                </span>
                {/* Theme */}
                <button onClick={toggleTheme} aria-label="Toggle theme"
                  className="inline-flex items-center gap-1.5 rounded-md border border-black/10 bg-black/5 px-3 py-1.5 text-xs text-gray-700 hover:bg-black/10 dark:border-white/10 dark:bg-white/10 dark:text-gray-200 dark:hover:bg-white/20 transition-colors cursor-pointer">
                  {theme === 'dark' ? <Sun size={13} /> : <Moon size={13} />}
                  <span>{theme === 'dark' ? (lang === 'ja' ? 'ライト' : 'Light') : (lang === 'ja' ? 'ダーク' : 'Dark')}</span>
                </button>
                {/* Language */}
                <div className="flex items-center gap-1.5">
                  <Globe size={14} className="text-gray-400" />
                  <div className="inline-flex rounded-md bg-black/5 p-0.5 border border-black/10 dark:border-white/10 dark:bg-white/10">
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
                </div>
                {/* Devices */}
                <button onClick={() => setPage(PAGE_DEVICES)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-black/10 bg-black/5 px-3 py-1.5 text-xs text-gray-700 hover:bg-black/10 dark:border-white/10 dark:bg-white/10 dark:text-gray-200 dark:hover:bg-white/20 transition-colors cursor-pointer">
                  <Settings size={13} /><span>Devices</span>
                </button>
                {/* Logout */}
                <button onClick={handleLogout}
                  className="inline-flex items-center gap-1.5 rounded-md border border-black/10 bg-black/5 px-3 py-1.5 text-xs text-gray-700 hover:bg-black/10 dark:border-white/10 dark:bg-white/10 dark:text-gray-200 dark:hover:bg-white/20 transition-colors cursor-pointer">
                  <LogOut size={13} /><span>{lang === 'ja' ? 'ログアウト' : 'Sign out'}</span>
                </button>
              </div>

              {/* ── Mobile nav (<640px): hamburger only ── */}
              <div className="relative flex sm:hidden">
                <button
                  onClick={() => setMobileMenuOpen((o) => !o)}
                  className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-black/5 text-slate-700 hover:bg-black/10 dark:bg-white/10 dark:text-white dark:hover:bg-white/20 transition-colors cursor-pointer"
                  aria-label="Menu"
                >
                  {mobileMenuOpen ? <X size={18} /> : <Menu size={18} />}
                </button>

                {mobileMenuOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setMobileMenuOpen(false)} />
                    <div className="absolute right-0 top-full mt-2 z-50 w-56 rounded-2xl border border-black/10 bg-white shadow-xl dark:border-white/10 dark:bg-slate-900 overflow-hidden">

                      {/* Status row */}
                      <div className="flex items-center gap-2 px-4 py-3 border-b border-black/5 dark:border-white/5">
                        <span className={`w-2 h-2 rounded-full shrink-0 ${wsColors[wsStatus]}`} />
                        <span className="text-xs text-gray-500 dark:text-gray-400">{wsLabels[wsStatus]}</span>
                        <span className="ml-auto text-xs text-gray-400 dark:text-gray-500 tabular-nums">{currentTime.toLocaleTimeString()}</span>
                      </div>

                      {/* Theme */}
                      <button onClick={() => { toggleTheme(); setMobileMenuOpen(false) }}
                        className="w-full flex items-center gap-3 px-4 py-3 text-sm text-slate-700 hover:bg-black/5 dark:text-gray-200 dark:hover:bg-white/10 transition-colors cursor-pointer border-b border-black/5 dark:border-white/5">
                        {theme === 'dark' ? <Sun size={15} className="text-yellow-400 shrink-0" /> : <Moon size={15} className="text-indigo-500 shrink-0" />}
                        {theme === 'dark' ? (lang === 'ja' ? 'ライトモード' : 'Light mode') : (lang === 'ja' ? 'ダークモード' : 'Dark mode')}
                      </button>

                      {/* Language */}
                      <div className="px-4 py-3 flex items-center gap-2 border-b border-black/5 dark:border-white/5">
                        <Globe size={15} className="text-gray-400 shrink-0" />
                        <span className="text-sm text-slate-700 dark:text-gray-200 mr-auto">{lang === 'ja' ? '言語' : 'Language'}</span>
                        <div className="flex gap-1">
                          {['ja', 'en'].map((l) => (
                            <button key={l} onClick={() => { setLang(l); setMobileMenuOpen(false) }}
                              className={`px-2.5 py-1 text-xs rounded-md cursor-pointer transition-colors ${lang === l
                                ? (theme === 'dark' ? 'bg-white text-slate-900' : 'bg-slate-900 text-white')
                                : 'border border-black/10 dark:border-white/15 text-gray-600 dark:text-gray-300'
                              }`}>
                              {l === 'ja' ? 'JP' : 'EN'}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Devices */}
                      <button onClick={() => { setPage(PAGE_DEVICES); setMobileMenuOpen(false) }}
                        className="w-full flex items-center gap-3 px-4 py-3 text-sm text-slate-700 hover:bg-black/5 dark:text-gray-200 dark:hover:bg-white/10 transition-colors cursor-pointer border-b border-black/5 dark:border-white/5">
                        <Settings size={15} className="text-gray-400 shrink-0" />
                        {lang === 'ja' ? 'デバイス管理' : 'Devices'}
                      </button>

                      {/* Sign out */}
                      <button onClick={() => { handleLogout(); setMobileMenuOpen(false) }}
                        className="w-full flex items-center gap-3 px-4 py-3 text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10 transition-colors cursor-pointer">
                        <LogOut size={15} className="shrink-0" />
                        {lang === 'ja' ? 'ログアウト' : 'Sign out'}
                      </button>
                    </div>
                  </>
                )}
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

      {/* Loading skeleton */}
      {devicesLoading && (
        <div className="space-y-6 animate-pulse">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2 rounded-2xl border border-black/10 bg-slate-100 dark:border-white/10 dark:bg-slate-800 h-48 md:h-[26rem]" />
            <div className="rounded-2xl border border-black/10 bg-slate-100 dark:border-white/10 dark:bg-slate-800 h-32 md:h-[26rem]" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="rounded-xl border border-black/10 bg-slate-100 dark:border-white/10 dark:bg-slate-800 h-28" />
            ))}
          </div>
        </div>
      )}

      {/* No device state */}
      {!devicesLoading && !selectedDevice && (
        <div className="rounded-2xl border border-black/10 bg-white p-12 dark:border-white/10 dark:bg-slate-800 text-center">
          <Cpu className="mx-auto mb-3 w-10 h-10 text-slate-300 dark:text-gray-600" />
          <p className="text-slate-500 dark:text-gray-400">
            {deviceIds.length === 0 ? 'No devices found. Waiting for data…' : 'Select a device above.'}
          </p>
        </div>
      )}

      {/* Device overview */}
      {!devicesLoading && selectedDevice && (
        <>
          {/* Top: Controller cards (left) + Main Module Status (right compact) */}
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 items-start">

            {/* Controller cards — 3/4 width */}
            <div className="lg:col-span-3 order-2 lg:order-1">
              <h3 className="text-base font-semibold mb-3 text-slate-900 dark:text-white">
                {t.dashboard?.sensorControllers || 'Sensor Controllers'}
              </h3>
              {ctrlIds.length === 0 ? (
                <div className="rounded-2xl border border-black/10 bg-white/80 p-8 backdrop-blur-sm dark:border-white/10 dark:bg-slate-800/60 shadow-sm text-center">
                  <p className="text-sm text-slate-400 dark:text-gray-500">
                    {t.dashboard?.noHubDetected || 'No sensor controllers registered for this device.'}
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                  {ctrlIds.map((ctrlId) => {
                    const online = isCtrlOnline(ctrlId)
                    const isSelected = selectedCtrlId === String(ctrlId)
                    const ctrlNodes = selectedNodes.filter((n) => String(n.ctrl_id) === String(ctrlId))
                    const activeNodes = ctrlNodes.filter((n) => n.status === 'online')
                    const displayCount = countDisplayNodes(activeNodes)

                    const hbKey = `${selectedDeviceId}_${ctrlId}`
                    const lastSeenMs = Math.max(
                      ctrlHbTs[hbKey] || 0,
                      ...ctrlNodes.map((n) => n.last_seen ? new Date(n.last_seen).getTime() : 0),
                      0
                    )

                    if (!online && lastSeenMs > 0 && (now - lastSeenMs) > 24 * 60 * 60 * 1000) return null
                    if (!online && lastSeenMs === 0) return null

                    const lastSeenLabel = lastSeenMs > 0
                      ? (() => {
                          const diff = Math.floor((now - lastSeenMs) / 1000)
                          if (diff < 60)   return `${diff}s ago`
                          if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
                          return `${Math.floor(diff / 3600)}h ago`
                        })()
                      : null

                    return (
                      <div
                        key={ctrlId}
                        className={`rounded-xl border bg-white/80 p-4 backdrop-blur-sm dark:bg-slate-800/60 shadow-sm transition-all ${
                          isSelected
                            ? 'border-cyan-500/60 ring-2 ring-cyan-500/20 dark:border-cyan-400/50'
                            : 'border-black/10 dark:border-white/10 hover:border-black/20 dark:hover:border-white/30'
                        }`}
                      >
                        <div className="flex items-center gap-3 mb-3">
                          <div className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${online ? 'bg-gradient-to-r from-cyan-500 to-indigo-500' : 'bg-slate-200 dark:bg-slate-700'}`}>
                            <Cpu className={`w-4 h-4 ${online ? 'text-white' : 'text-slate-400 dark:text-slate-500'}`} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-slate-900 dark:text-white truncate text-sm">Controller {ctrlId}</p>
                            <p className="text-xs text-slate-500 dark:text-gray-400">
                              {displayCount} node{displayCount !== 1 ? 's' : ''}
                              {!online && lastSeenLabel && <span className="ml-1">· {lastSeenLabel}</span>}
                            </p>
                          </div>
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full shrink-0 ${
                            online
                              ? 'bg-green-500/10 text-green-700 dark:text-green-400'
                              : 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400'
                          }`}>
                            {online ? (t.dashboard?.online || 'Online') : (t.dashboard?.offline || 'Offline')}
                          </span>
                        </div>
                        <button
                          onClick={() => {
                            const next = isSelected ? null : String(ctrlId)
                            setSelectedCtrlId(next)
                            if (next) setTimeout(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80)
                          }}
                          className={`w-full rounded-lg py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                            isSelected
                              ? 'bg-cyan-500 hover:bg-cyan-600 text-white'
                              : 'bg-slate-900 hover:bg-slate-800 text-white dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100'
                          }`}
                        >
                          {isSelected ? '▲ ' + (t.controllerDetail?.back || 'Close') : (t.dashboard?.viewDetails || 'View Details')}
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Main Module Status — compact right sidebar */}
            <div className="lg:col-span-1 order-1 lg:order-2">
              <h3 className="text-base font-semibold mb-3 text-slate-900 dark:text-white">
                {t.dashboard?.mainModuleStatus || 'Main Module Status'}
              </h3>
              <div className="rounded-2xl border border-black/10 bg-white/80 p-3 backdrop-blur-sm dark:border-white/10 dark:bg-slate-800/60 shadow-sm divide-y divide-black/5 dark:divide-white/5">

                {/* Online status */}
                <div className="flex items-center justify-between py-2 first:pt-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${selectedDevice.status === 'online' ? 'bg-green-400' : 'bg-slate-300 dark:bg-slate-600'}`} />
                    <span className="text-xs text-slate-500 dark:text-gray-400">{t.dashboard?.liveStatus || 'Live Status'}</span>
                  </div>
                  <span className={`text-xs font-semibold ${selectedDevice.status === 'online' ? 'text-green-600 dark:text-green-400' : 'text-slate-400'}`}>
                    {selectedDevice.status === 'online' ? (t.dashboard?.online || 'ONLINE') : '—'}
                  </span>
                </div>

                {/* Connectivity mode */}
                <div className="flex items-center gap-2 py-2">
                  {connMode === 'wifi'
                    ? <Wifi size={13} className="text-cyan-500 shrink-0" />
                    : <Signal size={13} className="text-indigo-500 shrink-0" />
                  }
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] text-slate-400 dark:text-gray-500 leading-none mb-0.5">Connectivity</p>
                    <div className="flex items-center gap-1.5">
                      {connMode ? (
                        <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded-md ${
                          connMode === 'wifi'
                            ? 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400'
                            : 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400'
                        }`}>
                          {connMode === 'wifi' ? 'WiFi' : 'CAT-M'}
                        </span>
                      ) : (
                        <span className="text-[11px] text-slate-400">—</span>
                      )}
                      {selectedDevice.rssi != null && (
                        <span className="text-[11px] font-mono text-slate-500 dark:text-gray-400">
                          {selectedDevice.rssi} dBm
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Battery */}
                {selectedDevice.batt_pct != null && (
                  <div className="flex items-center gap-2 py-2">
                    <Battery size={13} className={`shrink-0 ${
                      selectedDevice.batt_pct <= 20 ? 'text-red-500' :
                      selectedDevice.batt_pct <= 50 ? 'text-yellow-500' : 'text-green-500'
                    }`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] text-slate-400 dark:text-gray-500 leading-none mb-0.5">Battery</p>
                      <p className="text-[11px] font-mono text-slate-900 dark:text-white">
                        {selectedDevice.batt_pct}%
                      </p>
                    </div>
                  </div>
                )}

                {/* Controllers count */}
                <div className="flex items-center gap-2 py-2">
                  <Cpu size={13} className="text-indigo-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] text-slate-400 dark:text-gray-500 leading-none mb-0.5">Controllers</p>
                    <p className="text-[11px] text-slate-900 dark:text-white">
                      {ctrlIds.filter(isCtrlOnline).length} online · {ctrlIds.length} total
                    </p>
                  </div>
                </div>

                {/* Firmware */}
                <div className="flex items-center gap-2 py-2 last:pb-0">
                  <Zap size={13} className="text-yellow-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] text-slate-400 dark:text-gray-500 leading-none mb-0.5">Firmware</p>
                    <p className="text-[11px] font-mono text-slate-900 dark:text-white truncate">
                      {selectedDevice.fw_version || '—'}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Controller Detail — inline below, no page navigation */}
          {selectedCtrlId && (
            <div ref={detailRef} className="scroll-mt-4">
              <ControllerDetailView
                ctrlId={selectedCtrlId}
                deviceId={selectedDeviceId}
                nodes={selectedNodes}
                latestData={selectedLatest}
                nodeStatus={selectedNodeStatus}
                now={now}
                onBack={() => setSelectedCtrlId(null)}
                onPortReset={handlePortReset}
                wsRef={wsRef}
                t={t}
              />
            </div>
          )}

          {/* Footer */}
          <div className="text-center text-[11px] text-slate-400 dark:text-gray-600 pb-2">
            {t.dashboard?.footer || '© 2025 CIREN Dashboard'}
          </div>
        </>
      )}
    </main>,
    true  // showHeader = true for dashboard
  )
}
