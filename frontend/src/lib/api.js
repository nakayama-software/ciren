const BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3000'

// ─── Token / Auth helpers ─────────────────────────
export function getToken()    { return localStorage.getItem('ciren-token') }
export function getUsername() { return localStorage.getItem('ciren-username') || '' }
export function isLoggedIn()  { return !!getToken() }

export function setToken(token) {
  localStorage.setItem('ciren-token', token)
}

export function clearToken() {
  localStorage.removeItem('ciren-token')
}

export function setUsername(uname) {
  localStorage.setItem('ciren-username', uname)
}

export function clearAuth() {
  localStorage.removeItem('ciren-token')
  localStorage.removeItem('ciren-username')
}

export function logout() {
  clearAuth()
}

function authHeaders() {
  const token = getToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export async function apiFetch(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...(opts.headers || {}),
    },
    ...opts,
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}

// ─── Auth ────────────────────────────────────────
export async function login(username, password) {
  return apiFetch('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })
}

export async function register(username, password) {
  return apiFetch('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })
}

// ─── User device management ──────────────────────
export async function getUserDevices() {
  const data = await apiFetch('/api/user/devices')
  return data.devices || []
}

export async function addUserDevice(device_id) {
  return apiFetch('/api/user/devices', {
    method: 'POST',
    body: JSON.stringify({ device_id }),
  })
}

export async function removeUserDevice(device_id) {
  return apiFetch(`/api/user/devices/${encodeURIComponent(device_id)}`, {
    method: 'DELETE',
  })
}

// ─── Device data ─────────────────────────────────
export function getDevices() {
  return apiFetch('/api/devices')
}

export function getDevice(id) {
  return apiFetch(`/api/devices/${id}`)
}

export function getLatest(id) {
  return apiFetch(`/api/devices/${id}/data/latest`)
}

// Get recent data (multi-stype) for initial IMU snapshot
export function getDeviceData(id, ctrl_id, port_num, limit = 50) {
  let url = `/api/devices/${id}/data?limit=${limit}`
  if (ctrl_id !== undefined) url += `&ctrl_id=${ctrl_id}`
  if (port_num !== undefined) url += `&port_num=${port_num}`
  return apiFetch(url)
}

// Public — tidak butuh token, dipakai login page
export async function getPublicStats() {
  const res = await fetch(`${BASE}/api/stats`)
  if (!res.ok) throw new Error('stats unavailable')
  return res.json()
}

export function getHistory(id, ctrl_id, port_num, hours = 24, sensor_type) {
  let url = `/api/devices/${id}/data/history?ctrl_id=${ctrl_id}&port_num=${port_num}&hours=${hours}`
  if (sensor_type !== undefined && sensor_type !== null) {
    url += `&sensor_type=${sensor_type}`
  }
  return apiFetch(url)
}

// ─── Node interval config ─────────────────────────
export function getNodeConfig(deviceId) {
  return apiFetch(`/api/devices/${encodeURIComponent(deviceId)}/node-config`)
}

export function setNodeConfig(deviceId, ctrl_id, port_num, interval_ms) {
  return apiFetch(`/api/devices/${encodeURIComponent(deviceId)}/node-config`, {
    method: 'POST',
    body: JSON.stringify({ ctrl_id, port_num, interval_ms }),
  })
}

export function verifyNodeConfig(deviceId, ctrl_id, port_num) {
  let url = `/api/devices/${encodeURIComponent(deviceId)}/node-config/verify`
  const params = []
  if (ctrl_id != null)  params.push(`ctrl_id=${ctrl_id}`)
  if (port_num != null) params.push(`port_num=${port_num}`)
  if (params.length) url += '?' + params.join('&')
  return apiFetch(url)
}
