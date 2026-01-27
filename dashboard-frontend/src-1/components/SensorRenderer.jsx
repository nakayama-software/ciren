// src/components/SensorRenderer.jsx - IMPROVED VERSION
import React, { useState } from "react";
import HistoryModal from "./HistoryModal";
import { 
  Thermometer, Droplets, Gauge, Sun, Ruler, Waves, 
  Activity, Zap, RotateCw, Eye, Move3d, Wind, CircleDot 
} from "lucide-react";

const API_BASE = import.meta.env?.VITE_API_BASE || "";

// Sensor type to icon mapping
const SENSOR_ICONS = {
  temperature: Thermometer,
  humidity: Droplets,
  pressure: Gauge,
  light_intensity: Sun,
  ultrasonic: Ruler,
  infrared: Eye,
  imu: Move3d,
  voltage: Zap,
  rotary_encoder: RotateCw,
  encoder: RotateCw,
  accelerometer: Activity,
  gyroscope: Activity,
  current: Zap,
  distance: Ruler,
  motion: Waves,
  sound: Waves,
  gas: Wind,
  flame: CircleDot,
};

// Sensor type to color mapping
const SENSOR_COLORS = {
  temperature: { icon: 'text-orange-500', bg: 'bg-orange-500/10', border: 'border-orange-500/20' },
  humidity: { icon: 'text-blue-500', bg: 'bg-blue-500/10', border: 'border-blue-500/20' },
  pressure: { icon: 'text-purple-500', bg: 'bg-purple-500/10', border: 'border-purple-500/20' },
  light_intensity: { icon: 'text-yellow-500', bg: 'bg-yellow-500/10', border: 'border-yellow-500/20' },
  ultrasonic: { icon: 'text-cyan-500', bg: 'bg-cyan-500/10', border: 'border-cyan-500/20' },
  infrared: { icon: 'text-red-500', bg: 'bg-red-500/10', border: 'border-red-500/20' },
  imu: { icon: 'text-indigo-500', bg: 'bg-indigo-500/10', border: 'border-indigo-500/20' },
  voltage: { icon: 'text-green-500', bg: 'bg-green-500/10', border: 'border-green-500/20' },
  rotary_encoder: { icon: 'text-teal-500', bg: 'bg-teal-500/10', border: 'border-teal-500/20' },
  encoder: { icon: 'text-teal-500', bg: 'bg-teal-500/10', border: 'border-teal-500/20' },
  default: { icon: 'text-gray-500', bg: 'bg-gray-500/10', border: 'border-gray-500/20' },
};

