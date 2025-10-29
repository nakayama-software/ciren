// src/Dashboard.jsx
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, Thermometer, Gauge, MapPin, Clock, Cpu, Wifi, Zap, Eye,
  Settings, Battery, ArrowLeft, Globe, Sun, Moon
} from 'lucide-react';

// Konfigurasi dasar
const API_BASE = import.meta.env.VITE_API_BASE || '';
const HUB_OFFLINE_MS = 12_000;
const NODE_OFFLINE_MS = 8_000;
const RASPI_ALIVE_MS = 15_000;

// ============================ i18n ============================
const translations = {
  en: {
    locale: 'en-US',
    dashboard: {
      title: "'s Dashboard",
      raspiId: "Raspi ID",
      initializing: "Initializing Dashboard...",
      controllerPositions: "Controller Positions",
      mainModuleStatus: "Main Module Status",
      liveStatus: "Live Status",
      online: "ONLINE",
      runningTime: "Running Time",
      avgTemp: "Raspberry Temp",
      sensorControllers: "Sensor Controllers",
      nodesActive: "nodes active",
      viewDetails: "View Details",
      footer: "© 2025 CIREN Dashboard",
      noNode: "No node connected",
      noHubDetected: "No Sensor controller connected"
    },
    controllerDetail: {
      back: "Back to Dashboard",
      battery: "Battery",
      signal: "Signal",
      sensorNodes: "Sensor Nodes",
      history: "Sensor Nodes",
      noNode: "No node connected.",
    },
    sensors: {
      temperature: "Temperature",
      pressure: "Pressure",
      light_intensity: "Light Intensity",
      humidity: "Humidity",
      ultrasonic: "Ultrasonic",
      infrared: "Infrared",
      imu: "IMU",
    },
  },
  ja: {
    locale: 'ja-JP',
    dashboard: {
      title: "のダッシュボード",
      raspiId: "Raspi ID",
      initializing: "ダッシュボードを初期化中...",
      controllerPositions: "コントローラーの位置",
      mainModuleStatus: "メインモジュールの状態",
      liveStatus: "ライブステータス",
      online: "オンライン",
      runningTime: "稼働時間",
      avgTemp: "ラズパイ温度",
      sensorControllers: "センサーコントローラー",
      nodesActive: "ノードがアクティブ",
      viewDetails: "詳細を表示",
      footer: "© 2025 CIREN ダッシュボード",
      noNode: "接続されたノードはありません",
      noHubDetected: "センサーコントローラーが接続されていません"
    },
    controllerDetail: {
      back: "ダッシュボードに戻る",
      battery: "バッテリー",
      signal: "信号強度",
      sensorNodes: "センサーノード",
      history: "センサーノード",
      noNode: "接続されたノードはありません。",
    },
    sensors: {
      temperature: "温度",
      pressure: "気圧",
      light_intensity: "光強度",
      humidity: "湿度",
      ultrasonic: "超音波",
      infrared: "赤外線",
      imu: "IMU",
    },
  },
};

// ============================ Helper Functions ============================
function inferUnit(type) {
  if (type === "temperature") return "°C";
  if (type === "humidity") return "%";
  if (type === "pressure") return "hPa";
  if (type === "ultrasonic") return "cm";
  if (type === "light" || type === "light_intensity") return "lux";
  return "";
}

function parseTypeValue(raw) {
  if (!raw || typeof raw !== "string" || !raw.includes("-")) {
    return { type: "unknown", value: raw, unit: "" };
  }
  const [typeRaw, valRaw] = raw.split("-", 2);
  const type = String(typeRaw || "").trim().toLowerCase();
  const m = String(valRaw ?? "").trim().match(/^(-?\d+(?:\.\d+)?)(.*)$/);
  if (!m) return { type, value: valRaw?.trim() ?? "", unit: "" };
  const num = Number(m[1]);
  const unit = (m[2] || "").trim() || inferUnit(type);
  return {
    type: type === "light" ? "light_intensity" : type,
    value: Number.isNaN(num) ? (valRaw?.trim() ?? "") : num,
    unit,
  };
}

