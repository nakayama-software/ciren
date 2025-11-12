import React, { useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";

const GPS_TIMEOUT_MS = 15000; // 15 detik

export default function LeafletMap({ gpsData }) {
  const [gpsDisconnected, setGpsDisconnected] = useState(false);

  useEffect(() => {
    if (!gpsData) {
      setGpsDisconnected(true);
      return;
    }

    const checkConnection = () => {
      const ts = new Date(gpsData.timestamp).getTime();
      const now = Date.now();
      setGpsDisconnected(now - ts > GPS_TIMEOUT_MS);
    };

    checkConnection(); // periksa langsung saat data masuk
    const timer = setInterval(checkConnection, 1000); // periksa setiap detik
    return () => clearInterval(timer);
  }, [gpsData]);

  if (!gpsData) {
    return (
      <div className="w-full h-full flex items-center justify-center text-gray-500">
        No GPS data available
      </div>
    );
  }

  const markerIcon = new L.Icon({
    iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
    shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
    iconSize: [25, 41],
    iconAnchor: [12, 41],
  });

  return (
    <div className="relative w-full h-full">
      <MapContainer
        center={[gpsData.lat, gpsData.lon]}
        zoom={15}
        className="w-full h-full rounded-xl"
      >
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <Marker position={[gpsData.lat, gpsData.lon]} icon={markerIcon}>
          <Popup>
            <b>Raspberry ID:</b> {gpsData.raspi_serial_id} <br />
            <b>Speed:</b> {gpsData.speed_kmh} km/h <br />
            <b>Altitude:</b> {gpsData.altitude_m} m <br />
            <b>Timestamp:</b>{" "}
            {new Date(gpsData.timestamp).toLocaleString("ja-JP")}
          </Popup>
        </Marker>
      </MapContainer>

      {/* ✅ Overlay selalu re-render karena berada di luar MapContainer */}
      {gpsDisconnected && (
        <div className="absolute bottom-3 right-3 bg-red-600 text-white text-xs font-medium px-3 py-2 rounded-lg shadow-lg animate-pulse transition-opacity duration-300">
          GPS not connected
        </div>
      )}
    </div>
  );
}
