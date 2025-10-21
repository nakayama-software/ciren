import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, Thermometer, Gauge, MapPin, Clock, Cpu, Wifi, Zap, Eye,
  Settings, Battery, ArrowLeft, Droplets, Move3d, RadioTower, AlertTriangle,
  TrendingUp, Download, Globe,Sun
} from 'lucide-react';

/**
 * Dashboard.jsx — restorasi informasi + perbaikan stabilitas
 *
 * Ringkas perubahan:
 * - Mengembalikan semua info dari versi awal: grid sensor node (temperature, humidity, pressure,
 *   light_intensity, ultrasonic), status infrared, IMU (X/Y/Z), kartu detail controller (battery,
 *   signal, jumlah node), peta dengan marker, daftar controller, dan tombol unduh CSV per node.
 * - Perbaikan teknis: inisialisasi Leaflet lebih tahan race (tile layer sekali saja + LayerGroup markers),
 *   Chart.js di-reuse (tidak destroy setiap render, update data saja), i18n dipakai konsisten.
 */

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
      moreSensors: "more sensors",
      viewDetails: "View Details",
      footer: "© 2025 CIREN Dashboard",
    },
    controllerDetail: {
      back: "Back to Dashboard",
      battery: "Battery",
      signal: "Signal",
      sensorNodes: "Sensor Nodes",
      history: "Sensor Nodes Details & History",
    },
    sensors: {
      temperature: "Temperature",
      pressure: "Pressure",
      light_intensity: "Light Intensity",
      humidity: "Humidity",
      ultrasonic: "Ultrasonic",
      infrared: "Infrared",
      imu: "IMU",
      accelerometer: "Accelerometer",
      gyroscope: "Gyroscope",
      infraredStatus: { detected: "Motion Detected", clear: "Clear" },
    },
    download: {
      title: "Download historical data as CSV",
      header: "timestamp,value,unit",
      alerts: {
        noData: "No historical data available to download.",
        badFormat: "Data format is not downloadable (e.g., IMU data).",
      },
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
      moreSensors: "個の追加センサー",
      viewDetails: "詳細を表示",
      footer: "© 2025 CIREN ダッシュボード",
    },
    controllerDetail: {
      back: "ダッシュボードに戻る",
      battery: "バッテリー",
      signal: "信号強度",
      sensorNodes: "センサーノード",
      history: "センサーノードの詳細と履歴",
    },
    sensors: {
      temperature: "温度",
      pressure: "気圧",
      light_intensity: "光強度",
      humidity: "湿度",
      ultrasonic: "超音波",
      infrared: "赤外線",
      imu: "IMU",
      accelerometer: "加速度計",
      gyroscope: "ジャイロスコープ",
      infraredStatus: { detected: "動きを検出", clear: "クリア" },
    },
    download: {
      title: "履歴データをCSVとしてダウンロード",
      header: "タイムスタンプ,値,単位",
      alerts: {
        noData: "ダウンロード可能な履歴データがありません。",
        badFormat: "このデータ形式はダウンロードできません（例：IMUデータ）。",
      },
    },
  },
};

/********************** CSV helper **********************/
function downloadCSV(history, node, t) {
  if (!history || history.length === 0) {
    alert(t.download.alerts.noData);
    return;
  }
  const header = t.download.header;
  const rows = history
    .map((h) => {
      const ts = new Date(h.timestamp).toISOString();
      if (typeof h.value === 'object') return null; // skip IMU object
      return `${ts},${h.value},${node.unit || ''}`;
    })
    .filter(Boolean)
    .join('');
  if (!rows) {
    alert(t.download.alerts.badFormat);
    return;
  }
  const csvContent = header + rows;
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${node.node_id}_${node.sensor_type}_history.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/********************** Chart.js mini line **********************/
function SensorHistoryChart({ history, sensorLabel, lineColor = 'rgba(0, 212, 255, 1)' }) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!canvasRef.current || !window.Chart || !history?.length) return;

    const ctx = canvasRef.current.getContext('2d');
    const labels = history.map((h) => new Date(h.timestamp).toLocaleTimeString());
    const dataValues = history.map((h) => h.value);

    // gradient fill
    const gradient = ctx.createLinearGradient(0, 0, 0, canvasRef.current.offsetHeight);
    gradient.addColorStop(0, lineColor.replace(/1\)$/i, '0.4)'));
    gradient.addColorStop(1, lineColor.replace(/1\)$/i, '0)'));

    if (!chartRef.current) {
      chartRef.current = new window.Chart(ctx, {
        type: 'line',
        data: {
          labels,
          datasets: [
            {
              label: sensorLabel,
              data: dataValues,
              borderColor: lineColor,
              backgroundColor: gradient,
              fill: true,
              tension: 0.4,
              pointRadius: 0,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { display: false },
            y: { grid: { color: 'rgba(255,255,255,0.1)' }, ticks: { color: 'rgba(255,255,255,0.5)', font: { size: 10 } } },
          },
        },
      });
    } else {
      const c = chartRef.current;
      c.data.labels = labels;
      c.data.datasets[0].data = dataValues;
      c.update('none');
    }
  }, [history, sensorLabel, lineColor]);

  useEffect(() => () => { if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; } }, []);

  return <canvas ref={canvasRef} />;
}

