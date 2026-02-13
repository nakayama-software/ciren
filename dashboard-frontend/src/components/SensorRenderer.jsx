import React, { useMemo, useState } from "react";
import HistoryModal from "./LineChartModal";
import ResetPortModal from "./ResetPortModal";
import PortHistoryModal from "./PortHistoryModal";

import { Activity, Archive, RotateCcw, Move3d, Droplets, Thermometer } from "lucide-react";

import HumidityAndTemperatureCard from "./sensors/HumidityAndTemperatureCard";
import ImuCard from "./sensors/IMUCard";
import LineChartModal from "./LineChartModal";
import IMU3DModal from "./charts/IMU3DModal";
import { normalizeSensorType } from "../utils/helpers";

const SENSOR_REGISTRY = {
  hum_temp: {
    label: "Humidity & Temperature",
    Icon: Droplets,
    colors: { icon: "text-indigo-500", bg: "bg-indigo-500/10", border: "border-indigo-500/20" },
    Card: (props) => <HumidityAndTemperatureCard {...props} variant="embedded" />,
    detail: { type: "history" },
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
    detail: { type: "history" },
  },
  humidity: {
    label: "Humidity",
    Icon: Droplets,
    colors: { icon: "text-blue-500", bg: "bg-blue-500/10", border: "border-blue-500/20" },
    Card: null,
    detail: { type: "history" },
  },
};

const DEFAULT_META = {
  label: "Unknown Sensor",
  Icon: Activity,
  colors: { icon: "text-gray-500", bg: "bg-gray-500/10", border: "border-gray-500/20" },
  Card: null,
  detail: { type: "history" },
};













