import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  Activity, Thermometer, Gauge, MapPin, Clock, Cpu, Wifi, Eye,
  Settings, ArrowLeft, Globe, Sun, Moon, LogOut, Tag,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { translations } from './utils/translation';
import { fmtHHMMSS, fmtJaTime, normalizeSensorNode } from './utils/helpers';
import LeafletMap from './components/LeafletMap';
import ControllerDetailView from './components/ControllerDetailView';
import { getDashboard, logout, getUsername, isLoggedIn } from './lib/api';
import { socket } from './lib/socket';

const API_POLL_MS    = 5000;
const HUB_OFFLINE_MS = 12_000;
const RASPI_ALIVE_MS = 15_000;
const GPS_TIMEOUT_MS = 15_000;

function parseSensorData(str) {
  if (!str || typeof str !== 'string') return null;
  const first  = str.indexOf('-');
  if (first === -1) return null;
  const second = str.indexOf('-', first + 1);
  if (second === -1) return null;

  const port_number = Number(str.slice(0, first));
  const sensor_type = str.slice(first + 1, second);
  const value       = str.slice(second + 1);

  if (!Number.isFinite(port_number) || !sensor_type || sensor_type === 'null' || value === 'null')
    return null;

  return { port_number, sensor_type, value };
}

function buildControllers(raspi) {
  if (!raspi?.sensor_controllers) return [];

  return raspi.sensor_controllers.map(ctrl => {
    const ts = ctrl.timestamp ? new Date(ctrl.timestamp).getTime() : 0;

    const sensor_nodes = (ctrl.sensor_datas || [])
      .map(sd => {
        const parsed = parseSensorData(sd.sensor_data);
        if (!parsed) return null;
        return normalizeSensorNode({
          node_id:     `P${parsed.port_number}`,
          port_number: parsed.port_number,
          sensor_type: parsed.sensor_type,
          value:       parsed.value,
          unit:        null,
        });
      })
      .filter(Boolean);

    return {
      raspi_id:             raspi.raspberry_serial_id,
      module_id:            ctrl.module_id,
      sensor_controller_id: ctrl.module_id,
      sensor_nodes,
      last_seen:            ts,
    };
  });
}

