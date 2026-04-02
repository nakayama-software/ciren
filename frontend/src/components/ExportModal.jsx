import React, { useState } from "react";
import { X, Download, FileText, FileJson, Loader2 } from "lucide-react";

const API_BASE = (import.meta.env?.VITE_API_BASE || "").replace(/\/+$/, "");

async function fetchReadings(raspiId, hubId, port, sensorType, limit) {
  const params = new URLSearchParams({
    raspberry_serial_id: String(raspiId).toLowerCase(),
    module_id: String(hubId),
    sensor_type: String(sensorType),
    port_number: String(port),
    limit: String(limit),
    skip: "0",
  });
  const res = await fetch(`${API_BASE}/api/sensor-readings?${params}`);
  if (!res.ok) throw new Error(`HTTP ${res.status} for port ${port} (${sensorType})`);
  const data = await res.json();
  return Array.isArray(data.items) ? data.items : [];
}

function toCSV(rows) {
  const headers = ["timestamp", "sensor_type", "port", "value"];
  const lines = [
    headers.join(","),
    ...rows.map((r) =>
      [
        r.timestamp_server || r.timestamp_device || "",
        r.sensor_type || "",
        r.port_number ?? "",
        `"${String(r.value ?? "").replace(/"/g, '""')}"`,
      ].join(",")
    ),
  ];
  return lines.join("\n");
}

