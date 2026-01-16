import React from "react";
import { RadioTower } from "lucide-react";

export default function UltrasonicCard({ node }) {
  const distance = Number(node.value);
  const pct = Number.isFinite(distance) ? Math.min(100, Math.max(0, (distance / 300) * 100)) : 0;
  return (
    <div className="bg-white/5 rounded-lg p-4 space-y-3 hover:bg-white/10">
      <div className="flex items-start justify-between">
        <div className="flex items-center space-x-3">
          <RadioTower className="w-5 h-5 text-teal-400" />
          <div>
            <p className="font-semibold text-white">Ultrasonic</p>
            <p className="text-xs text-gray-400">{node.node_id}</p>
          </div>
        </div>
        <p className="text-2xl font-bold text-white">
          {node.value}<span className="text-sm text-gray-400"> {node.unit || "cm"}</span>
        </p>
      </div>
      <div className="w-full bg-gray-700 rounded-full h-1.5">
        <div className="bg-teal-400 h-1.5 rounded-full" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
