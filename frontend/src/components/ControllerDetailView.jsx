import { useState, useEffect } from 'react'
import { Cpu, ArrowLeft, Download, Zap, AlertTriangle, Timer, WifiOff, RefreshCw } from 'lucide-react'
import { getNodeKey, getReadingKey, isIMUSensor } from '../utils/sensors'
import { getThreshold, isOutOfRange } from '../utils/thresholds'
import { getNodeConfig, verifyNodeConfig } from '../lib/api'
import SensorNodeCard, { timeAgo } from './SensorNodeCard'
import LineChartModal from './charts/LineChartModal'
import IMU3DModal from './charts/IMU3DModal'
import RotaryChartModal from './charts/RotaryChartModal'
import ExportModal from './ExportModal'
import ResetPortModal from './ResetPortModal'
import AliasInlineEdit from './AliasInlineEdit'
import LabelManager from './LabelManager'
import MultiSensorView from './MultiSensorView'
import ThresholdModal from './ThresholdModal'
import NodeIntervalModal from './NodeIntervalModal'

// Compute active display nodes for a given ctrl across all registered nodes.
// Used both for current-ctrl rendering and cross-ctrl label support.
function computeCtrlDisplayNodes(cid, allNodes, nodeStatus, latestData) {
  const cidNodes = allNodes.filter((n) => String(n.ctrl_id) === String(cid))

  const humTempPorts = new Set()
  const portSTypeMap = {}
  for (const n of cidNodes) {
    const pk = `${n.ctrl_id}_${n.port_num}`
    portSTypeMap[pk] = portSTypeMap[pk] || new Set()
    portSTypeMap[pk].add(Number(n.sensor_type))
  }
  for (const [pk, stypes] of Object.entries(portSTypeMap)) {
    if (stypes.has(0x01) && stypes.has(0x02)) humTempPorts.add(pk)
  }

  const active = cidNodes.filter((node) => {
    const rKey = getReadingKey(node.ctrl_id, node.port_num, node.sensor_type)
    if (nodeStatus[rKey] === 'online') return true
    const portKey = getNodeKey(node.ctrl_id, node.port_num)
    if (nodeStatus[portKey] === 'stale') return false
    return !!latestData[rKey]
  })

  const seenIMU = new Set()
  const displayNodes = []
  for (const node of active) {
    const pk = `${node.ctrl_id}_${node.port_num}`
    if (isIMUSensor(node.sensor_type)) {
      if (seenIMU.has(pk)) continue
      seenIMU.add(pk)
    } else if (humTempPorts.has(pk) && Number(node.sensor_type) === 0x02) {
      continue
    }
    displayNodes.push({ ...node, isHumTemp: humTempPorts.has(pk) })
  }

  return { displayNodes, humTempPorts }
}

