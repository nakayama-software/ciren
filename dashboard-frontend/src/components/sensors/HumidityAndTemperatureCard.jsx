import React, { useMemo } from "react";
import { Droplets, Thermometer, ThermometerSun } from "lucide-react";

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
    accent === "blue"
      ? "bg-blue-400/10 border-blue-300/20"
      : accent === "amber"
      ? "bg-amber-400/10 border-amber-300/20"
      : "bg-white/5 border-white/10";

  return (
    <div className="rounded-xl bg-black/20 border border-white/10 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`inline-flex items-center justify-center rounded-full border px-2.5 py-1 ${accentCls}`}>
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

export default function HumidityAndTemperatureCard({ node, variant = "embedded" }) {
  const { temp, hum, tempUnit, humUnit } = useMemo(() => {
    const rTemp = pickReading(node, ["temperature", "temp"]);
    const rHum = pickReading(node, ["humidity", "hum", "rh"]);

    let t = toNum(rTemp?.value);
    let h = toNum(rHum?.value);

    // fallback: parse dari "23.40,42.80"
    const rawValue = node?.value ?? node?.readings?.[0]?.value ?? "";
    if ((t === null || h === null) && typeof rawValue === "string" && rawValue.includes(",")) {
      const [tStr, hStr] = rawValue.split(",").map((s) => s.trim());
      if (t === null) t = toNum(tStr);
      if (h === null) h = toNum(hStr);
    }

    return {
      temp: t,
      hum: h,
      tempUnit: rTemp?.unit || "°C",
      humUnit: rHum?.unit || "%",
    };
  }, [node]);

  // Embedded: konsisten dengan IMUCard (tanpa raw)
  if (variant === "embedded") {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 p-4 hover:bg-white/10 transition">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="rounded-lg bg-indigo-500/10 border border-indigo-400/20 p-2">
              <ThermometerSun className="w-5 h-5 text-indigo-300" />
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="font-semibold text-white">Humidity & Temperature</p>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-gray-300">
                  {node?.node_id ?? "-"}
                </span>
              </div>
              <p className="text-[11px] text-gray-400 mt-0.5">Environment sensor</p>
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          <MetricTile
            icon={<Droplets className="w-4 h-4 text-blue-300" />}
            label="Humidity"
            value={fmt(hum, 1)}
            unit={humUnit}
            accent="blue"
          />
          <MetricTile
            icon={<Thermometer className="w-4 h-4 text-amber-300" />}
            label="Temperature"
            value={fmt(temp, 1)}
            unit={tempUnit}
            accent="amber"
          />
        </div>
      </div>
    );
  }

  // Standalone ringkas (tanpa raw)
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4 hover:bg-white/10 transition">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-gray-300">
          <Droplets className="w-5 h-5 text-blue-300" />
          <span className="font-semibold text-white">Humidity</span>
        </div>
        <div className="text-right">
          <p className="text-2xl font-mono text-white tabular-nums leading-none">{fmt(hum, 1)}</p>
          <p className="text-[11px] text-gray-500 mt-1">{humUnit}</p>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-gray-300">
          <Thermometer className="w-4 h-4 text-amber-300" />
          <span className="text-sm text-gray-300">Temperature</span>
        </div>
        <div className="text-right">
          <p className="text-lg font-mono text-white tabular-nums leading-none">{fmt(temp, 1)}</p>
          <p className="text-[11px] text-gray-500 mt-1">{tempUnit}</p>
        </div>
      </div>
    </div>
  );
}