function triggerDownload(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const LIMITS = [
  { label: "100", value: 100 },
  { label: "500", value: 500 },
  { label: "1 000", value: 1000 },
  { label: "2 000", value: 2000 },
];

export default function ExportModal({ open, onClose, raspiId, hubId, sensor_nodes_filtered }) {
  const [selected, setSelected] = useState(new Set());
  const [format, setFormat] = useState("csv");
  const [limit, setLimit] = useState(500);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState(null); // { type: "ok"|"error", msg }

  if (!open) return null;

  const allKey = (n) => `${n.port_number}-${n.sensor_type}`;
  const allSelected = selected.size === sensor_nodes_filtered.length && sensor_nodes_filtered.length > 0;

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(sensor_nodes_filtered.map(allKey)));
  };

  const toggle = (n) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const k = allKey(n);
      next.has(k) ? next.delete(k) : next.add(k);
      return next;
    });
  };

  const handleExport = async () => {
    if (selected.size === 0 || loading) return;
    setLoading(true);
    setStatus(null);
    try {
      const targets = sensor_nodes_filtered.filter((n) => selected.has(allKey(n)));
      let allRows = [];
      for (const node of targets) {
        const rows = await fetchReadings(raspiId, hubId, node.port_number, node.sensor_type, limit);
        allRows = allRows.concat(rows);
      }
      allRows.sort((a, b) => {
        const ta = new Date(a.timestamp_server || a.timestamp_device || 0).getTime();
        const tb = new Date(b.timestamp_server || b.timestamp_device || 0).getTime();
        return ta - tb;
      });

      const ts = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
      if (format === "csv") {
        triggerDownload(toCSV(allRows), `sensor-data-${ts}.csv`, "text/csv");
      } else {
        triggerDownload(JSON.stringify(allRows, null, 2), `sensor-data-${ts}.json`, "application/json");
      }
      setStatus({ type: "ok", msg: `Downloaded ${allRows.length} readings.` });
    } catch (e) {
      setStatus({ type: "error", msg: e.message || "Export failed." });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md flex flex-col rounded-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-black/10 dark:border-white/10 bg-white dark:bg-slate-800/80">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Export Sensor Data</h2>
            <p className="text-sm text-slate-500 dark:text-gray-400">Download readings history</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5 text-slate-500 dark:text-gray-400" />
          </button>
        </div>

        <div className="p-6 space-y-5 overflow-y-auto max-h-[65vh]">
          {/* Sensor selection */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Sensors</p>
              <button
                onClick={toggleAll}
                className="text-xs text-cyan-600 dark:text-cyan-400 hover:underline"
              >
                {allSelected ? "Deselect all" : "Select all"}
              </button>
            </div>
            <div className="space-y-1.5">
              {sensor_nodes_filtered.map((node) => {
                const k = allKey(node);
                const checked = selected.has(k);
                return (
                  <label
                    key={k}
                    className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 cursor-pointer transition-colors ${
                      checked
                        ? "border-cyan-500/40 bg-cyan-500/8 dark:bg-cyan-500/10"
                        : "border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/5"
                    }`}
                  >
                    <div
                      className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
                        checked ? "bg-cyan-500 border-cyan-500" : "border-slate-300 dark:border-gray-500"
                      }`}
                      onClick={() => toggle(node)}
                    >
                      {checked && <span className="text-white text-[10px] font-bold leading-none">✓</span>}
                    </div>
                    <span
                      className="text-sm text-slate-900 dark:text-white select-none flex-1"
                      onClick={() => toggle(node)}
                    >
                      P{node.port_number}
                      <span className="mx-1.5 text-slate-300 dark:text-slate-600">—</span>
                      <span className="text-slate-500 dark:text-gray-400">
                        {node.sensor_type.replace(/_/g, " ")}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Readings limit */}
          <div>
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
              Readings per sensor
            </p>
            <div className="grid grid-cols-4 gap-2">
              {LIMITS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setLimit(opt.value)}
                  className={`py-1.5 rounded-lg border text-sm font-medium transition-colors ${
                    limit === opt.value
                      ? "border-cyan-500 bg-cyan-500/10 text-cyan-600 dark:text-cyan-400"
                      : "border-slate-200 dark:border-white/10 text-slate-600 dark:text-gray-300 hover:bg-slate-100 dark:hover:bg-white/5"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Format */}
          <div>
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Format</p>
            <div className="grid grid-cols-2 gap-3">
              {[
                { id: "csv",  Icon: FileText, label: "CSV",  sub: "Excel / spreadsheet" },
                { id: "json", Icon: FileJson, label: "JSON", sub: "Developer friendly" },
              ].map(({ id, Icon, label, sub }) => (
                <button
                  key={id}
                  onClick={() => setFormat(id)}
                  className={`flex items-center gap-3 rounded-xl border px-4 py-3 transition-colors text-left ${
                    format === id
                      ? "border-cyan-500/50 bg-cyan-500/10"
                      : "border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 hover:bg-slate-100 dark:hover:bg-white/8"
                  }`}
                >
                  <Icon
                    className={`w-5 h-5 flex-shrink-0 ${
                      format === id ? "text-cyan-600 dark:text-cyan-400" : "text-slate-400"
                    }`}
                  />
                  <div>
                    <p
                      className={`text-sm font-semibold ${
                        format === id
                          ? "text-cyan-700 dark:text-cyan-300"
                          : "text-slate-700 dark:text-slate-300"
                      }`}
                    >
                      {label}
                    </p>
                    <p className="text-[11px] text-slate-400 dark:text-gray-500">{sub}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Status */}
          {status && (
            <div
              className={`rounded-lg border px-3 py-2 text-sm ${
                status.type === "ok"
                  ? "border-green-300 dark:border-green-500/30 bg-green-50 dark:bg-green-500/10 text-green-700 dark:text-green-400"
                  : "border-red-300 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400"
              }`}
            >
              {status.type === "ok" ? "✓ " : "✕ "}{status.msg}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-black/10 dark:border-white/10 flex items-center justify-between gap-3">
          <p className="text-xs text-slate-400 dark:text-gray-500">
            {selected.size > 0
              ? `${selected.size} sensor${selected.size > 1 ? "s" : ""} × max ${limit} = up to ${selected.size * limit} rows`
              : "No sensors selected"}
          </p>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-slate-200 dark:border-white/10 text-sm text-slate-700 dark:text-gray-300 hover:bg-slate-100 dark:hover:bg-white/10"
            >
              Close
            </button>
            <button
              onClick={handleExport}
              disabled={selected.size === 0 || loading}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors"
            >
              {loading
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Exporting…</>
                : <><Download className="w-4 h-4" /> Export</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}