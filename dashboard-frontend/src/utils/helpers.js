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

function normalizeSensorTypeRaw(s) {
  return String(s || "unknown").toLowerCase().trim();
}

const SENSOR_TYPE_ALIASES = {
  imu: "imu",
  "imu3d": "imu",
  "humtemp": "hum_temp",
  "hum_temp": "hum_temp",
  "humidity_temperature": "hum_temp",
  "humidity&temperature": "hum_temp",
  temperature: "temperature",
  temp: "temperature",
  humidity: "humidity",
  hum: "humidity",
};

export function normalizeSensorType(s) {
  const raw = normalizeSensorTypeRaw(s);
  return SENSOR_TYPE_ALIASES[raw] || raw || "unknown";
}

function parseVec3(seg) {
  // "3.92,1.56,9.15"
  const parts = String(seg || "").split(",").map((x) => toNumber(x));
  if (parts.length < 3) return null;
  const [x, y, z] = parts;
  if (x == null || y == null || z == null) return null;
  return { x, y, z };
}

function toNumber(x) {
  const n = typeof x === "number" ? x : parseFloat(String(x).trim());
  return Number.isFinite(n) ? n : null;
}

function splitSensorDataHeader(sensorData) {
  if (typeof sensorData !== "string") return null;
  const s = sensorData.trim();
  if (!s) return null;

  const i1 = s.indexOf("-");
  if (i1 < 0) return null;
  const i2 = s.indexOf("-", i1 + 1);
  if (i2 < 0) return null;

  const portStr = s.slice(0, i1);
  const typeStr = s.slice(i1 + 1, i2);
  const payload = s.slice(i2 + 1);

  const port = toNumber(portStr);
  if (!port) return null;

  return {
    port_number: port,
    sensor_type: normalizeSensorType(typeStr),
    payload,
  };
}

function buildReadingsFromPayload(sensorType, payload) {
  const st = normalizeSensorType(sensorType);
  const p = String(payload || "").trim();

  if (!p) return { readings: [], extra: {} };

  const pipe = p.split("|").map((x) => x.trim()).filter(Boolean);
  const comma = p.split(",").map((x) => x.trim()).filter(Boolean);

  // ---- IMU e.g.:
  // "3.92,1.56,9.15|0.00,-0.01,-0.00|29.28"
  if (st === "imu") {
    const accel = parseVec3(pipe[0]);
    const gyro = parseVec3(pipe[1]);
    const tempC = toNumber(pipe[2]);

    const readings = [];

    if (accel) {
      readings.push(
        { key: "ax", label: "Accel X", value: accel.x, unit: "" },
        { key: "ay", label: "Accel Y", value: accel.y, unit: "" },
        { key: "az", label: "Accel Z", value: accel.z, unit: "" },
      );
    }
    if (gyro) {
      readings.push(
        { key: "gx", label: "Gyro X", value: gyro.x, unit: "" },
        { key: "gy", label: "Gyro Y", value: gyro.y, unit: "" },
        { key: "gz", label: "Gyro Z", value: gyro.z, unit: "" },
      );
    }
    if (tempC != null) {
      readings.push({ key: "temp", label: "Temperature", value: tempC, unit: "°C" });
    }

    return { readings, extra: { imu: { accel, gyro, tempC } } };
  }

  // ---- Humidity & Temperature (heuristic)
  // bisa "45.2|26.7" atau "45.2,26.7"
  if (st === "hum_temp") {
    const a = toNumber(pipe[0] ?? comma[0]);
    const b = toNumber(pipe[1] ?? comma[1]);

    // heuristik: humidity biasanya 0..100
    let humidity = null;
    let temperature = null;

    if (a != null && b != null) {
      if (a >= 0 && a <= 100) {
        humidity = a;
        temperature = b;
      } else if (b >= 0 && b <= 100) {
        humidity = b;
        temperature = a;
      } else {
        // fallback: a=humidity, b=temp
        humidity = a;
        temperature = b;
      }
    }

    const readings = [];
    if (humidity != null) readings.push({ key: "humidity", label: "Humidity", value: humidity, unit: "%" });
    if (temperature != null) readings.push({ key: "temperature", label: "Temperature", value: temperature, unit: "°C" });
    return { readings, extra: {} };
  }

  // ---- Single-value sensors: temperature / humidity / default numeric
  if (st === "temperature") {
    const v = toNumber(pipe[0] ?? comma[0] ?? p);
    return {
      readings: v != null ? [{ key: "temperature", label: "Temperature", value: v, unit: "°C" }] : [],
      extra: {},
    };
  }

  if (st === "humidity") {
    const v = toNumber(pipe[0] ?? comma[0] ?? p);
    return {
      readings: v != null ? [{ key: "humidity", label: "Humidity", value: v, unit: "%" }] : [],
      extra: {},
    };
  }

  // ---- Generic fallback: kalau ada angka, pakai yang pertama
  const v = toNumber(pipe[0] ?? comma[0] ?? p);
  return {
    readings: v != null ? [{ key: "value", label: "Value", value: v, unit: "" }] : [],
    extra: {},
  };
}

/** Normalize node object from API to include parsed readings */
export function normalizeSensorNode(node) {
  if (!node || typeof node !== "object") {
    return { node_id: null, port_number: null, sensor_type: "unknown", readings: [], unit: "" };
  }

  const out = { ...node };

  // 1) port_number / node_id
  const portFromField = toNumber(out.port_number);
  let port = portFromField;

  // 2) parse sensor_data jika ada
  const parsed = splitSensorDataHeader(out.sensor_data);

  if (!port && parsed?.port_number) port = parsed.port_number;

  // Set node_id kalau belum ada
  if (!out.node_id && port) out.node_id = `P${port}`;
  // Set port_number kalau belum ada
  if (out.port_number == null && port) out.port_number = port;

  // 3) sensor_type
  const currentType = normalizeSensorType(out.sensor_type);
  const parsedType = parsed?.sensor_type || "unknown";
  out.sensor_type = (currentType && currentType !== "unknown") ? currentType : parsedType;

  // 4) readings
  const existingReadings = Array.isArray(out.readings) ? out.readings : [];
  if (existingReadings.length > 0) {
    out.readings = existingReadings;
    return out;
  }

  const { readings, extra } = buildReadingsFromPayload(out.sensor_type, parsed?.payload);
  out.readings = readings || [];

  // optional: simpan hasil parse buat komponen lain (imu card / modal)
  if (extra && Object.keys(extra).length) out.parsed = extra;

  // optional: fallback value untuk renderer lama
  if (out.value == null && out.readings.length > 0) out.value = out.readings[0].value;

  return out;
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