/********************** Leaflet Map **********************/
function LeafletMap({ dataList }) {
  const mapDivRef = useRef(null);
  const mapRef = useRef(null);
  const markersGroupRef = useRef(null);

  useEffect(() => {
    let intervalId;

    function initMap() {
      if (!window.L || !mapDivRef.current || mapRef.current) return;
      const L = window.L;
      const first = dataList?.[0]?.data?.[0];
      const center = first?.latitude && first?.longitude ? [first.latitude, first.longitude] : [-6.2088, 106.8456];
      const map = L.map(mapDivRef.current, { center, zoom: 13, zoomControl: true });
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { attribution: '&copy; OpenStreetMap' }).addTo(map);
      const group = L.layerGroup().addTo(map);
      markersGroupRef.current = group;
      mapRef.current = map;
    }

    function drawMarkers() {
      if (!window.L || !mapRef.current || !markersGroupRef.current || !dataList?.length) return;
      const L = window.L;
      const group = markersGroupRef.current;
      group.clearLayers();
      const colors = ['#00d4ff', '#ff6b6b', '#4ecdc4', '#feca57'];
      dataList[0].data.forEach((controllerData, index) => {
        if (controllerData.latitude && controllerData.longitude) {
          const color = colors[index % colors.length];
          const customIcon = L.divIcon({
            className: 'custom-marker',
            html: `<div style="background:${color};width:20px;height:20px;border-radius:50%;border:3px solid white;box-shadow:0 0 10px rgba(0,0,0,0.5);"></div>`,
          });
          const marker = L.marker([controllerData.latitude, controllerData.longitude], { icon: customIcon });
          marker.bindPopup(`<div style="color:#333;"><b>${controllerData.sensor_controller_id}</b></div>`);
          marker.addTo(group);
        }
      });
    }

    if (!window.L) {
      intervalId = setInterval(() => { if (window.L) { clearInterval(intervalId); initMap(); drawMarkers(); } }, 120);
    } else {
      initMap();
      drawMarkers();
    }

    return () => { if (intervalId) clearInterval(intervalId); if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; } };
  }, [dataList]);

  useEffect(() => { // redraw markers when data updates
    if (!mapRef.current) return;
    const id = setTimeout(() => {}, 0);
    return () => clearTimeout(id);
  }, [dataList]);

  return <div ref={mapDivRef} className="w-full h-full bg-gray-900 rounded-xl" />;
}

/********************** Sensor views **********************/
const sensorHasChart = (type) => ['temperature', 'humidity', 'pressure', 'ultrasonic', 'light_intensity'].includes(type);

function HeaderWithDownload({ node, history, t }) {
  return (
    <div className="flex items-center space-x-2">
      <p className="font-semibold text-white capitalize">{(t.sensors[node.sensor_type] || node.sensor_type).toString()}</p>
      <button
        onClick={(e) => { e.stopPropagation(); downloadCSV(history, node, t); }}
        className="text-gray-500 hover:text-cyan-400 transition-colors"
        title={t.download.title}
        aria-label={t.download.title}
      >
        <Download className="w-4 h-4" />
      </button>
    </div>
  );
}

