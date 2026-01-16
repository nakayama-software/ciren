import React, { useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";

const GPS_TIMEOUT_MS = 15000; // 15 detik

export default function LeafletMap({ gpsData }) {

  if (!gpsData) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500">
        Waiting for GPS data...
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
        className="w-full h-full rounded-xl z-2"
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
    </div>
  );
}
