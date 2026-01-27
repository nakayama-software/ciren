export function inferUnit(type) {
  switch (type) {
    case "temperature": return "°C";
    case "humidity": return "%";
    case "pressure": return "hPa";
    case "ultrasonic": return "cm";
    case "light":
    case "light_intensity": return "lux";
    case "voltage": return "V";
    case "current": return "A";
    default: return "";
  }
}

// Backward-compat parser: "temperature-26.8°C"
export function parseTypeValue(raw) {
  if (!raw || typeof raw !== "string" || !raw.includes("-"))
    return { type: "unknown", value: raw, unit: "" };

  const [typeRaw, valRaw] = raw.split("-", 2);
  const type = typeRaw.trim().toLowerCase();

  const match = String(valRaw).trim().match(/^(-?\d+(?:\.\d+)?)(.*)$/);
  if (!match) return { type, value: valRaw.trim(), unit: "" };

  const num = Number(match[1]);
  const unit = match[2].trim() || inferUnit(type);

  return {
    type: type === "light" ? "light_intensity" : type,
    value: Number.isNaN(num) ? valRaw.trim() : num,
    unit,
  };
}

// ============================
// New sensor payload format (template)
// Example: "ID=humidity;VAL=26.80,40.50"
// ============================

function cleanId(id) {
  return String(id || "")
    .trim()
    .replace(/^\[|\]$/g, "")
    .toLowerCase();
}

