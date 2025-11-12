import React from "react";

export default function SensorRenderer({ node }) {
  return (
    <div className="rounded-xl border border-black/10 bg-white/70 p-4 dark:border-white/10 dark:bg-slate-800/60 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-medium text-gray-600 dark:text-gray-400">
          {node.node_id}
        </div>
        <div className="text-xs text-green-600 dark:text-green-400">
          {node.status}
        </div>
      </div>

      <div className="text-sm text-gray-700 dark:text-gray-300 mb-1">
        {node.sensor_type}
      </div>

      <div className="text-2xl font-semibold text-slate-900 dark:text-white">
        {typeof node.value === 'number' ? node.value.toFixed(1) : node.value}
        <span className="text-base ml-1 text-gray-600 dark:text-gray-400">{node.unit}</span>
      </div>
    </div>
  );
}
