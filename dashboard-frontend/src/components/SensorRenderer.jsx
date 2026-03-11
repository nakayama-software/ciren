import React, { useMemo } from "react";
import { Activity, RotateCcw, Move3d, Droplets, Thermometer,
         Zap, RadioTower, Radio, RotateCw } from "lucide-react";

import HumidityAndTemperatureCard from "./sensors/HumidityAndTemperatureCard";
import ImuCard from "./sensors/IMUCard";
import { normalizeSensorType } from "../utils/helpers";
import UltrasonicCard from "./sensors/UltrasonicCard";
import RotaryCard from "./sensors/RotaryCard";
import VoltageCard from "./sensors/VoltageCard";
import CurrentCard from "./sensors/CurrentCard";
import GenericCard from "./sensors/GenericCard";

const SENSOR_REGISTRY = {
  hum_temp: {
    label: "Humidity & Temperature",
    Icon: Droplets,
    colors: { icon: "text-indigo-500", bg: "bg-indigo-500/10", border: "border-indigo-500/20" },
    Card: (props) => <HumidityAndTemperatureCard {...props} variant="embedded" />,
    detail: { type: "line" },
  },
  imu: {
    label: "IMU",
    Icon: Move3d,
    colors: { icon: "text-violet-500", bg: "bg-violet-500/10", border: "border-violet-500/20" },
    Card: (props) => <ImuCard {...props} variant="embedded" />,
    detail: { type: "imu3d" },
  },
  temperature: {
    label: "Temperature",
    Icon: Thermometer,
    colors: { icon: "text-orange-500", bg: "bg-orange-500/10", border: "border-orange-500/20" },
    Card: null,
    detail: { type: "line" },
  },
  humidity: {
    label: "Humidity",
    Icon: Droplets,
    colors: { icon: "text-blue-500", bg: "bg-blue-500/10", border: "border-blue-500/20" },
    Card: null,
    detail: { type: "line" },
  },
  us: {
    label: "Ultrasonic",
    Icon: RadioTower,
    colors: { icon: "text-teal-500", bg: "bg-teal-500/10", border: "border-teal-500/20" },
    Card: (props) => <UltrasonicCard {...props} variant="embedded" />,
    detail: { type: "line" },
  },
  rotary_sensor: {
    label: "Rotary Sensor",
    Icon: RotateCw,
    colors: { icon: "text-amber-500", bg: "bg-amber-500/10", border: "border-amber-500/20" },
    Card: (props) => <RotaryCard {...props} variant="embedded" />,
    detail: { type: "rotary_sensor" },
  },
  voltage: {
    label: "Voltage",
    Icon: Zap,
    colors: { icon: "text-yellow-500", bg: "bg-yellow-500/10", border: "border-yellow-500/20" },
    Card: (props) => <VoltageCard {...props} variant="embedded" />,
    detail: { type: "line" },
  },
  current: {
    label: "Current",
    Icon: Activity,
    colors: { icon: "text-orange-500", bg: "bg-orange-500/10", border: "border-orange-500/20" },
    Card: (props) => <CurrentCard {...props} variant="embedded" />,
    detail: { type: "line" },
  },
  vibration: {
    label: "Vibration",
    Icon: Radio,
    colors: { icon: "text-red-500", bg: "bg-red-500/10", border: "border-red-500/20" },
    Card: (props) => <GenericCard {...props} />,
    detail: { type: "line" },
  },
};

const DEFAULT_META = {
  label: "Unknown Sensor",
  Icon: Activity,
  colors: { icon: "text-slate-500", bg: "bg-slate-500/10", border: "border-slate-500/20" },
  Card: (props) => <GenericCard {...props} />,
  detail: { type: "line" },
};

function formatLabelFromType(sensorType) {
  return sensorType.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

export default function SensorRenderer({ node, hubId, raspiId, onOpenDetail }) {
  const portId = Number(String(node?.node_id || "").replace(/^P/i, "")) || null;
  const sensorType = normalizeSensorType(node?.sensor_type);

  const meta = useMemo(() => {
    return SENSOR_REGISTRY[sensorType] || {
      ...DEFAULT_META,
      label: formatLabelFromType(sensorType),
    };
  }, [sensorType]);

  const { colors, Card, detail } = meta;

  const openDetail = () => {
    if (!portId) return;
    if (detail?.type === "imu3d") {
      onOpenDetail?.({ type: "imu3d", raspiId, hubId, portId, sensorTypeHint: node?.sensor_type });
      return;
    }
    if (detail?.type === "rotary_sensor") {
      onOpenDetail?.({ type: "rotary_sensor", raspiId, hubId, portId, sensorTypeHint: node?.sensor_type });
      return;
    }
    onOpenDetail?.({ type: "line", raspiId, hubId, portId, sensorTypeHint: node?.sensor_type });
  };

  return (
    <div
      role="button"
      onClick={openDetail}
      className={`rounded-xl border ${colors.border} ${colors.bg} p-4 hover:border-opacity-60 transition-all cursor-pointer`}
    >
      <div className="text-slate-900 dark:text-white min-h-[100px]">
        {Card ? <Card node={node} /> : (
          <div className="flex items-center justify-center h-full text-slate-400 dark:text-gray-500 text-sm py-8">
            Click to view chart
          </div>
        )}
      </div>

      <div className="mt-3 pt-3 border-t border-black/10 dark:border-white/10 flex items-center justify-between gap-2">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onOpenDetail?.({ type: "reset", raspiId, hubId, portId, sensorTypeHint: sensorType });
          }}
          className="flex items-center gap-1 text-[10px] rounded-md border px-2 py-1 hover:bg-black/5 dark:hover:bg-white/10 border-black/10 dark:border-white/10 text-slate-600 dark:text-gray-200"
          title="Reset port"
        >
          <RotateCcw className="w-3 h-3" />
          <span>Reset</span>
        </button>
      </div>
    </div>
  );
}