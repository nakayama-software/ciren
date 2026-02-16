import React, { useEffect, useMemo, useRef, useState } from "react";
import { X, RotateCw, Activity } from "lucide-react";

const API_BASE = import.meta.env.VITE_API_BASE || "";

function toNum(v) {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").trim());
  return Number.isFinite(n) ? n : null;
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function fmtTime(ts) {
  try {
    const d = new Date(ts);
    return d.toLocaleString("ja-JP", { hour12: false });
  } catch {
    return String(ts);
  }
}

function buildUrl(path, params) {
  const qs = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v === undefined || v === null || v === "") return;
    qs.set(k, String(v));
  });
  return `${API_BASE}${path}?${qs.toString()}`;
}


function parseRotaryEvent(raw) {
  const s = String(raw ?? "");

  let direction = null; // "CW" | "CCW" | null
  if (s.includes("CCW")) direction = "CCW";
  else if (s.includes("CW")) direction = "CW";

  let delta = null;

  if (s.includes(",")) {
    const last = s.split(",").pop()?.trim();
    delta = toNum(last);
  } else {
    const m = s.match(/(-?\d+(\.\d+)?)(?!.*-?\d)/);
    if (m) delta = toNum(m[1]);
  }

  if (direction && (delta === null || delta === 0)) delta = 1;

  if (direction === "CCW" && delta !== null && delta > 0) delta = -delta;

  if (direction === "CW" && delta !== null && delta < 0) delta = Math.abs(delta);

  return { direction, delta };
}

function buildPath(points, xScale, yScale) {
  if (!points.length) return "";
  let d = `M ${xScale(points[0].t)} ${yScale(points[0].y)}`;
  for (let i = 1; i < points.length; i++) {
    d += ` L ${xScale(points[i].t)} ${yScale(points[i].y)}`;
  }
  return d;
}

