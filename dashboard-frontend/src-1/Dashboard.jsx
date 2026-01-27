// src/Dashboard.jsx - IMPROVED VERSION
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, Thermometer, Gauge, MapPin, Clock, Cpu, Wifi, Zap, Eye,
  Settings, Battery, ArrowLeft, Globe, Sun, Moon, TrendingUp, Layers
} from 'lucide-react';
import { translations } from './utils/translation';
import { fmtHHMMSS, fmtJaTime } from './utils/helpers';
import LeafletMap from './components/LeafletMap';
import ControllerDetailView from './components/ControllerDetailView';

// Konfigurasi dasar
const API_BASE = import.meta.env.VITE_API_BASE || '';
const HUB_OFFLINE_MS = 12_000;
const NODE_OFFLINE_MS = 8_000;
const RASPI_ALIVE_MS = 15_000;
const MAX_HUB_AGE = 10_000;
const GPS_TIMEOUT_MS = 15000; // 15 detik

// ============================ Main Component ============================
export default function Dashboard() {
  const usernameProp = "raihan";
  const [language, setLanguage] = useState('ja');
  const t = useMemo(() => translations[language], [language]);

  const [theme, setTheme] = useState(() => {
    const prefersDark = typeof window !== 'undefined'
      && window.matchMedia('(prefers-color-scheme: dark)').matches;
    return prefersDark ? 'dark' : 'light';
  });

  useEffect(() => {
    const html = document.querySelector('html');
    if (!html) return;
    html.classList.toggle('dark', theme === 'dark');
    html.style.colorScheme = theme;
  }, [theme]);

  // --- State utama ---
  const [raspiID, setRaspiID] = useState(null);
  const [controllersLatest, setControllersLatest] = useState([]);
  const [selectedControllerId, setSelectedControllerId] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);

  const [raspiStatus, setRaspiStatus] = useState({ lastTs: 0, tempC: null, uptimeS: null });
  const [currentTime, setCurrentTime] = useState(new Date());
  const [startTime] = useState(new Date());
  const [runningTime, setRunningTime] = useState('00:00:00');
  const [gpsDisconnected, setGpsDisconnected] = useState(false);

  const [gpsData, gpsDataSet] = useState();

  // NEW: Aggregate sensor statistics
  const [sensorStats, setSensorStats] = useState({
    totalSensors: 0,
    activeSensors: 0,
    sensorTypes: {},
    avgBattery: 0,
    avgSignal: 0
  });

  useEffect(() => {
    if (gpsData) {
      // console.log("gpsData updated:", gpsData);
    }
  }, [gpsData]);

  // --- Timer waktu lokal ---
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
      const diff = Math.floor((new Date() - startTime) / 1000);
      setRunningTime(fmtHHMMSS(diff));
    }, 1000);
    return () => clearInterval(timer);
  }, [startTime]);

  useEffect(() => {
    let stop = false;
    let pollId;

    async function resolveAndLoad() {
      try {
        setLoading(true);
        setErr(null);

        // resolve alias → raspi_serial_id
        const r = await fetch(`${API_BASE}/api/resolve/${encodeURIComponent(usernameProp)}`);
        if (!r.ok) throw new Error("resolve failed");
        const jr = await r.json();
        const raspiId = jr.raspi_serial_id;

        if (stop) return;

        console.log(raspiId);

        setRaspiID(raspiId);

        await fetchAndBuild(raspiId);
        pollId = setInterval(() => fetchAndBuild(raspiId), 1000);
      } catch (e) {
        if (!stop) setErr(e.message || String(e));
      } finally {
        if (!stop) setLoading(false);
      }
    }

    async function fetchAndBuild(raspiId) {
      try {
        const hubRes = await fetch(`${API_BASE}/api/data/${raspiId}`);
        if (!hubRes.ok) throw new Error("failed /api/data");
        const hubJson = await hubRes.json();

        // ---- Raspi status dari /api/data
        const rs = hubJson.raspi_status || null;
        const lastTs = rs?.last_seen ? new Date(rs.last_seen).getTime() : 0;
        const tempC = typeof rs?.temp_c === 'number' ? rs.temp_c : null;
        const uptimeS = typeof rs?.uptime_s === 'number' ? rs.uptime_s : null;
        setRaspiStatus({ lastTs, tempC, uptimeS });

        // ---- Hubs (grouped) → flatten kartu controller terbaru saja
        const hubsRaw = hubJson.hubs || {};
        const now = Date.now();
        const newControllers = [];

        // NEW: Calculate sensor statistics
        let totalSensors = 0;
        let activeSensors = 0;
        const sensorTypes = {};
        let totalBattery = 0;
        let totalSignal = 0;
        let controllerCount = 0;

        for (const hubId of Object.keys(hubsRaw)) {
          const records = hubsRaw[hubId];
          if (!Array.isArray(records) || records.length === 0) continue;

          const latest = records[0];
          const ts = new Date(latest.timestamp).getTime();
          // skip jika last seen > MAX_HUB_AGE
          if (now - ts > MAX_HUB_AGE) continue;

          const nodes = latest.nodes || [];
          totalSensors += nodes.length;
          activeSensors += nodes.filter(n => n.status === 'online').length;

          // Count sensor types
          nodes.forEach(n => {
            const type = n.sensor_type || 'unknown';
            sensorTypes[type] = (sensorTypes[type] || 0) + 1;
          });

          // Aggregate battery and signal
          if (typeof latest.battery_level === 'number') {
            totalBattery += latest.battery_level;
            controllerCount++;
          }
          if (typeof latest.signal_strength === 'number') {
            totalSignal += latest.signal_strength;
          }

          newControllers.push({
            raspi_id: hubJson.raspi_serial_id,
            sensor_controller_id: hubId,
            sensor_nodes: nodes,
            last_seen: ts,
            battery_level: latest.battery_level || 0,
            signal_strength: latest.signal_strength || 0,
            controller_status: latest.controller_status || 'unknown',
            ports_connected: latest.ports_connected || 0,
          });
        }

        newControllers.sort((a, b) => Number(a.sensor_controller_id) - Number(b.sensor_controller_id));
        setControllersLatest(newControllers);

        // Set sensor statistics
        setSensorStats({
          totalSensors,
          activeSensors,
          sensorTypes,
          avgBattery: controllerCount > 0 ? Math.round(totalBattery / controllerCount) : 0,
          avgSignal: controllerCount > 0 ? Math.round(totalSignal / controllerCount) : 0,
        });

        // ---- GPS
        const gps = hubJson.gps || null;
        gpsDataSet(gps);

        const checkConnection = () => {
          const ts = gps?.timestamp ? new Date(gps.timestamp).getTime() : 0;
          const now = Date.now();
          setGpsDisconnected(!gps || (now - ts > GPS_TIMEOUT_MS));
        };
        checkConnection();

      } catch (e) {
        setErr(e.message || String(e));
      }
    }

    resolveAndLoad();
    return () => {
      stop = true;
      if (pollId) clearInterval(pollId);
    };
  }, [usernameProp]);


  // --- Kondisi tampilan ---
  if (loading && !raspiID) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
        <div className="rounded-lg border border-black/10 bg-white/80 p-6 backdrop-blur-sm dark:border-white/10 dark:bg-slate-800/60 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-cyan-500 border-t-transparent"></div>
            <span className="text-sm text-slate-700 dark:text-slate-300">Loading...</span>
          </div>
        </div>
      </div>
    );
  }

  if (err && !raspiID) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-6 dark:bg-red-900/20">
          <p className="text-sm text-red-800 dark:text-red-200">
            Error: {err}
          </p>
        </div>
      </div>
    );
  }

  const selectedController = controllersLatest.find(
    (c) => c.sensor_controller_id === selectedControllerId
  );

  const now = Date.now();
  const raspiIsOnline = now - raspiStatus.lastTs < RASPI_ALIVE_MS;
  const uptimeStr = raspiStatus.uptimeS
    ? fmtHHMMSS(raspiStatus.uptimeS)
    : "—";
  const tempStr = typeof raspiStatus.tempC === 'number'
    ? `${raspiStatus.tempC.toFixed(1)} °C`
    : "—";

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 
                    dark:from-slate-900 dark:via-slate-800 dark:to-slate-900 transition-colors duration-300">
      <div className="mx-auto max-w-[1600px] px-4 py-6 md:px-6 md:py-8">
        <div className="space-y-6">
          <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
                {t.dashboard.title}
              </h1>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                {t.dashboard.subtitle}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                className="inline-flex items-center gap-2 rounded-md border border-black/10 bg-black/5 px-3 py-1 text-xs text-gray-700 hover:bg-black/10 dark:border-white/10 dark:bg-white/10 dark:text-gray-200 dark:hover:bg-white/20"
              >
                {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </button>

              <button
                type="button"
                onClick={() => setLanguage(language === 'en' ? 'ja' : 'en')}
                className="inline-flex items-center gap-2 rounded-md border border-black/10 bg-black/5 px-3 py-1 text-xs text-gray-700 hover:bg-black/10 dark:border-white/10 dark:bg-white/10 dark:text-gray-200 dark:hover:bg-white/20"
              >
                <Globe className="w-4 h-4" />
                <span>{language === 'en' ? '日本語' : 'EN'}</span>
              </button>
            </div>
          </header>

          <div className="mb-6 text-right text-[11px] font-mono text-gray-600 dark:text-gray-400">
            {fmtJaTime(currentTime, t.locale)}
          </div>

          {selectedController ? (
            <ControllerDetailView
              controller={selectedController}
              onBack={() => setSelectedControllerId(null)}
              t={t}
            />
          ) : (
            <div className="space-y-6">
              {/* NEW: Sensor Statistics Overview */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard
                  icon={<Layers className="h-5 w-5" />}
                  label="Total Sensors"
                  value={sensorStats.totalSensors}
                  color="cyan"
                />
                <StatCard
                  icon={<Activity className="h-5 w-5" />}
                  label="Active Sensors"
                  value={sensorStats.activeSensors}
                  color="green"
                  subtitle={`${sensorStats.totalSensors > 0 ? Math.round((sensorStats.activeSensors / sensorStats.totalSensors) * 100) : 0}% online`}
                />
                <StatCard
                  icon={<Battery className="h-5 w-5" />}
                  label="Avg Battery"
                  value={`${sensorStats.avgBattery}%`}
                  color="amber"
                />
                <StatCard
                  icon={<Wifi className="h-5 w-5" />}
                  label="Avg Signal"
                  value={`${sensorStats.avgSignal} dBm`}
                  color="indigo"
                />
              </div>

              {/* Map + Status */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 rounded-2xl border border-black/10 bg-white/80 p-4 backdrop-blur-sm 
                                dark:border-white/10 dark:bg-slate-800/60 shadow-sm h-[26rem] relative">
                  <h2 className="text-base font-medium tracking-tight text-slate-900 dark:text-white flex items-center gap-2 mb-3">
                    <MapPin className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />
                    <span>{t.dashboard.controllerPositions}</span>
                  </h2>
                  <div className="w-full h-[calc(100%-2.5rem)]">
                    <LeafletMap gpsData={gpsData} />
                  </div>
                  {gpsDisconnected && (
                    <div className="absolute top-3 right-3 bg-red-600 text-white text-xs font-medium px-3 py-2 rounded-lg shadow-lg animate-pulse transition-opacity duration-300 z-100">
                      GPS not connected
                    </div>
                  )}
                </div>

                <div className="rounded-2xl border border-black/10 bg-white/80 p-4 backdrop-blur-sm 
                                dark:border-white/10 dark:bg-slate-800/60 shadow-sm flex flex-col">
                  <h2 className="text-base font-medium tracking-tight text-slate-900 dark:text-white flex items-center gap-2 mb-4">
                    <Gauge className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
                    <span>{t.dashboard.mainModuleStatus}</span>
                  </h2>

                  <div className="space-y-3 text-sm flex-grow">
                    <div className="rounded-xl border border-black/10 bg-white/70 p-3 backdrop-blur-sm 
                                    dark:border-white/10 dark:bg-slate-800/60 flex justify-between">
                      <span className="text-gray-600 dark:text-gray-400 flex items-center gap-2">
                        <Eye className="w-4 h-4" />{t.dashboard.liveStatus}
                      </span>
                      <span className={`font-semibold ${raspiIsOnline ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                        {raspiIsOnline ? t.dashboard.online : 'OFFLINE'}
                      </span>
                    </div>

                    <div className="rounded-xl border border-black/10 bg-white/70 p-3 backdrop-blur-sm 
                                    dark:border-white/10 dark:bg-slate-800/60 flex justify-between">
                      <span className="text-gray-600 dark:text-gray-400 flex items-center gap-2">
                        <Clock className="w-4 h-4" />{t.dashboard.runningTime}
                      </span>
                      <span className="font-mono text-slate-900 dark:text-white font-medium">{uptimeStr}</span>
                    </div>

                    <div className="rounded-xl border border-black/10 bg-white/70 p-3 backdrop-blur-sm 
                                    dark:border-white/10 dark:bg-slate-800/60 flex justify-between">
                      <span className="text-gray-600 dark:text-gray-400 flex items-center gap-2">
                        <Thermometer className="w-4 h-4" />{t.dashboard.avgTemp}
                      </span>
                      <span className="font-mono text-slate-900 dark:text-white font-medium">{tempStr}</span>
                    </div>
                  </div>

                  <p className="text-center mt-4 text-gray-500 dark:text-gray-500 text-xs">
                    {t.dashboard.footer}
                  </p>
                </div>
              </div>

              {/* Sensor Type Distribution */}
              {Object.keys(sensorStats.sensorTypes).length > 0 && (
                <div className="rounded-2xl border border-black/10 bg-white/80 p-4 backdrop-blur-sm 
                                dark:border-white/10 dark:bg-slate-800/60 shadow-sm">
                  <h2 className="text-base font-medium tracking-tight text-slate-900 dark:text-white flex items-center gap-2 mb-4">
                    <TrendingUp className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />
                    <span>Sensor Type Distribution</span>
                  </h2>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                    {Object.entries(sensorStats.sensorTypes).map(([type, count]) => (
                      <div key={type} className="rounded-lg border border-black/10 bg-white/70 p-3 
                                                  dark:border-white/10 dark:bg-slate-800/60">
                        <div className="text-2xl font-bold text-slate-900 dark:text-white">{count}</div>
                        <div className="text-xs text-gray-600 dark:text-gray-400 capitalize">{type.replace('_', ' ')}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Controllers list */}
              <div>
                <h2 className="text-base font-medium tracking-tight text-slate-900 dark:text-white flex items-center gap-2 mb-4">
                  <Settings className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />
                  <span>{t.dashboard.sensorControllers}</span>
                </h2>

                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {controllersLatest.map((controller, idx) => {
                    const online = controller.controller_status === 'online';
                    const hasNodes = controller.sensor_nodes.length > 0;
                    return (
                      <div
                        key={idx}
                        className="rounded-xl border border-black/10 bg-white/80 p-4 backdrop-blur-sm 
                                   dark:border-white/10 dark:bg-slate-800/60 shadow-sm 
                                   hover:border-black/20 dark:hover:border-white/30 transition-all"
                      >
                        <div className="flex items-center justify-between mb-4">
                          <div className="flex h-10 w-10 items-center justify-center rounded-lg 
                                          bg-gradient-to-r from-cyan-500 to-indigo-500">
                            <Cpu className="h-5 w-5 text-white" />
                          </div>
                          <div className="text-right">
                            <div className="font-semibold text-slate-900 dark:text-white tracking-tight">
                              Hub {controller.sensor_controller_id}
                            </div>
                            <div className="text-xs text-gray-600 dark:text-gray-400">
                              {hasNodes
                                ? `${controller.sensor_nodes.length} ${t.dashboard.nodesActive}`
                                : <span className="text-yellow-700 dark:text-yellow-300">{t.dashboard.noNode}</span>
                              }
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-3 gap-2 mb-4">
                          <div className="rounded-lg border border-black/10 bg-white/70 p-2 backdrop-blur-sm 
                                          dark:border-white/10 dark:bg-slate-800/60 flex items-center justify-between">
                            <Battery className="w-4 h-4 text-green-600 dark:text-green-400" />
                            <span className="text-xs font-semibold text-slate-900 dark:text-white">
                              {controller.battery_level}%
                            </span>
                          </div>

                          <div className="rounded-lg border border-black/10 bg-white/70 p-2 backdrop-blur-sm 
                                          dark:border-white/10 dark:bg-slate-800/60 flex items-center justify-between">
                            <Wifi className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
                            <span className="text-xs font-semibold text-slate-900 dark:text-white">
                              {controller.signal_strength}
                            </span>
                          </div>

                          <div className="rounded-lg border border-black/10 bg-white/70 p-2 backdrop-blur-sm 
                                          dark:border-white/10 dark:bg-slate-800/60 flex items-center justify-between">
                            <Eye className={`w-4 h-4 ${online ? 'text-green-600 dark:text-green-400' : 'text-gray-400'}`} />
                            <span className={`text-xs font-semibold ${online ? 'text-green-600 dark:text-green-400' : 'text-gray-500'}`}>
                              {online ? 'ON' : 'OFF'}
                            </span>
                          </div>
                        </div>

                        {/* Quick sensor preview */}
                        {hasNodes && (
                          <div className="mb-3 text-xs text-gray-600 dark:text-gray-400">
                            <div className="flex flex-wrap gap-1">
                              {controller.sensor_nodes.slice(0, 4).map((node, i) => (
                                <span key={i} className="bg-black/5 dark:bg-white/10 px-2 py-1 rounded">
                                  {node.node_id}
                                </span>
                              ))}
                              {controller.sensor_nodes.length > 4 && (
                                <span className="bg-black/5 dark:bg-white/10 px-2 py-1 rounded">
                                  +{controller.sensor_nodes.length - 4}
                                </span>
                              )}
                            </div>
                          </div>
                        )}

                        <button
                          onClick={() => setSelectedControllerId(controller.sensor_controller_id)}
                          className="w-full inline-flex items-center justify-center gap-2 rounded-lg 
                                     bg-slate-900 px-4 py-2 text-sm font-medium text-white 
                                     hover:bg-slate-800 focus:ring-2 focus:ring-cyan-400 
                                     dark:bg-white dark:text-slate-900 dark:hover:bg-gray-100"
                        >
                          <Eye className="w-4 h-4" />
                          <span>{t.dashboard.viewDetails}</span>
                        </button>
                      </div>
                    );
                  })}

                  {controllersLatest.length === 0 && (
                    <div className="col-span-full rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-4 
                                    text-sm text-yellow-800 dark:text-yellow-200">
                      {t.dashboard.noHubDetected} <b>{raspiID || "—"}</b>.
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// NEW: StatCard component for statistics
function StatCard({ icon, label, value, color, subtitle }) {
  const colorClasses = {
    cyan: 'text-cyan-600 dark:text-cyan-400 bg-cyan-500/10',
    green: 'text-green-600 dark:text-green-400 bg-green-500/10',
    amber: 'text-amber-600 dark:text-amber-400 bg-amber-500/10',
    indigo: 'text-indigo-600 dark:text-indigo-400 bg-indigo-500/10',
  };

  return (
    <div className="rounded-xl border border-black/10 bg-white/80 p-4 backdrop-blur-sm 
                    dark:border-white/10 dark:bg-slate-800/60 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${colorClasses[color]}`}>
          {icon}
        </div>
      </div>
      <div className="text-2xl font-bold text-slate-900 dark:text-white">{value}</div>
      <div className="text-xs text-gray-600 dark:text-gray-400">{label}</div>
      {subtitle && (
        <div className="text-[10px] text-gray-500 dark:text-gray-500 mt-1">{subtitle}</div>
      )}
    </div>
  );
}
