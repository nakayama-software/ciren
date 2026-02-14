import React, { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { Line } from "react-chartjs-2";
import {
  Chart as ChartJS,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  Filler,
} from "chart.js";
import { socket } from "../../lib/socket";

ChartJS.register(LinearScale, PointElement, LineElement, Tooltip, Legend, Filler);

const API_BASE = (import.meta.env?.VITE_API_BASE || "").replace(/\/+$/, "");

function toNum(v) {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").trim());
  return Number.isFinite(n) ? n : null;
}

function parseHumTemp(d) {
  if (Array.isArray(d?.readings) && d.readings.length > 0) {
    const t = d.readings.find((r) => String(r?.key || "").toLowerCase() === "temperature");
    const h = d.readings.find((r) => String(r?.key || "").toLowerCase() === "humidity");
    const temp = toNum(t?.value);
    const hum = toNum(h?.value);
    if (temp !== null || hum !== null) {
      return { temp, hum, tempUnit: t?.unit || "°C", humUnit: h?.unit || "%" };
    }
  }

  if (typeof d?.value === "string" && d.value.includes(",")) {
    const [tStr, hStr] = d.value.split(",").map((s) => s.trim());
    return { temp: toNum(tStr), hum: toNum(hStr), tempUnit: "°C", humUnit: "%" };
  }

  return { temp: null, hum: null, tempUnit: "°C", humUnit: "%" };
}

function fmtTick(ms) {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function normalizePayload(p) {
  if (!p) return null;

  const raspi = String(p.raspberry_serial_id || p.raspi_serial_id || "").toLowerCase().trim();
  const moduleId = String(p.module_id || p.hub_id || "").trim();
  const port = Number(p.port_number ?? p.port_id);

  const sensorTypeRaw = p.sensor_type;
  const sensor_type =
    sensorTypeRaw === null || sensorTypeRaw === undefined
      ? null
      : String(sensorTypeRaw).toLowerCase().trim() || null;

  const tsRaw = p.timestamp_device || p.timestamp_server || p.ts;
  const ts = tsRaw ? new Date(tsRaw).getTime() : Date.now();
  if (!Number.isFinite(ts)) return null;

  const id = p._id ? String(p._id) : null;

  return { raspi, moduleId, port, sensor_type, ts, id, payload: p };
}

function buildUrl(path, params) {
  const qs = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v === undefined || v === null || v === "") return;
    qs.set(k, String(v));
  });
  return `${API_BASE}${path}?${qs.toString()}`;
}