export default function RotaryChartModal({
  open,
  onClose,
  raspiId,
  hubId,
  portId,
  sensorTypeHint,
  node,
}) {
  // console.log("111");

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [rows, setRows] = useState([]);

  const raspiKey = useMemo(() => String(raspiId || "").toLowerCase().trim(), [raspiId]);
  const moduleKey = useMemo(() => String(hubId || "").trim(), [hubId]);
  const portKey = useMemo(() => Number(portId), [portId]);
  const sensorKey = useMemo(() => String(sensorTypeHint || "").toLowerCase().trim(), [sensorTypeHint]);

  const [hoverIdx, setHoverIdx] = useState(null);
  const svgRef = useRef(null);

  useEffect(() => {
    if (!open) return;

    let disposed = false;

    const pn = Number(portKey);
    if (!raspiKey || !moduleKey || !Number.isFinite(pn) || pn < 1 || pn > 10 || !sensorKey) {
      setRows([]);
      setErr("Invalid chart context");
      return;
    }

    async function fetchHistory() {
      setLoading(true);
      setErr(null);

      try {


        const minutes = 10;
        // const url =
        //   `${API_BASE}/api/sensor/history` +
        //   `?raspi_id=${encodeURIComponent(raspiId ?? "")}` +
        //   `&hub_id=${encodeURIComponent(hubId ?? "")}` +
        //   `&port_id=${encodeURIComponent(portId ?? "")}` +
        //   `&sensor_type=${encodeURIComponent(sensorTypeHint ?? "rotary_sensor")}` +
        //   `&minutes=${minutes}`;

        const url = buildUrl("/api/sensor-readings", {
          raspberry_serial_id: raspiId,
          module_id: moduleKey,
          sensor_type: sensorKey,
          port_number: pn,
          limit: 2000,
        });

        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) throw new Error(`history fetch failed (HTTP ${res.status})`);

        const json = await res.json();

        const data = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];

        if (!disposed) setRows(data);
      } catch (e) {
        if (!disposed) setErr(e?.message || String(e));
      } finally {
        if (!disposed) setLoading(false);
      }
    }

    fetchHistory();

    return () => {
      disposed = true;
    };
  }, [open, raspiId, hubId, portId, sensorTypeHint]);

  const series = useMemo(() => {
    const events = (Array.isArray(rows) ? rows : [])
      .map((r) => {
        const tRaw = r?.timestamp ?? r?.ts ?? r?.created_at ?? r?.time;
        const t = tRaw ? new Date(tRaw).getTime() : null;
        const raw =
          r?.sensor_data ??
          r?.value ??
          r?.readings?.[0]?.value ??
          r?.payload ??
          "";

        const { direction, delta } = parseRotaryEvent(raw);

        return { t, raw, direction, delta };
      })
      .filter((x) => Number.isFinite(x.t))
      .sort((a, b) => a.t - b.t);

    let pos = 0;
    const points = [];
    for (const e of events) {
      if (e.delta !== null) pos += e.delta;
      points.push({ t: e.t, y: pos, ...e });
    }
    const ratePoints = [];
    for (let i = 1; i < points.length; i++) {
      const dt = (points[i].t - points[i - 1].t) / 1000;
      const dy = points[i].y - points[i - 1].y;
      const rate = dt > 0 ? dy / dt : 0;
      ratePoints.push({ t: points[i].t, y: rate });
    }

    return { points, ratePoints };
  }, [rows]);

  const W = 920;
  const H = 320;
  const PAD = 36;

  const { xMin, xMax, yMin, yMax, rateMin, rateMax } = useMemo(() => {
    const pts = series.points;
    const rps = series.ratePoints;
    const xMin = pts.length ? pts[0].t : Date.now() - 60_000;
    const xMax = pts.length ? pts[pts.length - 1].t : Date.now();

    let yMin = 0, yMax = 1;
    if (pts.length) {
      yMin = Math.min(...pts.map((p) => p.y));
      yMax = Math.max(...pts.map((p) => p.y));
      if (yMin === yMax) { yMin -= 1; yMax += 1; }
    }

    let rateMin = -1, rateMax = 1;
    if (rps.length) {
      rateMin = Math.min(...rps.map((p) => p.y));
      rateMax = Math.max(...rps.map((p) => p.y));
      if (rateMin === rateMax) { rateMin -= 1; rateMax += 1; }
    }

    return { xMin, xMax, yMin, yMax, rateMin, rateMax };
  }, [series]);

  const xScale = (t) => {
    const span = Math.max(1, xMax - xMin);
    return PAD + ((t - xMin) / span) * (W - PAD * 2);
  };

  const yScale = (y) => {
    const span = Math.max(1e-9, yMax - yMin);
    return PAD + (1 - (y - yMin) / span) * (H - PAD * 2);
  };

  const rateBandTop = PAD;
  const rateBandBottom = PAD + 70;
  const rateScale = (y) => {
    const span = Math.max(1e-9, rateMax - rateMin);
    const v = (y - rateMin) / span;
    return rateBandBottom - v * (rateBandBottom - rateBandTop);
  };

  const posPath = useMemo(() => buildPath(series.points, xScale, yScale), [series, xMin, xMax, yMin, yMax]);
  const ratePath = useMemo(() => buildPath(series.ratePoints, xScale, rateScale), [series, xMin, xMax, rateMin, rateMax]);

  const summary = useMemo(() => {
    const pts = series.points;
    if (!pts.length) return { total: 0, lastDir: "—", lastDelta: "—", lastPos: "—" };

    const last = pts[pts.length - 1];
    const total = last.y;

    let lastDir = last.direction ?? "—";
    let lastDelta = last.delta == null ? "—" : String(last.delta);
    let lastPos = String(last.y);

    return { total, lastDir, lastDelta, lastPos };
  }, [series]);

  function onMove(e) {
    if (!svgRef.current || !series.points.length) return;
    const rect = svgRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;

    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < series.points.length; i++) {
      const px = (xScale(series.points[i].t) / W) * rect.width;
      const d = Math.abs(px - mx);
      if (d < bestDist) { bestDist = d; best = i; }
    }
    setHoverIdx(best);
  }

  function closeIfBackdrop(e) {
    if (e.target === e.currentTarget) onClose?.();
  }

  if (!open) return null;

  const hovered = hoverIdx != null ? series.points[hoverIdx] : null;

  return (
    <div
      className="fixed inset-0 z-[999] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onMouseDown={closeIfBackdrop}
    >
      <div className="w-full max-w-5xl rounded-2xl border border-white/10 bg-slate-900/80 shadow-xl">
        {/* header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <div className="flex items-center gap-3 min-w-0">
            <div className="rounded-lg bg-amber-500/10 border border-amber-400/20 p-2">
              <RotateCw className="w-5 h-5 text-amber-300" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-white font-semibold truncate">Rotary Sensor Chart</h3>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-gray-300">
                  {portId ?? "-"}
                </span>
              </div>
              <p className="text-[11px] text-gray-400 mt-0.5 truncate">
                Raspi: {raspiId ?? "—"} • Hub: {hubId ?? "—"} • Type: {sensorTypeHint ?? "rotary_sensor"}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-gray-200 p-2"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* body */}
        <div className="p-5 space-y-4">
          {/* summary tiles */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="rounded-xl bg-black/20 border border-white/10 p-3">
              <p className="text-[11px] text-gray-400">Position (steps)</p>
              <p className="text-lg font-mono text-white tabular-nums">{summary.lastPos}</p>
            </div>
            <div className="rounded-xl bg-black/20 border border-white/10 p-3">
              <p className="text-[11px] text-gray-400">Last direction</p>
              <p className="text-lg font-mono text-white tabular-nums">{summary.lastDir}</p>
            </div>
            <div className="rounded-xl bg-black/20 border border-white/10 p-3">
              <p className="text-[11px] text-gray-400">Last delta</p>
              <p className="text-lg font-mono text-white tabular-nums">{summary.lastDelta}</p>
            </div>
            <div className="rounded-xl bg-black/20 border border-white/10 p-3">
              <p className="text-[11px] text-gray-400 flex items-center gap-2">
                <Activity className="w-4 h-4 text-gray-300" />
                Points
              </p>
              <p className="text-lg font-mono text-white tabular-nums">{series.points.length}</p>
            </div>
          </div>

          {/* status */}
          {loading && (
            <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-gray-200">
              Loading history…
            </div>
          )}
          {err && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
              {err}
            </div>
          )}
          {!loading && !err && series.points.length === 0 && (
            <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm text-yellow-200">
              No rotary history data available.
            </div>
          )}

          {/* chart */}
          <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm text-gray-200 font-medium">Position over time</p>
              <p className="text-[11px] text-gray-400">
                {series.points.length ? `${fmtTime(xMin)} → ${fmtTime(xMax)}` : "—"}
              </p>
            </div>

            <div className="w-full overflow-x-auto">
              <svg
                ref={svgRef}
                viewBox={`0 0 ${W} ${H}`}
                className="w-full h-[320px]"
                onMouseMove={onMove}
                onMouseLeave={() => setHoverIdx(null)}
              >
                {/* grid */}
                <g opacity="0.45">
                  {[0, 0.25, 0.5, 0.75, 1].map((p) => {
                    const y = PAD + p * (H - PAD * 2);
                    return (
                      <line
                        key={p}
                        x1={PAD}
                        y1={y}
                        x2={W - PAD}
                        y2={y}
                        stroke="rgba(255,255,255,0.12)"
                        strokeWidth="1"
                      />
                    );
                  })}
                  {[0, 0.25, 0.5, 0.75, 1].map((p) => {
                    const x = PAD + p * (W - PAD * 2);
                    return (
                      <line
                        key={p}
                        x1={x}
                        y1={PAD}
                        x2={x}
                        y2={H - PAD}
                        stroke="rgba(255,255,255,0.10)"
                        strokeWidth="1"
                      />
                    );
                  })}
                </g>

                {/* rate band label */}
                <text x={PAD} y={rateBandTop - 8} fill="rgba(255,255,255,0.45)" fontSize="11">
                  rate (steps/s)
                </text>

                {/* rate path */}
                {series.ratePoints.length > 1 && (
                  <path
                    d={ratePath}
                    fill="none"
                    stroke="rgba(45,212,191,0.85)" /* teal-ish */
                    strokeWidth="2"
                  />
                )}

                {/* position path */}
                {series.points.length > 1 && (
                  <path
                    d={posPath}
                    fill="none"
                    stroke="rgba(251,191,36,0.90)" /* amber-ish */
                    strokeWidth="2.5"
                  />
                )}

                {/* points */}
                {series.points.slice(-300).map((p, idx) => {
                  const x = xScale(p.t);
                  const y = yScale(p.y);
                  const isHover = hoverIdx != null && series.points[hoverIdx]?.t === p.t && series.points[hoverIdx]?.y === p.y;

                  const dirColor =
                    p.direction === "CW"
                      ? "rgba(34,197,94,0.9)"   // green
                      : p.direction === "CCW"
                        ? "rgba(239,68,68,0.9)"   // red
                        : "rgba(148,163,184,0.7)"; // slate

                  return (
                    <circle
                      key={`${p.t}-${idx}`}
                      cx={x}
                      cy={y}
                      r={isHover ? 4 : 2.5}
                      fill={dirColor}
                      opacity={isHover ? 1 : 0.65}
                    />
                  );
                })}

                {/* hover marker */}
                {hovered && (
                  <>
                    <line
                      x1={xScale(hovered.t)}
                      y1={PAD}
                      x2={xScale(hovered.t)}
                      y2={H - PAD}
                      stroke="rgba(255,255,255,0.25)"
                      strokeWidth="1"
                    />
                    <circle
                      cx={xScale(hovered.t)}
                      cy={yScale(hovered.y)}
                      r={5}
                      fill="rgba(251,191,36,1)"
                    />
                  </>
                )}
              </svg>
            </div>

            {/* tooltip */}
            {hovered && (
              <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-gray-200">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                  <div>
                    <div className="text-[11px] text-gray-400">Time</div>
                    <div className="font-mono tabular-nums">{fmtTime(hovered.t)}</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-gray-400">Direction</div>
                    <div className="font-mono tabular-nums">{hovered.direction ?? "—"}</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-gray-400">Delta</div>
                    <div className="font-mono tabular-nums">
                      {hovered.delta == null ? "—" : hovered.delta}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-gray-400">Position</div>
                    <div className="font-mono tabular-nums">{hovered.y}</div>
                  </div>
                </div>
              </div>
            )}
          </div>

          <p className="text-[11px] text-gray-500">
            * Position dihitung sebagai akumulasi delta CW/CCW dari history. Jika backend sudah punya “absolute encoder count”,
            lebih baik pakai itu untuk hasil yang stabil antar refresh.
          </p>
        </div>
      </div>
    </div>
  );
}
