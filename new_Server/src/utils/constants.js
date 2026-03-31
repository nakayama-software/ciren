// CIREN sensor type constants
// Harus sinkron dengan ciren_frame.h di firmware

const STYPE = {
  TEMPERATURE: 0x01,
  HUMIDITY:    0x02,
  ACCEL_X:     0x03,
  ACCEL_Y:     0x04,
  ACCEL_Z:     0x05,
  GYRO_X:      0x06,
  GYRO_Y:      0x07,
  GYRO_Z:      0x08,
  DISTANCE:    0x09,
  TEMP_1WIRE:  0x0A,
  PITCH:       0x10,
  ROLL:        0x11,
  YAW:         0x12,
}

const STYPE_LABEL = {
  [STYPE.TEMPERATURE]: { label: 'Temperature', unit: '°C' },
  [STYPE.HUMIDITY]:    { label: 'Humidity',    unit: '%RH' },
  [STYPE.ACCEL_X]:     { label: 'Accel X',     unit: 'm/s²' },
  [STYPE.ACCEL_Y]:     { label: 'Accel Y',     unit: 'm/s²' },
  [STYPE.ACCEL_Z]:     { label: 'Accel Z',     unit: 'm/s²' },
  [STYPE.GYRO_X]:      { label: 'Gyro X',      unit: 'rad/s' },
  [STYPE.GYRO_Y]:      { label: 'Gyro Y',      unit: 'rad/s' },
  [STYPE.GYRO_Z]:      { label: 'Gyro Z',      unit: 'rad/s' },
  [STYPE.DISTANCE]:    { label: 'Distance',    unit: 'cm' },
  [STYPE.TEMP_1WIRE]:  { label: 'Temperature', unit: '°C' },
  [STYPE.PITCH]:       { label: 'Pitch',       unit: '°' },
  [STYPE.ROLL]:        { label: 'Roll',        unit: '°' },
  [STYPE.YAW]:         { label: 'Yaw',         unit: '°' },
}

const FTYPE = {
  DATA:        0x01,
  HELLO:       0x02,
  HEARTBEAT:   0x03,
  DATA_TYPED:  0x04,
  HB_TYPED:    0x05,
  ERROR:       0xFF,
  STALE:       0xFE,
}

module.exports = { STYPE, STYPE_LABEL, FTYPE }
