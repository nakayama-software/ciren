// src/components/PortHistoryModal.jsx
import React, { useState, useEffect } from 'react';
import { X, Clock, Activity, TrendingUp, TrendingDown, Calendar, Archive } from 'lucide-react';

const API_BASE = import.meta.env?.VITE_API_BASE || "";

export default function PortHistoryModal({ 
  open, 
  onClose, 
  raspiId, 
  hubId, 
  portId 
}) {
  const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open) {
      fetchHistory();
    }
  }, [open, raspiId, hubId, portId]);

  async function fetchHistory() {
    try {
      setLoading(true);
      setError(null);

      const res = await fetch(
        `${API_BASE}/api/port-history/${raspiId}/${hubId}/${portId}`
      );

      if (!res.ok) throw new Error('Failed to fetch history');

      const data = await res.json();
      setHistory(data);
    } catch (err) {
      setError(err.message || 'Failed to load history');
    } finally {
      setLoading(false);
    }
  }

  if (!open) return null;

  const formatDuration = (hours) => {
    if (!hours) return '—';
    if (hours < 1) return `${Math.round(hours * 60)}m`;
    if (hours < 24) return `${hours.toFixed(1)}h`;
    return `${Math.round(hours / 24)}d`;
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '—';
    const date = new Date(dateStr);
    return date.toLocaleString('en-US', { 
      month: 'short', 
      day: 'numeric', 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  };

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div 
        className="relative w-full max-w-3xl max-h-[90vh] overflow-hidden rounded-2xl border 
                   border-black/10 bg-white dark:border-white/10 dark:bg-slate-800 shadow-2xl
                   flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-black/10 dark:border-white/10 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-indigo-500/10">
              <Calendar className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                Port History
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
        <div className="flex-1 overflow-y-auto p-6">
          {loading && (
            <div className="text-center py-12">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-500"></div>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-3">Loading history...</p>
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4">
              <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
            </div>
          )}

          {!loading && !error && history && (
            <div className="space-y-6">
              {/* Current Session */}
              {history.current_session && (
                <div>
                  <h3 className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-3 uppercase tracking-wide">
                    Current Session
                  </h3>
                  <SessionCard session={history.current_session} isCurrent={true} />
                </div>
              )}

              {/* Archived Sessions */}
              {history.archived_sessions && history.archived_sessions.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-3 uppercase tracking-wide flex items-center gap-2">
                    <Archive className="w-4 h-4" />
                    Archived Sessions ({history.archived_sessions.length})
                  </h3>
                  <div className="space-y-3">
                    {history.archived_sessions.map((session, idx) => (
                      <SessionCard key={idx} session={session} isCurrent={false} />
                    ))}
                  </div>
                </div>
              )}

              {/* Empty State */}
              {!history.current_session && (!history.archived_sessions || history.archived_sessions.length === 0) && (
                <div className="text-center py-12">
                  <Archive className="w-12 h-12 mx-auto text-gray-400 dark:text-gray-600 mb-3" />
                  <p className="text-gray-600 dark:text-gray-400">No history available for this port</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SessionCard({ session, isCurrent }) {
  const stats = session.stats || {};
  const duration = formatDuration(stats.duration_hours);
  const totalReadings = stats.total_readings || 0;

  return (
    <div className={`rounded-xl border p-4 ${
      isCurrent 
        ? 'border-green-500/30 bg-green-500/10' 
        : 'border-black/10 bg-slate-50 dark:border-white/10 dark:bg-slate-900/50'
    }`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="text-lg font-semibold text-slate-900 dark:text-white capitalize">
            {session.sensor_type.replace('_', ' ')}
          </div>
          {isCurrent && (
            <span className="px-2 py-1 rounded-full bg-green-500/20 text-green-600 dark:text-green-400 text-xs font-medium">
              Active
            </span>
          )}
          {!isCurrent && session.deletion_reason && (
            <span className="px-2 py-1 rounded-full bg-gray-500/20 text-gray-600 dark:text-gray-400 text-xs font-medium">
              {session.deletion_reason === 'sensor_changed' ? 'Sensor Changed' : 
               session.deletion_reason === 'user_reset' ? 'User Reset' : 
               'Auto Cleanup'}
            </span>
          )}
        </div>
      </div>

      {/* Time Range */}
      <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 mb-3">
        <Clock className="w-4 h-4" />
        <span>
          {formatDate(session.started_at)}
          {session.ended_at && ` → ${formatDate(session.ended_at)}`}
          {isCurrent && ' → now'}
        </span>
      </div>

      {/* Statistics Grid */}
      {(totalReadings > 0 || duration !== '—') && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-4">
          {totalReadings > 0 && (
            <StatBox 
              icon={<Activity className="w-4 h-4" />}
              label="Readings"
              value={totalReadings.toLocaleString()}
              color="text-cyan-600 dark:text-cyan-400"
            />
          )}
          {duration !== '—' && (
            <StatBox 
              icon={<Clock className="w-4 h-4" />}
              label="Duration"
              value={duration}
              color="text-indigo-600 dark:text-indigo-400"
            />
          )}
          
          {/* Show average values if available */}
          {Object.keys(stats).filter(k => k.startsWith('avg_')).map((key, idx) => {
            const value = stats[key];
            const label = key.replace('avg_', '').replace('_', ' ');
            return (
              <StatBox 
                key={idx}
                icon={<TrendingUp className="w-4 h-4" />}
                label={`Avg ${label}`}
                value={typeof value === 'number' ? value.toFixed(2) : value}
                color="text-green-600 dark:text-green-400"
              />
            );
          })}
        </div>
      )}

      {/* Data Deleted Notice */}
      {!isCurrent && (
        <div className="mt-3 text-xs text-gray-500 dark:text-gray-500 italic">
          Raw data has been deleted. Only summary is kept.
        </div>
      )}
    </div>
  );
}

function StatBox({ icon, label, value, color }) {
  return (
    <div className="rounded-lg border border-black/10 bg-white dark:border-white/10 dark:bg-slate-800 p-3">
      <div className={`flex items-center gap-2 mb-1 ${color}`}>
        {icon}
        <span className="text-xs text-gray-600 dark:text-gray-400">{label}</span>
      </div>
      <div className="text-lg font-bold text-slate-900 dark:text-white">
        {value}
      </div>
    </div>
  );
}

function formatDuration(hours) {
  if (!hours) return '—';
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 24) return `${hours.toFixed(1)}h`;
  return `${Math.round(hours / 24)}d`;
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const date = new Date(dateStr);
  return date.toLocaleString('en-US', { 
    month: 'short', 
    day: 'numeric', 
    hour: '2-digit', 
    minute: '2-digit' 
  });
}