import React, { useMemo } from "react";
import { Zap, Radio, AlertCircle } from "lucide-react";

function toNum(v) {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").trim());
  return Number.isFinite(n) ? n : null;
}

function fmt(v, digits = 2) {
  const n = toNum(v);
  if (n === null) return String(v ?? "--");
  return n.toFixed(digits);
}

// ─── Vibration card ────────────────────────────────────────────────────────────
function VibrationCard({ node }) {
  const isActive = useMemo(() => {
    const readings = Array.isArray(node?.readings) ? node.readings : [];
    const r = readings.find((x) => String(x?.key || "").toLowerCase() === "vibration");
    const raw = r?.value ?? node?.value ?? "";
    return String(raw).toLowerCase() === "true";
  }, [node]);

  return (
    <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 p-4 hover:bg-slate-100 dark:hover:bg-white/10 transition">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className={`rounded-lg p-2 border transition-colors ${
            isActive
              ? "bg-red-500/10 border-red-400/30"
              : "bg-slate-200/60 dark:bg-white/5 border-slate-300 dark:border-white/10"
          }`}>
            <Radio className={`w-5 h-5 ${isActive ? "text-red-500 dark:text-red-400" : "text-slate-400 dark:text-gray-500"}`} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="font-semibold text-slate-900 dark:text-white">Vibration</p>
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-gray-300">
                {node?.node_id ?? "-"}
              </span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-gray-400 mt-0.5">Vibration detector</p>
          </div>
        </div>
      </div>

      <div className="mt-4">
        <div className={`rounded-xl border p-4 flex items-center gap-4 transition-colors ${
          isActive
            ? "bg-red-500/10 border-red-400/30"
            : "bg-slate-100/80 dark:bg-black/20 border-slate-200 dark:border-white/10"
        }`}>
          {/* Indicator dot */}
          <div className="relative flex-shrink-0">
            <div className={`w-4 h-4 rounded-full ${isActive ? "bg-red-500" : "bg-slate-300 dark:bg-slate-600"}`} />
            {isActive && (
              <div className="absolute inset-0 w-4 h-4 rounded-full bg-red-500 animate-ping opacity-60" />
            )}
          </div>
          <div>
            <p className={`text-base font-bold ${isActive ? "text-red-600 dark:text-red-400" : "text-slate-500 dark:text-gray-400"}`}>
              {isActive ? "VIBRATING" : "IDLE"}
            </p>
            <p className="text-[11px] text-slate-400 dark:text-gray-500 mt-0.5">
              {isActive ? "Vibration detected" : "No vibration detected"}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Generic fallback card ─────────────────────────────────────────────────────
function FallbackCard({ node }) {
  const readings = Array.isArray(node?.readings) ? node.readings : [];
  const label = String(node?.sensor_type ?? "").replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase()) || "Unknown";

  return (
    <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 p-4 hover:bg-slate-100 dark:hover:bg-white/10 transition">
      <div className="flex items-center gap-3 mb-4">
        <div className="rounded-lg bg-slate-200/60 dark:bg-white/5 border border-slate-300 dark:border-white/10 p-2">
          <Zap className="w-5 h-5 text-slate-500 dark:text-gray-400" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <p className="font-semibold text-slate-900 dark:text-white capitalize">{label}</p>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-gray-300">
              {node?.node_id ?? "-"}
            </span>
          </div>
          <p className="text-[11px] text-slate-500 dark:text-gray-400 mt-0.5">Sensor node</p>
        </div>
      </div>

      {readings.length > 0 ? (
        <div className="space-y-2">
          {readings.map((r, i) => (
            <div
              key={r.key ?? i}
              className="rounded-lg bg-slate-100/80 dark:bg-black/20 border border-slate-200 dark:border-white/10 px-3 py-2 flex items-center justify-between gap-2"
            >
              <span className="text-[11px] text-slate-500 dark:text-gray-400 font-medium truncate">
                {r.label ?? r.key ?? `Value ${i + 1}`}
              </span>
              <span className="text-sm font-mono font-semibold text-slate-900 dark:text-white tabular-nums flex-shrink-0">
                {fmt(r.value, typeof r.value === "number" && r.value % 1 !== 0 ? 2 : 0)}
                {r.unit ? <span className="text-xs text-slate-400 dark:text-gray-500 ml-1">{r.unit}</span> : null}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-lg bg-slate-100/80 dark:bg-black/20 border border-slate-200 dark:border-white/10 px-3 py-2">
          <AlertCircle className="w-4 h-4 text-slate-400 dark:text-gray-500 flex-shrink-0" />
          <span className="text-[11px] text-slate-500 dark:text-gray-400">
            {node?.value != null ? String(node.value) : "No readable data"}
          </span>
        </div>
      )}
    </div>
  );
}

// ─── Main export ───────────────────────────────────────────────────────────────
export default function GenericCard({ node, variant = "embedded" }) {
  const sensorType = String(node?.sensor_type ?? "").toLowerCase();

  if (sensorType === "vibration") return <VibrationCard node={node} />;
  return <FallbackCard node={node} />;
}