export default function Dashboard() {
  const navigate = useNavigate();

  useEffect(() => {
    if (!isLoggedIn()) navigate('/ciren', { replace: true });
  }, []);

  const [language, setLanguage] = useState('ja');
  const t = useMemo(() => translations[language], [language]);

  const [theme, setTheme] = useState(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem('ciren-theme') : null;
    if (saved === 'light' || saved === 'dark') return saved;
    return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark' : 'light';
  });

  useEffect(() => {
    const html = document.querySelector('html');
    if (!html) return;
    html.classList.toggle('dark', theme === 'dark');
    html.style.colorScheme = theme;
    localStorage.setItem('ciren-theme', theme);
  }, [theme]);

  const [allRaspis,  setAllRaspis]  = useState([]);
  const [activeIdx,  setActiveIdx]  = useState(0);
  const [loading,    setLoading]    = useState(true);
  const [err,        setErr]        = useState(null);

  const [controllersLatest, setControllersLatest] = useState([]);
  const [selectedControllerId, setSelectedControllerId] = useState(null);

  const [raspiStatus, setRaspiStatus]   = useState({ lastTs: 0, tempC: null, uptimeS: null });
  const [gpsData,     setGpsData]       = useState(null);
  const [gpsDisconnected, setGpsDisconnected] = useState(false);

  const [currentTime, setCurrentTime] = useState(new Date());
  const [startTime]   = useState(new Date());
  const [runningTime, setRunningTime] = useState('00:00:00');

  const username = getUsername();

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
      const diff = Math.floor((new Date() - startTime) / 1000);
      setRunningTime(fmtHHMMSS(diff));
    }, 1000);
    return () => clearInterval(timer);
  }, [startTime]);

  const applyRaspiMeta = useCallback((raspi) => {
    if (!raspi) return;
    const ts = raspi.timestamp_raspberry ? new Date(raspi.timestamp_raspberry).getTime() : 0;
    setRaspiStatus({
      lastTs:  ts,
      tempC:   typeof raspi.temperature === 'number' ? raspi.temperature : null,
      uptimeS: raspi.raspi_status?.uptime_s ?? null,
    });
    const gps = raspi.gps_data || null;
    setGpsData(gps);
    const gpsTsMs = gps?.timestamp_gps ? new Date(gps.timestamp_gps).getTime() : 0;
    setGpsDisconnected(!gps || (Date.now() - gpsTsMs > GPS_TIMEOUT_MS));
  }, []);

  const applyRaspi = useCallback((raspi) => {
    if (!raspi) return;
    applyRaspiMeta(raspi);
    setControllersLatest(buildControllers(raspi));
  }, [applyRaspiMeta]);

  const activeIdxRef = useRef(activeIdx);
  useEffect(() => { activeIdxRef.current = activeIdx; }, [activeIdx]);

  const allRaspisRef = useRef(allRaspis);
  useEffect(() => { allRaspisRef.current = allRaspis; }, [allRaspis]);

  const fetchDashboard = useCallback(async (showLoader = false) => {
    if (showLoader) setLoading(true);
    setErr(null);
    try {
      const data   = await getDashboard();
      const raspis = data.raspis || [];
      setAllRaspis(raspis);
      if (raspis.length > 0) {
        const raspi = raspis[activeIdxRef.current] || raspis[0];
        if (showLoader) {
          applyRaspi(raspi);
        } else {
          applyRaspiMeta(raspi);
        }
      }
    } catch (e) {
      setErr(e.message || String(e));
    } finally {
      if (showLoader) setLoading(false);
    }
  }, [applyRaspi, applyRaspiMeta]);

  useEffect(() => {
    fetchDashboard(true);
    const pollId = setInterval(() => fetchDashboard(false), API_POLL_MS);
    return () => clearInterval(pollId);
  }, [fetchDashboard]);

  useEffect(() => {
    if (allRaspis.length > 0) {
      applyRaspi(allRaspis[activeIdx] || allRaspis[0]);
      setSelectedControllerId(null);
    }
  }, [activeIdx]);

  useEffect(() => {
    function onNodeSample(doc) {
      const activeRaspi = allRaspisRef.current[activeIdxRef.current];
      if (!activeRaspi) return;
      if (doc.raspberry_serial_id !== activeRaspi.raspberry_serial_id) return;

      setControllersLatest(prev => {
        const next = prev.map(ctrl => {
          if (ctrl.module_id !== doc.module_id) return ctrl;

          const newNode = normalizeSensorNode({
            node_id:     `P${doc.port_number}`,
            port_number: doc.port_number,
            sensor_type: doc.sensor_type,
            value:       doc.value,
            unit:        doc.unit ?? null,
          });

          const updatedNodes = ctrl.sensor_nodes.some(n => n.port_number === doc.port_number)
            ? ctrl.sensor_nodes.map(n => n.port_number === doc.port_number ? newNode : n)
            : [...ctrl.sensor_nodes, newNode];

          return { ...ctrl, sensor_nodes: updatedNodes, last_seen: Date.now() };
        });

        const exists = next.some(c => c.module_id === doc.module_id);
        if (!exists) {
          next.push({
            raspi_id:             doc.raspberry_serial_id,
            module_id:            doc.module_id,
            sensor_controller_id: doc.module_id,
            sensor_nodes: [normalizeSensorNode({
              node_id:     `P${doc.port_number}`,
              port_number: doc.port_number,
              sensor_type: doc.sensor_type,
              value:       doc.value,
              unit:        doc.unit ?? null,
            })],
            last_seen: Date.now(),
          });
        }
        return next;
      });
    }

    socket.on('node-sample', onNodeSample);
    return () => socket.off('node-sample', onNodeSample);
  }, []);

  const activeRaspi   = allRaspis[activeIdx] || null;
  const raspiIsOnline = raspiStatus.lastTs && (Date.now() - raspiStatus.lastTs <= RASPI_ALIVE_MS);
  const uptimeStr     = raspiStatus.uptimeS != null ? fmtHHMMSS(raspiStatus.uptimeS) : runningTime;
  const tempStr       = raspiStatus.tempC   != null ? `${raspiStatus.tempC.toFixed(1)}°C` : '—';
  const selectedController = controllersLatest.find(c => c.sensor_controller_id === selectedControllerId);

  function handleLogout() {
    logout();
    navigate('/ciren');
  }

  if (loading && allRaspis.length === 0) {
    return (
      <div className="h-screen w-screen flex items-center justify-center text-xl font-medium text-gray-600 dark:text-gray-300 dark:bg-slate-950">
        {t.dashboard.initializing}
      </div>
    );
  }

  if (err) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center gap-4 dark:bg-slate-950">
        <p className="text-red-500 dark:text-red-400">Error: {err}</p>
        <button onClick={() => fetchDashboard(true)}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white dark:bg-white dark:text-slate-900">
          Retry
        </button>
      </div>
    );
  }

  return (
    <div lang={t.locale}
      className="min-h-screen font-['Noto_Sans_JP','Hiragino Kaku Gothic ProN','Yu Gothic UI',system-ui,sans-serif]
                 selection:bg-cyan-300/30 selection:text-white
                 bg-slate-50 text-slate-900 dark:text-white
                 dark:bg-gradient-to-br dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 transition-colors duration-500">
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute -top-32 -right-24 h-64 w-64 rounded-full bg-cyan-500/10 blur-3xl" />
        <div className="absolute -bottom-32 -left-24 h-64 w-64 rounded-full bg-indigo-500/10 blur-3xl" />
      </div>

      <div className="relative z-10">
        <div className="mx-auto max-w-7xl px-5 py-5">

          <header className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-black/5 dark:bg-white/10">
                <Activity className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-xl font-semibold tracking-tight">
                  {username}{t.dashboard.title}
                </h1>
                {activeRaspi && (
                  <p className="text-xs text-gray-600 dark:text-gray-400 flex items-center gap-1">
                    {activeRaspi.label && (
                      <><Tag className="w-3 h-3" /><span>{activeRaspi.label} · </span></>
                    )}
                    <code className="text-cyan-600 dark:text-cyan-400">{activeRaspi.raspberry_serial_id}</code>
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                className="inline-flex items-center gap-2 rounded-md border border-black/10 bg-black/5 px-3 py-1 text-xs text-gray-700 hover:bg-black/10 dark:border-white/10 dark:bg-white/10 dark:text-gray-200 dark:hover:bg-white/20">
                {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </button>
              <button type="button" onClick={() => setLanguage(language === 'en' ? 'ja' : 'en')}
                className="inline-flex items-center gap-2 rounded-md border border-black/10 bg-black/5 px-3 py-1 text-xs text-gray-700 hover:bg-black/10 dark:border-white/10 dark:bg-white/10 dark:text-gray-200 dark:hover:bg-white/20">
                <Globe className="w-4 h-4" />
                <span>{language === 'en' ? '日本語' : 'EN'}</span>
              </button>
              <button type="button" onClick={() => navigate('/ciren/raspis')}
                className="inline-flex items-center gap-2 rounded-md border border-black/10 bg-black/5 px-3 py-1 text-xs text-gray-700 hover:bg-black/10 dark:border-white/10 dark:bg-white/10 dark:text-gray-200 dark:hover:bg-white/20">
                <Settings className="w-4 h-4" />
                <span>{language === 'ja' ? 'デバイス管理' : 'Manage'}</span>
              </button>
              <button type="button" onClick={handleLogout}
                className="inline-flex items-center gap-2 rounded-md border border-black/10 bg-black/5 px-3 py-1 text-xs text-gray-700 hover:bg-black/10 dark:border-white/10 dark:bg-white/10 dark:text-gray-200 dark:hover:bg-white/20">
                <LogOut className="w-4 h-4" />
                <span>{language === 'ja' ? 'ログアウト' : 'Logout'}</span>
              </button>
            </div>
          </header>

          <div className="mb-4 text-right text-[11px] font-mono text-gray-600 dark:text-gray-400">
            {fmtJaTime(currentTime, t.locale)}
          </div>

          {allRaspis.length > 1 && (
            <div className="flex gap-2 mb-5 overflow-x-auto pb-1">
              {allRaspis.map((raspi, idx) => (
                <button key={raspi.raspberry_serial_id} type="button"
                  onClick={() => { setActiveIdx(idx); setSelectedControllerId(null); }}
                  className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors
                    ${activeIdx === idx
                      ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                      : 'border border-black/10 text-slate-700 hover:bg-black/5 dark:border-white/10 dark:text-gray-300 dark:hover:bg-white/10'}`}>
                  <Cpu className="w-3.5 h-3.5" />
                  {raspi.label || raspi.raspberry_serial_id}
                </button>
              ))}
            </div>
          )}

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
                    <LeafletMap gpsData={gpsData} />
                  </div>
                  {gpsDisconnected && (
                    <div className="absolute top-3 right-3 bg-red-600 text-white text-xs font-medium px-3 py-2 rounded-lg shadow-lg animate-pulse z-[100]">
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
                    {[
                      {
                        icon: <Eye className="w-4 h-4" />, label: t.dashboard.liveStatus,
                        value: <span className={`font-semibold ${raspiIsOnline ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                          {raspiIsOnline ? t.dashboard.online : 'OFFLINE'}
                        </span>,
                      },
                      {
                        icon: <Clock className="w-4 h-4" />, label: t.dashboard.runningTime,
                        value: <span className="font-mono text-slate-900 dark:text-white font-medium">{uptimeStr}</span>,
                      },
                      {
                        icon: <Thermometer className="w-4 h-4" />, label: t.dashboard.avgTemp,
                        value: <span className="font-mono text-slate-900 dark:text-white font-medium">{tempStr}</span>,
                      },
                    ].map(({ icon, label, value }) => (
                      <div key={label} className="rounded-xl border border-black/10 bg-white/70 p-3 backdrop-blur-sm
                                                  dark:border-white/10 dark:bg-slate-800/60 flex justify-between">
                        <span className="text-gray-600 dark:text-gray-400 flex items-center gap-2">{icon}{label}</span>
                        {value}
                      </div>
                    ))}
                  </div>

                  <p className="text-center mt-4 text-gray-500 dark:text-gray-500 text-xs">{t.dashboard.footer}</p>
                </div>
              </div>

              <div>
                <h2 className="text-base font-medium tracking-tight text-slate-900 dark:text-white flex items-center gap-2 mb-4">
                  <Settings className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />
                  <span>{t.dashboard.sensorControllers}</span>
                </h2>

                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {controllersLatest.map((controller, idx) => {
                    const isOnline  = Date.now() - controller.last_seen <= HUB_OFFLINE_MS;
                    const hasNodes  = controller.sensor_nodes.length > 0;
                    return (
                      <div key={idx}
                        className="rounded-xl border border-black/10 bg-white/80 p-4 backdrop-blur-sm
                                   dark:border-white/10 dark:bg-slate-800/60 shadow-sm
                                   hover:border-black/20 dark:hover:border-white/30 transition-all">
                        <div className="flex items-center justify-between mb-4">
                          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-r from-cyan-500 to-indigo-500">
                            <Cpu className="h-5 w-5 text-white" />
                          </div>
                          <div className="text-right">
                            <div className="font-semibold text-slate-900 dark:text-white tracking-tight">
                              {controller.sensor_controller_id}
                            </div>
                            <div className="text-xs text-gray-600 dark:text-gray-400">
                              {hasNodes
                                ? `${controller.sensor_nodes.length} ${t.dashboard.nodesActive}`
                                : <span className="text-yellow-700 dark:text-yellow-300">{t.dashboard.noNode}</span>}
                            </div>
                          </div>
                        </div>

                        <div className="mb-4 flex justify-end">
                          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium
                            ${isOnline
                              ? 'bg-green-500/10 text-green-700 dark:text-green-400'
                              : 'bg-gray-500/10 text-gray-500 dark:text-gray-400'}`}>
                            <Wifi className="w-3 h-3" />
                            {isOnline ? t.dashboard.online : 'OFFLINE'}
                          </span>
                        </div>

                        <button onClick={() => setSelectedControllerId(controller.sensor_controller_id)}
                          className="w-full inline-flex items-center justify-center gap-2 rounded-lg
                                     bg-slate-900 px-4 py-2 text-sm font-medium text-white
                                     hover:bg-slate-800 focus:ring-2 focus:ring-cyan-400
                                     dark:bg-white dark:text-slate-900 dark:hover:bg-gray-100">
                          <Eye className="w-4 h-4" />
                          <span>{t.dashboard.viewDetails}</span>
                        </button>
                      </div>
                    );
                  })}

                  {controllersLatest.length === 0 && (
                    <div className="col-span-full rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-4 text-sm text-yellow-800 dark:text-yellow-200">
                      {t.dashboard.noHubDetected} <b>{activeRaspi?.raspberry_serial_id || '—'}</b>.
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
