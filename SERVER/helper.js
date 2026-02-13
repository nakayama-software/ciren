function normalizeHubObject(hubObj = {}) {
  const scidRaw = hubObj.sensor_controller_id ?? hubObj.sensor_controller ?? 'UNKNOWN';
  const hub_id = String(scidRaw).trim();

  if (!hub_id || hub_id.toUpperCase() === 'RASPI_SYS' || hubObj._type === 'raspi_status') return null;

  const nodes = [];

  for (let i = 1; i <= 8; i++) {
    const key = `port-${i}`;
    if (!hubObj[key]) continue;

    const raw = hubObj[key];

    const idMatch = raw.match(/ID=([^;]+)/i);
    const valMatch = raw.match(/VAL=(.+)/i);
    if (!idMatch || !valMatch) return null;

    const sensorType = String(idMatch[1] || '').trim().toLowerCase();
    const payload = String(valMatch[1] || '').trim();

    nodes.push({
      node_id: `P${i}`,
      sensor_type: sensorType,
      value: payload,
    });

  }

  return {
    hub_id,
    signal_strength: hubObj.signal_strength ?? null,
    battery_level: hubObj.battery_level ?? null,
    latitude: hubObj.latitude ?? null,
    longitude: hubObj.longitude ?? null,
    nodes,
    raw: hubObj,
  };
}