import React, { useMemo } from "react";
import { RadioTower } from "lucide-react";

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

function MetricTile({ icon, label, value, unit, accent = "neutral" }) {
  const accentCls =
    accent === "teal"
      ? "bg-teal-400/10 border-teal-300/20"
      : "bg-slate-100 dark:bg-white/5 border-slate-200 dark:border-white/10";

  return (
    <div className="rounded-xl bg-slate-100/80 dark:bg-black/20 border border-slate-200 dark:border-white/10 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`inline-flex items-center justify-center rounded-full border px-2.5 py-1 ${accentCls}`}
          >
            {icon}
          </span>
          <span className="text-[11px] text-slate-500 dark:text-gray-400 font-medium truncate">
            {label}
          </span>
        </div>
        <div className="text-right">
          <p className="text-lg font-mono text-slate-900 dark:text-white tabular-nums leading-none">
            {value}
          </p>
          <p className="text-[11px] text-slate-400 dark:text-gray-500 mt-1">{unit}</p>
        </div>
      </div>
    </div>
  );
}

export default function UltrasonicCard({ node, variant = "embedded", maxDistance = 300 }) {
  const { distance, unit } = useMemo(() => {
    const rDist = pickReading(node, ["distance", "range", "ultrasonic"]);
    let d = toNum(rDist?.value);
    if (d === null) d = toNum(node?.value);
    return { distance: d, unit: rDist?.unit || node?.unit || "cm" };
  }, [node]);

  const pct = useMemo(() => {
    if (distance === null) return 0;
    return Math.min(100, Math.max(0, (distance / Math.max(1, maxDistance)) * 100));
  }, [distance, maxDistance]);

  if (variant === "embedded") {
    return (
      <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 p-4 hover:bg-slate-100 dark:hover:bg-white/10 transition">
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="rounded-lg bg-teal-500/10 border border-teal-400/20 p-2">
              <RadioTower className="w-5 h-5 text-teal-600 dark:text-teal-300" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="font-semibold text-slate-900 dark:text-white">Ultrasonic</p>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-gray-300">
                  {node?.node_id ?? "-"}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-gray-400 mt-0.5">Distance sensor</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs text-slate-400 dark:text-gray-400">Max</p>
            <p className="text-sm font-mono text-slate-600 dark:text-gray-200 tabular-nums">
              {maxDistance} {unit}
            </p>
          </div>
        </div>

        {/* Metric + bar */}
        <div className="mt-4 space-y-3">
          <MetricTile
            icon={<RadioTower className="w-4 h-4 text-teal-600 dark:text-teal-300" />}
            label="Distance"
            value={fmt(distance, 1)}
            unit={unit}
            accent="teal"
          />

          <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-slate-100/80 dark:bg-black/20 p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] text-slate-500 dark:text-gray-400 font-medium">Level</span>
              <span className="text-[11px] text-slate-700 dark:text-gray-300 font-mono tabular-nums">
                {distance === null ? "--" : `${pct.toFixed(0)}%`}
              </span>
            </div>
            <div className="w-full bg-slate-200 dark:bg-white/10 rounded-full h-2 overflow-hidden">
              <div
                className="bg-teal-500 dark:bg-teal-400 h-2 rounded-full transition-[width] duration-300"
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400 dark:text-gray-500 font-mono tabular-nums">
              <span>0</span>
              <span>{maxDistance}</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Standalone
  return (
    <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 p-4 hover:bg-slate-100 dark:hover:bg-white/10 transition">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <RadioTower className="w-5 h-5 text-teal-600 dark:text-teal-300" />
          <div className="min-w-0">
            <p className="font-semibold text-slate-900 dark:text-white">Ultrasonic</p>
            <p className="text-xs text-slate-500 dark:text-gray-400 truncate">{node?.node_id ?? "-"}</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-2xl font-mono text-slate-900 dark:text-white tabular-nums leading-none">
            {fmt(distance, 1)}
          </p>
          <p className="text-[11px] text-slate-400 dark:text-gray-500 mt-1">{unit}</p>
        </div>
      </div>
      <div className="mt-3 w-full bg-slate-200 dark:bg-white/10 rounded-full h-2 overflow-hidden">
        <div
          className="bg-teal-500 dark:bg-teal-400 h-2 rounded-full transition-[width] duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}