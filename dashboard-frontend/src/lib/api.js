export const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3000';

// =============================================================================
// JWT / Auth helpers
// =============================================================================

export function getToken()    { return localStorage.getItem('ciren-token'); }
export function getUsername() { return localStorage.getItem('ciren-username'); }
export function isLoggedIn()  { return !!getToken(); }

function setAuth(token, username) {
  localStorage.setItem('ciren-token',    token);
  localStorage.setItem('ciren-username', username);
}

export function clearAuth() {
  localStorage.removeItem('ciren-token');
  localStorage.removeItem('ciren-username');
}

function authHeaders() {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// =============================================================================
// Base fetch wrapper
// =============================================================================

async function apiFetch(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...(options.headers || {}),
    },
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// =============================================================================
// Auth
// =============================================================================

export async function register(username, password) {
  return apiFetch('/api/register', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
}

export async function login(username, password) {
  const data = await apiFetch('/api/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  setAuth(data.token, data.username);
  return data;
}

export function logout() {
  clearAuth();
}

// =============================================================================
// Raspi management  (protected)
// =============================================================================

export async function getRaspis() {
  return apiFetch('/api/raspis');
}

export async function addRaspi(raspberry_serial_id, label = null) {
  return apiFetch('/api/raspis', {
    method: 'POST',
    body: JSON.stringify({ raspberry_serial_id, label }),
  });
}

export async function updateRaspi(raspberry_serial_id, label) {
  return apiFetch(`/api/raspis/${encodeURIComponent(raspberry_serial_id)}`, {
    method: 'PUT',
    body: JSON.stringify({ label }),
  });
}

export async function deleteRaspi(raspberry_serial_id) {
  return apiFetch(`/api/raspis/${encodeURIComponent(raspberry_serial_id)}`, {
    method: 'DELETE',
  });
}

// =============================================================================
// Dashboard  (protected)
// =============================================================================

export async function getDashboard() {
  return apiFetch('/api/dashboard');
}

// =============================================================================
// Sensor readings
// =============================================================================

export async function getSensorReadings(params) {
  const qs = new URLSearchParams(params).toString();
  return apiFetch(`/api/sensor-readings?${qs}`);
}

export async function deleteSensorReadings(params) {
  return apiFetch('/api/sensor-readings', {
    method: 'DELETE',
    body: JSON.stringify(params),
  });
}