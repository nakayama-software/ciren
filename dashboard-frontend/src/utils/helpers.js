export function inferUnit(type) {
  switch (type) {
    case "temperature": return "°C";
    case "humidity": return "%";
    case "pressure": return "hPa";
    case "ultrasonic": return "cm";
    case "light":
    case "light_intensity": return "lux";
    default: return "";
  }
}

export function parseTypeValue(raw) {
  if (!raw || typeof raw !== "string" || !raw.includes("-"))
    return { type: "unknown", value: raw, unit: "" };

  const [typeRaw, valRaw] = raw.split("-", 2);
  const type = typeRaw.trim().toLowerCase();

  const match = String(valRaw).trim().match(/^(-?\d+(?:\.\d+)?)(.*)$/);
  if (!match)
    return { type, value: valRaw.trim(), unit: "" };

  const num = Number(match[1]);
  const unit = match[2].trim() || inferUnit(type);

  return {
    type: type === "light" ? "light_intensity" : type,
    value: Number.isNaN(num) ? valRaw.trim() : num,
    unit,
  };
}

export function fmtHHMMSS(sec) {
  if (!Number.isFinite(sec)) return "00:00:00";
  const s = Math.max(0, Math.floor(sec));
  const h = String(Math.floor(s / 3600)).padStart(2, '0');
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${h}:${m}:${ss}`;
}

export function fmtJaTime(date, locale) {
  if (locale !== 'ja-JP') return date.toLocaleString(locale);

  const parts = new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false, weekday: 'short'
  }).formatToParts(date);

  const get = (t) => parts.find(p => p.type === t)?.value || '';
  return `${get('year')}/${get('month')}/${get('day')}(${get('weekday')}) ${get('hour')}:${get('minute')}:${get('second')}`;
}
