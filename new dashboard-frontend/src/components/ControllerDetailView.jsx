import { useState } from 'react'
import { Cpu, ArrowLeft, Download, Zap } from 'lucide-react'
import { getNodeKey, getReadingKey, isIMUSensor } from '../utils/sensors'
import SensorNodeCard from './SensorNodeCard'
import LineChartModal from './charts/LineChartModal'
import IMU3DModal from './charts/IMU3DModal'
import ExportModal from './ExportModal'

export default function ControllerDetailView({
  ctrlId,
  deviceId,
  nodes,
  latestData,
  nodeStatus,
  now,
  onBack,
  wsRef,
  t,
}) {
  const [lineTarget, setLineTarget] = useState(null)   // { ctrlId, portNum, sensorType }
  const [imu3DTarget, setImu3DTarget] = useState(null) // { ctrlId, portNum }
  const [showExport, setShowExport] = useState(false)

  const ctrlNodes = nodes.filter((n) => String(n.ctrl_id) === String(ctrlId))
  const nowMs = now || Date.now()

  const activeCount = ctrlNodes.filter((node) => {
    const key = getNodeKey(node.ctrl_id, node.port_num)
    const status = nodeStatus[key]
    if (status === 'online') return true
    const rKey = getReadingKey(node.ctrl_id, node.port_num, node.sensor_type)
    const reading = latestData[rKey]
    if (reading?.server_ts && (nowMs - new Date(reading.server_ts).getTime()) < 30000) return true
    return false
  }).length

  // Deteksi port yang punya BOTH 0x01 (temp) dan 0x02 (humidity) — tampilkan sebagai HumTempCard
  const humTempPorts = new Set()
  const portSTypeMap = {}
  for (const n of ctrlNodes) {
    const pk = `${n.ctrl_id}_${n.port_num}`
    portSTypeMap[pk] = portSTypeMap[pk] || new Set()
    portSTypeMap[pk].add(Number(n.sensor_type))
  }
  for (const [pk, stypes] of Object.entries(portSTypeMap)) {
    if (stypes.has(0x01) && stypes.has(0x02)) humTempPorts.add(pk)
  }

  // Deduplicate: IMU nodes tampil sekali per port, HumTemp tampil sekali via 0x01 (skip 0x02)
  const seenIMUPorts = new Set()
  const displayNodes = ctrlNodes.filter((node) => {
    if (isIMUSensor(node.sensor_type)) {
      const portKey = `${node.ctrl_id}_${node.port_num}`
      if (seenIMUPorts.has(portKey)) return false
      seenIMUPorts.add(portKey)
    }
    const pk = `${node.ctrl_id}_${node.port_num}`
    // Skip 0x02 jika port ini adalah HumTemp (sudah dihandle via 0x01 card)
    if (humTempPorts.has(pk) && Number(node.sensor_type) === 0x02) return false
    return true
  })

  const tBack = t?.controllerDetail?.back || 'Back'
  const tSensorNodes = t?.controllerDetail?.sensorNodes || 'Active Nodes'
  const tNoNode = t?.controllerDetail?.noNode || 'No node connected.'

  return (
    <div className="rounded-2xl border border-black/10 bg-white/80 p-6 backdrop-blur-sm dark:border-white/10 dark:bg-slate-800/60 shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 flex items-center justify-center rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-500">
            <Cpu className="h-6 w-6 text-white" />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-slate-900 dark:text-white">
              Controller {ctrlId}
            </h2>
            <p className="text-xs text-slate-500 dark:text-gray-400">
              {ctrlNodes.length} node{ctrlNodes.length !== 1 ? 's' : ''} registered
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowExport(true)}
            className="inline-flex items-center gap-2 border border-black/10 dark:border-white/10 px-3 py-2 rounded-lg text-sm text-slate-700 dark:text-gray-200 hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
          >
            <Download className="h-4 w-4" />
            <span className="hidden sm:inline">Export</span>
          </button>
          <button
            onClick={onBack}
            className="inline-flex items-center gap-2 border border-black/10 dark:border-white/10 px-4 py-2 rounded-lg text-sm text-slate-700 dark:text-gray-200 hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>{tBack}</span>
          </button>
        </div>
      </div>

      {/* Info box */}
      <div className="rounded-xl border border-black/10 bg-white/70 p-3 dark:border-white/10 dark:bg-slate-800/60 mb-6">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-cyan-500" />
          <span className="text-xs text-gray-600 dark:text-gray-400">{tSensorNodes}:</span>
          <span className="text-xl font-semibold text-slate-900 dark:text-white">{activeCount}</span>
          <span className="text-xs text-slate-400 dark:text-gray-500">/ {ctrlNodes.length}</span>
        </div>
      </div>

      {/* Sensor grid */}
      <h3 className="text-base font-medium mb-4 text-slate-900 dark:text-white">Sensor Nodes</h3>

      {displayNodes.length === 0 ? (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm text-yellow-800 dark:text-yellow-200">
          {tNoNode}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {displayNodes.map((node) => {
            const rKey = getReadingKey(node.ctrl_id, node.port_num, node.sensor_type)
            const reading = latestData[rKey] || null
            const nKey = getNodeKey(node.ctrl_id, node.port_num)
            const status = nodeStatus[nKey] || node.status || null

            const portKey   = `${node.ctrl_id}_${node.port_num}`
            const isHumTemp = humTempPorts.has(portKey) && Number(node.sensor_type) === 0x01

            return (
              <SensorNodeCard
                key={`${node.ctrl_id}_${node.port_num}_${node.sensor_type}`}
                ctrlId={node.ctrl_id}
                portNum={node.port_num}
                sensorType={node.sensor_type}
                reading={reading}
                status={status}
                now={nowMs}
                latestData={latestData}
                isHumTemp={isHumTemp}
                onChartClick={() => setLineTarget({ ctrlId: node.ctrl_id, portNum: node.port_num, sensorType: node.sensor_type })}
                onIMU3DClick={() => setImu3DTarget({ ctrlId: node.ctrl_id, portNum: node.port_num })}
              />
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

      <ExportModal
        open={showExport}
        onClose={() => setShowExport(false)}
        deviceId={deviceId}
        ctrlId={ctrlId}
        nodes={ctrlNodes}
      />
    </div>
  )
}
