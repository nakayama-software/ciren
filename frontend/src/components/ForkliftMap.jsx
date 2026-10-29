import { useEffect, useRef, useState } from 'react'
import { MapContainer, TileLayer, Marker, Popup, Polygon, Tooltip, ZoomControl, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import { Maximize2, Minimize2 } from 'lucide-react'
import { useIsDark } from '../utils/useIsDark'
import forkliftIconUrl from '../assets/forklift.png'

function makeForkliftIcon(ringColor, size) {
  const imgSize = Math.round(size * 0.68)
  return new L.DivIcon({
    html: `<div style="
      width:${size}px;height:${size}px;border-radius:50%;
      background:white;border:3px solid ${ringColor};
      box-shadow:0 2px 8px rgba(0,0,0,0.45);
      box-sizing:border-box;
      display:flex;align-items:center;justify-content:center;
      overflow:hidden;
    "><img src="${forkliftIconUrl}" style="width:${imgSize}px;height:${imgSize}px;object-fit:contain;" /></div>`,
    className: '',
    iconSize:    [size, size],
    iconAnchor:  [size / 2, size / 2],
    popupAnchor: [0, -(size / 2 + 6)],
  })
}

const ICON_SELECTED = makeForkliftIcon('#06b6d4', 34)
const ICON_DEFAULT  = makeForkliftIcon('#f59e0b', 26)   // amber ring — visually distinct from sensor-device markers

function FitBounds({ positions }) {
  const map = useMap()
  const prevCountRef = useRef(0)

  useEffect(() => {
    if (positions.length === 0) return
    if (positions.length === prevCountRef.current) return
    prevCountRef.current = positions.length

    if (positions.length === 1) {
      map.setView(positions[0], Math.max(map.getZoom(), 15))
    } else {
      try {
        map.fitBounds(L.latLngBounds(positions), { padding: [60, 60], maxZoom: 16 })
      } catch (_) {}
    }
  }, [positions.length]) // eslint-disable-line

  return null
}

// Click to add vertices, double-click to close the polygon (needs >= 3 points).
// Disables double-click-zoom while active so finishing a shape doesn't also zoom the map.
function DrawPolygonLayer({ active, onComplete }) {
  const [points, setPoints] = useState([])
  const map = useMap()

  useEffect(() => {
    if (!active) {
      setPoints([])
      return
    }
    map.doubleClickZoom.disable()
    return () => map.doubleClickZoom.enable()
  }, [active, map])

  useMapEvents({
    click(e) {
      if (!active) return
      setPoints((prev) => [...prev, [e.latlng.lat, e.latlng.lng]])
    },
    dblclick() {
      if (!active || points.length < 3) return
      onComplete(points)
      setPoints([])
    },
  })

  if (!active || points.length === 0) return null
  return <Polygon positions={points} pathOptions={{ color: '#06b6d4', dashArray: '4 4', fillOpacity: 0.1 }} />
}

function forkliftKey(f) {
  return `${f.device_id}-${f.node_id}`
}

// Flies the map to the selected forklift. Keyed on `focusTick` (which bumps
// on every click, even re-clicking the already-selected node) rather than
// `selectedKey` alone — otherwise clicking the same already-selected card a
// second time would be a no-op, since the key string wouldn't have changed.
function FocusOnSelect({ forklifts, selectedKey, focusTick }) {
  const map = useMap()

  useEffect(() => {
    if (!selectedKey) return
    const target = forklifts.find((f) => forkliftKey(f) === selectedKey)
    if (!target) return
    // Always fly to a fixed close zoom, regardless of current zoom — clicking
    // a card should give a clear, consistent "focused in" result every time,
    // not a no-op when the map already happens to be near that zoom level.
    map.flyTo([target.lat, target.lon], 18, { duration: 0.75 })
  }, [focusTick]) // eslint-disable-line react-hooks/exhaustive-deps

  return null
}

function timeAgo(serverTs, lang) {
  if (!serverTs) return '—'
  const secs = Math.max(0, Math.floor((Date.now() - new Date(serverTs).getTime()) / 1000))
  if (secs < 60) return lang === 'ja' ? `${secs}秒前` : `${secs}s ago`
  const mins = Math.floor(secs / 60)
  return lang === 'ja' ? `${mins}分前` : `${mins}m ago`
}

// forklifts: array of { device_id, node_id, lat, lon, speed, server_ts }
// areas: array of { _id, label, points: [[lat,lng], ...] }
export default function ForkliftMap({
  forklifts = [], selectedKey, onSelectForklift, focusTick, waitingText, lang = 'en',
  areas = [], drawing = false, onAreaDrawn, onDeleteArea,
}) {
  const isDark = useIsDark()
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const [isFullscreen, setIsFullscreen] = useState(false)

  // Sync state with the browser's actual fullscreen status (handles the
  // user pressing Esc, not just our own button), and nudge Leaflet to
  // recompute its size once the fullscreen transition finishes.
  useEffect(() => {
    const onChange = () => {
      setIsFullscreen(document.fullscreenElement === containerRef.current)
      setTimeout(() => mapRef.current?.invalidateSize(), 100)
    }
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen()
    } else {
      containerRef.current?.requestFullscreen?.()
    }
  }

  const validForklifts = forklifts.filter((f) => f.lat != null && f.lon != null)

  if (validForklifts.length === 0 && areas.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500 dark:text-gray-400 text-sm">
        {waitingText || 'Waiting for GPS data…'}
      </div>
    )
  }

  const positions     = validForklifts.map((f) => [f.lat, f.lon])
  const defaultCenter = positions[0] || areas[0]?.points?.[0] || [0, 0]

  const p = isDark ? {
    bg:      '#1e293b',
    border:  '#334155',
    heading: '#f1f5f9',
    body:    '#94a3b8',
    value:   '#e2e8f0',
    coord:   '#64748b',
    divider: '#334155',
  } : {
    bg:      '#ffffff',
    border:  '#e2e8f0',
    heading: '#334155',
    body:    '#475569',
    value:   '#0f172a',
    coord:   '#94a3b8',
    divider: '#e2e8f0',
  }

  return (
    <div
      ref={containerRef}
      className={`relative w-full h-full ${isFullscreen ? 'bg-white dark:bg-slate-950' : ''}`}
    >
      <button
        onClick={toggleFullscreen}
        title={isFullscreen ? (lang === 'ja' ? '全画面終了' : 'Exit fullscreen') : (lang === 'ja' ? '全画面表示' : 'Fullscreen')}
        className="absolute top-2.5 right-2.5 z-[1000] inline-flex items-center justify-center w-8 h-8 rounded-md border border-black/10 bg-white/90 text-gray-700 hover:bg-white shadow-sm dark:border-white/10 dark:bg-slate-800/90 dark:text-gray-200 dark:hover:bg-slate-700 transition-colors cursor-pointer"
      >
        {isFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
      </button>
      {/* Node cards — click to fly the map to that forklift */}
      {validForklifts.length > 0 && (
        <div className="absolute top-2.5 left-2.5 z-[1000] max-h-[calc(100%-1.25rem)] overflow-y-auto flex flex-col gap-2 w-40">
          {validForklifts.map((f) => {
            const key        = forkliftKey(f)
            const isSelected = key === selectedKey
            return (
              <button
                key={key}
                onClick={() => onSelectForklift?.(key)}
                className={`text-left rounded-lg border-2 pl-2.5 pr-3 py-2 shadow-lg transition-colors cursor-pointer ${
                  isSelected
                    ? 'border-cyan-500 bg-cyan-500 text-white shadow-cyan-500/30'
                    : 'border-amber-500 bg-white text-slate-900 hover:bg-amber-50 dark:bg-slate-800 dark:text-gray-100 dark:hover:bg-slate-700'
                }`}
              >
                <div className="flex items-center gap-1.5 text-sm font-bold">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${isSelected ? 'bg-white' : 'bg-amber-500'}`} />
                  {lang === 'ja' ? `ノード ${f.node_id}` : `Node ${f.node_id}`}
                </div>
                <div className={`text-[11px] mt-0.5 ${isSelected ? 'text-cyan-50' : 'text-gray-500 dark:text-gray-400'}`}>
                  {f.speed != null ? `${Number(f.speed).toFixed(1)} km/h` : '—'} · {timeAgo(f.server_ts, lang)}
                </div>
              </button>
            )
          })}
        </div>
      )}
      <MapContainer
        ref={mapRef}
        center={defaultCenter}
        zoom={15}
        zoomControl={false}
        className={`w-full h-full ${isFullscreen ? '' : 'rounded-xl'}`}
        style={{ zIndex: 0 }}
      >
        <ZoomControl position="bottomright" />
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        />
        <FitBounds positions={positions} />
        <FocusOnSelect forklifts={validForklifts} selectedKey={selectedKey} focusTick={focusTick} />
        <DrawPolygonLayer active={drawing} onComplete={(pts) => onAreaDrawn?.(pts)} />

        {areas.map((area) => (
          <Polygon
            key={area._id}
            positions={area.points}
            pathOptions={{ color: '#f59e0b', fillOpacity: 0.15 }}
            eventHandlers={{
              click: () => {
                const msg = lang === 'ja' ? `「${area.label}」を削除しますか？` : `Delete area "${area.label}"?`
                if (onDeleteArea && window.confirm(msg)) {
                  onDeleteArea(area._id)
                }
              },
            }}
          >
            <Tooltip permanent direction="center" className="area-label">
              {area.label}
            </Tooltip>
          </Polygon>
        ))}

        {validForklifts.map((f) => {
          const key        = forkliftKey(f)
          const isSelected = key === selectedKey
          return (
            <Marker
              key={key}
              position={[f.lat, f.lon]}
              icon={isSelected ? ICON_SELECTED : ICON_DEFAULT}
              zIndexOffset={isSelected ? 1000 : 0}
              eventHandlers={{ click: () => onSelectForklift?.(key) }}
            >
              <Popup>
                <div style={{ minWidth: '190px', fontFamily: 'system-ui, sans-serif', lineHeight: '1', background: p.bg, borderRadius: '8px', padding: '10px' }}>
                  <div style={{
                    fontWeight: '700', fontSize: '13px',
                    color: isSelected ? '#d97706' : p.heading,
                    marginBottom: '8px', paddingBottom: '6px',
                    borderBottom: `1px solid ${p.divider}`,
                  }}>
                    {f.device_id} · node {f.node_id}
                  </div>
                  <div style={{ fontSize: '12px', color: p.body, lineHeight: '2' }}>
                    <div>{lang === 'ja' ? '速度' : 'Speed'}: <b style={{ color: p.value }}>{f.speed != null ? `${Number(f.speed).toFixed(1)} km/h` : '—'}</b></div>
                    <div>{lang === 'ja' ? '更新' : 'Updated'}: <b style={{ color: p.value }}>{timeAgo(f.server_ts, lang)}</b></div>
                    <div style={{ color: p.coord, fontSize: '11px', marginTop: '2px' }}>
                      {Number(f.lat).toFixed(6)}, {Number(f.lon).toFixed(6)}
                    </div>
                  </div>
                </div>
              </Popup>
            </Marker>
          )
        })}
      </MapContainer>
    </div>
  )
}