function normalizeHubToController(hubObj) {
  const scidRaw = hubObj.sensor_controller_id ?? hubObj.sensor_controller ?? "UNKNOWN";
  const scidUp = String(hubObj.sensor_controller_id ?? hubObj.sensor_controller ?? "UNKNOWN").toUpperCase();

  if (scidUp === "RASPI_SYS" || hubObj._type === "raspi_status") return null;

  const nodes = [];
  for (let i = 1; i <= 8; i++) {
    const key = `port-${i}`;
    if (!hubObj[key]) continue;
    const parsed = parseTypeValue(hubObj[key]);
    nodes.push({
      node_id: `P${i}`,
      sensor_type: parsed.type,
      value: parsed.value,
      unit: parsed.unit,
      status: "active",
    });
  }
  return {
    sensor_controller_id: scidRaw,
    controller_status: "online",
    signal_strength: hubObj.signal_strength ?? -60,
    battery_level: hubObj.battery_level ?? 80,
    sensor_nodes: nodes,
    latitude: hubObj.latitude,
    longitude: hubObj.longitude,
  };
}

function fmtHHMMSS(totalSeconds) {
  if (!Number.isFinite(totalSeconds)) return "00:00:00";
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = String(Math.floor(s / 3600)).padStart(2, '0');
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${h}:${m}:${ss}`;
}

function fmtJaTime(date, locale) {
  if (locale !== 'ja-JP') return date.toLocaleString(locale);
  const o = new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false, weekday: 'short',
  }).formatToParts(date);
  const get = (t) => o.find(p => p.type === t)?.value || '';
  return `${get('year')}/${get('month')}/${get('day')}(${get('weekday')}) ${get('hour')}:${get('minute')}:${get('second')}`;
}

// ============================ Components ============================
function SensorRenderer({ node }) {
  const t = translations.en.sensors;
  const label = t[node.sensor_type] || node.sensor_type;

  return (
    <div className="rounded-xl border border-black/10 bg-white/70 p-4 backdrop-blur-sm 
                    dark:border-white/10 dark:bg-slate-800/60 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-medium text-gray-600 dark:text-gray-400">
          {node.node_id}
        </div>
        <div className="text-xs text-green-600 dark:text-green-400">
          {node.status}
        </div>
      </div>
      <div className="text-sm text-gray-700 dark:text-gray-300 mb-1">{label}</div>
      <div className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
        {typeof node.value === 'number' ? node.value.toFixed(1) : node.value}
        <span className="text-base ml-1 text-gray-600 dark:text-gray-400">{node.unit}</span>
      </div>
    </div>
  );
}

function LeafletMap({ controllers }) {
  const mapDivRef = useRef(null);
  return (
    <div
      ref={mapDivRef}
      className="w-full h-full rounded-xl border border-black/10 bg-slate-100 
                 dark:border-white/10 dark:bg-slate-900 flex items-center justify-center
                 text-sm text-gray-500 dark:text-gray-400"
    >
      Map visualization ({controllers.length} controllers)
    </div>
  );
}

function ControllerDetailView({ controller, onBack, t }) {
  return (
    <div className="rounded-2xl border border-black/10 bg-white/80 p-6 backdrop-blur-sm 
                    dark:border-white/10 dark:bg-slate-800/60 shadow-sm">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl 
                          bg-gradient-to-r from-cyan-500 to-indigo-500">
            <Cpu className="h-6 w-6 text-white" />
          </div>
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-white">
              {controller.sensor_controller_id}
            </h2>
            <p className="text-sm text-green-600 dark:text-green-400 capitalize">
              {controller.controller_status}
            </p>
          </div>
        </div>
        <button
          onClick={onBack}
          className="inline-flex items-center gap-2 rounded-lg border border-black/10 
                     bg-transparent px-4 py-2 text-sm font-medium text-slate-900 
                     hover:bg-black/5 dark:border-white/10 dark:text-white dark:hover:bg-white/10"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>{t.controllerDetail.back}</span>
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="rounded-xl border border-black/10 bg-white/70 p-4 backdrop-blur-sm 
                        dark:border-white/10 dark:bg-slate-800/60 shadow-sm">
          <div className="flex items-center gap-2 mb-1">
            <Battery className="h-4 w-4 text-green-600 dark:text-green-400" />
            <span className="text-xs text-gray-600 dark:text-gray-400">{t.controllerDetail.battery}</span>
          </div>
          <div className="text-xl font-semibold tracking-tight text-slate-900 dark:text-white">
            {controller.battery_level}%
          </div>
        </div>

        <div className="rounded-xl border border-black/10 bg-white/70 p-4 backdrop-blur-sm 
                        dark:border-white/10 dark:bg-slate-800/60 shadow-sm">
          <div className="flex items-center gap-2 mb-1">
            <Wifi className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
            <span className="text-xs text-gray-600 dark:text-gray-400">{t.controllerDetail.signal}</span>
          </div>
          <div className="text-xl font-semibold tracking-tight text-slate-900 dark:text-white">
            {controller.signal_strength} dBm
          </div>
        </div>

        <div className="rounded-xl border border-black/10 bg-white/70 p-4 backdrop-blur-sm 
                        dark:border-white/10 dark:bg-slate-800/60 shadow-sm">
          <div className="flex items-center gap-2 mb-1">
            <Zap className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
            <span className="text-xs text-gray-600 dark:text-gray-400">{t.controllerDetail.sensorNodes}</span>
          </div>
          <div className="text-xl font-semibold tracking-tight text-slate-900 dark:text-white">
            {controller.sensor_nodes.length}
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-base font-medium tracking-tight text-slate-900 dark:text-white mb-4">
          {t.controllerDetail.history}
        </h3>

        {controller.sensor_nodes.length === 0 ? (
          <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 
                          text-sm text-yellow-800 dark:text-yellow-200">
            {t.controllerDetail.noNode}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {controller.sensor_nodes.map((node, index) => (
              <SensorRenderer key={index} node={node} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

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

  // --- Timer waktu lokal ---
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
      const diff = Math.floor((new Date() - startTime) / 1000);
      setRunningTime(fmtHHMMSS(diff));
    }, 1000);
    return () => clearInterval(timer);
  }, [startTime]);

  // --- Fetch Data dari API ---
  useEffect(() => {
    let stop = false;
    let pollId;

    async function resolveAndLoad() {
      try {
        setLoading(true);
        setErr(null);

        const r = await fetch(`${API_BASE}/api/resolve/${encodeURIComponent(usernameProp)}`);
        if (!r.ok) throw new Error("resolve failed");
        const jr = await r.json();
        const raspiId = jr.raspi_serial_id || jr.raspi || jr;
        if (stop) return;
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
        const d = await fetch(`${API_BASE}/api/data/${encodeURIComponent(raspiId)}`);
        if (!d.ok) throw new Error("get data failed");
        const jd = await d.json();
        const entries = Array.isArray(jd) ? jd : [];
        entries.sort((a, b) => new Date(b.received_ts || b.timestamp) - new Date(a.received_ts || a.timestamp));
        const now = Date.now();

        let raspiTs = 0, raspiTemp = null, raspiUptime = null;
        for (const rec of entries) {
          const ts = new Date(rec.received_ts || rec.timestamp || 0).getTime();
          if (!Number.isFinite(ts)) continue;
          if (!Array.isArray(rec.data)) continue;
          const sys = rec.data.find(h => {
            const scid = (h?.sensor_controller_id ?? h?.sensor_controller ?? "").toUpperCase();
            return scid === "RASPI_SYS" || h._type === "raspi_status";
          });
          if (sys) {
            raspiTs = ts;
            const tempCandidate = [sys.raspi_temp_c, sys.pi_temp, sys.cpu_temp, sys.soc_temp_c];
            raspiTemp = tempCandidate.find(v => typeof v === "number") ?? null;
            if (typeof sys.uptime_s === "number") raspiUptime = sys.uptime_s;
            break;
          }
        }

        setRaspiStatus({ lastTs: raspiTs, tempC: raspiTemp, uptimeS: raspiUptime ?? null });

        const hubMetaLatest = new Map();
        const hubLastSeen = new Map();
        const nodeLastSeen = new Map();

        for (const rec of entries) {
          const ts = new Date(rec.received_ts || rec.timestamp || 0).getTime();
          if (!Array.isArray(rec.data)) continue;
          for (const hubObj of rec.data) {
            const scidRaw = hubObj.sensor_controller_id ?? hubObj.sensor_controller ?? "UNKNOWN";
            const scidUp = String(scidRaw).toUpperCase();
            if (scidUp === "RASPI_SYS" || hubObj._type === "raspi_status") continue;

            if (!hubMetaLatest.has(scidRaw)) hubMetaLatest.set(scidRaw, normalizeHubToController(hubObj));
            hubLastSeen.set(scidRaw, Math.max(hubLastSeen.get(scidRaw) || 0, ts));

            for (let i = 1; i <= 8; i++) {
              const key = `port-${i}`;
              if (!hubObj[key]) continue;
              const k = `${scidRaw}:P${i}`;
              nodeLastSeen.set(k, Math.max(nodeLastSeen.get(k) || 0, ts));
            }
          }
        }

        let visible = [];
        for (const [hubId, meta] of hubMetaLatest.entries()) {
          const seenAt = hubLastSeen.get(hubId) || 0;
          if (now - seenAt > HUB_OFFLINE_MS) continue;

          const nodes = [];
          for (let i = 1; i <= 8; i++) {
            const key = `${hubId}:P${i}`;
            const last = nodeLastSeen.get(key) || 0;
            if (now - last <= NODE_OFFLINE_MS) nodes.push({ node_id: `P${i}`, status: "active" });
          }
          visible.push({ ...meta, sensor_nodes: nodes });
        }

        visible.sort((a, b) => a.sensor_controller_id.localeCompare(b.sensor_controller_id));
        setControllersLatest(visible);

        if (selectedControllerId && !visible.find(v => v.sensor_controller_id === selectedControllerId)) {
          setSelectedControllerId(null);
        }
      } catch (e) {
        setErr(e.message || String(e));
      }
    }

    resolveAndLoad();
    return () => { stop = true; if (pollId) clearInterval(pollId); };
  }, [usernameProp, selectedControllerId]);

  // --- Kondisi tampilan ---
  if (loading && !raspiID) {
    return (
      <div className="h-screen w-screen flex items-center justify-center text-xl font-medium text-gray-600 dark:text-gray-300">
        {t.dashboard.initializing}
      </div>
    );
  }

  if (err) {
    return (
      <div className="p-6 text-center text-red-500 dark:text-red-400">
        Error: {err}
      </div>
    );
  }

  const selectedController = controllersLatest.find(c => c.sensor_controller_id === selectedControllerId);
  const raspiIsOnline = raspiStatus.lastTs && (Date.now() - raspiStatus.lastTs <= RASPI_ALIVE_MS);
  const uptimeStr = raspiStatus.uptimeS != null ? fmtHHMMSS(raspiStatus.uptimeS) : runningTime;
  const tempStr = raspiStatus.tempC != null ? `${raspiStatus.tempC.toFixed(1)}°C` : '—';

  // --- UI utama ---
  return (
    <div
      lang={t.locale}
      className="fixed inset-0 min-h-screen overflow-hidden font-['Noto_Sans_JP','Hiragino Kaku Gothic ProN','Yu Gothic UI',system-ui,sans-serif]
                 selection:bg-cyan-300/30 selection:text-white
                 bg-slate-50 text-slate-900 dark:text-white
                 dark:bg-gradient-to-br dark:from-slate-950 dark:via-slate-900 dark:to-slate-950
                 transition-colors duration-500"
    >
      {/* Background gradient */}
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
                  {usernameProp}{t.dashboard.title}
                </h1>
                <p className="text-xs text-gray-600 dark:text-gray-400">
                  {t.dashboard.raspiId} <code className="text-cyan-600 dark:text-cyan-400">{raspiID}</code>
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                className="inline-flex items-center gap-2 rounded-md border border-black/10 bg-black/5 px-3 py-1 text-xs text-gray-700 hover:bg-black/10 dark:border-white/10 dark:bg-white/10 dark:text-gray-200 dark:hover:bg-white/20"
              >
                {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                <span>{theme === 'dark' ? 'Light' : 'Dark'}</span>
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
              {/* Map + Status */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 rounded-2xl border border-black/10 bg-white/80 p-4 backdrop-blur-sm 
                                dark:border-white/10 dark:bg-slate-800/60 shadow-sm h-[26rem]">
                  <h2 className="text-base font-medium tracking-tight text-slate-900 dark:text-white flex items-center gap-2 mb-3">
                    <MapPin className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />
                    <span>{t.dashboard.controllerPositions}</span>
                  </h2>
                  <div className="w-full h-[calc(100%-2.5rem)]">
                    <LeafletMap controllers={controllersLatest} />
                  </div>
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
                              {controller.sensor_controller_id}
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
