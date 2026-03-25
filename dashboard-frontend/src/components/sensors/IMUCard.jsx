import React, { useMemo } from "react";
import { Move3d, Thermometer } from "lucide-react";

function parseIMUValue(valueStr) {
  if (!valueStr || typeof valueStr !== "string") return null;
  const parts = valueStr.split("|").map((x) => x.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const [accStr, gyrStr, tempStr] = parts;
  const acc = accStr.split(",").map((n) => Number(n.trim()));
  const gyr = gyrStr.split(",").map((n) => Number(n.trim()));
  const temp = tempStr != null ? Number(tempStr.trim()) : null;
  if (acc.length !== 3 || gyr.length !== 3) return null;
  if (acc.some((v) => Number.isNaN(v)) || gyr.some((v) => Number.isNaN(v))) return null;
  return {
    accelerometer: { x: acc[0], y: acc[1], z: acc[2] },
    gyroscope: { x: gyr[0], y: gyr[1], z: gyr[2] },
    temperature: temp !== null && !Number.isNaN(temp) ? temp : null,
  };
}

function parseIMUPayloadLegacy(raw) {
  if (!raw || typeof raw !== "string") return null;
  const s = raw.trim();
  const idx = s.indexOf("VAL=");
  let payload = s;
  if (idx >= 0) {
    payload = s.slice(idx + 4).trim();
  } else if (/^\d/.test(s)) {
    const i1 = s.indexOf("-");
    if (i1 >= 0) {
      const i2 = s.indexOf("-", i1 + 1);
      if (i2 >= 0) payload = s.slice(i2 + 1).trim();
    }
  }
  return parseIMUValue(payload);
}

function getReadingValue(node, key) {
  const readings = Array.isArray(node?.readings) ? node.readings : [];
  const hit = readings.find((r) => r?.key === key);
  return typeof hit?.value === "number" && !Number.isNaN(hit.value) ? hit.value : null;
}

function buildIMUFromNode(node) {
  const imu = node?.parsed?.imu;
  if (imu?.accel && imu?.gyro) {
    return {
      accelerometer: imu.accel,
      gyroscope: imu.gyro,
      temperature: typeof imu.tempC === "number" ? imu.tempC : null,
    };
  }

  const ax = getReadingValue(node, "ax"), ay = getReadingValue(node, "ay"), az = getReadingValue(node, "az");
  const gx = getReadingValue(node, "gx"), gy = getReadingValue(node, "gy"), gz = getReadingValue(node, "gz");
  const temp = getReadingValue(node, "temp");
  if (ax != null && ay != null && az != null && gx != null && gy != null && gz != null) {
    return { accelerometer: { x: ax, y: ay, z: az }, gyroscope: { x: gx, y: gy, z: gz }, temperature: temp };
  }

  if (typeof node?.value === "string" && node.value) {
    return parseIMUValue(node.value);
  }

  if (typeof node?.sensor_data === "string" && node.sensor_data) {
    return parseIMUPayloadLegacy(node.sensor_data);
  }

  return null;
}

function AxisGrid({ title, subtitle, x, y, z }) {
  const fmt = (v) => (typeof v === "number" && !Number.isNaN(v) ? v.toFixed(2) : "--");
  return (
    <div className="rounded-xl bg-slate-100/80 dark:bg-black/20 border border-slate-200 dark:border-white/10 p-3">
      <div>
        <p className="text-sm font-semibold text-slate-800 dark:text-white/90 leading-tight">{title}</p>
        {subtitle && <p className="text-[11px] text-slate-500 dark:text-gray-400 mt-0.5">{subtitle}</p>}
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {[{ k: "X", v: x }, { k: "Y", v: y }, { k: "Z", v: z }].map((a) => (
          <div key={a.k} className="rounded-lg bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 px-2 py-2">
            <p className="text-[10px] text-slate-400 dark:text-gray-400">{a.k}</p>
            <p className="mt-0.5 text-sm font-mono text-slate-900 dark:text-white tabular-nums">{fmt(a.v)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function IMUCard({ node }) {
  const parsed = useMemo(() => buildIMUFromNode(node), [node]);
  const fmtTemp = (v) => (typeof v === "number" && !Number.isNaN(v) ? v.toFixed(2) : "--");

  // console.log("IMU node data : ", node);

  if (!parsed) {
    return (
      <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 p-4">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-violet-500/10 border border-violet-400/20 p-2">
            <Move3d className="w-5 h-5 text-violet-500 dark:text-violet-300" />
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-slate-900 dark:text-white">IMU</p>
            <p className="text-xs text-slate-500 dark:text-gray-400">{node?.node_id ?? "-"}</p>
            <p className="text-[11px] text-slate-400 dark:text-gray-500 mt-1">IMU data not available</p>
          </div>
        </div>
      </div>
    );
  }

  const { accelerometer: acc, gyroscope: gyr, temperature } = parsed;

  return (
    <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 p-4 hover:bg-slate-100 dark:hover:bg-white/10 transition">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="rounded-lg bg-violet-500/10 border border-violet-400/20 p-2">
            <Move3d className="w-5 h-5 text-violet-500 dark:text-violet-300" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="font-semibold text-slate-900 dark:text-white">IMU</p>
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-gray-300">
                {node?.node_id ?? "-"}
              </span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-gray-400 mt-0.5">
              Accelerometer · Gyroscope · Temperature
            </p>
          </div>
        </div>
        <div className="shrink-0">
          <div className="flex items-center gap-1.5 rounded-full bg-amber-400/10 border border-amber-300/20 px-2.5 py-1">
            <Thermometer className="w-4 h-4 text-amber-500 dark:text-amber-300" />
            <span className="text-xs font-mono text-slate-900 dark:text-white tabular-nums">
              {temperature == null ? "--" : `${fmtTemp(temperature)} °C`}
            </span>
          </div>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
        <AxisGrid title="Accelerometer" subtitle="m/s²" x={acc.x} y={acc.y} z={acc.z} />
        <AxisGrid title="Gyroscope" subtitle="rad/s" x={gyr.x} y={gyr.y} z={gyr.z} />
      </div>
    </div>
  );
}