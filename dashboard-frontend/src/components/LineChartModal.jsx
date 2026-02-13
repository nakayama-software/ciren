// src/components/HistoryModal.jsx
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
import { socket } from "../lib/socket";

ChartJS.register(LinearScale, PointElement, LineElement, Tooltip, Legend, Filler);

const API_BASE = import.meta.env?.VITE_API_BASE || "";

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

  // initial fetch
  useEffect(() => {
    if (!open) return;
    let abort = false;

    async function load() {
      setLoading(true);
      setErr(null);

      try {
        const url = new URL(`${API_BASE}/api/port-history`, window.location.origin);
        url.searchParams.set("raspi_serial_id", raspiId);
        url.searchParams.set("hub_id", hubId);
        url.searchParams.set("port_id", String(portId));
        url.searchParams.set("limit", "2000");

        const r = await fetch(url.toString().replace(window.location.origin, ""));
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        if (abort) return;

        const items = Array.isArray(j.items) ? j.items : [];

        const mapped = items
          .map((d) => {
            const tsMs = new Date(d.ts).getTime();
            const sensor_type = String(d.sensor_type || sensorTypeHint || "").toLowerCase();

            if (sensor_type === "hum_temp") {
              const { temp, hum, tempUnit, humUnit } = parseHumTemp(d);
              return { ts: tsMs, sensor_type, temp, hum, tempUnit, humUnit, sensor_id: d.sensor_id };
            }

            const value = toNum(d.value);
            return { ts: tsMs, sensor_type, value, unit: d.unit || "", sensor_id: d.sensor_id };
          })
          .filter((x) => (x.sensor_type === "hum_temp" ? x.temp !== null || x.hum !== null : x.value !== null))
          .sort((a, b) => a.ts - b.ts);

        setRows(mapped);
      } catch (e) {
        if (!abort) setErr(e.message || String(e));
      } finally {
        if (!abort) setLoading(false);
      }
    }

    load();
    return () => {
      abort = true;
    };
  }, [open, raspiId, hubId, portId, sensorTypeHint]);

  // realtime append (tanpa refetch)
  useEffect(() => {
    if (!open) return;

    const handler = (p) => {
      if (!p) return;
      if (String(p.raspi_serial_id || "").toLowerCase() !== String(raspiId || "").toLowerCase()) return;
      if (String(p.hub_id || "") !== String(hubId || "")) return;
      if (Number(p.port_id) !== Number(portId)) return;

      const sensor_type = String(p.sensor_type || sensorTypeHint || "").toLowerCase();
      const tsMs = p.ts ? new Date(p.ts).getTime() : Date.now();

      let nextRow;
      if (sensor_type === "hum_temp") {
        const { temp, hum, tempUnit, humUnit } = parseHumTemp(p);
        if (temp === null && hum === null) return;
        nextRow = { ts: tsMs, sensor_type, temp, hum, tempUnit, humUnit, sensor_id: p.sensor_id };
      } else {
        const value = toNum(p.value);
        if (value === null) return;
        nextRow = { ts: tsMs, sensor_type, value, unit: p.unit || "", sensor_id: p.sensor_id };
      }

      setRows((prev) => {
        const key = `${p.sensor_id || ""}-${tsMs}`;
        const exists = prev.some((x) => `${x.sensor_id || ""}-${x.ts}` === key);
        if (exists) return prev;

        const merged = [...prev, nextRow].sort((a, b) => a.ts - b.ts);
        if (merged.length > 2000) return merged.slice(merged.length - 2000);
        return merged;
      });
    };

    socket.on("node-sample", handler);
    return () => socket.off("node-sample", handler);
  }, [open, raspiId, hubId, portId, sensorTypeHint]);

  const isHumTemp = useMemo(() => {
    const st = String(rows[0]?.sensor_type || sensorTypeHint || "").toLowerCase();
    return st === "hum_temp";
  }, [rows, sensorTypeHint]);

  const title = useMemo(() => {
    const st = rows[0]?.sensor_type || sensorTypeHint || "sensor";
    return `${hubId} • P${portId} — ${st}`;
  }, [rows, hubId, portId, sensorTypeHint]);

  const unitLabel = useMemo(() => {
    if (!rows.length) return "-";
    if (isHumTemp) return "°C / %";
    return rows[0]?.unit || "-";
  }, [rows, isHumTemp]);

  // Chart.js data (klik legend otomatis hide/show dataset)
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
      animation: false, // penting: biar update point gak terasa "reload"
      parsing: false,   // karena pakai {x,y}
      normalized: true,
      interaction: { mode: "nearest", intersect: false },
      plugins: {
        legend: {
          display: true,
          position: "top",
          // Chart.js default: klik legend => hide/show dataset ✅
        },
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
          ticks: {
            callback: (value) => fmtTick(Number(value)),
            maxTicksLimit: 8,
          },
          grid: { display: true },
        },
        y: {
          ticks: {
            callback: (v) => String(v),
          },
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
            <div className="text-center text-sm text-gray-600 dark:text-gray-300">
              No data yet for this port.
            </div>
          )}

          {!loading && !err && rows.length > 0 && (
            <div className="h-[380px]">
              <Line data={chartData} options={chartOptions} />
              <div className="mt-2 text-[11px] text-gray-600 dark:text-gray-400">
                Points: {rows.length} • Unit: {unitLabel} • (Klik legend untuk hide/show)
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
