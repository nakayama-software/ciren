import React, { useMemo } from "react";
import { RotateCw } from "lucide-react";

function toNum(v) {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").trim());
  return Number.isFinite(n) ? n : null;
}

function fmt(n, digits = 0) {
  if (n === null) return "--";
  return n.toFixed(digits);
}

function MetricTile({ icon, label, value, unit, accent = "neutral" }) {
  const accentCls =
    accent === "amber"
      ? "bg-amber-400/10 border-amber-300/20"
      : "bg-white/5 border-white/10";

  return (
    <div className="rounded-xl bg-black/20 border border-white/10 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`inline-flex items-center justify-center rounded-full border px-2.5 py-1 ${accentCls}`}
          >
            {icon}
          </span>
          <span className="text-[11px] text-gray-400 font-medium truncate">{label}</span>
        </div>

        <div className="text-right">
          <p className="text-lg font-mono text-white tabular-nums leading-none">{value}</p>
          <p className="text-[11px] text-gray-500 mt-1">{unit}</p>
        </div>
      </div>
    </div>
  );
}

function parseRotary(node) {
  const raw =
    node?.sensor_data ??
    node?.value ??
    node?.readings?.[0]?.value ??
    "";

  const s = String(raw ?? "");
  let direction = null;
  let steps = null;   
  let port = node?.port_number ?? null;

  if (s.includes("CW")) direction = "CW";
  if (s.includes("CCW")) direction = "CCW";

  if (s.includes(",")) {
    const last = s.split(",").pop()?.trim();
    steps = toNum(last);
  } else {
    const m = s.match(/(-?\d+(\.\d+)?)(?!.*-?\d)/);
    if (m) steps = toNum(m[1]);
  }

  if (port == null) {
    const m = s.match(/^(\d+)-/);
    if (m) port = toNum(m[1]);
  }

  return { raw: s, direction, steps, port };
}

export default function RotaryCard({ node, variant = "embedded" }) {
  const { direction, steps, port } = useMemo(() => parseRotary(node), [node]);

  const directionLabel =
    direction === "CW" ? "Clockwise" : direction === "CCW" ? "Counter-Clockwise" : "—";

  // ============ Embedded ============
  if (variant === "embedded") {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 p-4 hover:bg-white/10 transition">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="rounded-lg bg-amber-500/10 border border-amber-400/20 p-2">
              <RotateCw className="w-5 h-5 text-amber-300" />
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="font-semibold text-white">Rotary Sensor</p>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-gray-300">
                  {node?.node_id ?? "-"}
                </span>
              </div>
              <p className="text-[11px] text-gray-400 mt-0.5">
                Incremental rotation input{port != null ? ` • Port ${port}` : ""}
              </p>
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          <MetricTile
            icon={<RotateCw className="w-4 h-4 text-amber-300" />}
            label="Direction"
            value={directionLabel}
            unit=""
            accent="amber"
          />
          <MetricTile
            icon={<span className="text-amber-300 text-xs font-bold tabular-nums">Δ</span>}
            label="Steps / Count"
            value={fmt(steps, 0)}
            unit={node?.unit || "step"}
            accent="amber"
          />
        </div>
      </div>
    );
  }

  // ============ Standalone ============
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4 hover:bg-white/10 transition">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <RotateCw className="w-5 h-5 text-amber-300" />
          <div className="min-w-0">
            <p className="font-semibold text-white">Rotary Sensor</p>
            <p className="text-xs text-gray-400 truncate">{node?.node_id ?? "-"}</p>
          </div>
        </div>

        <div className="text-right">
          <p className="text-2xl font-mono text-white tabular-nums leading-none">
            {fmt(steps, 0)}
          </p>
          <p className="text-[11px] text-gray-500 mt-1">{node?.unit || "step"}</p>
        </div>
      </div>

      <div className="mt-3 text-[11px] text-gray-400">
        Direction: <span className="text-gray-200 font-medium">{directionLabel}</span>
      </div>
    </div>
  );
}
