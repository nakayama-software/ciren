// src/components/SensorRenderer.jsx
import React, { useState } from "react";
import HistoryModal from "./HistoryModal";

const API_BASE = import.meta.env?.VITE_API_BASE || "";

export default function SensorRenderer({
  node,           // { node_id: 'P1', sensor_type, value, unit, status? }
  hubId,          // string, id hub (sensor_controller_id)
  raspiId,        // string, raspi_serial_id
  onReset,        // optional callback setelah reset sukses
}) {
  const [resetting, setResetting] = useState(false);
  const [openModal, setOpenModal] = useState(false);
  const portId = Number(String(node?.node_id || "").replace(/^P/i, "")) || null;

  async function handleReset(e) {
    e.stopPropagation(); // penting: jangan buka modal saat klik reset
    if (!raspiId || !hubId || !portId) {
      alert("Parameter reset tidak lengkap (raspiId / hubId / portId).");
      return;
    }
    const ok = confirm(
      `Reset data untuk ${hubId} • Port ${portId}?\nSemua histori di port ini akan dihapus dan sensor_id baru akan dibuat.`
    );
    if (!ok) return;

    try {
      setResetting(true);
      const res = await fetch(`${API_BASE}/api/reset-port`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ raspi_serial_id: raspiId, hub_id: hubId, port_id: portId }),
      });

      let data = null;
      try { data = await res.json(); } catch {}

      if (!res.ok || !data?.success) {
        const msg = data?.error || data?.message || "Reset gagal.";
        alert(msg);
        return;
      }
      alert(`Reset berhasil. SensorID baru: ${data.newSensorId}`);
      onReset && onReset({ hubId, portId, newSensorId: data.newSensorId });
    } catch (e) {
      console.error(e);
      alert("Gagal terhubung ke server.");
    } finally {
      setResetting(false);
    }
  }

  return (
    <>
      <div
        role="button"
        onClick={() => setOpenModal(true)}
        className="rounded-xl border border-black/10 bg-white/70 p-4 dark:border-white/10 dark:bg-slate-800/60 shadow-sm hover:border-black/20 dark:hover:border-white/30 transition-colors cursor-pointer"
      >
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs font-medium text-gray-600 dark:text-gray-400">
            {node.node_id}
          </div>
          <div className="flex items-center gap-2">
            <div className="text-xs text-green-600 dark:text-green-400">
              {node.status}
            </div>
            <button
              type="button"
              onClick={handleReset}
              disabled={resetting}
              className={`text-[11px] rounded-md border px-2 py-1 
                ${resetting
                  ? "opacity-60 cursor-not-allowed"
                  : "hover:bg-black/5 dark:hover:bg-white/10"}
                border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-200`}
              title="Reset histori port ini"
            >
              {resetting ? "Resetting..." : "Reset"}
            </button>
          </div>
        </div>

        <div className="text-sm text-gray-700 dark:text-gray-300 mb-1">
          {node.sensor_type}
        </div>

        <div className="text-2xl font-semibold text-slate-900 dark:text-white">
          {typeof node.value === "number" ? node.value.toFixed(1) : node.value}
          <span className="text-base ml-1 text-gray-600 dark:text-gray-400">
            {node.unit}
          </span>
        </div>

        <div className="mt-2 text-[11px] text-gray-500 dark:text-gray-400">
          Klik kartu untuk melihat grafik historis.
        </div>
      </div>

      <HistoryModal
        open={openModal}
        onClose={() => setOpenModal(false)}
        raspiId={raspiId}
        hubId={hubId}
        portId={portId}
        sensorTypeHint={node.sensor_type}
      />
    </>
  );
}
