import React from "react";
import { Zap } from "lucide-react";

export default function GenericCard({ node }) {
  return (
    <div className="bg-white/5 rounded-lg p-4 space-y-1 hover:bg-white/10">
      <div className="flex items-start justify-between">
        <div className="flex items-center space-x-3">
          <Zap className="w-5 h-5 text-gray-400" />
          <div>
            <p className="font-semibold text-white capitalize">{node.sensor_type}</p>
            <p className="text-xs text-gray-400">{node.node_id}</p>
          </div>
        </div>
        <p className="text-lg font-bold text-white">
          {typeof node.value === "object" ? "—" : node.value}
          {node.unit ? <span className="text-sm text-gray-400"> {node.unit}</span> : null}
        </p>
      </div>
    </div>
  );
}
