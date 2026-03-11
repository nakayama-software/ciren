// src/Dashboard.jsx
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, Thermometer, Gauge, MapPin, Clock, Cpu, Wifi, Eye,
  Settings, Battery, Globe, Sun, Moon
} from 'lucide-react';
import { translations } from './utils/translation';
import { fmtHHMMSS, fmtJaTime, normalizeSensorNode } from './utils/helpers';
import LeafletMap from './components/LeafletMap';
import ControllerDetailView from './components/ControllerDetailView';
import AliasInlineEdit from './components/AliasInlineEdit';
import { useParams } from 'react-router-dom';

const API_BASE       = import.meta.env.VITE_API_BASE || '';
const RASPI_ALIVE_MS = 120_000;
const GPS_TIMEOUT_MS = 120_000;
const POLL_MS        = 100;

export default function Dashboard() {
  const { userID } = useParams();
  const inFlightRef        = useRef(false);
  const selectedRaspiIdRef = useRef(null);

  const [language, setLanguage] = useState('ja');
  const t = useMemo(() => translations[language], [language]);

  const [theme, setTheme] = useState(() => {
    const prefersDark =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches;
    return prefersDark ? 'dark' : 'light';
  });

  useEffect(() => {
    const html = document.querySelector('html');
    if (!html) return;
    html.classList.toggle('dark', theme === 'dark');
    html.style.colorScheme = theme;
  }, [theme]);

  const [raspis,               setRaspis]               = useState([]);
  const [selectedRaspiId,      setSelectedRaspiId]      = useState(null);
  const [selectedControllerId, setSelectedControllerId] = useState(null);
  const [fetchError,  setFetchError]  = useState(null);
  const [lastOkAt,    setLastOkAt]    = useState(0);
  const [loading,     setLoading]     = useState(true);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [startTime]                   = useState(new Date());
  const [runningTime, setRunningTime] = useState('00:00:00');

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
      const diff = Math.floor((new Date() - startTime) / 1000);
      setRunningTime(fmtHHMMSS(diff));
    }, 1000);
    return () => clearInterval(timer);
  }, [startTime]);

  useEffect(() => {
    let disposed = false;
    let timerId  = null;

    async function fetchAndBuild() {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      try {
        const res = await fetch(
          `${API_BASE}/api/dashboard?username=${encodeURIComponent(userID)}`,
          { method: 'GET', headers: { 'Content-Type': 'application/json' }, cache: 'no-store' }
        );
        if (!res.ok) throw new Error(`failed /api/dashboard (HTTP ${res.status})`);
        const data = await res.json();
        setFetchError(null);
        setLastOkAt(Date.now());
        const raspiList = Array.isArray(data.raspis) ? data.raspis : [];
        setRaspis(raspiList);
        if (!selectedRaspiIdRef.current && raspiList.length > 0) {
          const id = raspiList[0].raspberry_serial_id;
          selectedRaspiIdRef.current = id;
          setSelectedRaspiId(id);
        }
        setLoading(false);
      } catch (e) {
        if (!disposed) { setFetchError(e?.message || String(e)); setLoading(false); }
      } finally {
        inFlightRef.current = false;
      }
    }

    async function tick() {
      if (disposed) return;
      await fetchAndBuild();
      if (!disposed) timerId = setTimeout(tick, POLL_MS);
    }

    setLoading(true);
    tick();
    return () => { disposed = true; if (timerId) clearTimeout(timerId); };
  }, [userID]);

  const selectedRaspiData = useMemo(() => {
    const id = selectedRaspiId || selectedRaspiIdRef.current;
    return raspis.find((r) => r.raspberry_serial_id === id) || raspis[0] || null;
  }, [raspis, selectedRaspiId]);

  const raspiID = selectedRaspiData?.raspberry_serial_id || null;

  const controllersLatest = useMemo(() => {
    if (!selectedRaspiData) return [];
    const controllers = [];
    for (const ctrl of selectedRaspiData.sensor_controllers || []) {
      controllers.push({
        raspi_id:             selectedRaspiData.raspberry_serial_id,
        sensor_controller_id: ctrl.module_id,
        sensor_nodes:         (ctrl.sensor_datas || []).map(normalizeSensorNode),
        last_seen:            new Date(ctrl.timestamp).getTime(),
      });
    }
    return controllers.sort((a, b) =>
      String(a.sensor_controller_id).localeCompare(String(b.sensor_controller_id))
    );
  }, [selectedRaspiData]);

  const raspiStatus = useMemo(() => {
    const rs     = selectedRaspiData?.raspi_status || null;
    const lastTs = selectedRaspiData?.timestamp_raspberry
      ? new Date(selectedRaspiData.timestamp_raspberry).getTime() : 0;
    return {
      lastTs,
      tempC:   selectedRaspiData?.temperature ?? null,
      uptimeS: typeof rs?.uptime_s === 'number' ? rs.uptime_s : null,
    };
  }, [selectedRaspiData]);

  const gpsData = selectedRaspiData?.gps_data || null;

  const gpsDisconnected = useMemo(() => {
    if (!gpsData) return true;
    const ts = gpsData.timestamp_gps ? new Date(gpsData.timestamp_gps).getTime() : 0;
    return Date.now() - ts > GPS_TIMEOUT_MS;
  }, [gpsData, currentTime]);

  const activeNode = useMemo(() => {
    const first = controllersLatest[0];
    if (!first) return 0;
    return first.sensor_nodes.filter((node) => !node.sensor_data.includes('null')).length;
  }, [controllersLatest]);

  function handleSelectRaspi(id) {
    selectedRaspiIdRef.current = id;
    setSelectedRaspiId(id);
    setSelectedControllerId(null);
  }

  const hasEverLoaded = lastOkAt > 0 || raspis.length > 0;
  if (loading && !hasEverLoaded) {
    return (
      <div className="h-screen w-screen flex items-center justify-center text-xl font-medium text-gray-600 dark:text-gray-300">
        {t.dashboard.initializing}
      </div>
    );
  }

  const selectedController = controllersLatest.find(
    (c) => c.sensor_controller_id === selectedControllerId
  );
  const raspiIsOnline = raspiStatus.lastTs && Date.now() - raspiStatus.lastTs <= RASPI_ALIVE_MS;
  const uptimeStr = raspiStatus.uptimeS != null ? fmtHHMMSS(raspiStatus.uptimeS) : runningTime;
  const tempStr   = raspiStatus.tempC   != null ? `${raspiStatus.tempC.toFixed(1)}°C` : '—';

  return (
    <div
      lang={t.locale}
      className="fixed inset-0 min-h-screen overflow-hidden
                 font-['Noto_Sans_JP','Hiragino_Kaku_Gothic_ProN','Yu_Gothic_UI',system-ui,sans-serif]
                 selection:bg-cyan-300/30 selection:text-white
                 bg-slate-50 text-slate-900 dark:text-white
                 dark:bg-gradient-to-br dark:from-slate-950 dark:via-slate-900 dark:to-slate-950
                 transition-colors duration-500"
    >
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-32 -right-24 h-64 w-64 rounded-full bg-cyan-500/10 blur-3xl" />
        <div className="absolute -bottom-32 -left-24 h-64 w-64 rounded-full bg-indigo-500/10 blur-3xl" />
      </div>

      <div className="relative z-10 h-full overflow-y-auto">
        <div className="mx-auto max-w-7xl px-5 py-5">

          <header className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-black/5 dark:bg-white/10">
                <Activity className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-xl font-semibold tracking-tight">
                  {userID}{t.dashboard.title}
                </h1>
                <p className="text-xs text-gray-600 dark:text-gray-400">
                  {t.dashboard.raspiId}{' '}
                  <code className="text-cyan-600 dark:text-cyan-400">{raspiID || '—'}</code>
                  {raspis.length > 1 && (
                    <span className="ml-2 text-gray-400">· {raspis.length} devices</span>
                  )}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                className="inline-flex items-center gap-2 rounded-md border border-black/10 bg-black/5 px-3 py-1 text-xs text-gray-700
                           hover:bg-black/10 dark:border-white/10 dark:bg-white/10 dark:text-gray-200 dark:hover:bg-white/20"
              >
                {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                <span>{theme === 'dark' ? 'Light' : 'Dark'}</span>
              </button>
              <button
                type="button"
                onClick={() => setLanguage(language === 'en' ? 'ja' : 'en')}
                className="inline-flex items-center gap-2 rounded-md border border-black/10 bg-black/5 px-3 py-1 text-xs text-gray-700
                           hover:bg-black/10 dark:border-white/10 dark:bg-white/10 dark:text-gray-200 dark:hover:bg-white/20"
              >
                <Globe className="w-4 h-4" />
                <span>{language === 'en' ? '日本語' : 'EN'}</span>
              </button>
            </div>
          </header>

          {fetchError && (
            <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-200">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold">Fetch error</div>
                  <div className="text-xs opacity-80 break-words">{fetchError}</div>
                  {lastOkAt > 0 && (
                    <div className="mt-1 text-[11px] opacity-70">
                      Last success: {fmtJaTime(new Date(lastOkAt), t.locale)}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => { setLoading(true); window.location.reload(); }}
                  className="shrink-0 rounded-lg bg-red-600 px-3 py-2 text-xs font-medium text-white hover:bg-red-700"
                >
                  Retry
                </button>
              </div>
            </div>
          )}

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

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 rounded-2xl border border-black/10 bg-white/80 p-4 backdrop-blur-sm
                                dark:border-white/10 dark:bg-slate-800/60 shadow-sm h-[26rem] relative">
                  <h2 className="text-base font-medium tracking-tight text-slate-900 dark:text-white flex items-center gap-2 mb-3">
                    <MapPin className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />
                    <span>{t.dashboard.controllerPositions}</span>
                  </h2>
                  <div className="w-full h-[calc(100%-2.5rem)]">
                    <LeafletMap
                      raspis={raspis}
                      selectedRaspiId={selectedRaspiId || raspis[0]?.raspberry_serial_id}
                      onSelectRaspi={handleSelectRaspi}
                    />
                  </div>
                  {gpsDisconnected && raspis.length > 0 && (
                    <div className="absolute top-3 right-3 bg-red-600 text-white text-xs font-medium
                                    px-3 py-2 rounded-lg shadow-lg animate-pulse z-[100]">
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

              {raspis.length > 1 && (
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-sm font-medium text-gray-600 dark:text-gray-400 flex items-center gap-1.5 shrink-0">
                    <Cpu className="w-4 h-4" />
                    Raspberry Pi:
                  </span>
                  {raspis.map((raspi) => {
                    const isSelected =
                      raspi.raspberry_serial_id ===
                      (selectedRaspiId || raspis[0]?.raspberry_serial_id);
                    const ctrlCount = raspi.sensor_controllers?.length ?? 0;
                    return (
                      <button
                        key={raspi.raspberry_serial_id}
                        onClick={() => handleSelectRaspi(raspi.raspberry_serial_id)}
                        className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
                          isSelected
                            ? 'border-cyan-500 bg-cyan-50 text-cyan-700 dark:bg-cyan-500/10 dark:text-cyan-300'
                            : 'border-black/10 bg-white/70 text-gray-700 hover:border-black/20 dark:border-white/10 dark:bg-slate-800/60 dark:text-gray-300 dark:hover:border-white/20'
                        }`}
                      >
                        <span className={`inline-flex h-2 w-2 rounded-full ${isSelected ? 'bg-cyan-500' : 'bg-gray-300 dark:bg-gray-500'}`} />
                        <AliasInlineEdit
                          raspiId={raspi.raspberry_serial_id}
                          controllerId={null}
                          originalName={raspi.raspberry_serial_id}
                          textClass="font-mono"
                        />
                        <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                          isSelected
                            ? 'bg-cyan-100 dark:bg-cyan-500/20 text-cyan-700 dark:text-cyan-300'
                            : 'bg-black/10 dark:bg-white/10 text-gray-500 dark:text-gray-400'
                        }`}>
                          {ctrlCount} ctrl
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              <div>
                <h2 className="text-base font-medium tracking-tight text-slate-900 dark:text-white flex items-center gap-2 mb-4">
                  <Settings className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />
                  <span>{t.dashboard.sensorControllers}</span>
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {controllersLatest.map((controller, idx) => {
                    const online   = controller.controller_status === 'online';
                    const hasNodes = controller.sensor_nodes.length > 0;
                    return (
                      <div
                        key={idx}
                        className="rounded-xl border border-black/10 bg-white/80 p-4 backdrop-blur-sm
                                   dark:border-white/10 dark:bg-slate-800/60 shadow-sm
                                   hover:border-black/20 dark:hover:border-white/30 transition-all"
                      >
                        <div className="flex items-center justify-between mb-4">
                          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-r from-cyan-500 to-indigo-500">
                            <Cpu className="h-5 w-5 text-white" />
                          </div>
                          <div className="text-right">
                            <div className="font-semibold text-slate-900 dark:text-white tracking-tight">
                              <AliasInlineEdit
                                raspiId={controller.raspi_id}
                                controllerId={controller.sensor_controller_id}
                                originalName={controller.sensor_controller_id}
                                textClass="font-semibold"
                              />
                            </div>
                            <div className="text-xs text-gray-600 dark:text-gray-400">
                              {hasNodes
                                ? `${activeNode} ${t.dashboard.nodesActive}`
                                : <span className="text-yellow-700 dark:text-yellow-300">{t.dashboard.noNode}</span>
                              }
                            </div>
                          </div>
                        </div>
                        <div className="grid grid-cols-3 gap-2 mb-4">
                          <div className="rounded-lg border border-black/10 bg-white/70 p-2 backdrop-blur-sm dark:border-white/10 dark:bg-slate-800/60 flex items-center justify-between">
                            <Battery className="w-4 h-4 text-green-600 dark:text-green-400" />
                            <span className="text-xs font-semibold text-slate-900 dark:text-white">{controller.battery_level ?? '—'}%</span>
                          </div>
                          <div className="rounded-lg border border-black/10 bg-white/70 p-2 backdrop-blur-sm dark:border-white/10 dark:bg-slate-800/60 flex items-center justify-between">
                            <Wifi className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
                            <span className="text-xs font-semibold text-slate-900 dark:text-white">{controller.signal_strength ?? '—'}</span>
                          </div>
                          <div className="rounded-lg border border-black/10 bg-white/70 p-2 backdrop-blur-sm dark:border-white/10 dark:bg-slate-800/60 flex items-center justify-between">
                            <Eye className={`w-4 h-4 ${online ? 'text-green-600 dark:text-green-400' : 'text-gray-400'}`} />
                            <span className={`text-xs font-semibold ${online ? 'text-green-600 dark:text-green-400' : 'text-gray-500'}`}>
                              {online ? 'ON' : 'OFF'}
                            </span>
                          </div>
                        </div>
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
                    <div className="col-span-full rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-4 text-sm text-yellow-800 dark:text-yellow-200">
                      {t.dashboard.noHubDetected} <b>{raspiID || '—'}</b>.
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