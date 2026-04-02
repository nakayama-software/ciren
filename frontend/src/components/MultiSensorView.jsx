// src/components/MultiSensorView.jsx
import React, { useState, useEffect, useMemo } from "react";
import { X, ExternalLink, Activity } from "lucide-react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Filler,
} from "chart.js";
import { Line } from "react-chartjs-2";
import { socket } from "../lib/socket";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Filler);

const API_BASE = (import.meta.env?.VITE_API_BASE || "").replace(/\/+$/, "");
const MAX_POINTS = 60;

// ─── Data hook ────────────────────────────────────────────────────────────────
function useSensorFeed(raspiId, hubId, port, sensor_type, open) {
  const [readings, setReadings] = useState([]);
  const [liveValue, setLiveValue] = useState(null);

  useEffect(() => {
    if (!open || !raspiId || !hubId || !port || !sensor_type) {
      setReadings([]);
      setLiveValue(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const params = new URLSearchParams({
          raspberry_serial_id: String(raspiId).toLowerCase(),
          module_id: String(hubId),
          sensor_type: String(sensor_type),
          port_number: String(port),
          limit: "60",
          skip: "0",
        });
        const res = await fetch(`${API_BASE}/api/sensor-readings?${params}`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (cancelled) return;
        if (Array.isArray(data.items)) {
          setReadings([...data.items].reverse());
        }
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [open, raspiId, hubId, port, sensor_type]);

  useEffect(() => {
    if (!open) return;
    const handler = (msg) => {
      if (
        String(msg.raspberry_serial_id).toLowerCase() !== String(raspiId).toLowerCase() ||
        String(msg.module_id) !== String(hubId) ||
        Number(msg.port_number) !== Number(port) ||
        String(msg.sensor_type) !== String(sensor_type)
      ) return;
      setLiveValue(msg.value);
      setReadings((prev) => {
        const next = [...prev, { value: msg.value, timestamp_server: msg.timestamp_server }];
        return next.slice(-MAX_POINTS);
      });
    };
    socket.on("node-sample", handler);
    return () => socket.off("node-sample", handler);
  }, [open, raspiId, hubId, port, sensor_type]);

  return { readings, liveValue };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function fmtTime(r) {
  const d = new Date(r.timestamp_device || r.timestamp_server || "");
  if (isNaN(d)) return "";
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

function parseSingleFloat(value) {
  const n = parseFloat(String(value ?? "").trim());
  return Number.isFinite(n) ? n : null;
}

function parseHumTemp(value) {
  const parts = String(value ?? "").split(",");
  const temp = parseFloat(parts[0]);
  const hum = parseFloat(parts[1]);
  return { temp: Number.isFinite(temp) ? temp : null, hum: Number.isFinite(hum) ? hum : null };
}

function parseIMU(value) {
  const segs = String(value ?? "").split("|");
  if (segs.length < 3) return null;
  const acc = segs[0].split(",").map(parseFloat);
  const gyr = segs[1].split(",").map(parseFloat);
  const temp = parseFloat(segs[2]);
  return { ax: acc[0]??0, ay: acc[1]??0, az: acc[2]??0, gx: gyr[0]??0, gy: gyr[1]??0, gz: gyr[2]??0, temp: Number.isFinite(temp)?temp:0 };
}

function parseRotary(value) {
  const parts = String(value ?? "").split(",");
  return { direction: parts[0] === "CCW" ? "CCW" : "CW", delta: parseInt(parts[1]) || 0 };
}

// ─── Chart options ────────────────────────────────────────────────────────────
const CHART_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  animation: { duration: 0 },
  plugins: { legend: { display: false }, tooltip: { enabled: true, mode: "index", intersect: false } },
  scales: {
    x: { ticks: { maxTicksLimit: 4, maxRotation: 0, font: { size: 9 }, color: "rgba(128,128,128,0.8)" }, grid: { display: false } },
    y: { ticks: { maxTicksLimit: 4, font: { size: 9 }, color: "rgba(128,128,128,0.8)" }, grid: { color: "rgba(128,128,128,0.12)" } },
  },
};

// ─── Line Panel ───────────────────────────────────────────────────────────────
function LinePanel({ readings, sensorType }) {
  const isDual = sensorType === "hum_temp";
  const { chartData, liveDisplay } = useMemo(() => {
    const labels = readings.map(fmtTime);
    const last = readings[readings.length - 1];
    let liveDisplay = "—";

    if (isDual) {
      const temps = readings.map((r) => parseHumTemp(r.value).temp);
      const hums = readings.map((r) => parseHumTemp(r.value).hum);
      if (last) {
        const { temp, hum } = parseHumTemp(last.value);
        liveDisplay = `${temp?.toFixed(1) ?? "—"}°C / ${hum?.toFixed(1) ?? "—"}%`;
      }
      return {
        liveDisplay,
        chartData: {
          labels,
          datasets: [
            { label: "Temp", data: temps, borderColor: "rgb(239,68,68)", backgroundColor: "rgba(239,68,68,0.08)", borderWidth: 1.5, pointRadius: 0, fill: false, tension: 0.3 },
            { label: "Hum", data: hums, borderColor: "rgb(99,102,241)", backgroundColor: "rgba(99,102,241,0.08)", borderWidth: 1.5, pointRadius: 0, fill: false, tension: 0.3 },
          ],
        },
      };
    }

    const values = readings.map((r) => parseSingleFloat(r.value));
    const color = sensorType === "voltage" ? { b: "rgb(234,179,8)", bg: "rgba(234,179,8,0.1)" }
      : sensorType === "current" ? { b: "rgb(249,115,22)", bg: "rgba(249,115,22,0.1)" }
      : { b: "rgb(6,182,212)", bg: "rgba(6,182,212,0.1)" };

    if (last) {
      const val = parseSingleFloat(last.value);
      if (val !== null)
        liveDisplay = sensorType === "voltage" ? `${val.toFixed(3)} V` : sensorType === "current" ? `${val.toFixed(3)} A` : `${val.toFixed(1)} cm`;
    }

    return {
      liveDisplay,
      chartData: {
        labels,
        datasets: [{ label: sensorType, data: values, borderColor: color.b, backgroundColor: color.bg, borderWidth: 1.5, pointRadius: 0, fill: true, tension: 0.3 }],
      },
    };
  }, [readings, sensorType, isDual]);

  return (
    <div className="flex flex-col h-full">
      {isDual && (
        <div className="flex gap-3 mb-1 flex-shrink-0">
          <div className="flex items-center gap-1"><div className="w-3 h-0.5 rounded bg-red-500"/><span className="text-[10px] text-gray-400">Temp</span></div>
          <div className="flex items-center gap-1"><div className="w-3 h-0.5 rounded bg-indigo-500"/><span className="text-[10px] text-gray-400">Humidity</span></div>
        </div>
      )}
      <div className="text-xl font-bold text-slate-900 dark:text-white mb-2 flex-shrink-0">{liveDisplay}</div>
      <div className="flex-1 min-h-0">
        {readings.length > 1
          ? <Line data={chartData} options={CHART_OPTS} />
          : <div className="flex items-center justify-center h-full text-gray-400 text-sm">Collecting data…</div>}
      </div>
    </div>
  );
}

// ─── Vibration Panel ──────────────────────────────────────────────────────────
function VibrationPanel({ readings }) {
  const lastVal = readings[readings.length - 1]?.value;
  const isActive = String(lastVal ?? "").toLowerCase() === "true";
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3">
      <div className={`w-16 h-16 rounded-full flex items-center justify-center border-2 transition-all duration-300 ${isActive ? "bg-red-500/20 border-red-500 animate-pulse" : "bg-slate-100 dark:bg-slate-700/50 border-slate-300 dark:border-slate-600"}`}>
        <Activity className={`w-8 h-8 ${isActive ? "text-red-500" : "text-slate-400"}`} />
      </div>
      <span className={`text-base font-bold tracking-wide ${isActive ? "text-red-500" : "text-slate-500 dark:text-slate-400"}`}>
        {readings.length === 0 ? "—" : isActive ? "VIBRATING" : "IDLE"}
      </span>
    </div>
  );
}

// ─── IMU Panel ────────────────────────────────────────────────────────────────
function IMUPanel({ liveValue }) {
  const parsed = liveValue ? parseIMU(liveValue) : null;
  const rows = parsed ? [
    ["Accel X", parsed.ax.toFixed(3), "m/s²"],
    ["Accel Y", parsed.ay.toFixed(3), "m/s²"],
    ["Accel Z", parsed.az.toFixed(3), "m/s²"],
    ["Gyro X",  parsed.gx.toFixed(4), "rad/s"],
    ["Gyro Y",  parsed.gy.toFixed(4), "rad/s"],
    ["Gyro Z",  parsed.gz.toFixed(4), "rad/s"],
    ["Temp",    parsed.temp.toFixed(2), "°C"],
  ] : [];
  return (
    <div className="flex flex-col h-full justify-center">
      {!parsed
        ? <div className="text-gray-400 text-sm text-center">Waiting for data…</div>
        : <div className="grid grid-cols-3 gap-x-2 gap-y-1.5">
            {rows.map(([label, val, unit]) => (
              <React.Fragment key={label}>
                <span className="text-[10px] text-gray-500 dark:text-gray-400 text-right pr-1 self-center">{label}</span>
                <span className="text-xs font-mono font-semibold text-slate-900 dark:text-white text-right self-center tabular-nums">{val}</span>
                <span className="text-[10px] text-gray-400 self-center">{unit}</span>
              </React.Fragment>
            ))}
          </div>}
    </div>
  );
}

// ─── Rotary Panel ─────────────────────────────────────────────────────────────
function RotaryPanel({ readings }) {
  const position = useMemo(() => {
    let p = 0;
    for (const r of readings) {
      const { direction, delta } = parseRotary(r.value);
      p += direction === "CW" ? delta : -delta;
    }
    return p;
  }, [readings]);
  const last = readings[readings.length - 1];
  const lastDir = last ? parseRotary(last.value).direction : null;
  return (
    <div className="flex flex-col items-center justify-center h-full gap-2">
      <div className="text-5xl font-bold text-slate-900 dark:text-white tabular-nums">{position}</div>
      <div className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider">steps</div>
      {lastDir && (
        <div className={`text-sm font-semibold px-3 py-1 rounded-full ${lastDir === "CW" ? "bg-green-500/15 text-green-600 dark:text-green-400" : "bg-red-500/15 text-red-600 dark:text-red-400"}`}>
          {lastDir === "CW" ? "↻ CW" : "↺ CCW"}
        </div>
      )}
      {!last && <div className="text-gray-400 text-sm">Waiting for data…</div>}
    </div>
  );
}

// ─── Sensor Panel wrapper ─────────────────────────────────────────────────────
function SensorPanel({ raspiId, hubId, sensor, open, onPopOut }) {
  const { port, sensor_type } = sensor;
  const { readings, liveValue } = useSensorFeed(raspiId, hubId, port, sensor_type, open);
  const label = sensor_type.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());

  const renderBody = () => {
    switch (sensor_type) {
      case "imu":          return <IMUPanel liveValue={liveValue} />;
      case "vibration":    return <VibrationPanel readings={readings} />;
      case "rotary_sensor":return <RotaryPanel readings={readings} />;
      default:             return <LinePanel readings={readings} sensorType={sensor_type} />;
    }
  };

  return (
    <div className="rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-slate-800 p-4 flex flex-col" style={{ minHeight: "260px" }}>
      <div className="flex items-start justify-between mb-3 flex-shrink-0">
        <div>
          <span className="text-[10px] font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500">Port {port}</span>
          <h4 className="text-sm font-semibold text-slate-900 dark:text-white leading-tight">{label}</h4>
        </div>
        <button onClick={() => onPopOut(sensor)} title="Open full view" className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors flex-shrink-0">
          <ExternalLink className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="flex-1 min-h-0">{renderBody()}</div>
    </div>
  );
}

// ─── Main modal ───────────────────────────────────────────────────────────────
export default function MultiSensorView({ open, onClose, label, raspiId, hubId, onPopOut }) {
  if (!open || !label) return null;
  const { name, sensors } = label;
  const gridClass = sensors.length === 1 ? "grid-cols-1"
    : sensors.length <= 4 ? "grid-cols-1 md:grid-cols-2"
    : "grid-cols-1 md:grid-cols-2 xl:grid-cols-3";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="relative w-full max-w-5xl max-h-[90vh] flex flex-col rounded-2xl border border-black/10 dark:border-white/10 bg-slate-50 dark:bg-slate-900 shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-black/10 dark:border-white/10 flex-shrink-0 bg-white dark:bg-slate-800/80">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{name}</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">{sensors.length} sensor{sensors.length !== 1 ? "s" : ""} • Live Grid View</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 transition-colors">
            <X className="w-5 h-5 text-gray-600 dark:text-gray-400" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          <div className={`grid ${gridClass} gap-4`}>
            {sensors.map((sensor) => (
              <SensorPanel key={`${sensor.port}-${sensor.sensor_type}`} raspiId={raspiId} hubId={hubId} sensor={sensor} open={open} onPopOut={onPopOut} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}