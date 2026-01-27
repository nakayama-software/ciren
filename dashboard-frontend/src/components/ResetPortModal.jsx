// src/components/ResetPortModal.jsx
import React, { useState, useEffect } from 'react';
import { X, AlertTriangle, Trash2, Clock, Activity } from 'lucide-react';

const API_BASE = import.meta.env?.VITE_API_BASE || "";

export default function ResetPortModal({ 
  open, 
  onClose, 
  raspiId, 
  hubId, 
  portId,
  onSuccess 
}) {
  const [loading, setLoading] = useState(true);
  const [info, setInfo] = useState(null);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open) {
      fetchPortInfo();
    }
  }, [open, raspiId, hubId, portId]);

  async function fetchPortInfo() {
    try {
      setLoading(true);
      setError(null);
      
      // Call reset-port WITHOUT confirm to get info
      const res = await fetch(`${API_BASE}/api/reset-port`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          raspi_serial_id: raspiId,
          hub_id: hubId,
          port_id: portId,
          confirm: false  // Get info only
        })
      });

      const data = await res.json();
      
      if (data.requires_confirmation) {
        setInfo(data.current_sensor);
      } else if (data.success === false) {
        setError(data.message || 'No active sensor on this port');
      } else {
        setError('Unexpected response from server');
      }
    } catch (err) {
      setError(err.message || 'Failed to fetch port info');
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirmReset() {
    try {
      setResetting(true);
      setError(null);

      const res = await fetch(`${API_BASE}/api/reset-port`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          raspi_serial_id: raspiId,
          hub_id: hubId,
          port_id: portId,
          confirm: true  // Confirm deletion
        })
      });

      const data = await res.json();
      
      if (data.success) {
        onSuccess && onSuccess({
          newSensorId: data.newSensorId,
          deletedReadings: data.deleted_readings,
          stats: data.stats
        });
        onClose();
      } else {
        setError(data.message || 'Reset failed');
      }
    } catch (err) {
      setError(err.message || 'Failed to reset port');
    } finally {
      setResetting(false);
    }
  }

  if (!open) return null;

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div 
        className="relative w-full max-w-lg mx-4 rounded-2xl border border-black/10 bg-white 
                   dark:border-white/10 dark:bg-slate-800 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-black/10 dark:border-white/10">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-red-500/10">
              <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                Reset Port Confirmation
              </h2>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Hub {hubId} • Port P{portId}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5 text-gray-600 dark:text-gray-400" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {loading && (
            <div className="text-center py-8">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-500"></div>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-3">Loading port info...</p>
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-4">
              <p className="text-sm text-yellow-800 dark:text-yellow-200">{error}</p>
            </div>
          )}

          {!loading && !error && info && (
            <>
              {/* Current Sensor Info */}
              <div className="rounded-lg border border-black/10 bg-slate-50 dark:border-white/10 dark:bg-slate-900/50 p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-medium text-gray-600 dark:text-gray-400">
                    Current Sensor
                  </span>
                  <span className="px-2 py-1 rounded-full bg-green-500/20 text-green-600 dark:text-green-400 text-xs font-medium">
                    Active
                  </span>
                </div>
                <div className="space-y-2">
                  <div>
                    <span className="text-sm text-gray-600 dark:text-gray-400">Type: </span>
                    <span className="text-sm font-medium text-slate-900 dark:text-white capitalize">
                      {info.sensor_type.replace('_', ' ')}
                    </span>
                  </div>
                  <div>
                    <span className="text-sm text-gray-600 dark:text-gray-400">Started: </span>
                    <span className="text-sm font-medium text-slate-900 dark:text-white">
                      {new Date(info.started_at).toLocaleString()}
                    </span>
                  </div>
                </div>
              </div>

              {/* Statistics */}
              {info.stats && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg border border-black/10 bg-white dark:border-white/10 dark:bg-slate-800 p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Activity className="w-4 h-4 text-cyan-500" />
                      <span className="text-xs text-gray-600 dark:text-gray-400">Readings</span>
                    </div>
                    <div className="text-2xl font-bold text-slate-900 dark:text-white">
                      {info.total_readings.toLocaleString()}
                    </div>
                  </div>

                  <div className="rounded-lg border border-black/10 bg-white dark:border-white/10 dark:bg-slate-800 p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Clock className="w-4 h-4 text-indigo-500" />
                      <span className="text-xs text-gray-600 dark:text-gray-400">Duration</span>
                    </div>
                    <div className="text-2xl font-bold text-slate-900 dark:text-white">
                      {info.stats.duration_hours ? `${info.stats.duration_hours.toFixed(1)}h` : '—'}
                    </div>
                  </div>
                </div>
              )}

              {/* Warning */}
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4">
                <div className="flex items-start gap-3">
                  <Trash2 className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <h4 className="text-sm font-medium text-red-900 dark:text-red-200 mb-1">
                      Data Will Be Deleted
                    </h4>
                    <p className="text-sm text-red-800 dark:text-red-300">
                      All <strong>{info.total_readings.toLocaleString()} readings</strong> from this sensor will be permanently deleted.
                    </p>
                    <p className="text-sm text-red-800 dark:text-red-300 mt-2">
                      A summary with statistics will be kept for history.
                    </p>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-6 border-t border-black/10 dark:border-white/10">
          <button
            onClick={onClose}
            disabled={resetting}
            className="px-4 py-2 rounded-lg border border-black/10 bg-white hover:bg-black/5 
                     text-slate-900 dark:border-white/10 dark:bg-slate-800 dark:text-white 
                     dark:hover:bg-white/10 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirmReset}
            disabled={resetting || loading || error || !info}
            className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white 
                     transition-colors disabled:opacity-50 disabled:cursor-not-allowed
                     flex items-center gap-2"
          >
            {resetting ? (
              <>
                <div className="inline-block animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                <span>Resetting...</span>
              </>
            ) : (
              <>
                <Trash2 className="w-4 h-4" />
                <span>Delete & Reset</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}