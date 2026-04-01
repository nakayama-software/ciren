import { useEffect, useMemo, useRef, useState } from 'react'
import { X, RotateCw, Activity } from 'lucide-react'
import { apiFetch } from '../../lib/api'

function fmtTime(ts) {
  try { return new Date(ts).toLocaleString('ja-JP', { hour12: false }) }
  catch { return String(ts) }
}

function buildPath(points, xScale, yScale) {
  if (!points.length) return ''
  let d = `M ${xScale(points[0].t)} ${yScale(points[0].y)}`
  for (let i = 1; i < points.length; i++) {
    d += ` L ${xScale(points[i].t)} ${yScale(points[i].y)}`
  }
  return d
}

export default function RotaryChartModal({ open, onClose, deviceId, ctrlId, portNum }) {
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState(null)
  const [rows, setRows] = useState([])
  const [hoverIdx, setHoverIdx] = useState(null)
  const svgRef = useRef(null)

  useEffect(() => {
    if (!open) return
    let disposed = false

    async function fetchHistory() {
      setLoading(true)
      setErr(null)
      try {
        const params = new URLSearchParams({
          ctrl_id: String(ctrlId),
          port_num: String(portNum),
          sensor_type: '19', // 0x13 rotary
          hours: '1',
        })
        const data = await apiFetch(`/api/devices/${deviceId}/data/history?${params}`)
        if (!disposed) setRows(Array.isArray(data) ? data : [])
      } catch (e) {
        if (!disposed) setErr(e?.message || String(e))
      } finally {
        if (!disposed) setLoading(false)
      }
    }

    fetchHistory()
    return () => { disposed = true }
  }, [open, deviceId, ctrlId, portNum])

  // Build cumulative position series from raw value readings
  const series = useMemo(() => {
    const events = rows
      .map((r) => {
        const t = r.server_ts ? new Date(r.server_ts).getTime() : null
        const delta = typeof r.value === 'number' ? r.value : parseFloat(String(r.value ?? ''))
        return { t, delta: Number.isFinite(delta) ? delta : null }
      })
      .filter((x) => x.t !== null)
      .sort((a, b) => a.t - b.t)

    let pos = 0
    const points = []
    for (const e of events) {
      if (e.delta !== null) pos += e.delta
      const direction = e.delta > 0 ? 'CW' : e.delta < 0 ? 'CCW' : null
      points.push({ t: e.t, y: pos, delta: e.delta, direction })
    }

    const ratePoints = []
    for (let i = 1; i < points.length; i++) {
      const dt = (points[i].t - points[i - 1].t) / 1000
      const dy = points[i].y - points[i - 1].y
      ratePoints.push({ t: points[i].t, y: dt > 0 ? dy / dt : 0 })
    }

    return { points, ratePoints }
  }, [rows])

  const W = 920, H = 320, PAD = 36

  const { xMin, xMax, yMin, yMax, rateMin, rateMax } = useMemo(() => {
    const pts = series.points
    const rps = series.ratePoints
    const xMin = pts.length ? pts[0].t : Date.now() - 60_000
    const xMax = pts.length ? pts[pts.length - 1].t : Date.now()
    let yMin = 0, yMax = 1
    if (pts.length) {
      yMin = Math.min(...pts.map(p => p.y)); yMax = Math.max(...pts.map(p => p.y))
      if (yMin === yMax) { yMin -= 1; yMax += 1 }
    }
    let rateMin = -1, rateMax = 1
    if (rps.length) {
      rateMin = Math.min(...rps.map(p => p.y)); rateMax = Math.max(...rps.map(p => p.y))
      if (rateMin === rateMax) { rateMin -= 1; rateMax += 1 }
    }
    return { xMin, xMax, yMin, yMax, rateMin, rateMax }
  }, [series])

  const xScale = (t) => PAD + ((t - xMin) / Math.max(1, xMax - xMin)) * (W - PAD * 2)
  const yScale = (y) => PAD + (1 - (y - yMin) / Math.max(1e-9, yMax - yMin)) * (H - PAD * 2)
  const rateBandTop = PAD, rateBandBottom = PAD + 70
  const rateScale = (y) => rateBandBottom - ((y - rateMin) / Math.max(1e-9, rateMax - rateMin)) * (rateBandBottom - rateBandTop)

  const posPath  = useMemo(() => buildPath(series.points, xScale, yScale),      [series, xMin, xMax, yMin, yMax])
  const ratePath = useMemo(() => buildPath(series.ratePoints, xScale, rateScale), [series, xMin, xMax, rateMin, rateMax])

  const summary = useMemo(() => {
    const pts = series.points
    if (!pts.length) return { lastPos: '—', lastDir: '—', lastDelta: '—' }
    const last = pts[pts.length - 1]
    return { lastPos: String(last.y), lastDir: last.direction ?? '—', lastDelta: last.delta == null ? '—' : String(last.delta) }
  }, [series])

  function onMove(e) {
    if (!svgRef.current || !series.points.length) return
    const rect = svgRef.current.getBoundingClientRect()
    const mx = e.clientX - rect.left
    let best = 0, bestDist = Infinity
    for (let i = 0; i < series.points.length; i++) {
      const px = (xScale(series.points[i].t) / W) * rect.width
      const d = Math.abs(px - mx)
      if (d < bestDist) { bestDist = d; best = i }
    }
    setHoverIdx(best)
  }

  if (!open) return null
  const hovered = hoverIdx != null ? series.points[hoverIdx] : null

  return (
    <div className="fixed inset-0 z-[999] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.() }}>
      <div className="w-full max-w-5xl rounded-2xl border border-white/10 bg-slate-900/95 shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <div className="flex items-center gap-3 min-w-0">
            <div className="rounded-lg bg-amber-500/10 border border-amber-400/20 p-2">
              <RotateCw className="w-5 h-5 text-amber-300" />
            </div>
            <div className="min-w-0">
              <h3 className="text-white font-semibold">Rotary Chart</h3>
              <p className="text-[11px] text-gray-400 mt-0.5">
                Device: {deviceId} · Controller: {ctrlId} · Port: {portNum}
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-gray-200 p-2">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-4 gap-3">
            {[['Position', summary.lastPos], ['Direction', summary.lastDir], ['Last Delta', summary.lastDelta], ['Points', series.points.length]].map(([label, val]) => (
              <div key={label} className="rounded-xl bg-black/20 border border-white/10 p-3">
                <p className="text-[11px] text-gray-400">{label}</p>
                <p className="text-lg font-mono text-white tabular-nums">{val}</p>
              </div>
            ))}
          </div>

          {loading && <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-gray-200">Loading history…</div>}
          {err && <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{err}</div>}
          {!loading && !err && series.points.length === 0 && (
            <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm text-yellow-200">No rotary history data available.</div>
          )}

          <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm text-gray-200 font-medium">Position over time</p>
              <p className="text-[11px] text-gray-400">{series.points.length ? `${fmtTime(xMin)} → ${fmtTime(xMax)}` : '—'}</p>
            </div>
            <div className="w-full overflow-x-auto">
              <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="w-full h-[320px]" onMouseMove={onMove} onMouseLeave={() => setHoverIdx(null)}>
                <g opacity="0.45">
                  {[0, 0.25, 0.5, 0.75, 1].map(p => (
                    <line key={`h${p}`} x1={PAD} y1={PAD + p * (H - PAD * 2)} x2={W - PAD} y2={PAD + p * (H - PAD * 2)} stroke="rgba(255,255,255,0.12)" strokeWidth="1" />
                  ))}
                  {[0, 0.25, 0.5, 0.75, 1].map(p => (
                    <line key={`v${p}`} x1={PAD + p * (W - PAD * 2)} y1={PAD} x2={PAD + p * (W - PAD * 2)} y2={H - PAD} stroke="rgba(255,255,255,0.10)" strokeWidth="1" />
                  ))}
                </g>
                <text x={PAD} y={rateBandTop - 8} fill="rgba(255,255,255,0.45)" fontSize="11">rate (steps/s)</text>
                {series.ratePoints.length > 1 && <path d={ratePath} fill="none" stroke="rgba(45,212,191,0.85)" strokeWidth="2" />}
                {series.points.length > 1 && <path d={posPath} fill="none" stroke="rgba(251,191,36,0.90)" strokeWidth="2.5" />}
                {series.points.slice(-300).map((p, idx) => {
                  const isHover = hoverIdx != null && series.points[hoverIdx]?.t === p.t
                  const dirColor = p.direction === 'CW' ? 'rgba(34,197,94,0.9)' : p.direction === 'CCW' ? 'rgba(239,68,68,0.9)' : 'rgba(148,163,184,0.7)'
                  return <circle key={`${p.t}-${idx}`} cx={xScale(p.t)} cy={yScale(p.y)} r={isHover ? 4 : 2.5} fill={dirColor} opacity={isHover ? 1 : 0.65} />
                })}
                {hovered && (
                  <>
                    <line x1={xScale(hovered.t)} y1={PAD} x2={xScale(hovered.t)} y2={H - PAD} stroke="rgba(255,255,255,0.25)" strokeWidth="1" />
                    <circle cx={xScale(hovered.t)} cy={yScale(hovered.y)} r={5} fill="rgba(251,191,36,1)" />
                  </>
                )}
              </svg>
            </div>
            {hovered && (
              <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-gray-200 grid grid-cols-4 gap-2">
                <div><div className="text-[11px] text-gray-400">Time</div><div className="font-mono tabular-nums">{fmtTime(hovered.t)}</div></div>
                <div><div className="text-[11px] text-gray-400">Direction</div><div className="font-mono tabular-nums">{hovered.direction ?? '—'}</div></div>
                <div><div className="text-[11px] text-gray-400">Delta</div><div className="font-mono tabular-nums">{hovered.delta == null ? '—' : hovered.delta}</div></div>
                <div><div className="text-[11px] text-gray-400">Position</div><div className="font-mono tabular-nums">{hovered.y}</div></div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