function toNumberMaybe(x) {
  const s = String(x ?? "").trim();
  if (s === "" || /^na$/i.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse node.value with template: ID=<type>;VAL=<payload>
 * Returns: { sensor_type, readings[] }
 */
export function parseTemplateSensorValue(rawValue) {
  if (rawValue == null) return { sensor_type: "unknown", readings: [] };

  const s = String(rawValue).trim();
  const mId = s.match(/(?:^|\s)ID\s*=\s*([^;]+)\s*;/i);
  const mVal = s.match(/VAL\s*=\s*(.+)$/i);

  // Fallback: backend already sent a plain value
  if (!mId || !mVal) {
    const n = toNumberMaybe(s);
    if (n != null) {
      return {
        sensor_type: "unknown",
        readings: [{ key: "value", label: "Value", value: n, unit: "", raw: s }],
      };
    }
    return {
      sensor_type: "unknown",
      readings: [{ key: "value", label: "Value", value: s, unit: "", raw: s }],
    };
  }

  const id = cleanId(mId[1]);
  const payload = String(mVal[1] ?? "").trim();

  // Canonicalize ids
  const sensor_type = (() => {
    if (id === "us" || id === "ultrasonic") return "ultrasonic";
    if (id === "humidity" || id === "humidity_i2c") return "humidity";
    if (id === "imu") return "imu";
    return id || "unknown";
  })();

  // humidity: "<temp>,<hum>"
  if (sensor_type === "humidity") {
    const [tRaw, hRaw] = payload.split(",").map((x) => x.trim());
    const tNum = toNumberMaybe(tRaw);
    const hNum = toNumberMaybe(hRaw);
    const readings = [];

    console.log("helper 11",payload);
    
    if (tNum != null)
      readings.push({ key: "temperature", label: "Temperature", value: tNum, unit: inferUnit("temperature"), raw: tRaw });
    if (hNum != null)
      readings.push({ key: "humidity", label: "Humidity", value: hNum, unit: inferUnit("humidity"), raw: hRaw });
    if (readings.length === 0)
      readings.push({ key: "status", label: "Status", value: payload, unit: "", raw: payload });
    return { sensor_type, readings };
  }

  // imu: "ax,ay,az| gx,gy,gz| temp"
  if (sensor_type === "imu") {
    const parts = payload.split("|").map((x) => x.trim()).filter(Boolean);
    const readings = [];
    const accel = (parts[0] || "").split(",").map((x) => x.trim());
    const gyro = (parts[1] || "").split(",").map((x) => x.trim());
    const tempRaw = parts[2] || "";

    ["ax", "ay", "az"].forEach((k, i) => {
      const v = toNumberMaybe(accel[i]);
      if (v != null) readings.push({ key: `accel_${k}`, label: `Accel ${k.toUpperCase()}`, value: v, unit: "m/s²", raw: accel[i] });
    });
    ["gx", "gy", "gz"].forEach((k, i) => {
      const v = toNumberMaybe(gyro[i]);
      if (v != null) readings.push({ key: `gyro_${k}`, label: `Gyro ${k.toUpperCase()}`, value: v, unit: "rad/s", raw: gyro[i] });
    });
    const t = toNumberMaybe(tempRaw);
    if (t != null) readings.push({ key: "temperature", label: "Temp", value: t, unit: inferUnit("temperature"), raw: tempRaw });
    if (readings.length === 0) readings.push({ key: "status", label: "Status", value: payload, unit: "", raw: payload });
    return { sensor_type, readings };
  }

  // rotary_sensor: "CW,<steps>" / "CCW,<steps>"
  if (sensor_type === "rotary_sensor") {
    const [dir, stepsRaw] = payload.split(",").map((x) => x.trim());
    const steps = toNumberMaybe(stepsRaw);
    const readings = [{ key: "direction", label: "Direction", value: dir || "—", unit: "", raw: dir }];
    if (steps != null) readings.push({ key: "steps", label: "Steps", value: steps, unit: "", raw: stepsRaw });
    return { sensor_type, readings };
  }

  // vibration: True/False
  if (sensor_type === "vibration") {
    const v = String(payload).trim();
    const norm = /^true$/i.test(v) ? true : /^false$/i.test(v) ? false : v;
    return {
      sensor_type,
      readings: [{ key: "vibration", label: "Vibration", value: norm, unit: "", raw: payload }],
    };
  }

  // Default: numeric single / numeric list
  const parts = payload.split(",").map((x) => x.trim());
  const nums = parts.map(toNumberMaybe);
  const allNumeric = nums.length > 0 && nums.every((v) => v != null);
  if (allNumeric && nums.length > 1) {
    return {
      sensor_type,
      readings: nums.map((v, i) => ({ key: `v${i + 1}`, label: `Value ${i + 1}`, value: v, unit: inferUnit(sensor_type), raw: parts[i] })),
    };
  }
  const n = toNumberMaybe(payload);
  if (n != null) {
    return {
      sensor_type,
      readings: [{ key: "value", label: "Value", value: n, unit: inferUnit(sensor_type), raw: payload }],
    };
  }
  return {
    sensor_type,
    readings: [{ key: "value", label: "Value", value: payload, unit: "", raw: payload }],
  };
}

/** Normalize node object from API to include parsed readings */
export function normalizeSensorNode(node) {
  const parsed = parseTemplateSensorValue(node?.value);
  const primary = parsed.readings.find((r) => typeof r?.value === "number") || parsed.readings[0] || null;
  return {
    ...node,
    sensor_type: node?.sensor_type && node.sensor_type !== "unknown" ? node.sensor_type : parsed.sensor_type,
    readings: parsed.readings,
    // keep compatibility with legacy UI (single value)
    value: primary && typeof primary.value === "number" ? primary.value : (primary?.value ?? node?.value),
    unit: node?.unit || (primary?.unit ?? ""),
  };
}

export function fmtHHMMSS(sec) {
  if (!Number.isFinite(sec)) return "00:00:00";
  const s = Math.max(0, Math.floor(sec));
  const h = String(Math.floor(s / 3600)).padStart(2, "0");
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${h}:${m}:${ss}`;
}

export function fmtJaTime(date, locale) {
  if (locale !== "ja-JP") return date.toLocaleString(locale);

  const parts = new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    weekday: "short",
  }).formatToParts(date);

  const get = (t) => parts.find((p) => p.type === t)?.value || "";
  return `${get("year")}/${get("month")}/${get("day")}(${get("weekday")}) ${get("hour")}:${get("minute")}:${get("second")}`;
}