function formatLabelFromType(sensorType) {
  return sensorType.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

export default function SensorRenderer({
  node,
  hubId,
  raspiId,
  viewMode = "grid",
  onReset,
}) {

  // console.log("node : ", node);

  const [openHistoryModal, setOpenHistoryModal] = useState(false);
  const [openResetModal, setOpenResetModal] = useState(false);
  const [openPortHistoryModal, setOpenPortHistoryModal] = useState(false);
  const [openImu3dModal, setOpenImu3dModal] = useState(false);

  const portId = Number(String(node?.node_id || "").replace(/^P/i, "")) || null;
  const sensorType = normalizeSensorType(node?.sensor_type);

  const meta = useMemo(() => {
    return SENSOR_REGISTRY[sensorType] || {
      ...DEFAULT_META,
      label: formatLabelFromType(sensorType),
    };
  }, [sensorType]);

  const { Icon, colors, Card, detail } = meta;

  const getReading = (key) => {
    const readings = Array.isArray(node?.readings) ? node.readings : [];
    return readings.find((r) => r?.key === key) || null;
  };

  const handleResetSuccess = (result) => {
    onReset?.({
      hubId,
      portId,
      newSensorId: result.newSensorId,
      deletedReadings: result.deletedReadings,
    });
  };

  const renderFallbackValue = () => {
    const readings = Array.isArray(node?.readings) ? node.readings : [];
    const val = node?.value;


    // console.log("node : ", node);
//     {
//     "port_number": 1,
//     "sensor_data": "1-Imu-3.92,1.56,9.15|0.00,-0.01,-0.00|29.28", //port_number-sensor_type-value
//     "_id": "698e7ad25ae63472f16e7789",
//     "sensor_type": "unknown",
//     "readings": [],
//     "unit": ""
// }

    if (readings.length > 0) {
      const primary = readings[0];
      const secondary = readings[1];

      return (
        <div className="space-y-2">
          {primary && (
            <div>
              <div className="text-2xl font-bold text-slate-900 dark:text-white">
                {typeof primary.value === "number" ? primary.value.toFixed(2) : primary.value}
                {primary.unit ? (
                  <span className="text-base ml-1 text-gray-600 dark:text-gray-400">{primary.unit}</span>
                ) : null}
              </div>
              <div className="text-xs text-gray-600 dark:text-gray-400">{primary.label}</div>
            </div>
          )}

          {secondary && (
            <div className="pt-2 border-t border-black/10 dark:border-white/10">
              <span className="text-sm font-medium text-slate-900 dark:text-white">
                {typeof secondary.value === "number" ? secondary.value.toFixed(2) : secondary.value}
              </span>
              <span className="text-xs text-gray-600 dark:text-gray-400 ml-2">
                {secondary.unit} {secondary.label}
              </span>
            </div>
          )}
        </div>
      );
    }

    if (typeof val === "number") {
      return (
        <>
          {val.toFixed(2)}
          {node?.unit ? <span className="text-base ml-1 text-gray-600 dark:text-gray-400">{node.unit}</span> : null}
        </>
      );
    }

    return (
      <>
        {String(val ?? "--")}
        {node?.unit ? <span className="text-base ml-1 text-gray-600 dark:text-gray-400">{node.unit}</span> : null}
      </>
    );
  };

  const renderCardBody = () => {
    if (Card) return <Card node={node} />;

    if (sensorType === "rotary_encoder" || sensorType === "rotary_sensor" || sensorType === "encoder") {
      const dirReading = getReading("direction");
      const stepsReading = getReading("steps");

      return (
        <div className="space-y-1">
          {dirReading ? <div className="text-2xl font-bold">{dirReading.value}</div> : null}
          {stepsReading ? (
            <div className="text-sm text-gray-600 dark:text-gray-400">Count: {stepsReading.value}</div>
          ) : null}
        </div>
      );
    }

    return renderFallbackValue();
  };

  const openDetail = () => {
    if (detail?.type === "imu3d") {
      setOpenImu3dModal(true);
      return;
    }
    setOpenHistoryModal(true);
  };

  // ========== GRID VIEW ==========
  if (viewMode === "grid") {
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
                setOpenPortHistoryModal(true);
              }}
              className="flex items-center gap-1 text-[10px] text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300"
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
              className="flex items-center gap-1 text-[10px] rounded-md border px-2 py-1 hover:bg-black/5 dark:hover:bg-white/10 border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-200"
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
          sensorTypeHint={node?.sensor_type}
        />

        <IMU3DModal
          open={openImu3dModal}
          onClose={() => setOpenImu3dModal(false)}
          node={node}
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

  // ========== LIST VIEW ==========
  return (
    <>
      <div
        role="button"
        onClick={openDetail}
        className={`rounded-lg border ${colors.border} ${colors.bg} p-4 hover:bg-opacity-80 transition-all cursor-pointer flex items-center justify-between`}
      >
        <div className="flex items-center gap-4 flex-1 min-w-0">
          <div className={`p-3 rounded-lg ${colors.bg} flex-shrink-0 border ${colors.border}`}>
            <Icon className={`w-6 h-6 ${colors.icon}`} />
          </div>

          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
              {node?.node_id ?? "-"} • {meta.label}
            </div>
            <div className="text-lg font-semibold text-slate-900 dark:text-white">
              {renderCardBody()}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <div
            className={`text-xs font-medium px-3 py-1 rounded-full ${node?.status === "online"
                ? "bg-green-500/20 text-green-600 dark:text-green-400"
                : "bg-gray-500/20 text-gray-600 dark:text-gray-400"
              }`}
          >
            {node?.status ?? "unknown"}
          </div>

          <button
            onClick={(e) => {
              e.stopPropagation();
              setOpenPortHistoryModal(true);
            }}
            className="text-xs rounded-md border px-2 py-1.5 flex items-center gap-1 hover:bg-black/5 dark:hover:bg-white/10 border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-200"
            title="Port history"
          >
            <Archive className="w-3 h-3" />
          </button>

          <button
            onClick={(e) => {
              e.stopPropagation();
              setOpenResetModal(true);
            }}
            className="text-xs rounded-md border px-2 py-1.5 hover:bg-black/5 dark:hover:bg-white/10 border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-200"
            title="Reset port"
          >
            Reset
          </button>
        </div>
      </div>

      <LineChartModal
        open={openHistoryModal}
        onClose={() => setOpenHistoryModal(false)}
        raspiId={raspiId}
        hubId={hubId}
        portId={portId}
        sensorTypeHint={node?.sensor_type}
      />

      <IMU3DModal
        open={openImu3dModal}
        onClose={() => setOpenImu3dModal(false)}
        node={node}
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
