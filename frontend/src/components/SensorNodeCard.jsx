import { getSensorInfo, formatValue, isIMUSensor, getReadingKey } from '../utils/sensors'
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

export function timeAgo(ts, t) {
  if (!ts) return null
  const tr = t?.timeAgo || {}
  const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000)
  if (diff < 5) return tr.justNow || 'Just now'
  if (diff < 60) return tr.secondsAgo ? tr.secondsAgo(diff) : `${diff}s ago`
  if (diff < 3600) return tr.minutesAgo ? tr.minutesAgo(Math.floor(diff / 60)) : `${Math.floor(diff / 60)}m ago`
  return tr.hoursAgo ? tr.hoursAgo(Math.floor(diff / 3600)) : `${Math.floor(diff / 3600)}h ago`
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
  t,
}) {
  const nowMs = now || Date.now()
  const st = Number(sensorType)

  // Determine last update timestamp
  const lastTs = reading?.ts || reading?.server_ts || null
  const ago = lastTs ? timeAgo(lastTs, t) : null

  // Format absolute time (HH:MM:SS)
  const lastTimeStr = lastTs
    ? new Date(lastTs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : null

  // HumTemp already shows ago — skip duplicate footer
  const showFooter = ago && !(st === 0x01 && isHumTemp)

  // IMU sensor: render aggregated IMU card
  if (isIMUSensor(st) && latestData) {
    // For IMU, find latest timestamp across all axes
    const imuTs = [0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x10, 0x11, 0x12]
      .map(s => latestData[getReadingKey(ctrlId, portNum, s)]?.ts || latestData[getReadingKey(ctrlId, portNum, s)]?.server_ts)
      .filter(Boolean)
      .sort()
      .pop() || null
    const imuAgo = imuTs ? timeAgo(imuTs, t) : null
    const imuTimeStr = imuTs
      ? new Date(imuTs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      : null

    return (
      <div
        role="button"
        onClick={onIMU3DClick}
        className="rounded-xl border border-violet-500/20 bg-violet-500/10 p-4 hover:border-violet-500/40 transition-all cursor-pointer h-full flex flex-col"
      >
        <div className="flex-1"><IMUCard ctrlId={ctrlId} portNum={portNum} latestData={latestData} /></div>
        <div className="mt-3 pt-3 border-t border-black/10 dark:border-white/10">
          <p className="text-[10px] text-center text-violet-600 dark:text-violet-400">{t?.imu?.open3D || 'Click to open 3D view'}</p>
        </div>
        {imuAgo && (
          <p className="text-[10px] text-slate-400 dark:text-gray-500 text-right mt-1">
            {imuTimeStr} · {imuAgo}
          </p>
        )}
      </div>
    )
  }

  // HumTemp combined card — already shows "ago"
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
        t={t}
      />
    )
  }

  const sharedProps = { portNum, reading, status, onChartClick, t }

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
  return <GenericCard portNum={portNum} sensorType={sensorType} reading={reading} status={status} onChartClick={onChartClick} t={t} />
}
