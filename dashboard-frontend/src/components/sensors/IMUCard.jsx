import React, { useMemo } from "react";
import { Move3d, Thermometer } from "lucide-react";

function extractPayload(raw) {
  if (!raw || typeof raw !== "string") return "";
  const s = raw.trim();
  if (!s) return "";

  // Format: ID=Imu;VAL=...
  const idx = s.indexOf("VAL=");
  if (idx >= 0) return s.slice(idx + 4).trim();

  // Format baru: "1-Imu-3.90,1.58,9.14|0.00,-0.01,-0.00|29.49"
  // Ambil setelah "-" kedua
  const i1 = s.indexOf("-");
  if (i1 >= 0) {
    const i2 = s.indexOf("-", i1 + 1);
    if (i2 >= 0) return s.slice(i2 + 1).trim();
  }

  // Kalau memang payload murni "a,b,c|d,e,f|t"
  return s;
}

function parseIMUPayload(payload) {
  const p = extractPayload(payload);
  const parts = p.split("|").map((x) => x.trim()).filter(Boolean);
  if (parts.length < 3) return null;

  const [accStr, gyrStr, tempStr] = parts;

  const acc = accStr.split(",").map((n) => Number(String(n).trim()));
  const gyr = gyrStr.split(",").map((n) => Number(String(n).trim()));
  const temp = Number(String(tempStr).trim());

  if (acc.length !== 3 || gyr.length !== 3) return null;
  if (acc.some((v) => Number.isNaN(v)) || gyr.some((v) => Number.isNaN(v))) return null;

  return {
    accelerometer: { x: acc[0], y: acc[1], z: acc[2] },
    gyroscope: { x: gyr[0], y: gyr[1], z: gyr[2] },
    temperature: Number.isNaN(temp) ? null : temp,
  };
}

function AxisGrid({ title, subtitle, x, y, z }) {
  const fmt = (v) => (typeof v === "number" && !Number.isNaN(v) ? v.toFixed(2) : "--");

  return (
    <div className="rounded-xl bg-black/20 border border-white/10 p-3">
      <div>
        <p className="text-sm font-semibold text-white/90 leading-tight">{title}</p>
        {subtitle ? <p className="text-[11px] text-gray-400 mt-0.5">{subtitle}</p> : null}
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        {[
          { k: "X", v: x },
          { k: "Y", v: y },
          { k: "Z", v: z },
        ].map((a) => (
          <div key={a.k} className="rounded-lg bg-white/5 border border-white/10 px-2 py-2">
            <p className="text-[10px] text-gray-400">{a.k}</p>
            <p className="mt-0.5 text-sm font-mono text-white tabular-nums">{fmt(a.v)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function getReadingValue(node, key) {
  const readings = Array.isArray(node?.readings) ? node.readings : [];
  const hit = readings.find((r) => r?.key === key);
  return typeof hit?.value === "number" && !Number.isNaN(hit.value) ? hit.value : null;
}

function buildIMUFromNode(node) {
  // 1) Paling ideal: hasil normalizer baru
  const imu = node?.parsed?.imu;
  if (imu?.accel && imu?.gyro) {
    return {
      accelerometer: imu.accel,
      gyroscope: imu.gyro,
      temperature: typeof imu.tempC === "number" ? imu.tempC : null,
    };
  }

  // 2) Dari readings (ax..gz,temp)
  const ax = getReadingValue(node, "ax");
  const ay = getReadingValue(node, "ay");
  const az = getReadingValue(node, "az");
  const gx = getReadingValue(node, "gx");
  const gy = getReadingValue(node, "gy");
  const gz = getReadingValue(node, "gz");
  const temp = getReadingValue(node, "temp");

  const hasAcc = ax != null && ay != null && az != null;
  const hasGyr = gx != null && gy != null && gz != null;

  if (hasAcc && hasGyr) {
    return {
      accelerometer: { x: ax, y: ay, z: az },
      gyroscope: { x: gx, y: gy, z: gz },
      temperature: temp,
    };
  }

  // 3) Fallback parsing dari sensor_data / value string (format lama)
  const fallbackRaw =
    (typeof node?.sensor_data === "string" && node.sensor_data) ||
    (typeof node?.value === "string" && node.value) ||
    "";

  return parseIMUPayload(fallbackRaw);
}

export default function IMUCard({ node }) {
  const parsed = useMemo(() => buildIMUFromNode(node), [node]);

  const fmtTemp = (v) => (typeof v === "number" && !Number.isNaN(v) ? v.toFixed(2) : "--");

  if (!parsed) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 p-4">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-indigo-500/10 border border-indigo-400/20 p-2">
            <Move3d className="w-5 h-5 text-indigo-300" />
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-white">IMU</p>
            <p className="text-xs text-gray-400">{node?.node_id ?? "-"}</p>
            <p className="text-[11px] text-gray-500 mt-1">IMU data not available</p>
          </div>
        </div>
      </div>
    );
  }

  const { accelerometer: acc, gyroscope: gyr, temperature } = parsed;

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4 hover:bg-white/10 transition">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="rounded-lg bg-indigo-500/10 border border-indigo-400/20 p-2">
            <Move3d className="w-5 h-5 text-indigo-300" />
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="font-semibold text-white">IMU</p>
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-gray-300">
                {node?.node_id ?? "-"}
              </span>
            </div>
            <p className="text-[11px] text-gray-400 mt-0.5">Accelerometer · Gyroscope · Temperature</p>
          </div>
        </div>

        <div className="shrink-0">
          <div className="flex items-center gap-1.5 rounded-full bg-amber-400/10 border border-amber-300/20 px-2.5 py-1">
            <Thermometer className="w-4 h-4 text-amber-300" />
            <span className="text-xs font-mono text-white tabular-nums">
              {temperature == null ? "--" : `${fmtTemp(temperature)} °C`}
            </span>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
        <AxisGrid title="Accelerometer" subtitle="raw from sensor" x={acc.x} y={acc.y} z={acc.z} />
        <AxisGrid title="Gyroscope" subtitle="raw from sensor" x={gyr.x} y={gyr.y} z={gyr.z} />
      </div>
    </div>
  );
}