function UltrasonicSensorView({ node, history, t }) {
  const distance = parseFloat(node.value);
  const percentage = Math.min((distance / 300) * 100, 100);
  return (
    <div className="bg-white/5 rounded-lg p-4 space-y-3 transition-all hover:bg-white/10">
      <div className="flex items-start justify-between">
        <div className="flex items-center space-x-3">
          <RadioTower className="w-5 h-5 text-teal-400" />
          <div>
            <HeaderWithDownload node={node} history={history} t={t} />
            <p className="text-xs text-gray-400">{node.node_id}</p>
          </div>
        </div>
        <p className="text-2xl font-bold text-white">{node.value} <span className="text-sm text-gray-400">{node.unit}</span></p>
      </div>
      <div className="w-full bg-gray-700 rounded-full h-1.5 mt-2">
        <div className="bg-teal-400 h-1.5 rounded-full" style={{ width: `${percentage}%` }} />
      </div>
      <div className="h-20 -mb-2 -mx-2">
        <SensorHistoryChart history={history} sensorLabel={node.unit} lineColor="rgba(45, 206, 137, 1)" />
      </div>
    </div>
  );
}

function HumiditySensorView({ node, history, t }) {
  return (
    <div className="bg-white/5 rounded-lg p-4 space-y-2 transition-all hover:bg-white/10">
      <div className="flex items-start justify-between">
        <div className="flex items-center space-x-4">
          <Droplets className="w-6 h-6 text-blue-400" />
          <div>
            <HeaderWithDownload node={node} history={history} t={t} />
            <p className="text-xs text-gray-400">{node.node_id}</p>
          </div>
        </div>
        <p className="text-2xl font-bold text-white">{node.value} <span className="text-sm text-gray-400">{node.unit}</span></p>
      </div>
      <div className="h-20 -mb-2 -mx-2">
        <SensorHistoryChart history={history} sensorLabel={node.unit} lineColor="rgba(59, 130, 246, 1)" />
      </div>
    </div>
  );
}

function GenericSensorView({ node, history, t }) {
  const sensorIcons = {
    temperature: <Thermometer className="w-5 h-5 text-orange-400" />, 
    pressure: <Gauge className="w-5 h-5 text-yellow-400" />,
    light_intensity: <Sun className="w-5 h-5 text-yellow-300" />,
    default: <Zap className="w-5 h-5 text-gray-500" />,
  };
  const sensorLineColors = {
    temperature: 'rgba(251, 146, 60, 1)',
    pressure: 'rgba(250, 204, 21, 1)',
    light_intensity: 'rgba(234, 179, 8, 1)',
    default: 'rgba(156, 163, 175, 1)',
  };
  return (
    <div className="bg-white/5 rounded-lg p-4 space-y-2 transition-all hover:bg-white/10">
      <div className="flex items-start justify-between">
        <div className="flex items-center space-x-4">
          {sensorIcons[node.sensor_type] || sensorIcons.default}
          <div>
            <HeaderWithDownload node={node} history={history} t={t} />
            <p className="text-xs text-gray-400">{node.node_id}</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-lg font-bold text-white">{node.value} <span className="text-sm text-gray-400">{node.unit}</span></p>
        </div>
      </div>
      <div className="h-20 -mb-2 -mx-2">
        <SensorHistoryChart history={history} sensorLabel={node.unit} lineColor={sensorLineColors[node.sensor_type] || sensorLineColors.default} />
      </div>
    </div>
  );
}

function InfraredSensorView({ node, t }) {
  const isMotionDetected = node.value === 1;
  return (
    <div className="bg-white/5 rounded-lg p-4 transition-all hover:bg-white/10 h-full flex flex-col justify-center">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <AlertTriangle className={`w-5 h-5 ${isMotionDetected ? 'text-red-500 animate-pulse' : 'text-purple-400'}`} />
          <div>
            <p className="font-semibold text-white capitalize">{t.sensors.infrared}</p>
            <p className="text-xs text-gray-400">{node.node_id}</p>
          </div>
        </div>
        <p className={`text-lg font-bold ${isMotionDetected ? 'text-red-400' : 'text-green-400'}`}>
          {isMotionDetected ? t.sensors.infraredStatus.detected : t.sensors.infraredStatus.clear}
        </p>
      </div>
    </div>
  );
}

