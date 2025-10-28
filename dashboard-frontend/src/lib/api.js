export const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3000';

export async function resolveUsername(username) {
  const res = await fetch(`${API_BASE}/api/resolve/${username}`);
  if (!res.ok) throw new Error('resolve failed');
  return res.json();
}

export async function getDataForRaspi(raspi) {
  const res = await fetch(`${API_BASE}/api/data/${raspi}`);
  if (!res.ok) throw new Error('getData failed');
  return res.json(); // expect array of entries
}