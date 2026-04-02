// src/components/LeafletMap.jsx
import React, { useEffect, useRef } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";

function makeDivIcon(color, size) {
  return new L.DivIcon({
    html: `<div style="
      width:${size}px;height:${size}px;border-radius:50%;
      background:${color};border:3px solid white;
      box-shadow:0 2px 8px rgba(0,0,0,0.45);
      box-sizing:border-box;
    "></div>`,
    className: "",
    iconSize:    [size, size],
    iconAnchor:  [size / 2, size / 2],
    popupAnchor: [0, -(size / 2 + 6)],
  });
}

const ICON_SELECTED = makeDivIcon("#06b6d4", 26);
const ICON_DEFAULT  = makeDivIcon("#64748b", 18);

function FitBounds({ positions }) {
  const map          = useMap();
  const prevCountRef = useRef(0);

  useEffect(() => {
    if (positions.length === 0) return;
    if (positions.length === prevCountRef.current) return;
    prevCountRef.current = positions.length;

    if (positions.length === 1) {
      map.setView(positions[0], Math.max(map.getZoom(), 15));
    } else {
      try {
        map.fitBounds(L.latLngBounds(positions), { padding: [60, 60], maxZoom: 16 });
      } catch (_) {}
    }
  }, [positions.length]); // eslint-disable-line

  return null;
}

export default function LeafletMap({ raspis = [], selectedRaspiId, onSelectRaspi }) {
  const validRaspis = raspis.filter(
    (r) => r.gps_data?.latitude != null && r.gps_data?.longitude != null
  );

  if (validRaspis.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500 dark:text-gray-400">
        Waiting for GPS data…
      </div>
    );
  }

  const positions     = validRaspis.map((r) => [r.gps_data.latitude, r.gps_data.longitude]);
  const defaultCenter = positions[0];

  return (
    <div className="relative w-full h-full">
      <MapContainer
        center={defaultCenter}
        zoom={15}
        className="w-full h-full rounded-xl"
        style={{ zIndex: 0 }}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        />
        <FitBounds positions={positions} />

        {validRaspis.map((raspi) => {
          const { latitude, longitude } = raspi.gps_data;
          const id         = raspi.raspberry_serial_id;
          const isSelected = id === selectedRaspiId;
          const ctrlCount  = raspi.sensor_controllers?.length ?? 0;
          const nodeCount  = raspi.sensor_controllers?.reduce(
            (sum, ctrl) => sum + (ctrl.sensor_datas?.length ?? 0), 0
          ) ?? 0;
          const temp = raspi.temperature;

          return (
            <Marker
              key={id}
              position={[latitude, longitude]}
              icon={isSelected ? ICON_SELECTED : ICON_DEFAULT}
              zIndexOffset={isSelected ? 1000 : 0}
              eventHandlers={{ click: () => onSelectRaspi?.(id) }}
            >
              <Popup>
                <div style={{ minWidth: "190px", fontFamily: "system-ui, sans-serif", lineHeight: "1" }}>
                  <div style={{
                    fontWeight: "700", fontSize: "13px",
                    color: isSelected ? "#0891b2" : "#334155",
                    marginBottom: "8px", paddingBottom: "6px",
                    borderBottom: "1px solid #e2e8f0",
                  }}>
                    {id}
                    {isSelected && (
                      <span style={{
                        marginLeft: "6px", fontSize: "10px", fontWeight: "500",
                        color: "#0891b2", background: "#ecfeff",
                        padding: "1px 6px", borderRadius: "9999px",
                        border: "1px solid #a5f3fc",
                      }}>selected</span>
                    )}
                  </div>
                  <div style={{ fontSize: "12px", color: "#475569", lineHeight: "2" }}>
                    <div>Controllers: <b style={{ color: "#0f172a" }}>{ctrlCount}</b></div>
                    <div>Sensor ports: <b style={{ color: "#0f172a" }}>{nodeCount}</b></div>
                    <div>Raspi temp: <b style={{ color: "#0f172a" }}>{temp != null ? `${temp.toFixed(1)} °C` : "—"}</b></div>
                    <div style={{ color: "#94a3b8", fontSize: "11px", marginTop: "2px" }}>
                      {latitude.toFixed(5)}, {longitude.toFixed(5)}
                    </div>
                  </div>
                  {!isSelected && (
                    <button
                      onClick={() => onSelectRaspi?.(id)}
                      style={{
                        marginTop: "10px", width: "100%",
                        background: "#0e7490", color: "white",
                        border: "none", borderRadius: "6px",
                        padding: "6px 10px", cursor: "pointer",
                        fontSize: "12px", fontWeight: "500",
                      }}
                    >
                      View controllers →
                    </button>
                  )}
                  {isSelected && (
                    <div style={{ marginTop: "10px", textAlign: "center", fontSize: "11px", color: "#0891b2", fontWeight: "500" }}>
                      ✓ Currently selected
                    </div>
                  )}
                </div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>
    </div>
  );
}