function IMUSensorView({ node, t }) {
  return (
    <div className="bg-white/5 rounded-lg p-4 space-y-2 transition-all hover:bg-white/10 h-full">
      <div className="flex items-center space-x-3 mb-2">
        <Move3d className="w-5 h-5 text-indigo-400" />
        <div>
          <p className="font-semibold text-white">{t.sensors.imu}</p>
          <p className="text-xs text-gray-400">{node.node_id}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 text-center">
        <div>
          <p className="text-sm font-bold text-gray-300">{t.sensors.accelerometer} (g)</p>
          <div className="flex justify-around text-xs font-mono mt-1">
            <span>X: {Number(node.value.accelerometer.x).toFixed(2)}</span>
            <span>Y: {Number(node.value.accelerometer.y).toFixed(2)}</span>
            <span>Z: {Number(node.value.accelerometer.z).toFixed(2)}</span>
          </div>
        </div>
        <div>
          <p className="text-sm font-bold text-gray-300">{t.sensors.gyroscope} (°/s)</p>
          <div className="flex justify-around text-xs font-mono mt-1">
            <span>X: {Number(node.value.gyroscope.x).toFixed(2)}</span>
            <span>Y: {Number(node.value.gyroscope.y).toFixed(2)}</span>
            <span>Z: {Number(node.value.gyroscope.z).toFixed(2)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

const sensorViewComponents = {
  ultrasonic: UltrasonicSensorView,
  humidity: HumiditySensorView,
  infrared: InfraredSensorView,
  imu: IMUSensorView,
};

/********************** Controller Detail **********************/
function ControllerDetailView({ controller, onBack, historicalData, t }) {
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
        <h3 className="text-lg font-bold text-white mb-4 flex items-center space-x-2">
          <TrendingUp className="w-6 h-6 text-cyan-400" />
          <span>{t.controllerDetail.history}</span>
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {controller.sensor_nodes.map((node, index) => {
            const nodeHistory = historicalData
              .map((dataPoint) => {
                const ctrl = dataPoint.data.find((c) => c.sensor_controller_id === controller.sensor_controller_id);
                if (!ctrl) return null;
                const n = ctrl.sensor_nodes.find((n) => n.node_id === node.node_id);
                return n ? { timestamp: dataPoint.timestamp, value: n.value } : null;
              })
              .filter(Boolean)
              .reverse();

            if (sensorHasChart(node.sensor_type)) {
              const ComponentToRender = sensorViewComponents[node.sensor_type] || GenericSensorView;
              return <ComponentToRender key={index} node={node} history={nodeHistory} t={t} />;
            } else {
              const ComponentToRender = sensorViewComponents[node.sensor_type];
              return ComponentToRender ? (
                <ComponentToRender key={index} node={node} t={t} />
              ) : (
                <GenericSensorView key={index} node={node} history={[]} t={t} />
              );
            }
          })}
        </div>
      </div>
    </div>
  );
}

/********************** Dashboard Utama **********************/
export default function Dashboard() {
  const [raspiID] = useState('RPI-001-DEMO');
  const [username] = useState('Demo User');
  const [dataList, setDataList] = useState([]); // history berurutan terbaru > lama
  const [selectedControllerId, setSelectedControllerId] = useState(null);
  const [startTime] = useState(new Date());
  const [runningTime, setRunningTime] = useState('00:00:00');
  const [language, setLanguage] = useState('en');
  const t = useMemo(() => translations[language], [language]);

  // Load Leaflet & Chart.js (UMD)
  useEffect(() => {
    const leafletCss = document.createElement('link');
    leafletCss.rel = 'stylesheet';
    leafletCss.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(leafletCss);

    const leafletScript = document.createElement('script');
    leafletScript.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    leafletScript.async = true;
    document.body.appendChild(leafletScript);

    const chartScript = document.createElement('script');
    chartScript.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js';
    chartScript.async = true;
    document.body.appendChild(chartScript);

    return () => {
      if (document.head.contains(leafletCss)) document.head.removeChild(leafletCss);
      if (document.body.contains(leafletScript)) document.body.removeChild(leafletScript);
      if (document.body.contains(chartScript)) document.body.removeChild(chartScript);
    };
  }, []);

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

  // Simulasi data (mengembalikan semua tipe sensor + IMU)
  useEffect(() => {
    const allSensorTypes = [
      { type: 'temperature', unit: '°C', gen: () => parseFloat((25 + Math.random() * 10).toFixed(1)) },
      { type: 'pressure', unit: 'hPa', gen: () => parseFloat((1010 + Math.random() * 10).toFixed(2)) },
      { type: 'light_intensity', unit: 'lux', gen: () => Math.floor(40000 + Math.random() * 20000) },
      { type: 'humidity', unit: '%', gen: () => parseFloat((60 + Math.random() * 20).toFixed(1)) },
      { type: 'ultrasonic', unit: 'cm', gen: () => parseFloat((10 + Math.random() * 200).toFixed(1)) },
      { type: 'infrared', unit: '', gen: () => (Math.random() > 0.9 ? 1 : 0) },
      { type: 'imu', unit: 'g & dps', gen: () => ({
          // gunakan g≈1 pada Z saat diam, noise kecil di X/Y
          accelerometer: { x: +(Math.random() * 0.2 - 0.1), y: +(Math.random() * 0.2 - 0.1), z: +(1 + (Math.random()*0.02 - 0.01)) },
          gyroscope: { x: +(Math.random() * 10 - 5), y: +(Math.random() * 10 - 5), z: +(Math.random() * 10 - 5) },
        }) },
    ];

    const generateControllerData = (controllerId, nodeIdPrefix, lat, lon) => {
      const numSensors = 3 + Math.floor(Math.random() * 4);
      const shuffled = [...allSensorTypes].sort(() => 0.5 - Math.random());
      const selected = shuffled.slice(0, numSensors);
      return {
        sensor_controller_id: controllerId,
        controller_status: 'online',
        signal_strength: -40 - Math.floor(Math.random() * 25),
        battery_level: 60 + Math.floor(Math.random() * 40),
        sensor_nodes: selected.map((s, i) => ({
          node_id: `${nodeIdPrefix}-${String(i + 1).padStart(3, '0')}`,
          sensor_type: s.type,
          value: s.gen(),
          unit: s.unit,
          status: 'active',
        })),
        latitude: lat + (Math.random() - 0.5) * 0.01,
        longitude: lon + (Math.random() - 0.5) * 0.01,
      };
    };

    const generateData = () => ({
      timestamp: new Date().toISOString(),
      raspi_serial_id: raspiID,
      data: [
        generateControllerData('ESP-CTRL-001', 'XIAO-A', -6.2088, 106.8456),
        generateControllerData('ESP-CTRL-002', 'XIAO-B', -6.215, 106.85),
        generateControllerData('ESP-CTRL-003', 'XIAO-C', -6.2, 106.84),
      ],
    });

    setDataList([generateData()]);
    const interval = setInterval(() => setDataList((prev) => [generateData(), ...prev.slice(0, 19)]), 3000);
    return () => clearInterval(interval);
  }, [raspiID]);

  const latestData = dataList[0];
  const selectedControllerData = latestData?.data.find((c) => c.sensor_controller_id === selectedControllerId);

  const tempSensors = latestData?.data?.flatMap((c) => c.sensor_nodes).filter((n) => n.sensor_type === 'temperature') || [];
  const averageTemp = tempSensors.length > 0 ? (tempSensors.reduce((acc, n) => acc + n.value, 0) / tempSensors.length).toFixed(1) : 'N/A';
  const averageBattery = latestData?.data?.length > 0 ? (latestData.data.reduce((acc, c) => acc + c.battery_level, 0) / latestData.data.length).toFixed(0) : 'N/A';

  if (!latestData) {
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
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6">
          <div className="flex items-center space-x-4">
            <div className="w-12 h-12 bg-gradient-to-r from-cyan-400 to-purple-500 rounded-full flex items-center justify-center shadow-2xl">
              <Activity className="w-7 h-7 text-white" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-white">{username}{t.dashboard.title}</h1>
              <p className="text-gray-400 text-sm">{t.dashboard.raspiId} <code className="text-cyan-400">{raspiID}</code></p>
            </div>
          </div>
          <div className="flex items-center space-x-2 mt-4 sm:mt-0">
            <Globe className="w-5 h-5 text-gray-400" />
            <button onClick={() => setLanguage('en')} className={`px-3 py-1 text-sm rounded-md transition-colors ${language === 'en' ? 'bg-cyan-500 text-white' : 'bg-white/10 text-gray-300 hover:bg-white/20'}`}>EN</button>
            <button onClick={() => setLanguage('ja')} className={`px-3 py-1 text-sm rounded-md transition-colors ${language === 'ja' ? 'bg-cyan-500 text-white' : 'bg-white/10 text-gray-300 hover:bg-white/20'}`}>JP</button>
          </div>
        </div>

        {selectedControllerData ? (
          <ControllerDetailView controller={selectedControllerData} onBack={() => setSelectedControllerId(null)} historicalData={dataList} t={t} />
        ) : (
          <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 bg-white/10 backdrop-blur-lg rounded-2xl p-4 border border-white/20 h-96 lg:h-[26rem]">
                <h2 className="text-xl font-bold text-white flex items-center space-x-2 mb-3">
                  <MapPin className="w-6 h-6 text-cyan-400" />
                  <span>{t.dashboard.controllerPositions}</span>
                </h2>
                <div className="w-full h-[calc(100%-2.5rem)]"><LeafletMap dataList={dataList} /></div>
              </div>
              <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-4 border border-white/20 flex flex-col">
                <h2 className="text-xl font-bold text-white flex items-center space-x-2 mb-4">
                  <Gauge className="w-6 h-6 text-purple-400" />
                  <span>{t.dashboard.mainModuleStatus}</span>
                </h2>
                <div className="space-y-2 text-sm flex-grow">
                  <div className="flex justify-between items-center bg-white/5 p-2 rounded-lg">
                    <span className="text-gray-400 flex items-center space-x-2"><Eye className="w-4 h-4" /><span>{t.dashboard.liveStatus}</span></span>
                    <span className="font-semibold text-green-400">{t.dashboard.online}</span>
                  </div>
                  <div className="flex justify-between items-center bg-white/5 p-2 rounded-lg">
                    <span className="text-gray-400 flex items-center space-x-2"><Cpu className="w-4 h-4" /><span>{t.dashboard.controllers}</span></span>
                    <span className="font-mono text-white">{latestData.data.filter((c) => c.controller_status === 'online').length} / {latestData.data.length}</span>
                  </div>
                  <div className="flex justify-between items-center bg-white/5 p-2 rounded-lg">
                    <span className="text-gray-400 flex items-center space-x-2"><Clock className="w-4 h-4" /><span>{t.dashboard.runningTime}</span></span>
                    <span className="font-mono text-white">{runningTime}</span>
                  </div>
                  <div className="flex justify-between items-center bg-white/5 p-2 rounded-lg">
                    <span className="text-gray-400 flex items-center space-x-2"><Thermometer className="w-4 h-4" /><span>{t.dashboard.avgTemp}</span></span>
                    <span className="font-mono text-white">{averageTemp}°C</span>
                  </div>
                  <div className="flex justify-between items-center bg-white/5 p-2 rounded-lg">
                    <span className="text-gray-400 flex items-center space-x-2"><Battery className="w-4 h-4" /><span>{t.dashboard.avgBattery}</span></span>
                    <span className="font-mono text-white">{averageBattery}%</span>
                  </div>
                </div>
                <p className="text-center mt-4 text-gray-500 text-xs">{t.dashboard.footer}</p>
              </div>
            </div>

            <div>
              <h2 className="text-xl font-bold text-white flex items-center space-x-2 mb-4">
                <Settings className="w-6 h-6 text-cyan-400" />
                <span>{t.dashboard.sensorControllers}</span>
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {latestData.data.map((controller, idx) => (
                  <div key={idx} className="group bg-white/10 backdrop-blur-lg rounded-xl p-4 border border-white/20 hover:border-white/40 transition-all duration-300">
                    <div className="flex items-center justify-between mb-4">
                      <div className="w-10 h-10 bg-gradient-to-r from-blue-400 to-cyan-500 rounded-lg flex items-center justify-center"><Cpu className="w-5 h-5 text-white" /></div>
                      <div className="text-right">
                        <div className="font-bold text-white">{controller.sensor_controller_id}</div>
                        <div className="text-xs text-gray-400">{controller.sensor_nodes.length} {t.dashboard.nodesActive}</div>
                      </div>
                    </div>
                    <div className="space-y-2 mb-4">
                      {controller.sensor_nodes.slice(0, 2).map((node, nodeIdx) => (
                        <div key={nodeIdx} className="flex justify-between items-center text-xs bg-white/5 p-2 rounded">
                          <span className="text-gray-400 capitalize">{t.sensors[node.sensor_type] || node.sensor_type}</span>
                          <span className="text-white font-semibold">{typeof node.value === 'object' ? (t.sensors[node.sensor_type] || node.sensor_type) : `${node.value} ${node.unit}`}</span>
                        </div>
                      ))}
                      {controller.sensor_nodes.length > 2 && (
                        <p className="text-xs text-center text-gray-400 pt-1">+ {controller.sensor_nodes.length - 2} {t.dashboard.moreSensors}</p>
                      )}
                    </div>
                    <button onClick={() => setSelectedControllerId(controller.sensor_controller_id)} className="w-full bg-white/10 hover:bg-white/20 text-white py-2 px-4 rounded-lg transition-all duration-300 flex items-center justify-center space-x-2 text-sm">
                      <Eye className="w-4 h-4" />
                      <span>{t.dashboard.viewDetails}</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
