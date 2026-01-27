// src/utils/sensorParser.js - UPDATED VERSION
export function parseSensorValue(rawValue) {
  if (!rawValue || typeof rawValue !== 'string') {
    return null;
  }

  // Clean up value: remove underscores, extra spaces
  const cleanValue = rawValue.replace(/_/g, ' ').trim();

  const idMatch = cleanValue.match(/ID=([^;]+)/);
  const valMatch = cleanValue.match(/VAL=(.+)/);

  if (!idMatch || !valMatch) {
    console.warn('Parser: Invalid format', cleanValue);
    return null;
  }

  const sensorId = idMatch[1].trim().toLowerCase();
  const valueStr = valMatch[1].trim();

  switch (sensorId) {
    case 'humidity':
      return parseHumidity(valueStr);
    case 'voltage':
      return parseVoltage(valueStr);
    case 'current':
      return parseCurrent(valueStr);
    case 'rotary_sensor':
    case 'encoder':
      return parseRotaryEncoder(valueStr);
    case 'imu':
      return parseIMU(valueStr);
    case 'us':
    case 'ultrasonic':
      return parseUltrasonic(valueStr);
    case 'vibration':
      return parseVibration(valueStr);
    default:
      return parseGeneric(sensorId, valueStr);
  }
}

function parseIMU(valueStr) {
  // Split by pipe, trim all whitespace
  const sections = valueStr.split('|').map(s => s.trim());
  
  if (sections.length === 3) {
    // Split by comma, handle spaces flexibly
    const acc = sections[0].split(',').map(v => parseFloat(v.trim()));
    const gyro = sections[1].split(',').map(v => parseFloat(v.trim()));
    const temp = parseFloat(sections[2].trim());
    
    // Validate we have 3 values each
    if (acc.length === 3 && gyro.length === 3 && !isNaN(temp)) {
      return {
        sensor_type: 'imu',
        data: {
          accelerometer: { x: acc[0] || 0, y: acc[1] || 0, z: acc[2] || 0 },
          gyroscope: { x: gyro[0] || 0, y: gyro[1] || 0, z: gyro[2] || 0 },
          temperature: temp
        },
        display: {
          primary: { value: acc[2], unit: 'm/s²', label: 'Acceleration Z' },
          secondary: { value: temp, unit: '°C', label: 'Temperature' }
        }
      };
    }
  }
  
  console.warn('IMU parse failed:', valueStr);
  return null;
}

// Keep other functions same...
function parseHumidity(valueStr) {
  const parts = valueStr.split(',').map(v => parseFloat(v.trim()));
  
  if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
    return {
      sensor_type: 'humidity',
      data: {
        temperature: parts[0],
        humidity: parts[1]
      },
      display: {
        primary: { value: parts[1], unit: '%', label: 'Humidity' },
        secondary: { value: parts[0], unit: '°C', label: 'Temperature' }
      }
    };
  }
  return null;
}

function parseVoltage(valueStr) {
  const voltage = parseFloat(valueStr.trim());
  if (isNaN(voltage)) return null;
  
  return {
    sensor_type: 'voltage',
    data: { voltage: voltage },
    display: {
      primary: { value: voltage, unit: 'V', label: 'Voltage' }
    }
  };
}

function parseCurrent(valueStr) {
  const current = parseFloat(valueStr.trim());
  if (isNaN(current)) return null;
  
  return {
    sensor_type: 'current',
    data: { current: current },
    display: {
      primary: { value: current, unit: 'A', label: 'Current' }
    }
  };
}

function parseRotaryEncoder(valueStr) {
  const parts = valueStr.split(',').map(v => v.trim());
  
  if (parts.length === 2) {
    const count = parseInt(parts[1]);
    if (!isNaN(count)) {
      return {
        sensor_type: 'rotary_encoder',
        data: {
          direction: parts[0],
          count: count
        },
        display: {
          primary: { value: parts[0], unit: '', label: 'Direction' },
          secondary: { value: count, unit: 'steps', label: 'Count' }
        }
      };
    }
  }
  return null;
}

function parseUltrasonic(valueStr) {
  const distance = parseFloat(valueStr.trim());
  if (isNaN(distance)) return null;
  
  return {
    sensor_type: 'ultrasonic',
    data: { distance: distance },
    display: {
      primary: { value: distance, unit: 'cm', label: 'Distance' }
    }
  };
}

function parseVibration(valueStr) {
  const val = parseInt(valueStr.trim());
  const detected = val === 1;
  
  return {
    sensor_type: 'vibration',
    data: { detected: detected },
    display: {
      primary: { value: detected ? 'DETECTED' : 'CLEAR', unit: '', label: 'Vibration' }
    }
  };
}

function parseGeneric(sensorId, valueStr) {
  return {
    sensor_type: sensorId,
    data: { raw: valueStr },
    display: {
      primary: { value: valueStr, unit: '', label: sensorId }
    }
  };
}

export function formatForDashboard(parsed, nodeId, status = 'online') {
  if (!parsed) return null;

  const display = parsed.display.primary;

  return {
    node_id: nodeId,
    sensor_type: parsed.sensor_type,
    value: display.value,
    unit: display.unit,
    status: status,
    _raw_data: parsed.data,
    _parsed: parsed
  };
}
