// src/components/SensorRenderer.jsx - UPDATED VERSION
import React, { useState } from "react";
import HistoryModal from "./HistoryModal";
import ResetPortModal from "./ResetPortModal";
import PortHistoryModal from "./PortHistoryModal";
import {
  Thermometer, Droplets, Gauge, Sun, Ruler, Waves,
  Activity, Zap, RotateCw, Eye, Move3d, Wind, CircleDot, Archive, RotateCcw
} from "lucide-react";
import HumidityAndTemperatureCard from "./sensors/HumidityAndTemperatureCard";

const API_BASE = import.meta.env?.VITE_API_BASE || "";

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
  rotary_sensor: RotateCw,
  encoder: RotateCw,
  current: Zap,
  distance: Ruler,
  motion: Waves,
  sound: Waves,
  gas: Wind,
  flame: CircleDot,
  vibration: Activity,
  us: Ruler,
};

const SENSOR_COLORS = {
  temperature: { icon: 'text-orange-500', bg: 'bg-orange-500/10', border: 'border-orange-500/20' },
  humidity: { icon: 'text-blue-500', bg: 'bg-blue-500/10', border: 'border-blue-500/20' },
  pressure: { icon: 'text-purple-500', bg: 'bg-purple-500/10', border: 'border-purple-500/20' },
  light_intensity: { icon: 'text-yellow-500', bg: 'bg-yellow-500/10', border: 'border-yellow-500/20' },
  ultrasonic: { icon: 'text-cyan-500', bg: 'bg-cyan-500/10', border: 'border-cyan-500/20' },
  us: { icon: 'text-cyan-500', bg: 'bg-cyan-500/10', border: 'border-cyan-500/20' },
  infrared: { icon: 'text-red-500', bg: 'bg-red-500/10', border: 'border-red-500/20' },
  imu: { icon: 'text-indigo-500', bg: 'bg-indigo-500/10', border: 'border-indigo-500/20' },
  voltage: { icon: 'text-green-500', bg: 'bg-green-500/10', border: 'border-green-500/20' },
  current: { icon: 'text-emerald-500', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' },
  rotary_encoder: { icon: 'text-teal-500', bg: 'bg-teal-500/10', border: 'border-teal-500/20' },
  rotary_sensor: { icon: 'text-teal-500', bg: 'bg-teal-500/10', border: 'border-teal-500/20' },
  encoder: { icon: 'text-teal-500', bg: 'bg-teal-500/10', border: 'border-teal-500/20' },
  vibration: { icon: 'text-pink-500', bg: 'bg-pink-500/10', border: 'border-pink-500/20' },
  default: { icon: 'text-gray-500', bg: 'bg-gray-500/10', border: 'border-gray-500/20' },
};

export default function SensorRenderer({
  node,
  hubId,
  raspiId,
  viewMode = 'grid',
  onReset,
}) {

  console.log("node : ", node);
  console.log("hubId : ",hubId);
  console.log("raspiId : ",raspiId);

  const [openHistoryModal, setOpenHistoryModal] = useState(false);
  const [openResetModal, setOpenResetModal] = useState(false);
  const [openPortHistoryModal, setOpenPortHistoryModal] = useState(false);

  const portId = Number(String(node?.node_id || "").replace(/^P/i, "")) || null;
  const sensorType = String(node.sensor_type || 'unknown').toLowerCase();
  const IconComponent = SENSOR_ICONS[sensorType] || Activity;
  const colors = SENSOR_COLORS[sensorType] || SENSOR_COLORS.default;

  // Get reading by key helper
  const getReading = (key) => {
    if (!node.readings || !Array.isArray(node.readings)) return null;
    return node.readings.find(r => r.key === key);
  };

  const handleResetSuccess = (result) => {
    console.log('Reset successful:', result);
    onReset && onReset({
      hubId,
      portId,
      newSensorId: result.newSensorId,
      deletedReadings: result.deletedReadings
    });
  };

  const sensorNameNormalize = (sensorType) => {
    if (sensorType === 'hum_temp') {
      return 'Humidity & Temperature';
    }
    // return sensorType.replace(/_/g, ' ');
  };

  const formatValue = () => {
    const val = node.value;
    const rawData = node._raw_data;
    const readings = node.readings;

    // ========== HUMIDITY SENSOR (NEW FORMAT) ==========
    if (sensorType === 'hum_temp' && readings) {
      return <HumidityAndTemperatureCard node={node} variant="embedded" />;
    }


    // ========== IMU SENSOR ==========
    if (sensorType === 'imu' && readings) {
      const accelReadings = readings.filter(r => r.key.startsWith('accel_'));
      const gyroReadings = readings.filter(r => r.key.startsWith('gyro_'));
      const tempReading = getReading('temperature');

      return (
        <div className="space-y-2 text-xs">
          {accelReadings.length > 0 && (
            <div>
              <div className="font-semibold text-gray-700 dark:text-gray-300">Accelerometer (m/s²)</div>
              <div className="font-mono">
                {accelReadings.map((r, i) => (
                  <span key={i}>{r.label.split(' ')[1]}:{r.value.toFixed(2)} </span>
                ))}
              </div>
            </div>
          )}
          {gyroReadings.length > 0 && (
            <div>
              <div className="font-semibold text-gray-700 dark:text-gray-300">Gyroscope (rad/s)</div>
              <div className="font-mono">
                {gyroReadings.map((r, i) => (
                  <span key={i}>{r.label.split(' ')[1]}:{r.value.toFixed(2)} </span>
                ))}
              </div>
            </div>
          )}
          {tempReading && (
            <div className="text-gray-600 dark:text-gray-400">
              Temp: {tempReading.value.toFixed(1)}{tempReading.unit}
            </div>
          )}
        </div>
      );
    }

    // ========== ROTARY ENCODER ==========
    if ((sensorType === 'rotary_encoder' || sensorType === 'rotary_sensor') && readings) {
      const dirReading = getReading('direction');
      const stepsReading = getReading('steps');

      return (
        <div className="space-y-1">
          {dirReading && (
            <div className="text-2xl font-bold">{dirReading.value}</div>
          )}
          {stepsReading && (
            <div className="text-sm text-gray-600 dark:text-gray-400">
              Count: {stepsReading.value}
            </div>
          )}
        </div>
      );
    }

    // ========== FALLBACK: Use readings array if available ==========
    if (readings && readings.length > 0) {
      const primary = readings[0];
      const secondary = readings[1];

      return (
        <div className="space-y-2">
          {primary && (
            <div>
              <div className="text-2xl font-bold text-slate-900 dark:text-white">
                {typeof primary.value === 'number' ? primary.value.toFixed(2) : primary.value}
                {primary.unit && <span className="text-base ml-1 text-gray-600 dark:text-gray-400">{primary.unit}</span>}
              </div>
              <div className="text-xs text-gray-600 dark:text-gray-400">{primary.label}</div>
            </div>
          )}
          {secondary && (
            <div className="pt-2 border-t border-black/10 dark:border-white/10">
              <span className="text-sm font-medium text-slate-900 dark:text-white">
                {typeof secondary.value === 'number' ? secondary.value.toFixed(2) : secondary.value}
              </span>
              <span className="text-xs text-gray-600 dark:text-gray-400 ml-2">
                {secondary.unit} {secondary.label}
              </span>
            </div>
          )}
        </div>
      );
    }

    // ========== FALLBACK: Numeric ==========
    if (typeof val === 'number') {
      return (
        <>
          {val.toFixed(2)}
          {node.unit && <span className="text-base ml-1 text-gray-600 dark:text-gray-400">{node.unit}</span>}
        </>
      );
    }

    // ========== FALLBACK: String ==========
    return (
      <>
        {val}
        {node.unit && <span className="text-base ml-1 text-gray-600 dark:text-gray-400">{node.unit}</span>}
      </>
    );
  };

  // ========== GRID VIEW ==========
  if (viewMode === 'grid') {
    return (
      <>
        <div
          role="button"
          onClick={() => setOpenHistoryModal(true)}
          className={`rounded-xl border ${colors.border} ${colors.bg} p-4 
                     hover:border-opacity-40 transition-all cursor-pointer group`}
        >
          <div className="flex items-center justify-between mb-3">
            <div className={`p-2 rounded-lg ${colors.bg} group-hover:scale-110 transition-transform`}>
              <IconComponent className={`w-5 h-5 ${colors.icon}`} />
            </div>
            <div className="flex items-center gap-1">
              <div className={`text-xs font-medium px-2 py-1 rounded-full ${node.status === 'online'
                  ? 'bg-green-500/20 text-green-600 dark:text-green-400'
                  : 'bg-gray-500/20 text-gray-600 dark:text-gray-400'
                }`}>
                {node.status}
              </div>
            </div>
          </div>

          <div className="mb-2">
            <div className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
              {node.node_id}
            </div>
            <div className="text-sm text-gray-700 dark:text-gray-300 capitalize">
              {sensorNameNormalize(node.sensor_type)}
            </div>
          </div>

          <div className="text-slate-900 dark:text-white min-h-[100px]">
            {formatValue()}
          </div>

          <div className="mt-3 pt-3 border-t border-black/10 dark:border-white/10 flex items-center justify-between gap-2">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setOpenPortHistoryModal(true);
              }}
              className="flex items-center gap-1 text-[10px] text-indigo-600 dark:text-indigo-400 
                       hover:text-indigo-700 dark:hover:text-indigo-300"
              title="View port history"
            >
              <Archive className="w-3 h-3" />
              <span>History</span>
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setOpenResetModal(true);
              }}
              className="flex items-center gap-1 text-[10px] rounded-md border px-2 py-1 
                       hover:bg-black/5 dark:hover:bg-white/10
                       border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-200"
              title="Reset port"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Reset</span>
            </button>
          </div>
        </div>

        <HistoryModal
          open={openHistoryModal}
          onClose={() => setOpenHistoryModal(false)}
          raspiId={raspiId}
          hubId={hubId}
          portId={portId}
          sensorTypeHint={node.sensor_type}
        />

        <ResetPortModal
          open={openResetModal}
          onClose={() => setOpenResetModal(false)}
          raspiId={raspiId}
          hubId={hubId}
          portId={portId}
          onSuccess={handleResetSuccess}
        />

        <PortHistoryModal
          open={openPortHistoryModal}
          onClose={() => setOpenPortHistoryModal(false)}
          raspiId={raspiId}
          hubId={hubId}
          portId={portId}
        />
      </>
    );
  }

  // ========== LIST VIEW (similar structure) ==========
  return (
    <>
      <div
        role="button"
        onClick={() => setOpenHistoryModal(true)}
        className={`rounded-lg border ${colors.border} ${colors.bg} p-4 hover:bg-opacity-80 
                   transition-all cursor-pointer flex items-center justify-between`}
      >
        <div className="flex items-center gap-4 flex-1">
          <div className={`p-3 rounded-lg ${colors.bg} flex-shrink-0`}>
            <IconComponent className={`w-6 h-6 ${colors.icon}`} />
          </div>

          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
              {node.node_id} • <span className="capitalize">{node.sensor_type.replace('_', ' ')}</span>
            </div>
            <div className="text-lg font-semibold text-slate-900 dark:text-white">
              {formatValue()}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <div className={`text-xs font-medium px-3 py-1 rounded-full ${node.status === 'online'
              ? 'bg-green-500/20 text-green-600 dark:text-green-400'
              : 'bg-gray-500/20 text-gray-600 dark:text-gray-400'
            }`}>
            {node.status}
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setOpenPortHistoryModal(true);
            }}
            className="text-xs rounded-md border px-2 py-1.5 flex items-center gap-1
                     hover:bg-black/5 dark:hover:bg-white/10
                     border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-200"
            title="Port history"
          >
            <Archive className="w-3 h-3" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setOpenResetModal(true);
            }}
            className="text-xs rounded-md border px-2 py-1.5 
                     hover:bg-black/5 dark:hover:bg-white/10
                     border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-200"
            title="Reset port"
          >
            Reset
          </button>
        </div>
      </div>

      <HistoryModal
        open={openHistoryModal}
        onClose={() => setOpenHistoryModal(false)}
        raspiId={raspiId}
        hubId={hubId}
        portId={portId}
        sensorTypeHint={node.sensor_type}
      />

      <ResetPortModal
        open={openResetModal}
        onClose={() => setOpenResetModal(false)}
        raspiId={raspiId}
        hubId={hubId}
        portId={portId}
        onSuccess={handleResetSuccess}
      />

      <PortHistoryModal
        open={openPortHistoryModal}
        onClose={() => setOpenPortHistoryModal(false)}
        raspiId={raspiId}
        hubId={hubId}
        portId={portId}
      />
    </>
  );
}