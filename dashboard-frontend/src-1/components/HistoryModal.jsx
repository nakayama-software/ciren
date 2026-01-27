// src/components/HistoryModal.jsx
import React, { useEffect, useState, useMemo } from "react";
import { X } from "lucide-react";
import {
    LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer,
} from "recharts";

const API_BASE = import.meta.env?.VITE_API_BASE || "";

export default function HistoryModal({
    open,
    onClose,
    raspiId,
    hubId,
    portId,
    sensorTypeHint,  // optional untuk judul awal
}) {
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState(null);
    const [rows, setRows] = useState([]);

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
                // contoh: range waktu (opsional)
                // url.searchParams.set("from", new Date(Date.now()-24*3600e3).toISOString())

                const r = await fetch(url.toString().replace(window.location.origin, ""));
                if (!r.ok) throw new Error(`HTTP ${r.status}`);
                const j = await r.json();
                if (abort) return;

                const data = (j.items || []).map(d => ({
                    ts: new Date(d.ts).getTime(),
                    time: new Date(d.ts).toLocaleString(),
                    value: typeof d.value === "number" ? d.value : Number(d.value) || null,
                    unit: d.unit || "",
                    sensor_type: d.sensor_type || sensorTypeHint || "",
                })).filter(x => x.value !== null);

                setRows(data);
            } catch (e) {
                if (!abort) setErr(e.message || String(e));
            } finally {
                if (!abort) setLoading(false);
            }
        }
        load();

        return () => { abort = true; };
    }, [open, raspiId, hubId, portId, sensorTypeHint]);

    const title = useMemo(() => {
        const st = rows[0]?.sensor_type || sensorTypeHint || "sensor";
        return `${hubId} • P${portId} — ${st}`;
    }, [rows, hubId, portId, sensorTypeHint]);

    if (!open) return null;

    return (
        <div className="fixed inset-0 z-[1000] bg-black/50 flex items-center justify-center p-4">
            <div className="w-full max-w-3xl rounded-2xl border border-black/10 bg-white dark:bg-slate-900 dark:border-white/10 shadow-xl">
                <div className="flex items-center justify-between px-4 py-3 border-b border-black/10 dark:border-white/10">
                    <div className="text-sm font-medium text-slate-900 dark:text-white">
                        {title}
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1 rounded-md hover:bg-black/5 dark:hover:bg-white/10"
                        aria-label="Close"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>

                <div className="p-4">
                    {loading && (
                        <div className="text-center text-sm text-gray-600 dark:text-gray-300">Loading…</div>
                    )}

                    {err && !loading && (
                        <div className="text-center text-sm text-red-600 dark:text-red-400">
                            {err}
                        </div>
                    )}

                    {!loading && !err && rows.length === 0 && (
                        <div className="text-center text-sm text-gray-600 dark:text-gray-300">
                            No data yet for this port.
                        </div>
                    )}

                    {!loading && !err && rows.length > 0 && (
                        <div className="h-[320px]">
                            <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={rows} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" />
                                    <XAxis dataKey="time" minTickGap={32} />
                                    <YAxis />
                                    <Tooltip />
                                    <Line type="monotone" dataKey="value" strokeWidth={2} dot={false} />
                                </LineChart>
                            </ResponsiveContainer>
                            <div className="mt-2 text-[11px] text-gray-600 dark:text-gray-400">
                                Points: {rows.length} • Unit: {rows[0]?.unit || "-"}
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
