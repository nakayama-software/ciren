import React, { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { Move3d, Thermometer } from "lucide-react";

function extractPayload(raw) {
  if (!raw || typeof raw !== "string") return "";
  const s = raw.trim();
  if (!s) return "";

  // Format lama: ID=Imu;VAL=...
  const idx = s.indexOf("VAL=");
  if (idx >= 0) return s.slice(idx + 4).trim();

  // Format baru: "1-Imu-...."
  const i1 = s.indexOf("-");
  if (i1 >= 0) {
    const i2 = s.indexOf("-", i1 + 1);
    if (i2 >= 0) return s.slice(i2 + 1).trim();
  }

  // payload murni
  return s;
}

function parseIMUPayload(raw) {
  const payload = extractPayload(raw);
  const parts = payload.split("|").map((x) => x.trim()).filter(Boolean);
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

function getReadingValue(node, key) {
  const readings = Array.isArray(node?.readings) ? node.readings : [];
  const hit = readings.find((r) => r?.key === key);
  return typeof hit?.value === "number" && !Number.isNaN(hit.value) ? hit.value : null;
}

function buildIMUFromNode(node) {
  // 1) Hasil normalizer baru: node.parsed.imu
  const imu = node?.parsed?.imu;
  if (imu?.accel && imu?.gyro) {
    return {
      accelerometer: imu.accel,
      gyroscope: imu.gyro,
      temperature: typeof imu.tempC === "number" ? imu.tempC : null,
    };
  }

  // 2) Dari readings ax..gz,temp
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

  // 3) Fallback parse dari sensor_data / value string (format lama)
  const fallbackRaw =
    (typeof node?.sensor_data === "string" && node.sensor_data) ||
    (typeof node?.value === "string" && node.value) ||
    "";

  return parseIMUPayload(fallbackRaw);
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function normalizeVec3(x, y, z) {
  const mag = Math.sqrt(x * x + y * y + z * z);
  if (!mag || !Number.isFinite(mag)) return { x: 0, y: 0, z: 0 };
  return { x: x / mag, y: y / mag, z: z / mag };
}

function eulerFromAccel(acc) {
  const g = normalizeVec3(acc.x, acc.y, acc.z);
  const roll = Math.atan2(g.y, g.z);
  const pitch = Math.atan2(-g.x, Math.sqrt(g.y * g.y + g.z * g.z));
  return { roll, pitch };
}

function fmt(n, d = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return "--";
  return Number(n).toFixed(d);
}

function IMUObject({ imuRef, filterRef }) {
  const meshRef = useRef(null);

  useFrame((state, delta) => {
    const mesh = meshRef.current;
    if (!mesh) return;

    const imu = imuRef.current;
    if (!imu) return;

    const dt = clamp(delta, 0, 0.05);

    const gx = imu.gyroscope?.x ?? 0;
    const gy = imu.gyroscope?.y ?? 0;
    const gz = imu.gyroscope?.z ?? 0;

    const filter = filterRef.current;

    const rollGyro = filter.roll + gx * dt;
    const pitchGyro = filter.pitch + gy * dt;
    const yawGyro = filter.yaw + gz * dt;

    if (filter.useComplementary) {
      const { roll: rollAcc, pitch: pitchAcc } = eulerFromAccel(imu.accelerometer);
      const a = clamp(filter.alpha, 0, 1);

      filter.roll = a * rollGyro + (1 - a) * rollAcc;
      filter.pitch = a * pitchGyro + (1 - a) * pitchAcc;
      filter.yaw = yawGyro;
    } else {
      filter.roll = rollGyro;
      filter.pitch = pitchGyro;
      filter.yaw = yawGyro;
    }

    mesh.rotation.set(filter.roll, filter.pitch, filter.yaw, "XYZ");
  });

  return (
    <group>
      <mesh ref={meshRef} castShadow receiveShadow>
        <boxGeometry args={[1.4, 0.2, 0.9]} />
        <meshStandardMaterial roughness={0.35} metalness={0.2} />
      </mesh>

      <mesh position={[0, 0.14, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.15, 0.06, 0.12]} />
        <meshStandardMaterial roughness={0.4} metalness={0.1} />
      </mesh>

      <gridHelper args={[10, 10]} />
      <axesHelper args={[2]} />
    </group>
  );
}

export default function IMU3DModal({ open, onClose, node }) {
  const parsed = useMemo(() => buildIMUFromNode(node), [node]);

  const imuRef = useRef(null);
  const filterRef = useRef({
    roll: 0,
    pitch: 0,
    yaw: 0,
    alpha: 0.98,
    useComplementary: true,
  });

  const [alphaUi, setAlphaUi] = useState(0.98);
  const [useComp, setUseComp] = useState(true);

  useEffect(() => {
    filterRef.current.alpha = alphaUi;
  }, [alphaUi]);

  useEffect(() => {
    filterRef.current.useComplementary = useComp;
  }, [useComp]);

  useEffect(() => {
    imuRef.current = parsed;
  }, [parsed]);

  if (!open) return null;

  const acc = parsed?.accelerometer;
  const gyr = parsed?.gyroscope;
  const temp = parsed?.temperature ?? null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      <div className="relative w-[min(1100px,94vw)] rounded-2xl border border-white/10 bg-slate-950 p-4">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="rounded-lg bg-indigo-500/10 border border-indigo-400/20 p-2">
              <Move3d className="w-5 h-5 text-indigo-300" />
            </div>
            <div className="min-w-0">
              <p className="text-white font-semibold">IMU 3D View</p>
              <p className="text-xs text-gray-400 truncate">
                {node?.node_id ?? "-"} • {String(node?.sensor_type ?? "imu")}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 rounded-full bg-amber-400/10 border border-amber-300/20 px-2.5 py-1">
              <Thermometer className="w-4 h-4 text-amber-300" />
              <span className="text-xs font-mono text-white tabular-nums">
                {temp == null ? "--" : `${fmt(temp, 2)} °C`}
              </span>
            </div>

            <button
              onClick={onClose}
              className="text-xs rounded-md border px-3 py-1.5 hover:bg-white/5 border-white/10 text-gray-200"
            >
              Close
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 rounded-xl border border-white/10 bg-black/30 overflow-hidden">
            <div className="h-[420px]">
              <Canvas camera={{ position: [2.6, 1.6, 2.6], fov: 50 }}>
                <ambientLight intensity={0.6} />
                <directionalLight position={[4, 6, 2]} intensity={1.0} castShadow />
                <IMUObject imuRef={imuRef} filterRef={filterRef} />
                <OrbitControls enablePan enableRotate enableZoom />
              </Canvas>
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="flex items-center justify-between">
              <p className="text-white font-semibold">Live Values</p>
              <span className="text-[11px] text-gray-400">MPU6050</span>
            </div>

            <div className="mt-3 space-y-3">
              <div className="rounded-xl bg-black/20 border border-white/10 p-3">
                <p className="text-[11px] text-gray-400">Accelerometer</p>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {["x", "y", "z"].map((k) => (
                    <div key={k} className="rounded-lg bg-white/5 border border-white/10 px-2 py-2">
                      <p className="text-[10px] text-gray-400">{k.toUpperCase()}</p>
                      <p className="mt-0.5 text-sm font-mono text-white tabular-nums">
                        {acc ? fmt(acc[k], 2) : "--"}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl bg-black/20 border border-white/10 p-3">
                <p className="text-[11px] text-gray-400">Gyroscope</p>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {["x", "y", "z"].map((k) => (
                    <div key={k} className="rounded-lg bg-white/5 border border-white/10 px-2 py-2">
                      <p className="text-[10px] text-gray-400">{k.toUpperCase()}</p>
                      <p className="mt-0.5 text-sm font-mono text-white tabular-nums">
                        {gyr ? fmt(gyr[k], 3) : "--"}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl bg-black/20 border border-white/10 p-3">
                <p className="text-[11px] text-gray-400">Stabilization</p>

                <div className="mt-2 flex items-center justify-between gap-3">
                  <label className="text-xs text-gray-300 flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={useComp}
                      onChange={(e) => setUseComp(e.target.checked)}
                      className="accent-indigo-400"
                    />
                    Complementary filter
                  </label>

                  <button
                    onClick={() => {
                      filterRef.current.roll = 0;
                      filterRef.current.pitch = 0;
                      filterRef.current.yaw = 0;
                    }}
                    className="text-xs rounded-md border px-2.5 py-1.5 hover:bg-white/5 border-white/10 text-gray-200"
                  >
                    Recenter
                  </button>
                </div>

                <div className="mt-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-gray-400">Alpha</span>
                    <span className="text-[11px] text-gray-300 font-mono tabular-nums">{fmt(alphaUi, 2)}</span>
                  </div>
                  <input
                    type="range"
                    min="0.85"
                    max="0.995"
                    step="0.001"
                    value={alphaUi}
                    onChange={(e) => setAlphaUi(Number(e.target.value))}
                    className="w-full mt-2"
                    disabled={!useComp}
                  />
                  <p className="text-[11px] text-gray-500 mt-2">
                    Higher alpha = more gyro (responsive). Lower alpha = more accel (stable).
                  </p>
                </div>
              </div>

              <div className="rounded-xl bg-black/20 border border-white/10 p-3">
                <p className="text-[11px] text-gray-400">Orientation (rad)</p>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {[
                    { k: "Roll", v: filterRef.current.roll },
                    { k: "Pitch", v: filterRef.current.pitch },
                    { k: "Yaw", v: filterRef.current.yaw },
                  ].map((it) => (
                    <div key={it.k} className="rounded-lg bg-white/5 border border-white/10 px-2 py-2">
                      <p className="text-[10px] text-gray-400">{it.k}</p>
                      <p className="mt-0.5 text-sm font-mono text-white tabular-nums">{fmt(it.v, 3)}</p>
                    </div>
                  ))}
                </div>
              </div>

              {!parsed ? (
                <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3">
                  <p className="text-xs text-red-200">Invalid IMU payload</p>
                  <p className="text-[11px] text-red-200/70 mt-1">
                    Data not valid
                  </p>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-4 pt-3 border-t border-white/10 flex items-center justify-end">
          <button
            onClick={onClose}
            className="text-xs rounded-md border px-3 py-1.5 hover:bg-white/5 border-white/10 text-gray-200"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
