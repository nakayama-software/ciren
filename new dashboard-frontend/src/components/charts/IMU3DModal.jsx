import { useEffect, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { Move3d } from 'lucide-react'
import { buildIMUFromLatest } from '../../utils/sensors'

const DEG2RAD = Math.PI / 180

function fmt(n, d = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return '--'
  return Number(n).toFixed(d)
}

// orientRef: { pitch, roll, yaw } in degrees (from node)
// offsetRef: { pitch, roll, yaw } for recenter
function IMUObject({ orientRef, offsetRef }) {
  const meshRef = useRef(null)

  useFrame(() => {
    const mesh = meshRef.current
    if (!mesh) return
    const o = orientRef.current
    const off = offsetRef.current
    // Apply Euler angles directly (node already ran complementary filter)
    // Three.js rotation.set uses radians, order XYZ
    mesh.rotation.set(
      (o.pitch - off.pitch) * DEG2RAD,
      (o.yaw   - off.yaw)   * DEG2RAD,
      (o.roll  - off.roll)  * DEG2RAD,
      'XYZ'
    )
  })

  return (
    <group>
      {/* PCB body */}
      <mesh ref={meshRef} castShadow receiveShadow>
        <boxGeometry args={[1.4, 0.2, 0.9]} />
        <meshStandardMaterial color="#1e40af" roughness={0.35} metalness={0.3} />
      </mesh>
      {/* Connector nub */}
      <mesh position={[0, 0.14, 0]}>
        <boxGeometry args={[0.15, 0.06, 0.12]} />
        <meshStandardMaterial color="#94a3b8" roughness={0.4} metalness={0.1} />
      </mesh>
      <gridHelper args={[10, 10, '#334155', '#1e293b']} />
      <axesHelper args={[1.5]} />
    </group>
  )
}

// wsRef: { current: WebSocket | null }
export default function IMU3DModal({ open, onClose, deviceId, ctrlId, portNum, latestData, wsRef }) {
  // Orientation state — updated by WS
  const orientRef = useRef({ pitch: 0, roll: 0, yaw: 0 })
  const offsetRef = useRef({ pitch: 0, roll: 0, yaw: 0 })

  // Display values (updated at ~10Hz to avoid excess re-renders)
  const [display, setDisplay] = useState({ pitch: 0, roll: 0, yaw: 0 })

  // Seed from latestData on open
  useEffect(() => {
    if (!open) return
    const imu = latestData ? buildIMUFromLatest(ctrlId, portNum, latestData) : null
    const euler = imu?.euler
    // Fallback: estimasi pitch/roll dari accel jika euler tidak tersedia
    let initPitch = euler?.pitch ?? null
    let initRoll  = euler?.roll  ?? null
    if (initPitch === null && imu?.accelerometer) {
      const { x: ax, y: ay, z: az } = imu.accelerometer
      if (ax !== null && ay !== null && az !== null) {
        initPitch = Math.atan2(ay, Math.sqrt(ax * ax + az * az)) * 180 / Math.PI
        initRoll  = Math.atan2(-ax, az) * 180 / Math.PI
      }
    }
    orientRef.current = {
      pitch: initPitch ?? 0,
      roll:  initRoll  ?? 0,
      yaw:   euler?.yaw ?? 0,
    }
    offsetRef.current = { pitch: 0, roll: 0, yaw: 0 }
  }, [open, ctrlId, portNum, latestData])

  // Display refresh timer
  useEffect(() => {
    if (!open) return
    const id = setInterval(() => {
      const o = orientRef.current
      const off = offsetRef.current
      setDisplay({
        pitch: o.pitch - off.pitch,
        roll:  o.roll  - off.roll,
        yaw:   o.yaw   - off.yaw,
      })
    }, 100)
    return () => clearInterval(id)
  }, [open])

  // Subscribe to WS for live Euler angle updates (0x10/0x11/0x12)
  useEffect(() => {
    if (!open || !wsRef?.current) return
    const ws = wsRef.current

    const handler = (evt) => {
      try {
        const msg = JSON.parse(evt.data)
        if (msg.type !== 'sensor_data') return
        const p = msg.payload

        if (p.device_id !== deviceId)             return
        if (Number(p.ctrl_id) !== Number(ctrlId)) return
        // Port tidak dicek secara ketat — data diterima dari port manapun untuk ctrl ini
        // Ini handle kasus port mismatch antara registrasi MongoDB dan port aktual

        const st = Number(p.sensor_type)
        const v  = Number(p.value)
        if (!Number.isFinite(v)) return

        // Euler angles dari firmware baru (node_mpu6050 dengan complementary filter)
        if      (st === 0x10) orientRef.current = { ...orientRef.current, pitch: v }
        else if (st === 0x11) orientRef.current = { ...orientRef.current, roll:  v }
        else if (st === 0x12) orientRef.current = { ...orientRef.current, yaw:   v }
        // Raw accel dari firmware lama — estimasi pitch/roll (noisy, no yaw)
        else if (st >= 0x03 && st <= 0x05) {
          // Kumpulkan accel, hitung orientation saat semua 3 axis terupdate
          const cur = orientRef.current
          const _ax = st === 0x03 ? v : (cur._ax ?? 0)
          const _ay = st === 0x04 ? v : (cur._ay ?? 0)
          const _az = st === 0x05 ? v : (cur._az ?? 0)
          const pitch = Math.atan2(_ay, Math.sqrt(_ax * _ax + _az * _az)) * 180 / Math.PI
          const roll  = Math.atan2(-_ax, _az) * 180 / Math.PI
          orientRef.current = { ...cur, _ax, _ay, _az, pitch, roll }
        }
      } catch {}
    }

    ws.addEventListener('message', handler)
    return () => ws.removeEventListener('message', handler)
  }, [open, wsRef, deviceId, ctrlId])

  function handleRecenter() {
    offsetRef.current = { ...orientRef.current }
  }

  if (!open) return null

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
              <p className="text-xs text-gray-400 truncate">Ctrl {ctrlId} · Port {portNum} · MPU6050</p>
            </div>
          </div>
          <button onClick={onClose}
            className="text-xs rounded-md border px-3 py-1.5 hover:bg-white/5 border-white/10 text-gray-200 cursor-pointer">
            Close
          </button>
        </div>

        {/* Body */}
        <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-4">

          {/* 3D Canvas */}
          <div className="lg:col-span-2 rounded-xl border border-white/10 bg-black/30 overflow-hidden">
            <div className="h-[420px]">
              <Canvas camera={{ position: [2.6, 1.6, 2.6], fov: 50 }}>
                <ambientLight intensity={0.5} />
                <directionalLight position={[4, 6, 2]} intensity={1.0} castShadow />
                <IMUObject orientRef={orientRef} offsetRef={offsetRef} />
                <OrbitControls enablePan enableRotate enableZoom />
              </Canvas>
            </div>
          </div>

          {/* Live Values Panel */}
          <div className="rounded-xl border border-white/10 bg-white/5 p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <p className="text-white font-semibold text-sm">Orientation</p>
              <span className="text-[11px] text-gray-400">Complementary filter on-node</span>
            </div>

            {/* Euler angles */}
            <div className="rounded-xl bg-black/20 border border-white/10 p-3">
              <p className="text-[11px] text-gray-400 mb-2">Euler Angles (°)</p>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { k: 'Pitch', v: display.pitch, color: 'text-cyan-400' },
                  { k: 'Roll',  v: display.roll,  color: 'text-violet-400' },
                  { k: 'Yaw',   v: display.yaw,   color: 'text-emerald-400' },
                ].map((it) => (
                  <div key={it.k} className="rounded-lg bg-white/5 border border-white/10 px-2 py-2 text-center">
                    <p className="text-[10px] text-gray-400">{it.k}</p>
                    <p className={`mt-0.5 text-sm font-mono tabular-nums ${it.color}`}>
                      {fmt(it.v, 1)}°
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* Visual orientation bars */}
            <div className="rounded-xl bg-black/20 border border-white/10 p-3 space-y-3">
              <p className="text-[11px] text-gray-400">Visual</p>
              {[
                { k: 'Pitch', v: display.pitch, range: 90,  color: 'bg-cyan-500' },
                { k: 'Roll',  v: display.roll,  range: 180, color: 'bg-violet-500' },
                { k: 'Yaw',   v: display.yaw,   range: 180, color: 'bg-emerald-500' },
              ].map((it) => {
                const pct = Math.min(100, Math.max(0, ((it.v + it.range) / (it.range * 2)) * 100))
                return (
                  <div key={it.k}>
                    <div className="flex justify-between text-[10px] text-gray-400 mb-1">
                      <span>{it.k}</span>
                      <span className="font-mono">{fmt(it.v, 1)}°</span>
                    </div>
                    <div className="relative h-2 rounded-full bg-white/10 overflow-hidden">
                      {/* Center mark */}
                      <div className="absolute left-1/2 top-0 bottom-0 w-px bg-white/20" />
                      {/* Value indicator */}
                      <div
                        className={`absolute top-0 bottom-0 w-1.5 rounded-full ${it.color}`}
                        style={{ left: `calc(${pct}% - 3px)`, transition: 'left 0.08s linear' }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Controls */}
            <div className="rounded-xl bg-black/20 border border-white/10 p-3">
              <p className="text-[11px] text-gray-400 mb-2">Controls</p>
              <button
                onClick={handleRecenter}
                className="w-full text-xs rounded-md border px-2.5 py-2 hover:bg-white/10 border-white/10 text-gray-200 cursor-pointer transition-colors">
                ⊕ Recenter (zero current position)
              </button>
              <p className="mt-2 text-[10px] text-gray-500 text-center">
                Drag to orbit · Scroll to zoom
              </p>
            </div>

            {/* Waiting state */}
            {display.pitch === 0 && display.roll === 0 && display.yaw === 0 && (
              <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/10 p-3">
                <p className="text-xs text-yellow-200">Waiting for IMU data…</p>
                <p className="text-[10px] text-yellow-300/60 mt-1">
                  Expecting sensor_type 0x10/0x11/0x12
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="mt-4 pt-3 border-t border-white/10 flex items-center justify-end">
          <button onClick={onClose}
            className="text-xs rounded-md border px-3 py-1.5 hover:bg-white/5 border-white/10 text-gray-200 cursor-pointer">
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
