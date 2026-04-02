import { useState } from 'react'
import { Cpu, ArrowLeft, Download, Zap } from 'lucide-react'
import { getNodeKey, getReadingKey, isIMUSensor } from '../utils/sensors'
import SensorNodeCard from './SensorNodeCard'
import LineChartModal from './charts/LineChartModal'
import IMU3DModal from './charts/IMU3DModal'
import RotaryChartModal from './charts/RotaryChartModal'
import ExportModal from './ExportModal'
import ResetPortModal from './ResetPortModal'
import AliasInlineEdit from './AliasInlineEdit'
import LabelManager from './LabelManager'
import MultiSensorView from './MultiSensorView'

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
  const [lineTarget, setLineTarget]     = useState(null)  // { ctrlId, portNum, sensorType }
  const [imu3DTarget, setImu3DTarget]   = useState(null)  // { ctrlId, portNum }
  const [rotaryTarget, setRotaryTarget] = useState(null)  // { ctrlId, portNum }
  const [resetTarget, setResetTarget]   = useState(null)  // { ctrlId, portNum, sensorType }
  const [showExport, setShowExport]     = useState(false)
  const [openLabel, setOpenLabel]       = useState(null)  // label object for MultiSensorView

  const ctrlNodes = nodes.filter((n) => String(n.ctrl_id) === String(ctrlId))
  const nowMs = now || Date.now()

  // Hanya tampilkan node yang benar-benar menerima data sensor type ini dalam 30 detik terakhir.
  // PENTING: tidak pakai nodeStatus (port-level) karena bisa "ghost" — misal IMU online bikin
  // sensor lama di port yang sama ikut muncul padahal tidak ada data.
  function isNodeActive(node) {
    const rKey = getReadingKey(node.ctrl_id, node.port_num, node.sensor_type)
    const reading = latestData[rKey]
    return !!(reading?.server_ts && (nowMs - new Date(reading.server_ts).getTime()) < 30000)
  }

  const activeCtrlNodes = ctrlNodes.filter(isNodeActive)

  // Deteksi port yang punya BOTH 0x01 (temp) dan 0x02 (humidity) — dari node aktif saja
  const humTempPorts = new Set()
  const portSTypeMap = {}
  for (const n of activeCtrlNodes) {
    const pk = `${n.ctrl_id}_${n.port_num}`
    portSTypeMap[pk] = portSTypeMap[pk] || new Set()
    portSTypeMap[pk].add(Number(n.sensor_type))
  }
  for (const [pk, stypes] of Object.entries(portSTypeMap)) {
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
    if (humTempPorts.has(pk) && Number(node.sensor_type) === 0x02) return false
    return true
  })

  // activeCount = jumlah kartu yang ditampilkan (IMU dihitung 1, HumTemp dihitung 1)
  const activeCount = displayNodes.length

  function handleChartClick(node) {
    if (Number(node.sensor_type) === 0x13) {
      setRotaryTarget({ ctrlId: node.ctrl_id, portNum: node.port_num })
    } else {
      setLineTarget({ ctrlId: node.ctrl_id, portNum: node.port_num, sensorType: node.sensor_type })
    }
  }

  const tBack        = t?.controllerDetail?.back        || 'Back'
  const tSensorNodes = t?.controllerDetail?.sensorNodes || 'Active Nodes'
  const tNoNode      = t?.controllerDetail?.noNode      || 'No node connected.'

  return (
    <div className="rounded-2xl border border-black/10 bg-white/80 p-6 backdrop-blur-sm dark:border-white/10 dark:bg-slate-800/60 shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 flex items-center justify-center rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-500">
            <Cpu className="h-6 w-6 text-white" />
          </div>
          <div>
            <AliasInlineEdit
              deviceId={deviceId}
              ctrlId={ctrlId}
              originalName={`Controller ${ctrlId}`}
              textClass="text-xl font-semibold text-slate-900 dark:text-white"
            />
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
          <span className="text-xs text-slate-400 dark:text-gray-500">active now</span>
        </div>
      </div>

      {/* Sensor grid */}
      <h3 className="text-base font-medium mb-4 text-slate-900 dark:text-white">Sensor Nodes</h3>

      {displayNodes.length === 0 ? (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm text-yellow-800 dark:text-yellow-200">
          {tNoNode}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-stretch">
          {displayNodes.map((node) => {
            const rKey    = getReadingKey(node.ctrl_id, node.port_num, node.sensor_type)
            const reading = latestData[rKey] || null
            const nKey    = getNodeKey(node.ctrl_id, node.port_num)
            const status  = nodeStatus[nKey] || node.status || null
            const portKey   = `${node.ctrl_id}_${node.port_num}`
            const isHumTemp = humTempPorts.has(portKey) && Number(node.sensor_type) === 0x01

            return (
              <div key={`${node.ctrl_id}_${node.port_num}_${node.sensor_type}`} className="relative group h-full">
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
                />
                {/* Reset button — hover only */}
                <button
                  onClick={(e) => { e.stopPropagation(); setResetTarget({ ctrlId: node.ctrl_id, portNum: node.port_num, sensorType: node.sensor_type }) }}
                  title="Reset port data"
                  className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-md bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-500"
                >
                  <svg className="w-3 h-3" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M8 2a6 6 0 1 0 5.5 3.6l1.4-1.4A8 8 0 1 1 8 0v2z"/>
                    <path d="M8 0v4L6 2l2-2z"/>
                  </svg>
                </button>
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
        onSuccess={() => setResetTarget(null)}
      />

      <ExportModal
        open={showExport}
        onClose={() => setShowExport(false)}
        deviceId={deviceId}
        ctrlId={ctrlId}
        nodes={ctrlNodes}
      />

      <MultiSensorView
        open={!!openLabel}
        onClose={() => setOpenLabel(null)}
        label={openLabel}
        deviceId={deviceId}
        ctrlId={ctrlId}
        wsRef={wsRef}
        latestData={latestData}
        onPopOut={(sensor) => {
          setOpenLabel(null)
          if (isIMUSensor(sensor.sensorType)) {
            setImu3DTarget({ ctrlId, portNum: sensor.portNum })
          } else if (Number(sensor.sensorType) === 0x13) {
            setRotaryTarget({ ctrlId, portNum: sensor.portNum })
          } else {
            setLineTarget({ ctrlId, portNum: sensor.portNum, sensorType: sensor.sensorType })
          }
        }}
      />

      {/* Label manager — sensor grouping for compare view */}
      <LabelManager
        deviceId={deviceId}
        ctrlId={ctrlId}
        displayNodes={displayNodes}
        onOpenLabel={setOpenLabel}
      />
    </div>
  )
}
