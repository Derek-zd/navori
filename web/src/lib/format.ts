export function timeAgo(value?: string): string {
  if (!value) return '—'
  const t = new Date(value).getTime()
  if (isNaN(t)) return '—'
  const diff = Date.now() - t
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return Math.floor(diff / 60_000) + ' 分钟前'
  if (diff < 86_400_000) return Math.floor(diff / 3_600_000) + ' 小时前'
  if (diff < 7 * 86_400_000) return Math.floor(diff / 86_400_000) + ' 天前'
  return new Date(t).toLocaleDateString()
}

export function formatDuration(start?: string, end?: string): string {
  if (!start) return ''
  const a = new Date(start).getTime()
  const b = end ? new Date(end).getTime() : Date.now()
  if (isNaN(a) || isNaN(b) || b < a) return ''
  const s = Math.round((b - a) / 1000)
  if (s < 60) return s + 's'
  const m = Math.floor(s / 60)
  const rest = s % 60
  if (m < 60) return m + 'm' + (rest ? rest + 's' : '')
  const h = Math.floor(m / 60)
  return h + 'h' + (m % 60 ? (m % 60) + 'm' : '')
}

export function formatDateTime(value?: string): string {
  if (!value) return '—'
  const d = new Date(value)
  return isNaN(d.getTime()) ? '—' : d.toLocaleString()
}
