// src/Dashboard.jsx
import React, { useEffect, useMemo, useState, useRef } from 'react';
import { resolveUsername, getDataForRaspi, API_BASE } from './lib/api';
import { io } from 'socket.io-client';
import HubDetail from './HubDetail';

const SOCKET_URL = import.meta.env.VITE_WS_URL || API_BASE;

function deriveHubsFromEntries(entries = []) {
  // entries: [{ raspi_serial_id, data:[ { sensor_controller_id, "port-1": "..." } ], received_ts }]
  const map = new Map();
  for (const e of entries) {
    if (!Array.isArray(e.data)) continue;
    for (const item of e.data) {
      const id = item.sensor_controller_id ?? item.sensor_controller_id === 0 ? item.sensor_controller_id : null;
      if (id == null) continue;
      const rec = map.get(id) || { id, lastTs: 0, lastEntry: null, nodeSet: new Set() };
      const ts = e.received_ts || item._received_ts || Date.now();
      if (ts > rec.lastTs) {
        rec.lastTs = ts;
        rec.lastEntry = item;
      }
      // collect node keys (port-1,...)
      for (const k of Object.keys(item)) {
        if (k.startsWith('port-')) rec.nodeSet.add(k);
      }
      map.set(id, rec);
    }
  }
  return Array.from(map.values()).map(r => ({
    id: r.id,
    lastTs: r.lastTs,
    lastEntry: r.lastEntry,
    nodes: Array.from(r.nodeSet).sort()
  }));
}

export default function Dashboard({ params }) {
  // params.username from router /ciren/:userID/dashboard
  const username = params?.userID || (window.__APP_USERNAME__ || 'alice');
  const [raspi, setRaspi] = useState(null);
  const [entries, setEntries] = useState([]);
  const [selectedHub, setSelectedHub] = useState(null);
  const socketRef = useRef(null);

  useEffect(() => {
    let mounted = true;
    resolveUsername(username)
      .then(res => {
        if (!mounted) return;
        const r = res.raspi_serial_id || res.raspi || res;
        setRaspi(r);
        return getDataForRaspi(r);
      })
      .then(data => {
        if (!mounted) return;
        // backend returns array of entries
        setEntries(data || []);
      })
      .catch(err => {
        console.error('load data error', err);
      });
    return () => { mounted = false; };
  }, [username]);

  // socket.io realtime
  useEffect(() => {
    if (!raspi) return;
    const socket = io(SOCKET_URL, { transports: ['websocket'] });
    socketRef.current = socket;
    // join room (if backend supports)
    socket.on('connect', () => {
      socket.emit('join-raspi', raspi);
    });
    socket.on('new-data', (entry) => {
      // entry shape: { raspi_serial_id, data: [ { sensor_controller_id, "port-1": "..."} ], received_ts }
      if (!entry) return;
      if (entry.raspi_serial_id && entry.raspi_serial_id !== raspi) return;
      // merge - keep bounded history length
      setEntries(prev => {
        const next = [...prev];
        next.push(entry);
        if (next.length > 500) next.shift();
        return next;
      });
    });
    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [raspi]);

  const hubs = useMemo(() => deriveHubsFromEntries(entries), [entries]);

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold mb-4">Dashboard — Hubs</h1>
      {!raspi ? (
        <div>Loading raspi ID...</div>
      ) : (
        <>
          <div className="mb-4 text-sm text-gray-600">Raspberry: <strong>{raspi}</strong></div>

          {!selectedHub ? (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {hubs.length === 0 && (
                  <div className="col-span-full p-6 bg-yellow-50 border rounded">No hubs found yet</div>
                )}
                {hubs.map(h => {
                  const ageS = Math.max(0, Math.floor((Date.now() - (h.lastTs || 0)) / 1000));
                  const online = ageS < 15; // treat online if last seen < 15s (tweakable)
                  return (
                    <div key={h.id} className="p-4 border rounded shadow-sm hover:shadow-md cursor-pointer"
                         onClick={() => setSelectedHub(h.id)}>
                      <div className="flex items-baseline justify-between">
                        <div>
                          <div className="text-lg font-medium">Hub {h.id}</div>
                          <div className="text-xs text-gray-500">Nodes: {h.nodes.length}</div>
                        </div>
                        <div className={`px-2 py-1 text-xs rounded ${online ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                          {online ? 'Online' : 'Offline'}
                        </div>
                      </div>
                      <div className="mt-3 text-sm text-gray-700">
                        Last: {h.lastTs ? new Date(h.lastTs).toLocaleString() : '—'}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-6 text-sm text-gray-500">
                Klik sebuah Hub untuk lihat node/sensor yang terhubung.
              </div>
            </>
          ) : (
            <HubDetail
              raspi={raspi}
              hubId={selectedHub}
              entries={entries}
              onBack={() => setSelectedHub(null)} />
          )}
        </>
      )}
    </div>
  );
}
s