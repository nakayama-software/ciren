// Threshold storage — keyed per sensor, stored in localStorage as JSON
// Key format: threshold_{deviceId}_{ctrlId}_{portNum}_{sensorType}

function storageKey(deviceId, ctrlId, portNum, sensorType) {
  return `threshold_${deviceId}_${ctrlId}_${portNum}_${sensorType}`
}

export function getThreshold(deviceId, ctrlId, portNum, sensorType) {
  try {
    const raw = localStorage.getItem(storageKey(deviceId, ctrlId, portNum, sensorType))
    if (!raw) return { min: null, max: null }
    const parsed = JSON.parse(raw)
    return {
      min: parsed.min != null ? Number(parsed.min) : null,
      max: parsed.max != null ? Number(parsed.max) : null,
    }
  } catch {
    return { min: null, max: null }
  }
}

export function setThreshold(deviceId, ctrlId, portNum, sensorType, { min, max }) {
  const key = storageKey(deviceId, ctrlId, portNum, sensorType)
  const minVal = min !== '' && min != null && !isNaN(Number(min)) ? Number(min) : null
  const maxVal = max !== '' && max != null && !isNaN(Number(max)) ? Number(max) : null
  if (minVal === null && maxVal === null) {
    localStorage.removeItem(key)
  } else {
    localStorage.setItem(key, JSON.stringify({ min: minVal, max: maxVal }))
  }
}

export function clearThreshold(deviceId, ctrlId, portNum, sensorType) {
  localStorage.removeItem(storageKey(deviceId, ctrlId, portNum, sensorType))
}

// Returns true if value is outside configured threshold (if any)
export function isOutOfRange(value, threshold) {
  if (value == null || !Number.isFinite(Number(value))) return false
  const v = Number(value)
  if (threshold.min != null && v < threshold.min) return true
  if (threshold.max != null && v > threshold.max) return true
  return false
}
