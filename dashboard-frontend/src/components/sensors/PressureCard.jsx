import React from "react";
import { Gauge } from "lucide-react";

export default function PressureCard({ node }) {
  return (
    <div className="bg-white/5 rounded-lg p-4 hover:bg-white/10">
      <div className="flex items-start justify-between">
        <div className="flex items-center space-x-3">
          <Gauge className="w-5 h-5 text-yellow-400" />
          <div>
            <p className="font-semibold text-white">Pressure</p>
            <p className="text-xs text-gray-400">{node.node_id}</p>
          </div>
        </div>
        <p className="text-2xl font-bold text-white">
          {node.value}<span className="text-sm text-gray-400"> {node.unit || "hPa"}</span>
        </p>
      </div>
    </div>
  );
}
