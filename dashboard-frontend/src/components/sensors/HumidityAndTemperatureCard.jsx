import React from "react";
import { Droplets, Thermometer } from "lucide-react";

function pickReading(node, keys = []) {
  const readings = Array.isArray(node?.readings) ? node.readings : [];
  for (const k of keys) {
    const r = readings.find((x) => String(x?.key || "").toLowerCase() === k);
    if (r && r.value !== undefined && r.value !== null) return r;
  }
  return null;
}

function toNum(v) {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").trim());
  return Number.isFinite(n) ? n : null;
}

function fmt(n, digits = 1) {
  if (n === null) return "--";
  return n.toFixed(digits);
}

export default function HumidityAndTemperatureCard({ node, variant = "embedded" }) {
  const rTemp = pickReading(node, ["temperature", "temp"]);
  const rHum = pickReading(node, ["humidity", "hum", "rh"]);

  let temp = toNum(rTemp?.value);
  let hum = toNum(rHum?.value);

  // fallback: parse dari "23.40,42.80"
  if ((temp === null || hum === null) && typeof node?.value === "string" && node.value.includes(",")) {
    const [tStr, hStr] = node.value.split(",").map((s) => s.trim());
    if (temp === null) temp = toNum(tStr);
    if (hum === null) hum = toNum(hStr);
  }

  const tempUnit = rTemp?.unit || "°C";
  const humUnit = rHum?.unit || "%";

  // Embedded: hanya content value (tanpa judul/node_id/border besar)
  if (variant === "embedded") {
    return (
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-black/10 dark:bg-white/5 border border-black/10 dark:border-white/10 p-3">
          <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
            <Droplets className="w-4 h-4 text-blue-400" />
            <span>Humidity</span>
          </div>
          <div className="mt-2 text-xl font-bold text-slate-900 dark:text-white leading-none">
            {fmt(hum, 1)}
            <span className="text-sm font-medium text-gray-600 dark:text-gray-400"> {humUnit}</span>
          </div>
        </div>

        <div className="rounded-lg bg-black/10 dark:bg-white/5 border border-black/10 dark:border-white/10 p-3">
          <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
            <Thermometer className="w-4 h-4 text-orange-300" />
            <span>Temperature</span>
          </div>
          <div className="mt-2 text-xl font-bold text-slate-900 dark:text-white leading-none">
            {fmt(temp, 1)}
            <span className="text-sm font-medium text-gray-600 dark:text-gray-400"> {tempUnit}</span>
          </div>
        </div>


      </div>
    );
  }

  return (
    <div className="bg-white/5 rounded-xl p-4 hover:bg-white/10 transition-colors border border-white/10">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-gray-300">
          <Droplets className="w-5 h-5 text-blue-400" />
          <span className="font-semibold">Humidity</span>
        </div>
        <div className="text-white font-bold text-2xl">
          {fmt(hum, 1)} <span className="text-sm text-gray-400">{humUnit}</span>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between text-gray-300">
        <div className="flex items-center gap-2">
          <Thermometer className="w-4 h-4 text-orange-300" />
          <span className="text-sm">Temperature</span>
        </div>
        <div className="text-white font-semibold">
          {fmt(temp, 1)} <span className="text-sm text-gray-400">{tempUnit}</span>
        </div>
      </div>
    </div>
  );
}
