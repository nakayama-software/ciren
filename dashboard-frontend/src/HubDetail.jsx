// src/HubDetail.jsx
import React, { useMemo } from 'react';

function extractLatestPorts(entries = [], hubId) {
  // returns map portKey -> { value, ts }
  const map = new Map();
  for (let i = entries.length - 1; i >= 0; --i) {
    const e = entries[i];
    if (!Array.isArray(e.data)) continue;
    for (const item of e.data) {
      if ((item.sensor_controller_id ?? item.sensor_controller) != hubId) continue;
      const ts = e.received_ts || item._received_ts || Date.now();
      for (const k of Object.keys(item)) {
        if (!k.startsWith('port-')) continue;
        if (!map.has(k)) {
          map.set(k, { value: item[k], ts });
        }
      }
    }
    // early out if we've found all 8 ports
    if (map.size >= 8) break;
  }
  return map;
}

export default function HubDetail({ raspi, hubId, entries, onBack }) {
  const portsMap = useMemo(() => extractLatestPorts(entries, hubId), [entries, hubId]);

  // ensure port order 1..8
  const ports = [];
  for (let i = 1; i <= 8; ++i) {
    const key = `port-${i}`;
    const p = portsMap.get(key) || null;
    ports.push({ key, value: p ? p.value : null, ts: p ? p.ts : null });
  }

  return (
    <div className="p-4 border rounded bg-white">
      <button className="mb-4 px-3 py-1 bg-gray-100 rounded" onClick={onBack}>← Back to hubs</button>
      <h2 className="text-xl font-semibold mb-2">Hub {hubId} — Nodes</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {ports.map(p => (
          <div key={p.key} className="p-3 border rounded">
            <div className="flex justify-between items-center">
              <div className="font-medium">{p.key.toUpperCase()}</div>
              <div className="text-sm text-gray-500">{p.ts ? new Date(p.ts).toLocaleTimeString() : '—'}</div>
            </div>
            <div className="mt-2 text-lg">
              {p.value ? p.value : <span className="text-gray-400">No data</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