export default function LineChartModal({
  open,
  onClose,
  raspiId,
  hubId,
  portId,
  sensorTypeHint,
}) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [rows, setRows] = useState([]);

  const raspiKey = useMemo(() => String(raspiId || "").toLowerCase().trim(), [raspiId]);
  const moduleKey = useMemo(() => String(hubId || "").trim(), [hubId]);
  const portKey = useMemo(() => Number(portId), [portId]);
  const sensorKey = useMemo(() => String(sensorTypeHint || "").toLowerCase().trim(), [sensorTypeHint]);

  useEffect(() => {
    if (!open) return;

    const pn = Number(portKey);
    if (!raspiKey || !moduleKey || !Number.isFinite(pn) || pn < 1 || pn > 10 || !sensorKey) {
      setRows([]);
      setErr("Invalid chart context");
      return;
    }

    const ac = new AbortController();

    async function load() {
      setLoading(true);
      setErr(null);

      try {
        const url = buildUrl("/api/sensor-readings", {
          raspberry_serial_id: raspiKey,
          module_id: moduleKey,
          sensor_type: sensorKey,
          port_number: pn,
          limit: 2000,
        });

        const r = await fetch(url, { signal: ac.signal });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();

        const items = Array.isArray(j.items) ? j.items : [];

        const mapped = items
          .map((d) => {
            const tsRaw = d.timestamp_device || d.timestamp_server;
            const tsMs = tsRaw ? new Date(tsRaw).getTime() : null;

            const sensor_type = String(d.sensor_type || sensorKey || "").toLowerCase().trim();
            const reading_id = d._id ? String(d._id) : null;

            if (!tsMs || Number.isNaN(tsMs)) return null;
            if (!sensor_type) return null;

            if (sensor_type === "hum_temp") {
              const { temp, hum, tempUnit, humUnit } = parseHumTemp(d);
              if (temp === null && hum === null) return null;
              return { ts: tsMs, sensor_type, temp, hum, tempUnit, humUnit, reading_id };
            }

            const value = toNum(d.value);
            if (value === null) return null;

            return { ts: tsMs, sensor_type, value, unit: d.unit || "", reading_id };
          })
          .filter(Boolean)
          .sort((a, b) => a.ts - b.ts);

        setRows(mapped);
      } catch (e) {
        if (e?.name !== "AbortError") setErr(e.message || String(e));
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    }

    load();
    return () => ac.abort();
  }, [open, raspiKey, moduleKey, portKey, sensorKey]);

  useEffect(() => {
    if (!open) return;

    const handler = (p) => {
      const n = normalizePayload(p);
      if (!n) return;

      if (n.raspi !== raspiKey) return;
      if (n.moduleId !== moduleKey) return;
      if (n.port !== portKey) return;

      const st = n.sensor_type || sensorKey;
      if (!st) return;
      if (st !== sensorKey) return;

      const valueRaw = n.payload?.value;
      const valueMissing =
        valueRaw === null ||
        valueRaw === undefined ||
        (typeof valueRaw === "string" && valueRaw.trim() === "");

      if (valueMissing) return;

      let nextRow;

      if (st === "hum_temp") {
        const { temp, hum, tempUnit, humUnit } = parseHumTemp(n.payload);
        if (temp === null && hum === null) return;
        nextRow = { ts: n.ts, sensor_type: st, temp, hum, tempUnit, humUnit, reading_id: n.id };
      } else {
        const v = toNum(n.payload?.value);
        if (v === null) return;
        nextRow = { ts: n.ts, sensor_type: st, value: v, unit: n.payload?.unit || "", reading_id: n.id };
      }

      setRows((prev) => {
        const key = nextRow.reading_id
          ? `id:${nextRow.reading_id}`
          : `ts:${nextRow.ts}-st:${st}-v:${st === "hum_temp" ? `${nextRow.temp}-${nextRow.hum}` : nextRow.value}`;

        const exists = prev.some((x) => {
          const xKey = x.reading_id
            ? `id:${x.reading_id}`
            : `ts:${x.ts}-st:${x.sensor_type}-v:${x.sensor_type === "hum_temp" ? `${x.temp}-${x.hum}` : x.value}`;
          return xKey === key;
        });

        if (exists) return prev;

        const merged = [...prev, nextRow].sort((a, b) => a.ts - b.ts);
        if (merged.length > 2000) return merged.slice(merged.length - 2000);
        return merged;
      });
    };

    socket.on("node-sample", handler);
    socket.on("sensor-reading", handler);

    return () => {
      socket.off("node-sample", handler);
      socket.off("sensor-reading", handler);
    };
  }, [open, raspiKey, moduleKey, portKey, sensorKey]);

  const isHumTemp = useMemo(() => {
    const st = String(rows[0]?.sensor_type || sensorKey || "").toLowerCase();
    return st === "hum_temp";
  }, [rows, sensorKey]);

  const title = useMemo(() => {
    const st = rows[0]?.sensor_type || sensorKey || "sensor";
    return `${hubId} • P${portId} — ${st}`;
  }, [rows, hubId, portId, sensorKey]);

  const unitLabel = useMemo(() => {
    if (!rows.length) return "-";
    if (isHumTemp) return "°C / %";
    return rows[0]?.unit || "-";
  }, [rows, isHumTemp]);

  const chartData = useMemo(() => {
    if (!rows.length) return { datasets: [] };

    if (isHumTemp) {
      const tempData = rows
        .map((r) => ({ x: r.ts, y: typeof r.temp === "number" ? r.temp : null }))
        .filter((p) => p.y !== null);

      const humData = rows
        .map((r) => ({ x: r.ts, y: typeof r.hum === "number" ? r.hum : null }))
        .filter((p) => p.y !== null);

      return {
        datasets: [
          {
            label: "Temperature (°C)",
            data: tempData,
            borderColor: "rgb(249,115,22)",
            backgroundColor: "rgba(249,115,22,0.15)",
            pointRadius: 0,
            tension: 0.25,
            spanGaps: true,
          },
          {
            label: "Humidity (%)",
            data: humData,
            borderColor: "rgb(59,130,246)",
            backgroundColor: "rgba(59,130,246,0.15)",
            pointRadius: 0,
            tension: 0.25,
            spanGaps: true,
          },
        ],
      };
    }

    const valueData = rows
      .map((r) => ({ x: r.ts, y: typeof r.value === "number" ? r.value : null }))
      .filter((p) => p.y !== null);

    return {
      datasets: [
        {
          label: `Value (${unitLabel})`,
          data: valueData,
          borderColor: "rgb(99,102,241)",
          backgroundColor: "rgba(99,102,241,0.15)",
          pointRadius: 0,
          tension: 0.25,
          spanGaps: true,
        },
      ],
    };
  }, [rows, isHumTemp, unitLabel]);

  const chartOptions = useMemo(() => {
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      parsing: false,
      normalized: true,
      interaction: { mode: "nearest", intersect: false },
      plugins: {
        legend: { display: true, position: "top" },
        tooltip: {
          callbacks: {
            title: (items) => {
              const x = items?.[0]?.parsed?.x;
              return x ? new Date(x).toLocaleString() : "";
            },
            label: (item) => {
              const y = item?.parsed?.y;
              if (typeof y !== "number") return `${item.dataset.label}: -`;
              return `${item.dataset.label}: ${y.toFixed(2)}`;
            },
          },
        },
      },
      scales: {
        x: {
          type: "linear",
          ticks: { callback: (value) => fmtTick(Number(value)), maxTicksLimit: 8 },
          grid: { display: true },
        },
        y: {
          ticks: { callback: (v) => String(v) },
          grid: { display: true },
        },
      },
    };
  }, []);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[1000] bg-black/50 flex items-center justify-center p-4">
      <div className="w-full max-w-3xl rounded-2xl border border-black/10 bg-white dark:bg-slate-900 dark:border-white/10 shadow-xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-black/10 dark:border-white/10">
          <div className="text-sm font-medium text-slate-900 dark:text-white">{title}</div>
          <button
            onClick={onClose}
            className="p-1 rounded-md hover:bg-black/5 dark:hover:bg-white/10"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4">
          {loading && <div className="text-center text-sm text-gray-600 dark:text-gray-300">Loading…</div>}
          {err && !loading && <div className="text-center text-sm text-red-600 dark:text-red-400">{err}</div>}

          {!loading && !err && rows.length === 0 && (
            <div className="text-center text-sm text-gray-600 dark:text-gray-300">No data yet for this port.</div>
          )}

          {!loading && !err && rows.length > 0 && (
            <div className="h-[380px]">
              <Line data={chartData} options={chartOptions} />
              <div className="mt-2 text-[11px] text-gray-600 dark:text-gray-400">
                Points: {rows.length} • Unit: {unitLabel}
              </div>
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-black/10 dark:border-white/10 flex justify-end">
          <button
            onClick={onClose}
            className="text-sm rounded-md border border-black/10 dark:border-white/10 px-3 py-1 hover:bg-black/5 dark:hover:bg-white/10"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
