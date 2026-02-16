import React, { useMemo, useState } from "react";

import { Activity, Archive, RotateCcw, Move3d, Droplets, Thermometer } from "lucide-react";

import HumidityAndTemperatureCard from "./sensors/HumidityAndTemperatureCard";
import ImuCard from "./sensors/IMUCard";
import IMU3DModal from "./charts/IMU3DModal";
import { normalizeSensorType } from "../utils/helpers";
import UltrasonicCard from "./sensors/UltrasonicCard";
import RotaryCard from "./sensors/RotaryCard";

const SENSOR_REGISTRY = {
  hum_temp: {
    label: "Humidity & Temperature",
    Icon: Droplets,
    colors: { icon: "text-indigo-500", bg: "bg-indigo-500/10", border: "border-indigo-500/20" },
    Card: (props) => <HumidityAndTemperatureCard {...props} variant="embedded" />,
    detail: { type: "linearChart" },
  },
  imu: {
    label: "IMU",
    Icon: Move3d,
    colors: { icon: "text-indigo-500", bg: "bg-indigo-500/10", border: "border-indigo-500/20" },
    Card: (props) => <ImuCard {...props} variant="embedded" />,
    detail: { type: "imu3d" },
  },
  temperature: {
    label: "Temperature",
    Icon: Thermometer,
    colors: { icon: "text-orange-500", bg: "bg-orange-500/10", border: "border-orange-500/20" },
    Card: null,
    detail: { type: "linearChart" },
  },
  humidity: {
    label: "Humidity",
    Icon: Droplets,
    colors: { icon: "text-blue-500", bg: "bg-blue-500/10", border: "border-blue-500/20" },
    Card: null,
    detail: { type: "linearChart" },
  },
  us: {
    label: "us",
    Icon: Droplets,
    colors: { icon: "text-indigo-500", bg: "bg-indigo-500/10", border: "border-indigo-500/20" },
    Card: (props) => <UltrasonicCard {...props} variant="embedded" />,
    detail: { type: "linearChart" },
  },
  rotary_sensor: {
    label: "rotary_sensor",
    Icon: Droplets,
    colors: { icon: "text-indigo-500", bg: "bg-indigo-500/10", border: "border-indigo-500/20" },
    Card: (props) => <RotaryCard {...props} variant="embedded" />,
    detail: { type: "rotary_sensor" },
  },
};

const DEFAULT_META = {
  label: "Unknown Sensor",
  Icon: Activity,
  colors: { icon: "text-gray-500", bg: "bg-gray-500/10", border: "border-gray-500/20" },
  Card: null,
  detail: { type: "linearChart" },
};

function formatLabelFromType(sensorType) {
  return sensorType.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

export default function SensorRenderer({ node, hubId, raspiId, onReset, onOpenDetail }) {
  // console.log("node : ", node);

  const portId = Number(String(node?.node_id || "").replace(/^P/i, "")) || null;
  const sensorType = normalizeSensorType(node?.sensor_type);
  // console.log("sensorType : ", sensorType);


  const meta = useMemo(() => {
    return SENSOR_REGISTRY[sensorType] || {
      ...DEFAULT_META,
      label: formatLabelFromType(sensorType),
    };
  }, [sensorType]);

  const { Icon, colors, Card, detail } = meta;

  const renderCardBody = () => {
    if (Card) return <Card node={node} />;
  };

  const openDetail = () => {
    if (!portId) return;
    if (detail?.type === "imu3d") {
      onOpenDetail?.({
        type: "imu3d",
        raspiId,
        hubId,
        portId,
        sensorTypeHint: node?.sensor_type,
      });
      return;
    }

    if (detail?.type === "rotary_sensor") {
      onOpenDetail?.({
        type: "rotary_sensor",
        raspiId,
        hubId,
        portId,
        sensorTypeHint: node?.sensor_type,
      });
      return;
    }

    onOpenDetail?.({
      type: "line",
      raspiId,
      hubId,
      portId,
      sensorTypeHint: node?.sensor_type,
    });
  };

  // ========== GRID VIEW ==========
  return (
    <>
      <div
        role="button"
        onClick={openDetail}
        className={`rounded-xl border ${colors.border} ${colors.bg} p-4 hover:border-opacity-40 transition-all cursor-pointer group`}
      >
        <div className="text-slate-900 dark:text-white min-h-[100px]">
          {renderCardBody()}
        </div>

        <div className="mt-3 pt-3 border-t border-black/10 dark:border-white/10 flex items-center justify-between gap-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpenDetail?.({
                type: "reset",
                raspiId,
                hubId,
                portId,
                sensorTypeHint: sensorType,
              });
            }}
            className="flex items-center gap-1 text-[10px] rounded-md border px-2 py-1 hover:bg-black/5 dark:hover:bg-white/10 border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-200"
            title="Reset port"
          >
            <RotateCcw className="w-3 h-3" />
            <span>Reset</span>
          </button>
        </div>
      </div>

    </>
  );
}
