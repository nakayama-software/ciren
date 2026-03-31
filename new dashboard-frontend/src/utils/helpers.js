export function fmtHHMMSS(sec) {
  if (!Number.isFinite(sec)) return '00:00:00'
  const s = Math.max(0, Math.floor(sec))
  const h = String(Math.floor(s / 3600)).padStart(2, '0')
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0')
  const ss = String(s % 60).padStart(2, '0')
  return `${h}:${m}:${ss}`
}

export function fmtJaTime(date, locale) {
  if (locale !== 'ja-JP') return date.toLocaleString(locale)
  const parts = new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false, weekday: 'short',
  }).formatToParts(date)
  const get = (t) => parts.find((p) => p.type === t)?.value || ''
  return `${get('year')}/${get('month')}/${get('day')}(${get('weekday')}) ${get('hour')}:${get('minute')}:${get('second')}`
}
