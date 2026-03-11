import React, { useMemo } from "react";
import { Zap } from "lucide-react";

function toNum(v) {
    const n = typeof v === "number" ? v : parseFloat(String(v ?? "").trim());
    return Number.isFinite(n) ? n : null;
}

function fmt(n, digits = 3) {
    if (n === null) return "--";
    return n.toFixed(digits);
}

function MetricTile({ icon, label, value, unit, accent }) {
    const accentCls =
        accent === "yellow"
            ? "bg-yellow-400/10 border-yellow-300/30"
            : "bg-slate-100 dark:bg-white/5 border-slate-200 dark:border-white/10";
    return (
        <div className="rounded-xl bg-slate-100/80 dark:bg-black/20 border border-slate-200 dark:border-white/10 p-3">
            <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                    <span className={`inline-flex items-center justify-center rounded-full border px-2.5 py-1 ${accentCls}`}>
                        {icon}
                    </span>
                    <span className="text-[11px] text-slate-500 dark:text-gray-400 font-medium truncate">{label}</span>
                </div>
                <div className="text-right">
                    <p className="text-lg font-mono text-slate-900 dark:text-white tabular-nums leading-none">{value}</p>
                    <p className="text-[11px] text-slate-400 dark:text-gray-500 mt-1">{unit}</p>
                </div>
            </div>
        </div>
    );
}

export default function VoltageCard({ node, variant = "embedded", maxVoltage = 5 }) {
    const { voltage, unit } = useMemo(() => {
        const readings = Array.isArray(node?.readings) ? node.readings : [];
        const r = readings.find((x) =>
            ["voltage", "volt", "v", "value"].includes(String(x?.key || "").toLowerCase())
        );
        let v = toNum(r?.value);
        if (v === null) v = toNum(node?.value);
        return { voltage: v, unit: r?.unit || node?.unit || "V" };
    }, [node]);

    const pct = useMemo(() => {
        if (voltage === null) return 0;
        return Math.min(100, Math.max(0, (voltage / Math.max(1, maxVoltage)) * 100));
    }, [voltage, maxVoltage]);

    // voltage level color
    const barColor =
        pct > 80 ? "bg-red-400" : pct > 50 ? "bg-yellow-400" : "bg-yellow-500";

    if (variant === "embedded") {
        return (
            <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 p-4 hover:bg-slate-100 dark:hover:bg-white/10 transition">
                <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                        <div className="rounded-lg bg-yellow-500/10 border border-yellow-400/20 p-2">
                            <Zap className="w-5 h-5 text-yellow-500 dark:text-yellow-300" />
                        </div>
                        <div className="min-w-0">
                            <div className="flex items-center gap-2">
                                <p className="font-semibold text-slate-900 dark:text-white">Voltage</p>
                                <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-gray-300">
                                    {node?.node_id ?? "-"}
                                </span>
                            </div>
                            <p className="text-[11px] text-slate-500 dark:text-gray-400 mt-0.5">Power sensor</p>
                        </div>
                    </div>
                    <div className="text-right">
                        <p className="text-xs text-slate-400 dark:text-gray-400">Max</p>
                        <p className="text-sm font-mono text-slate-600 dark:text-gray-200 tabular-nums">
                            {maxVoltage} {unit}
                        </p>
                    </div>
                </div>

                <div className="mt-4 space-y-3">
                    <MetricTile
                        icon={<Zap className="w-4 h-4 text-yellow-500 dark:text-yellow-300" />}
                        label="Voltage"
                        value={fmt(voltage, 3)}
                        unit={unit}
                        accent="yellow"
                    />
                    <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-slate-100/80 dark:bg-black/20 p-3">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-[11px] text-slate-500 dark:text-gray-400 font-medium">Level</span>
                            <span className="text-[11px] text-slate-700 dark:text-gray-300 font-mono tabular-nums">
                                {voltage === null ? "--" : `${pct.toFixed(0)}%`}
                            </span>
                        </div>
                        <div className="w-full bg-slate-200 dark:bg-white/10 rounded-full h-2 overflow-hidden">
                            <div
                                className={`${barColor} h-2 rounded-full transition-[width] duration-300`}
                                style={{ width: `${pct}%` }}
                            />
                        </div>
                        <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400 dark:text-gray-500 font-mono tabular-nums">
                            <span>0</span>
                            <span>{maxVoltage} {unit}</span>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 p-4 hover:bg-slate-100 dark:hover:bg-white/10 transition">
            <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                    <Zap className="w-5 h-5 text-yellow-500 dark:text-yellow-300" />
                    <div className="min-w-0">
                        <p className="font-semibold text-slate-900 dark:text-white">Voltage</p>
                        <p className="text-xs text-slate-500 dark:text-gray-400 truncate">{node?.node_id ?? "-"}</p>
                    </div>
                </div>
                <div className="text-right">
                    <p className="text-2xl font-mono text-slate-900 dark:text-white tabular-nums leading-none">
                        {fmt(voltage, 3)}
                    </p>
                    <p className="text-[11px] text-slate-400 dark:text-gray-500 mt-1">{unit}</p>
                </div>
            </div>
            <div className="mt-3 w-full bg-slate-200 dark:bg-white/10 rounded-full h-2 overflow-hidden">
                <div className={`${barColor} h-2 rounded-full transition-[width] duration-300`} style={{ width: `${pct}%` }} />
            </div>
        </div>
    );
}