export default function ControllerDetailView({
  ctrlId,
  deviceId,
  nodes,
  latestData,
  nodeStatus,
  now,
  onBack,
  onPortReset,
  wsRef,
  t,
}) {
  const [lineTarget, setLineTarget] = useState(null)  // { ctrlId, portNum, sensorType }
  const [imu3DTarget, setImu3DTarget] = useState(null)  // { ctrlId, portNum }
  const [rotaryTarget, setRotaryTarget] = useState(null)  // { ctrlId, portNum }
  const [resetTarget, setResetTarget] = useState(null)  // { ctrlId, portNum, sensorType }
  const [thresholdTarget, setThresholdTarget] = useState(null)  // { ctrlId, portNum, sensorType }
  const [intervalTarget, setIntervalTarget] = useState(null)  // { ctrlId, portNum }
  const [showExport, setShowExport] = useState(false)
  const [openLabel, setOpenLabel] = useState(null)  // label object for MultiSensorView
  // Stored interval config: key = `${ctrlId}_${portNum}` → interval_ms
  const [nodeIntervals, setNodeIntervals] = useState({})
  // Delivery status: key = `${ctrlId}_${portNum}` → true (delivered) / false (queued)
  const [intervalDelivered, setIntervalDelivered] = useState({})
  // Verification results: key = `${ctrlId}_${portNum}` → { observed_ms, configured_ms, match }
  const [intervalVerified, setIntervalVerified] = useState({})
  const [verifying, setVerifying] = useState({})  // key → true while loading

  useEffect(() => {
    getNodeConfig(deviceId)
      .then(configs => {
        const map = {}
        configs.forEach(c => { map[`${c.ctrl_id}_${c.port_num}`] = c.interval_ms })
        setNodeIntervals(map)
      })
      .catch(() => { })
  }, [deviceId])

  const ctrlNodes = nodes.filter((n) => String(n.ctrl_id) === String(ctrlId))
  const nowMs = now || Date.now()

  // Cross-controller label support: compute active display nodes for ALL controllers
  const allCtrlIds = [...new Set(nodes.map((n) => String(n.ctrl_id)))]
  const allHumTempPorts = new Set()
  const allActiveDisplayNodes = []
  for (const cid of allCtrlIds) {
    const { displayNodes: cidNodes, humTempPorts: cidHTP } = computeCtrlDisplayNodes(cid, nodes, nodeStatus, latestData)
    for (const pk of cidHTP) allHumTempPorts.add(pk)
    allActiveDisplayNodes.push(...cidNodes)
  }

  // Tampilkan node jika:
  // 1. HB sedang aktif (nodeStatus 'online') — node hidup, DATA mungkin belum datang
  // 2. Ada reading di latestData — ada data terakhir yang diketahui (bisa offline tapi tetap tampil)
  // Sembunyikan hanya jika tidak ada HB DAN tidak ada reading sama sekali
  // (node belum pernah kirim data = truly baru, atau ghost node yang sudah dibersihkan backend)
  function isNodeActive(node) {
    const rKey = getReadingKey(node.ctrl_id, node.port_num, node.sensor_type)
    // Check sensor-type-specific online FIRST — 'online' always beats a stale port key.
    // Reversed order would cause nodes to stay hidden after a reboot sends STALE
    // and the sensor comes back, because the port-level stale is never cleared.
    if (nodeStatus[rKey] === 'online') return true
    const portKey = getNodeKey(node.ctrl_id, node.port_num)
    if (nodeStatus[portKey] === 'stale') return false
    return !!latestData[rKey]
  }

  const activeCtrlNodes = ctrlNodes.filter(isNodeActive)

  // Deteksi port HumTemp dari SEMUA node terdaftar (bukan hanya aktif).
  // Ini mencegah bug di mana humidity belum aktif sehingga card cuma tampil Temperature saja.
  const humTempPorts = new Set()
  const allPortSTypeMap = {}
  for (const n of ctrlNodes) {
    const pk = `${n.ctrl_id}_${n.port_num}`
    allPortSTypeMap[pk] = allPortSTypeMap[pk] || new Set()
    allPortSTypeMap[pk].add(Number(n.sensor_type))
  }
  for (const [pk, stypes] of Object.entries(allPortSTypeMap)) {
    if (stypes.has(0x01) && stypes.has(0x02)) humTempPorts.add(pk)
  }

  // Deduplicate: IMU tampil sekali per port, HumTemp tampil via 0x01 (skip 0x02)
  const seenIMUPorts = new Set()
  const displayNodes = activeCtrlNodes.filter((node) => {
    if (isIMUSensor(node.sensor_type)) {
      const portKey = `${node.ctrl_id}_${node.port_num}`
      if (seenIMUPorts.has(portKey)) return false
      seenIMUPorts.add(portKey)
    }
    const pk = `${node.ctrl_id}_${node.port_num}`
    // HumTemp: skip 0x02 node — 0x01 node akan render HumTempCard gabungan
    if (humTempPorts.has(pk) && Number(node.sensor_type) === 0x02) return false
    // HumTemp: jika hanya 0x01 yang aktif (0x02 belum kirim data), tetap tampilkan
    // sebagai HumTempCard supaya UI konsisten dan user tahu humidity ada tapi belum data
    return true
  })

  // activeCount = jumlah kartu yang ditampilkan (IMU dihitung 1, HumTemp dihitung 1)
  const activeCount = displayNodes.length

  function handleChartClick(node) {
    if (Number(node.sensor_type) === 0x13) {
      setRotaryTarget({ ctrlId: node.ctrl_id, portNum: node.port_num })
    } else {
      const pk = `${node.ctrl_id}_${node.port_num}`
      const isHT = humTempPorts.has(pk)
      setLineTarget({
        ctrlId: node.ctrl_id,
        portNum: node.port_num,
        sensorType: node.sensor_type,
        isHumTemp: isHT,
      })
    }
  }


  const tBack = t?.controllerDetail?.back || 'Back'
  const tSensorNodes = t?.controllerDetail?.sensorNodes || 'Active Nodes'
  const tNoNode = t?.controllerDetail?.noNode || 'No node connected.'
  const tActiveNow = t?.controllerDetail?.activeNow || 'active now'
  const tSNTitle = t?.controllerDetail?.sensorNodesTitle || 'Sensor Nodes'
  const tOutOfRange = t?.controllerDetail?.outOfRange || 'Out of range'
  const tExport = t?.controllerDetail?.export || 'Export'
  const tNodesReg = t?.controllerDetail?.nodesRegistered || ((n) => `${n} node${n !== 1 ? 's' : ''} registered`)

  async function handleVerifyInterval(ctrlId, portNum) {
    const key = `${ctrlId}_${portNum}`
    setVerifying(prev => ({ ...prev, [key]: true }))
    setIntervalVerified(prev => { const next = { ...prev }; delete next[key]; return next })
    try {
      const results = await verifyNodeConfig(deviceId, ctrlId, portNum)
      const match = results.find(r => r.ctrl_id === Number(ctrlId) && r.port_num === Number(portNum))
      if (match) setIntervalVerified(prev => ({ ...prev, [key]: match }))
    } catch { /* ignore */ }
    setVerifying(prev => { const next = { ...prev }; delete next[key]; return next })
  }

  const formatMs = (v) => v >= 1000 ? `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}s` : `${v}ms`

  return (
    <div className="rounded-2xl border border-black/10 bg-white/80 p-4 sm:p-6 backdrop-blur-sm dark:border-white/10 dark:bg-slate-800/60 shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 sm:mb-6">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <div className="h-10 w-10 sm:h-12 sm:w-12 flex items-center justify-center rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-500 shrink-0">
            <Cpu className="h-5 w-5 sm:h-6 sm:w-6 text-white" />
          </div>
          <div className="min-w-0">
            <AliasInlineEdit
              deviceId={deviceId}
              ctrlId={ctrlId}
              originalName={`Controller ${ctrlId}`}
              textClass="text-base sm:text-xl font-semibold text-slate-900 dark:text-white truncate"
            />
            <p className="text-xs text-slate-500 dark:text-gray-400">
              {tNodesReg(activeCount)}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setShowExport(true)}
            className="inline-flex items-center gap-2 border border-black/10 dark:border-white/10 px-3 py-2 rounded-lg text-sm text-slate-700 dark:text-gray-200 hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
          >
            <Download className="h-4 w-4" />
            <span className="hidden sm:inline">{tExport}</span>
          </button>
          <button
            onClick={onBack}
            className="inline-flex items-center gap-1.5 border border-black/10 dark:border-white/10 px-2.5 py-2 rounded-lg text-sm text-slate-700 dark:text-gray-200 hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
          >
            <ArrowLeft className="h-4 w-4 shrink-0" />
            <span className="hidden sm:inline">{tBack}</span>
          </button>
        </div>
      </div>

      {/* Info box */}
      <div className="rounded-xl border border-black/10 bg-white/70 p-3 dark:border-white/10 dark:bg-slate-800/60 mb-4 sm:mb-6">
        <div className="flex items-center gap-2 min-w-0">
          <Zap className="w-4 h-4 text-cyan-500 shrink-0" />
          <span className="text-xs text-gray-600 dark:text-gray-400 truncate">{tSensorNodes}:</span>
          <span className="text-xl font-semibold text-slate-900 dark:text-white shrink-0">{activeCount}</span>
          <span className="text-xs text-slate-400 dark:text-gray-500 shrink-0">{tActiveNow}</span>
        </div>
      </div>

      {/* Sensor grid */}
      <h3 className="text-base font-medium mb-4 text-slate-900 dark:text-white">{tSNTitle}</h3>

      {displayNodes.length === 0 ? (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm text-yellow-800 dark:text-yellow-200">
          {tNoNode}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4 items-stretch">
          {displayNodes.map((node) => {
            const rKey = getReadingKey(node.ctrl_id, node.port_num, node.sensor_type)
            const reading = latestData[rKey] || null
            const portKey = getNodeKey(node.ctrl_id, node.port_num)
            const status = nodeStatus[rKey] || (nodeStatus[portKey] === 'stale' ? 'stale' : null) || node.status || null
            const isHumTemp = humTempPorts.has(portKey) && Number(node.sensor_type) === 0x01

            // Threshold check — also check humidity if humTemp card
            const threshold = getThreshold(deviceId, node.ctrl_id, node.port_num, node.sensor_type)
            let alert = reading?.value != null && isOutOfRange(reading.value, threshold)
            if (!alert && isHumTemp) {
              const humThreshold = getThreshold(deviceId, node.ctrl_id, node.port_num, 0x02)
              const humRKey = getReadingKey(node.ctrl_id, node.port_num, 0x02)
              const humReading = latestData[humRKey]
              if (humReading?.value != null) alert = isOutOfRange(humReading.value, humThreshold)
            }

            // Last update timestamp for this card
            const cardLastTs = (() => {
              if (isIMUSensor(node.sensor_type)) {
                // IMU: find latest across all axes
                const imuTs = [0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x10, 0x11, 0x12]
                  .map(s => latestData[getReadingKey(node.ctrl_id, node.port_num, s)]?.ts)
                  .filter(Boolean).sort().pop()
                return imuTs || null
              }
              if (isHumTemp) {
                const humR = latestData[getReadingKey(node.ctrl_id, node.port_num, 0x02)]
                const tTs = reading?.ts || null
                const hTs = humR?.ts || null
                if (tTs && hTs) return tTs > hTs ? tTs : hTs
                return tTs || hTs || null
              }
              return reading?.ts || null
            })()
            const cardAgo = cardLastTs ? timeAgo(cardLastTs, t) : null
            const cardTimeStr = cardLastTs
              ? new Date(cardLastTs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
              : null
            // HumTemp card already shows its own ago — don't duplicate
            const showCardFooter = cardAgo && !(isHumTemp)

            return (
              <div
                key={`${node.ctrl_id}_${node.port_num}_${node.sensor_type}`}
                className={`group rounded-xl transition-shadow flex flex-col ${alert ? 'ring-2 ring-red-500/70 shadow-[0_0_0_2px_rgba(239,68,68,0.15)]' : ''}`}
              >
                {/* Sensor card */}
                <div className="relative flex-1 min-h-0">
                  {alert && (
                    <div className="absolute top-2 left-2 z-10 flex items-center gap-1 rounded-md bg-red-500 px-1.5 py-0.5 text-[10px] font-medium text-white pointer-events-none">
                      <AlertTriangle className="w-3 h-3" />
                      {tOutOfRange}
                    </div>
                  )}
                  <SensorNodeCard
                    deviceId={deviceId}
                    ctrlId={node.ctrl_id}
                    portNum={node.port_num}
                    sensorType={node.sensor_type}
                    reading={reading}
                    status={status}
                    now={nowMs}
                    latestData={latestData}
                    isHumTemp={isHumTemp}
                    onChartClick={() => handleChartClick(node)}
                    onIMU3DClick={() => setImu3DTarget({ ctrlId: node.ctrl_id, portNum: node.port_num })}
                    t={t}
                  />
                </div>

                {/* Footer: timestamp + action buttons */}
                <div className="flex items-center justify-between gap-2 px-1 pb-1 pt-0.5">
                  <span className="text-[10px] text-slate-400 dark:text-gray-500 truncate">
                    {showCardFooter ? `${cardTimeStr ?? ''}${cardAgo ? ` · ${cardAgo}` : ''}` : ''}
                  </span>
                  {/* Action buttons — inline, always accessible on mobile */}
                  <div className="flex items-center gap-1 shrink-0 opacity-60 group-hover:opacity-100 transition-opacity">
                    {nodeIntervals[portKey] != null && (
                      <span className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[10px] font-mono cursor-default select-none ${intervalDelivered[portKey] === false
                          ? 'bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400'
                          : intervalVerified[portKey] && intervalVerified[portKey].match === false
                            ? 'bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400'
                            : 'bg-cyan-500/10 border border-cyan-500/20 text-cyan-600 dark:text-cyan-400'
                        }`} title={
                          intervalVerified[portKey]
                            ? `Configured: ${formatMs(intervalVerified[portKey].configured_ms)} | Observed: ${intervalVerified[portKey].observed_ms ? formatMs(intervalVerified[portKey].observed_ms) : 'N/A'}`
                            : `Interval: ${formatMs(nodeIntervals[portKey])}`
                        }>
                        <Timer className="w-2.5 h-2.5" />
                        {nodeIntervals[portKey] >= 1000
                          ? `${(nodeIntervals[portKey] / 1000).toFixed(nodeIntervals[portKey] % 1000 === 0 ? 0 : 1)}s`
                          : `${nodeIntervals[portKey]}ms`}
                        {intervalDelivered[portKey] === false && <WifiOff className="w-2.5 h-2.5 ml-0.5" />}
                      </span>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); handleVerifyInterval(node.ctrl_id, node.port_num) }}
                      title="Verify interval"
                      disabled={verifying[portKey]}
                      className="p-1 rounded-md bg-slate-500/10 hover:bg-slate-500/20 border border-slate-500/20 text-slate-500 dark:text-slate-400 disabled:opacity-40"
                    >
                      <RefreshCw className={`w-3 h-3 ${verifying[portKey] ? 'animate-spin' : ''}`} />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setIntervalTarget({ ctrlId: node.ctrl_id, portNum: node.port_num }) }}
                      title="Set upload interval"
                      className="p-1 rounded-md bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/20 text-cyan-600 dark:text-cyan-400"
                    >
                      <Timer className="w-3 h-3" />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setThresholdTarget({ ctrlId: node.ctrl_id, portNum: node.port_num, sensorType: node.sensor_type }) }}
                      title="Set threshold"
                      className="p-1 rounded-md bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 text-amber-600 dark:text-amber-400"
                    >
                      <AlertTriangle className="w-3 h-3" />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setResetTarget({ ctrlId: node.ctrl_id, portNum: node.port_num, sensorType: node.sensor_type, isHumTemp }) }}
                      title="Reset port data"
                      className="p-1 rounded-md bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-500"
                    >
                      <svg className="w-3 h-3" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M8 2a6 6 0 1 0 5.5 3.6l1.4-1.4A8 8 0 1 1 8 0v2z" />
                        <path d="M8 0v4L6 2l2-2z" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Modals */}
      <LineChartModal
        open={!!lineTarget}
        onClose={() => setLineTarget(null)}
        deviceId={deviceId}
        ctrlId={lineTarget?.ctrlId}
        portNum={lineTarget?.portNum}
        sensorType={lineTarget?.sensorType}
        isHumTemp={lineTarget?.isHumTemp}
        wsRef={wsRef}
      />

      <IMU3DModal
        open={!!imu3DTarget}
        onClose={() => setImu3DTarget(null)}
        deviceId={deviceId}
        ctrlId={imu3DTarget?.ctrlId}
        portNum={imu3DTarget?.portNum}
        latestData={latestData}
        wsRef={wsRef}
      />

      <RotaryChartModal
        open={!!rotaryTarget}
        onClose={() => setRotaryTarget(null)}
        deviceId={deviceId}
        ctrlId={rotaryTarget?.ctrlId}
        portNum={rotaryTarget?.portNum}
      />

      <ResetPortModal
        open={!!resetTarget}
        onClose={() => setResetTarget(null)}
        deviceId={deviceId}
        ctrlId={resetTarget?.ctrlId}
        portNum={resetTarget?.portNum}
        sensorType={resetTarget?.sensorType}
        isHumTemp={resetTarget?.isHumTemp}
        onSuccess={() => {
          if (onPortReset && resetTarget) {
            onPortReset(deviceId, resetTarget.ctrlId, resetTarget.portNum)
          }
          setResetTarget(null)
        }}
        t={t}
      />

      <ExportModal
        open={showExport}
        onClose={() => setShowExport(false)}
        deviceId={deviceId}
        ctrlId={ctrlId}
        nodes={activeCtrlNodes}
        t={t}
      />

      <ThresholdModal
        open={!!thresholdTarget}
        onClose={() => setThresholdTarget(null)}
        deviceId={deviceId}
        ctrlId={thresholdTarget?.ctrlId}
        portNum={thresholdTarget?.portNum}
        sensorType={thresholdTarget?.sensorType}
        t={t}
      />

      <NodeIntervalModal
        open={!!intervalTarget}
        onClose={(savedMs, result) => {
          if (savedMs != null) {
            const key = `${intervalTarget.ctrlId}_${intervalTarget.portNum}`
            setNodeIntervals(prev => ({ ...prev, [key]: savedMs }))
            setIntervalDelivered(prev => ({ ...prev, [key]: result?.delivered ?? true }))
          }
          setIntervalTarget(null)
        }}
        deviceId={deviceId}
        ctrlId={intervalTarget?.ctrlId}
        portNum={intervalTarget?.portNum}
        currentIntervalMs={intervalTarget ? nodeIntervals[`${intervalTarget.ctrlId}_${intervalTarget.portNum}`] : null}
        t={t}
      />

      <MultiSensorView
        open={!!openLabel}
        onClose={() => setOpenLabel(null)}
        label={openLabel}
        deviceId={deviceId}
        wsRef={wsRef}
        latestData={latestData}
        onPopOut={(sensor) => {
          setOpenLabel(null)
          const sCtrlId = sensor.ctrlId ?? ctrlId
          if (isIMUSensor(sensor.sensorType)) {
            setImu3DTarget({ ctrlId: sCtrlId, portNum: sensor.portNum })
          } else if (Number(sensor.sensorType) === 0x13) {
            setRotaryTarget({ ctrlId: sCtrlId, portNum: sensor.portNum })
          } else {
            const pk = `${sCtrlId}_${sensor.portNum}`
            setLineTarget({ ctrlId: sCtrlId, portNum: sensor.portNum, sensorType: sensor.sensorType, isHumTemp: allHumTempPorts.has(pk) })
          }
        }}
      />

      {/* Label manager — sensor grouping for compare view (cross-controller) */}
      <LabelManager
        deviceId={deviceId}
        allDisplayNodes={allActiveDisplayNodes}
        allHumTempPorts={allHumTempPorts}
        onOpenLabel={setOpenLabel}
        t={t}
      />
    </div>
  )
}
