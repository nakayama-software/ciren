# CIREN Dashboard (Frontend)

React-based real-time dashboard for the CIREN IoT monitoring system.

## Stack

- **Framework:** React 19 + Vite
- **Styling:** Tailwind CSS 4
- **Charts:** Chart.js + react-chartjs-2, Recharts
- **3D Visualization:** Three.js + @react-three/fiber + @react-three/drei
- **Map:** Leaflet + React Leaflet
- **Icons:** Lucide React

## Source Layout

```
frontend/src/
├── App.jsx                         # Root — routing, WebSocket connection, device state
├── main.jsx                        # Vite entry point
├── lib/
│   └── api.js                      # REST API client (fetch wrappers for all endpoints)
├── utils/
│   └── translation.js              # EN/JA UI strings
├── pages/                          # Top-level page components
└── components/
    ├── DevicePanel.jsx             # Device list, online/offline status
    ├── DeviceStatusCard.jsx        # Per-device summary card
    ├── ControllerDetailView.jsx    # Per-controller layout, port grid, interval badge
    ├── SensorNodeCard.jsx          # Individual port/sensor display
    ├── NodeIntervalModal.jsx       # Set per-port upload interval, delivery status
    ├── ThresholdModal.jsx          # Alert threshold configuration
    ├── HistoryModal.jsx            # Historical charts with time range selection
    ├── ExportModal.jsx             # CSV/JSON data export
    ├── LeafletMap.jsx              # GPS location map
    ├── LabelManager.jsx            # Custom port label editor
    ├── MultiSensorView.jsx         # Multi-sensor overlay view
    ├── AliasInlineEdit.jsx         # Inline device alias editing
    ├── ResetPortModal.jsx          # Reset a port's stored state
    ├── sensors/                    # Sensor-type-specific display cards
    │   └── HumTempCard.jsx         # Temperature + humidity display
    └── charts/                     # Reusable chart components
```

## Key Features

- **Real-time updates** via WebSocket — no polling required
- **Per-port sensor view** — shows current value, unit, last seen time
- **Per-controller view** — all 8 ports in one grid, with controller HELLO status
- **Upload interval config** — set per-port interval (ms) with live delivery status (green = ACK received, amber = pending)
- **Alert thresholds** — configurable per port, triggers visual indicator when exceeded
- **Historical charts** — line chart for any port over a selectable time range
- **Data export** — CSV or JSON download for any device/port/time range
- **GPS map** — shows device location from GPS coordinates
- **Custom labels** — rename any port to a user-friendly label
- **Language toggle** — English / Japanese (全 UI strings in `translation.js`)

## Running

```bash
npm install
npm run dev       # dev server at http://localhost:5173
npm run build     # production build → dist/
npm run preview   # preview production build locally
```

The dashboard connects to the backend at the URL configured in `api.js`. In dev, Vite's proxy is used to avoid CORS issues.