export default function SensorRenderer({
  node,           // { node_id: 'P1', sensor_type, value, unit, status? }
  hubId,          // string, id hub (sensor_controller_id)
  raspiId,        // string, raspi_serial_id
  viewMode = 'grid', // 'grid' or 'list'
  onReset,        // optional callback setelah reset sukses
}) {

  console.log("node : ", node);
  
  const [resetting, setResetting] = useState(false);
  const [openModal, setOpenModal] = useState(false);
  const portId = Number(String(node?.node_id || "").replace(/^P/i, "")) || null;

  const sensorType = String(node.sensor_type || 'unknown').toLowerCase();
  const IconComponent = SENSOR_ICONS[sensorType] || Activity;
  const colors = SENSOR_COLORS[sensorType] || SENSOR_COLORS.default;

  async function handleReset(e) {
    e.stopPropagation();
    if (!raspiId || !hubId || !portId) {
      alert("Parameter reset tidak lengkap (raspiId / hubId / portId).");
      return;
    }
    const ok = confirm(
      `Reset data untuk ${hubId} • Port ${portId}?\nSemua histori di port ini akan dihapus dan sensor_id baru akan dibuat.`
    );
    if (!ok) return;

    try {
      setResetting(true);
      const res = await fetch(`${API_BASE}/api/reset-port`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ raspi_serial_id: raspiId, hub_id: hubId, port_id: portId }),
      });

      let data = null;
      try { data = await res.json(); } catch {}

      if (!res.ok || !data?.success) {
        const msg = data?.error || data?.message || "Reset gagal.";
        alert(msg);
        return;
      }
      alert(`Reset berhasil. SensorID baru: ${data.newSensorId}`);
      onReset && onReset({ hubId, portId, newSensorId: data.newSensorId });
    } catch (e) {
      console.error(e);
      alert("Gagal terhubung ke server.");
    } finally {
      setResetting(false);
    }
  }

  // Format value based on sensor type
  const formatValue = () => {
    const val = node.value;
    
    // Handle IMU (complex object)
    if (sensorType === 'imu' && typeof val === 'object') {
      return (
        <div className="space-y-1">
          {val.accelerometer && (
            <div className="text-xs">
              <span className="text-gray-600 dark:text-gray-400">Acc:</span>{' '}
              X:{Number(val.accelerometer.x).toFixed(2)} Y:{Number(val.accelerometer.y).toFixed(2)} Z:{Number(val.accelerometer.z).toFixed(2)}
            </div>
          )}
          {val.gyroscope && (
            <div className="text-xs">
              <span className="text-gray-600 dark:text-gray-400">Gyro:</span>{' '}
              X:{Number(val.gyroscope.x).toFixed(2)} Y:{Number(val.gyroscope.y).toFixed(2)} Z:{Number(val.gyroscope.z).toFixed(2)}
            </div>
          )}
        </div>
      );
    }

    // Handle rotary encoder (direction + count)
    if (sensorType === 'rotary_encoder' || sensorType === 'encoder') {
      if (typeof val === 'string' && val.includes(',')) {
        const [direction, count] = val.split(',');
        return (
          <div className="space-y-1">
            <div className="text-lg font-semibold">{direction}</div>
            <div className="text-xs text-gray-600 dark:text-gray-400">Count: {count}</div>
          </div>
        );
      }
    }

    // Handle array values (like humidity with temp,hum)
    if (typeof val === 'string' && val.includes(',')) {
      const parts = val.split(',');
      return (
        <div className="space-y-1">
          {parts.map((part, i) => (
            <div key={i} className="text-sm">{part.trim()}</div>
          ))}
        </div>
      );
    }

    // Handle boolean (infrared/motion sensors)
    if (typeof val === 'boolean') {
      return (
        <span className={`text-lg font-semibold ${val ? 'text-red-600 dark:text-red-400' : 'text-gray-600 dark:text-gray-400'}`}>
          {val ? 'DETECTED' : 'CLEAR'}
        </span>
      );
    }

    // Handle numeric values
    if (typeof val === 'number') {
      return (
        <>
          {val.toFixed(2)}
          {node.unit && <span className="text-base ml-1 text-gray-600 dark:text-gray-400">{node.unit}</span>}
        </>
      );
    }

    // Default string display
    return (
      <>
        {val}
        {node.unit && <span className="text-base ml-1 text-gray-600 dark:text-gray-400">{node.unit}</span>}
      </>
    );
  };

  if (viewMode === 'list') {
    return (
      <>
        <div
          role="button"
          onClick={() => setOpenModal(true)}
          className={`rounded-lg border ${colors.border} ${colors.bg} p-4 hover:bg-opacity-80 
                     transition-all cursor-pointer flex items-center justify-between`}
        >
          <div className="flex items-center gap-4">
            <div className={`p-3 rounded-lg ${colors.bg}`}>
              <IconComponent className={`w-6 h-6 ${colors.icon}`} />
            </div>
            <div>
              <div className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                {node.node_id} • <span className="capitalize">{node.sensor_type.replace('_', ' ')}</span>
              </div>
              <div className="text-lg font-semibold text-slate-900 dark:text-white">
                {formatValue()}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className={`text-xs font-medium px-3 py-1 rounded-full ${
              node.status === 'online' 
                ? 'bg-green-500/20 text-green-600 dark:text-green-400' 
                : 'bg-gray-500/20 text-gray-600 dark:text-gray-400'
            }`}>
              {node.status}
            </div>
            <button
              type="button"
              onClick={handleReset}
              disabled={resetting}
              className={`text-xs rounded-md border px-3 py-1.5 
                ${resetting
                  ? "opacity-60 cursor-not-allowed"
                  : "hover:bg-black/5 dark:hover:bg-white/10"}
                border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-200`}
              title="Reset histori port ini"
            >
              {resetting ? "..." : "Reset"}
            </button>
          </div>
        </div>
        <HistoryModal
          open={openModal}
          onClose={() => setOpenModal(false)}
          raspiId={raspiId}
          hubId={hubId}
          portId={portId}
          sensorTypeHint={node.sensor_type}
        />
      </>
    );
  }

  return (
    <>
      <div
        role="button"
        onClick={() => setOpenModal(true)}
        className={`rounded-xl border ${colors.border} ${colors.bg} p-4 
                   hover:border-opacity-40 transition-all cursor-pointer group`}
      >
        <div className="flex items-center justify-between mb-3">
          <div className={`p-2 rounded-lg ${colors.bg} group-hover:scale-110 transition-transform`}>
            <IconComponent className={`w-5 h-5 ${colors.icon}`} />
          </div>
          <div className="flex items-center gap-2">
            <div className={`text-xs font-medium px-2 py-1 rounded-full ${
              node.status === 'online' 
                ? 'bg-green-500/20 text-green-600 dark:text-green-400' 
                : 'bg-gray-500/20 text-gray-600 dark:text-gray-400'
            }`}>
              {node.status}
            </div>
            <button
              type="button"
              onClick={handleReset}
              disabled={resetting}
              className={`text-[10px] rounded-md border px-2 py-1 
                ${resetting
                  ? "opacity-60 cursor-not-allowed"
                  : "hover:bg-black/5 dark:hover:bg-white/10"}
                border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-200`}
              title="Reset histori port ini"
            >
              {resetting ? "..." : "Reset"}
            </button>
          </div>
        </div>

        <div className="mb-2">
          <div className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
            {node.node_id}
          </div>
          <div className="text-sm text-gray-700 dark:text-gray-300 capitalize">
            {node.sensor_type.replace('_', ' ')}
          </div>
        </div>

        <div className="text-2xl font-semibold text-slate-900 dark:text-white">
          {formatValue()}
        </div>

        <div className="mt-3 text-[10px] text-gray-500 dark:text-gray-400 flex items-center gap-1">
          <Eye className="w-3 h-3" />
          <span>Click to view history</span>
        </div>
      </div>

      <HistoryModal
        open={openModal}
        onClose={() => setOpenModal(false)}
        raspiId={raspiId}
        hubId={hubId}
        portId={portId}
        sensorTypeHint={node.sensor_type}
      />
    </>
  );
}
