import React from "react";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";

export default function LeafletMap({ gpsData }) {
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
          <b>Timestamp:</b> {new Date(gpsData.timestamp).toLocaleString("ja-JP")}
        </Popup>
      </Marker>
    </MapContainer>
  );
}
