// src/Dashboard.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, Thermometer, Gauge, MapPin, Clock, Cpu, Wifi, Zap, Eye,
  Settings, Battery, ArrowLeft, Globe, Sun
} from 'lucide-react';
import SensorRenderer from "./components/sensors/SensorRenderer.jsx";
import { useParams, useSearchParams } from 'react-router-dom';

const API_BASE = import.meta.env.VITE_API_BASE || '';
const HUB_OFFLINE_MS = 12_000; // hub menghilang jika tak terlihat > 12s
const NODE_OFFLINE_MS = 8_000;  // NODE LIVENESS: node dihapus jika tak terlihat > 8s

const WINDOW_MS = 5_000;

/************************ i18n ************************/
const translations = {
  en: {
    dashboard: {
      title: "'s Dashboard",
      raspiId: "Raspi ID",
      initializing: "Initializing Dashboard...",
      controllerPositions: "Controller Positions",
      mainModuleStatus: "Main Module Status",
      liveStatus: "Live Status",
      online: "ONLINE",
      controllers: "Controllers",
      runningTime: "Running Time",
      avgTemp: "Avg. Temp",
      avgBattery: "Avg. Battery",
      sensorControllers: "Sensor Controllers",
      nodesActive: "nodes active",
      viewDetails: "View Details",
      footer: "© 2025 CIREN Dashboard",
      noNode: "No node connected",
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
    dashboard: {
      title: "のダッシュボード",
      raspiId: "Raspi ID",
      initializing: "ダッシュボードを初期化中...",
      controllerPositions: "コントローラーの位置",
      mainModuleStatus: "メインモジュールの状態",
      liveStatus: "ライブステータス",
      online: "オンライン",
      controllers: "コントローラー",
      runningTime: "稼働時間",
      avgTemp: "平均温度",
      avgBattery: "平均バッテリー",
      sensorControllers: "センサーコントローラー",
      nodesActive: "ノードがアクティブ",
      viewDetails: "詳細を表示",
      footer: "© 2025 CIREN ダッシュボード",
      noNode: "接続されたノードはありません",
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

/********************** Adapter: hub → controllers **********************/
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
    sensor_controller_id: hubObj.sensor_controller_id ?? hubObj.sensor_controller ?? "UNKNOWN",
    controller_status: "online",
    signal_strength: hubObj.signal_strength ?? -60,
    battery_level: hubObj.battery_level ?? 80,
    sensor_nodes: nodes, // bisa kosong
    latitude: hubObj.latitude,
    longitude: hubObj.longitude,
  };
}

/********************** Leaflet Map **********************/
function LeafletMap({ controllers }) {
  const mapDivRef = useRef(null);
  const mapRef = useRef(null);
  const markersGroupRef = useRef(null);

  useEffect(() => {
    let intervalId;

    function initMap() {
      if (!window.L || !mapDivRef.current || mapRef.current) return;
      const L = window.L;
      const first = controllers?.[0];
      const center =
        first?.latitude && first?.longitude
          ? [first.latitude, first.longitude]
          : [-6.2088, 106.8456];

      const map = L.map(mapDivRef.current, { center, zoom: 13, zoomControl: true });
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { attribution: '&copy; OpenStreetMap' }).addTo(map);
      const group = L.layerGroup().addTo(map);
      markersGroupRef.current = group;
      mapRef.current = map;
    }

    function drawMarkers() {
      if (!window.L || !mapRef.current || !markersGroupRef.current) return;
      const L = window.L;
      const group = markersGroupRef.current;
      group.clearLayers();
      const colors = ['#00d4ff', '#ff6b6b', '#4ecdc4', '#feca57'];

      (controllers || []).forEach((c, index) => {
        if (c.latitude && c.longitude) {
          const color = colors[index % colors.length];
          const customIcon = L.divIcon({
            className: 'custom-marker',
            html: `<div style="background:${color};width:20px;height:20px;border-radius:50%;border:3px solid white;box-shadow:0 0 10px rgba(0,0,0,0.5);"></div>`,
          });
          const marker = L.marker([c.latitude, c.longitude], { icon: customIcon });
          marker.bindPopup(`<div style="color:#333;"><b>${c.sensor_controller_id}</b></div>`);
          marker.addTo(group);
        }
      });
    }

    if (!window.L) {
      intervalId = setInterval(() => {
        if (window.L) {
          clearInterval(intervalId);
          initMap();
          drawMarkers();
        }
      }, 120);
    } else {
      initMap();
      drawMarkers();
    }

    return () => {
      if (intervalId) clearInterval(intervalId);
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
    };
  }, [controllers]);

  useEffect(() => {
    if (!mapRef.current) return;
    const id = setTimeout(() => { }, 0);
    return () => clearTimeout(id);
  }, [controllers]);

  return <div ref={mapDivRef} className="w-full h-full bg-gray-900 rounded-xl" />;
}

/********************** Controller Detail **********************/
function ControllerDetailView({ controller, onBack, t }) {
  console.log(c);

  return (
    <div className="bg-white/5 backdrop-blur-lg rounded-2xl p-4 sm:p-6 border border-white/20 animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center space-x-4">
          <div className="w-12 h-12 bg-gradient-to-r from-purple-500 to-cyan-500 rounded-xl flex items-center justify-center">
            <Cpu className="w-7 h-7 text-white" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-white">{controller.sensor_controller_id}</h2>
            <p className="text-sm text-green-400 font-semibold capitalize">{controller.controller_status}</p>
          </div>
        </div>
        <button onClick={onBack} className="bg-white/10 hover:bg-white/20 px-4 py-2 rounded-lg transition-all duration-300 flex items-center space-x-2 text-white text-sm">
          <ArrowLeft className="w-4 h-4" />
          <span>{t.controllerDetail.back}</span>
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="bg-white/5 rounded-lg p-4">
          <div className="flex items-center space-x-2 mb-1"><Battery className="w-5 h-5 text-green-400" /><span className="text-sm text-gray-400">{t.controllerDetail.battery}</span></div>
          <div className="text-xl text-white font-semibold">{controller.battery_level}%</div>
        </div>
        <div className="bg-white/5 rounded-lg p-4">
          <div className="flex items-center space-x-2 mb-1"><Wifi className="w-5 h-5 text-blue-400" /><span className="text-sm text-gray-400">{t.controllerDetail.signal}</span></div>
          <div className="text-xl text-white font-semibold">{controller.signal_strength} dBm</div>
        </div>
        <div className="bg-white/5 rounded-lg p-4">
          <div className="flex items-center space-x-2 mb-1"><Zap className="w-5 h-5 text-yellow-400" /><span className="text-sm text-gray-400">{t.controllerDetail.sensorNodes}</span></div>
          <div className="text-xl text-white font-semibold">{controller.sensor_nodes.length}</div>
        </div>
      </div>

      <div>
        <h3 className="text-lg font-bold text-white mb-4">
          {t.controllerDetail.history}
        </h3>

        {controller.sensor_nodes.length === 0 ? (
          <div className="p-3 rounded bg-yellow-50/10 border border-yellow-200/30 text-yellow-100 text-sm">
            No node connected
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

/********************** Dashboard Utama (real data) **********************/
export default function Dashboard() {
  const { userID } = useParams();
  const [searchParams] = useSearchParams();
  const usernameProp = userID || searchParams.get("user") || window.__APP_USERNAME__;

  const [language, setLanguage] = useState('en');
  const t = useMemo(() => translations[language], [language]);

  const [raspiID, setRaspiID] = useState(null);
  const [controllersLatest, setControllersLatest] = useState([]); // daftar hub yang masih alive + node terfilter
  const [selectedControllerId, setSelectedControllerId] = useState(null);

  const [startTime] = useState(new Date());
  const [runningTime, setRunningTime] = useState('00:00:00');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  // Liveness reference maps
  const hubLastSeenRef = useRef(new Map()); // hubId -> ms
  const hubSnapshotRef = useRef(new Map()); // hubId -> last ctrl snapshot (bisa nodes kosong)
  const nodeLastSeenRef = useRef(new Map()); // NODE LIVENESS: `${hubId}:${nodeId}` -> ms

  // Running time
  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      const diff = Math.floor((now - startTime) / 1000);
      const h = String(Math.floor(diff / 3600)).padStart(2, '0');
      const m = String(Math.floor((diff % 3600) / 60)).padStart(2, '0');
      const s = String(diff % 60).padStart(2, '0');
      setRunningTime(`${h}:${m}:${s}`);
    }, 1000);
    return () => clearInterval(timer);
  }, [startTime]);

  // resolve raspi + load + polling
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

        // Sort terbaru -> lama
        entries.sort((a, b) => {
          const ta = new Date(a.received_ts || a.timestamp || 0).getTime();
          const tb = new Date(b.received_ts || b.timestamp || 0).getTime();
          return tb - ta;
        });

        const now = Date.now();

        // ---------------------------
        // 1) Bangun peta "last seen"
        // ---------------------------
        const nodeLastSeen = new Map();   // `${hubId}:P${i}` -> ms
        const hubMetaLatest = new Map();  // hubId -> meta terbaru
        const hubLastSeen = new Map();  // hubId -> ms

        for (const rec of entries) {
          const ts = new Date(rec.received_ts || rec.timestamp || 0).getTime();
          if (!isFinite(ts) || now - ts > WINDOW_MS) break;
          if (!Array.isArray(rec.data)) continue;

          for (const hubObj of rec.data) {
            const ctrl = normalizeHubToController(hubObj);
            const hubId = ctrl.sensor_controller_id;

            // meta terbaru per hub
            if (!hubMetaLatest.has(hubId)) {
              hubMetaLatest.set(hubId, {
                sensor_controller_id: hubId,
                controller_status: "online",
                signal_strength: ctrl.signal_strength ?? -60,
                battery_level: ctrl.battery_level ?? 80,
                latitude: ctrl.latitude,
                longitude: ctrl.longitude,
              });
            }
            hubLastSeen.set(hubId, Math.max(hubLastSeen.get(hubId) || 0, ts));

            // port yang muncul pada record ini
            for (let i = 1; i <= 8; i++) {
              const key = `port-${i}`;
              if (!hubObj[key]) continue;
              nodeLastSeen.set(`${hubId}:P${i}`, Math.max(nodeLastSeen.get(`${hubId}:P${i}`) || 0, ts));
            }
          }
        }

        // ---------------------------
        // 2) Susun daftar hub visible
        // ---------------------------
        let visible = [];
        for (const [hubId, meta] of hubMetaLatest.entries()) {
          const seenAt = hubLastSeen.get(hubId) || 0;
          if (now - seenAt > WINDOW_MS) continue; // hub tak aktif dalam window

          const nodes = [];
          for (let i = 1; i <= 8; i++) {
            const key = `${hubId}:P${i}`;
            const last = nodeLastSeen.get(key) || 0;
            if (now - last <= WINDOW_MS) {
              // ambil value terbaru untuk node ini dalam window
              let nodeParsed = null;
              for (const rec of entries) {
                const ts = new Date(rec.received_ts || rec.timestamp || 0).getTime();
                if (now - ts > WINDOW_MS) break;
                const row = Array.isArray(rec.data) ? rec.data.find(h => {
                  const id = (h.sensor_controller_id ?? h.sensor_controller ?? "UNKNOWN");
                  return id === hubId;
                }) : null;
                if (!row) continue;
                const raw = row[`port-${i}`];
                if (!raw) continue;
                const parsed = parseTypeValue(raw);
                nodeParsed = {
                  node_id: `P${i}`,
                  sensor_type: parsed.type,
                  value: parsed.value,
                  unit: parsed.unit,
                  status: "active",
                };
                break;
              }
              if (nodeParsed) nodes.push(nodeParsed);
            }
          }

          visible.push({ ...meta, sensor_nodes: nodes }); // nodes bisa []
        }

        // ---------------------------
        // 3) Fallback “hub tanpa node”
        //    Kalau tidak ada hub di window, tapi ada rekaman terbaru:
        //    tampilkan hub dari rekaman terbaru (nodes boleh kosong)
        // ---------------------------
        if (visible.length === 0 && entries.length > 0) {
          const latest = entries[0];
          const latestTs = new Date(latest.received_ts || latest.timestamp || 0).getTime();
          if (isFinite(latestTs) && now - latestTs <= WINDOW_MS && Array.isArray(latest.data)) {
            visible = latest.data.map(hubObj => {
              const ctrl = normalizeHubToController(hubObj);
              // kosongkan nodes (anggap no node connected pada snapshot ini)
              return {
                sensor_controller_id: ctrl.sensor_controller_id,
                controller_status: "online",
                signal_strength: ctrl.signal_strength ?? -60,
                battery_level: ctrl.battery_level ?? 80,
                latitude: ctrl.latitude,
                longitude: ctrl.longitude,
                sensor_nodes: [], // <- ini yang memicu label "No node connected"
              };
            });
          }
        }

        // ---------------------------
        // 4) Commit ke state
        // ---------------------------
        visible.sort((a, b) => String(a.sensor_controller_id).localeCompare(String(b.sensor_controller_id)));
        setControllersLatest(visible);

        // Tutup panel detail kalau hub-nya sudah tak visible
        if (selectedControllerId && !visible.find(v => v.sensor_controller_id === selectedControllerId)) {
          setSelectedControllerId(null);
        }
      } catch (e) {
        setErr(e.message || String(e));
      }
    }



    resolveAndLoad();
    return () => {
      stop = true;
      if (pollId) clearInterval(pollId);
    };
  }, [usernameProp, selectedControllerId]);

  // metrik ringkas pakai nodes yang sudah terfilter (agar tak kebawa node stale)
  const averageTemp = useMemo(() => {
    const temps = controllersLatest.flatMap(c => c.sensor_nodes).filter(n => n.sensor_type === 'temperature');
    if (!temps.length) return 'N/A';
    const avg = temps.reduce((s, n) => s + (Number(n.value) || 0), 0) / temps.length;
    return avg.toFixed(1);
  }, [controllersLatest]);

  const averageBattery = useMemo(() => {
    if (!controllersLatest.length) return 'N/A';
    const avg = controllersLatest.reduce((s, c) => s + (Number(c.battery_level) || 0), 0) / controllersLatest.length;
    return avg.toFixed(0);
  }, [controllersLatest]);

  const selectedController = controllersLatest.find(c => c.sensor_controller_id === selectedControllerId);

  if (loading && !raspiID) {
    return (
      <div className="h-screen w-screen bg-gradient-to-br from-slate-900 to-purple-900 flex items-center justify-center text-white text-2xl">
        {t.dashboard.initializing}
      </div>
    );
  }

  return (
    <div className="h-screen w-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 overflow-hidden fixed inset-0">
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-purple-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-pulse" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-cyan-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-pulse delay-1000" />
      </div>

      <div className="relative z-10 h-full w-full overflow-y-auto p-4 sm:p-6 lg:p-8">
        {/* header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6">
          <div className="flex items-center space-x-4">
            <div className="w-12 h-12 bg-gradient-to-r from-cyan-400 to-purple-500 rounded-full flex items-center justify-center shadow-2xl">
              <Activity className="w-7 h-7 text-white" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-white">
                {usernameProp}{t.dashboard.title}
              </h1>
              <p className="text-gray-400 text-sm">
                {t.dashboard.raspiId}{" "}
                <code className="text-cyan-400">{raspiID || "—"}</code>
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-2 mt-4 sm:mt-0">
            <Globe className="w-5 h-5 text-gray-400" />
            <button onClick={() => setLanguage('en')} className={`px-3 py-1 text-sm rounded-md transition-colors ${language === 'en' ? 'bg-cyan-500 text-white' : 'bg-white/10 text-gray-300 hover:bg-white/20'}`}>EN</button>
            <button onClick={() => setLanguage('ja')} className={`px-3 py-1 text-sm rounded-md transition-colors ${language === 'ja' ? 'bg-cyan-500 text-white' : 'bg-white/10 text-gray-300 hover:bg-white/20'}`}>JP</button>
          </div>
        </div>

        {err && (
          <div className="mb-4 p-3 rounded bg-red-500/10 border border-red-500/40 text-red-200 text-sm">
            Error: {err}
          </div>
        )}

        {/* detail controller */}
        {selectedController ? (
          <ControllerDetailView
            controller={selectedController}
            onBack={() => setSelectedControllerId(null)}
            t={t}
          />
        ) : (
          <div className="space-y-6">
            {/* map + main status */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 bg-white/10 backdrop-blur-lg rounded-2xl p-4 border border-white/20 h-96 lg:h-[26rem]">
                <h2 className="text-xl font-bold text-white flex items-center space-x-2 mb-3">
                  <MapPin className="w-6 h-6 text-cyan-400" />
                  <span>{t.dashboard.controllerPositions}</span>
                </h2>
                <div className="w-full h-[calc(100%-2.5rem)]">
                  <LeafletMap controllers={controllersLatest} />
                </div>
              </div>

              <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-4 border border-white/20 flex flex-col">
                <h2 className="text-xl font-bold text-white flex items-center space-x-2 mb-4">
                  <Gauge className="w-6 h-6 text-purple-400" />
                  <span>{t.dashboard.mainModuleStatus}</span>
                </h2>
                <div className="space-y-2 text-sm flex-grow">
                  <div className="flex justify-between items-center bg-white/5 p-2 rounded-lg">
                    <span className="text-gray-400 flex items-center space-x-2">
                      <Eye className="w-4 h-4" /><span>{t.dashboard.liveStatus}</span>
                    </span>
                    <span className="font-semibold text-green-400">{t.dashboard.online}</span>
                  </div>
                  <div className="flex justify-between items-center bg-white/5 p-2 rounded-lg">
                    <span className="text-gray-400 flex items-center space-x-2">
                      <Cpu className="w-4 h-4" /><span>{t.dashboard.controllers}</span>
                    </span>
                    <span className="font-mono text-white">
                      {controllersLatest.filter((c) => c.controller_status === 'online').length} / {controllersLatest.length}
                    </span>
                  </div>
                  <div className="flex justify-between items-center bg-white/5 p-2 rounded-lg">
                    <span className="text-gray-400 flex items-center space-x-2">
                      <Clock className="w-4 h-4" /><span>{t.dashboard.runningTime}</span>
                    </span>
                    <span className="font-mono text-white">{runningTime}</span>
                  </div>
                  <div className="flex justify-between items-center bg-white/5 p-2 rounded-lg">
                    <span className="text-gray-400 flex items-center space-x-2">
                      <Thermometer className="w-4 h-4" /><span>{t.dashboard.avgTemp}</span>
                    </span>
                    <span className="font-mono text-white">{averageTemp}{averageTemp !== 'N/A' ? '°C' : ''}</span>
                  </div>
                  <div className="flex justify-between items-center bg-white/5 p-2 rounded-lg">
                    <span className="text-gray-400 flex items-center space-x-2">
                      <Battery className="w-4 h-4" /><span>{t.dashboard.avgBattery}</span>
                    </span>
                    <span className="font-mono text-white">{averageBattery}{averageBattery !== 'N/A' ? '%' : ''}</span>
                  </div>
                </div>
                <p className="text-center mt-4 text-gray-500 text-xs">{t.dashboard.footer}</p>
              </div>
            </div>

            {/* daftar hub (ringkas) */}
            <div>
              <h2 className="text-xl font-bold text-white flex items-center space-x-2 mb-4">
                <Settings className="w-6 h-6 text-cyan-400" />
                <span>{t.dashboard.sensorControllers}</span>
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {controllersLatest.map((controller, idx) => {
                  const online = controller.controller_status === 'online';
                  const hasNodes = controller.sensor_nodes.length > 0;
                  return (
                    <div key={idx} className="group bg-white/10 backdrop-blur-lg rounded-xl p-4 border border-white/20 hover:border-white/40 transition-all duration-300">
                      <div className="flex items-center justify-between mb-4">
                        <div className="w-10 h-10 bg-gradient-to-r from-blue-400 to-cyan-500 rounded-lg flex items-center justify-center">
                          <Cpu className="w-5 h-5 text-white" />
                        </div>
                        <div className="text-right">
                          <div className="font-bold text-white">{controller.sensor_controller_id}</div>
                          <div className="text-xs text-gray-400">
                            {hasNodes
                              ? (<>{controller.sensor_nodes.length} {t.dashboard.nodesActive}</>)
                              : (<span className="text-yellow-200">{translations[language].dashboard.noNode}</span>)
                            }
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-2 mb-4 text-xs">
                        <div className="bg-white/5 p-2 rounded flex items-center justify-between">
                          <Battery className="w-4 h-4 text-green-400" />
                          <span className="text-white font-semibold">{controller.battery_level}%</span>
                        </div>
                        <div className="bg-white/5 p-2 rounded flex items-center justify-between">
                          <Wifi className="w-4 h-4 text-blue-400" />
                          <span className="text-white font-semibold">{controller.signal_strength} dBm</span>
                        </div>
                        <div className="bg-white/5 p-2 rounded flex items-center justify-between">
                          <Eye className={`w-4 h-4 ${online ? 'text-green-400' : 'text-gray-400'}`} />
                          <span className={`font-semibold ${online ? 'text-green-400' : 'text-gray-300'}`}>
                            {online ? t.dashboard.online : 'OFFLINE'}
                          </span>
                        </div>
                      </div>

                      <button
                        onClick={() => setSelectedControllerId(controller.sensor_controller_id)}
                        className="w-full bg-white/10 hover:bg-white/20 text-white py-2 px-4 rounded-lg transition-all duration-300 flex items-center justify-center space-x-2 text-sm"
                      >
                        <Eye className="w-4 h-4" />
                        <span>{t.dashboard.viewDetails}</span>
                      </button>
                    </div>
                  );
                })}

                {controllersLatest.length === 0 && (
                  <div className="col-span-full p-4 bg-yellow-50/10 border border-yellow-200/30 rounded text-yellow-100 text-sm">
                    Belum ada hub terdeteksi untuk Raspi <b>{raspiID || "—"}</b>.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
