import React from "react";
import { Move3d } from "lucide-react";

export default function IMUCard({ node }) {
  const acc = node.value?.accelerometer || {};
  const gyr = node.value?.gyroscope || {};
  const fmt = (v) => Number(v).toFixed(2);

  return (
    <div className="bg-white/5 rounded-lg p-4 hover:bg-white/10">
      <div className="flex items-center space-x-3 mb-2">
        <Move3d className="w-5 h-5 text-indigo-400" />
        <div>
          <p className="font-semibold text-white">IMU</p>
          <p className="text-xs text-gray-400">{node.node_id}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 text-center">
        <div>
          <p className="text-sm font-bold text-gray-300">Accelerometer (g)</p>
          <div className="flex justify-around text-xs font-mono mt-1">
            <span>X: {fmt(acc.x)}</span><span>Y: {fmt(acc.y)}</span><span>Z: {fmt(acc.z)}</span>
          </div>
        </div>
        <div>
          <p className="text-sm font-bold text-gray-300">Gyroscope (°/s)</p>
          <div className="flex justify-around text-xs font-mono mt-1">
            <span>X: {fmt(gyr.x)}</span><span>Y: {fmt(gyr.y)}</span><span>Z: {fmt(gyr.z)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
