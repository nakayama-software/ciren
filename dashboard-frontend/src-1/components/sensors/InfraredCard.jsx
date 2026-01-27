import React from "react";
import { AlertTriangle } from "lucide-react";

export default function InfraredCard({ node }) {
  const motion = String(node.value) === "1" || node.value === 1 || node.value === true;
  return (
    <div className="bg-white/5 rounded-lg p-4 hover:bg-white/10">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <AlertTriangle className={`w-5 h-5 ${motion ? "text-red-500 animate-pulse" : "text-purple-400"}`} />
          <div>
            <p className="font-semibold text-white">Infrared</p>
            <p className="text-xs text-gray-400">{node.node_id}</p>
          </div>
        </div>
        <p className={`text-lg font-bold ${motion ? "text-red-400" : "text-green-400"}`}>
          {motion ? "Motion Detected" : "Clear"}
        </p>
      </div>
    </div>
  );
}

