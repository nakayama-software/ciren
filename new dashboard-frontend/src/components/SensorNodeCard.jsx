import { getSensorInfo, formatValue, isIMUSensor } from '../utils/sensors'
import IMUCard from './sensors/IMUCard'
import HumTempCard from './sensors/HumTempCard'
import TemperatureCard from './sensors/TemperatureCard'
import VoltageCard from './sensors/VoltageCard'
import CurrentCard from './sensors/CurrentCard'
import UltrasonicCard from './sensors/UltrasonicCard'
import LightIntensityCard from './sensors/LightIntensityCard'
import PressureCard from './sensors/PressureCard'
import InfraredCard from './sensors/InfraredCard'
import RotaryCard from './sensors/RotaryCard'
import GenericCard from './sensors/GenericCard'

function timeAgo(ts) {
  if (!ts) return null
  const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000)
  if (diff < 5) return 'Just now'
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  return `${Math.floor(diff / 3600)}h ago`
}

export default function SensorNodeCard({
  deviceId,
  ctrlId,
  portNum,
  sensorType,
  reading,
  status,
  now,
  latestData,
  isHumTemp,
  onChartClick,
  onIMU3DClick,
}) {
  const nowMs = now || Date.now()
  const st = Number(sensorType)

  // IMU sensor: render aggregated IMU card
  if (isIMUSensor(st) && latestData) {
    return (
      <div
        role="button"
        onClick={onIMU3DClick}
        className="rounded-xl border border-violet-500/20 bg-violet-500/10 p-4 hover:border-violet-500/40 transition-all cursor-pointer h-full flex flex-col"
      >
        <div className="flex-1"><IMUCard ctrlId={ctrlId} portNum={portNum} latestData={latestData} /></div>
        <div className="mt-3 pt-3 border-t border-black/10 dark:border-white/10">
          <p className="text-[10px] text-center text-violet-600 dark:text-violet-400">Click to open 3D view</p>
        </div>
      </div>
    )
  }

  // HumTemp combined card
  if (st === 0x01 && isHumTemp) {
    return (
      <HumTempCard
        deviceId={deviceId}
        ctrlId={ctrlId}
        portNum={portNum}
        latestData={latestData}
        status={status}
        now={nowMs}
        onChartClick={onChartClick}
      />
    )
  }

  const sharedProps = { portNum, reading, status, onChartClick }

  // Standalone temperature (1-Wire DS18B20 or 0x01 without humidity)
  if (st === 0x0A || st === 0x01) return <TemperatureCard {...sharedProps} />
  if (st === 0x0B) return <VoltageCard {...sharedProps} />
  if (st === 0x0C) return <CurrentCard {...sharedProps} />
  if (st === 0x09) return <UltrasonicCard {...sharedProps} />
  if (st === 0x0D) return <LightIntensityCard {...sharedProps} />
  if (st === 0x0E) return <PressureCard {...sharedProps} />
  if (st === 0x0F) return <InfraredCard {...sharedProps} />
  if (st === 0x13) return <RotaryCard {...sharedProps} />

  // Vibration and unknown types
  return <GenericCard portNum={portNum} sensorType={sensorType} reading={reading} status={status} onChartClick={onChartClick} />
}
