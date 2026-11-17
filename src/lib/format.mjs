const DATE_TIME = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

const DATE_TIME_SHORT = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

const UTC_DATE_TIME = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'UTC',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

export function formatDateTime(value) {
  if (!value) return '未知'
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return '未知'
  return DATE_TIME.format(date)
}

export function formatDateTimeShort(value) {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return DATE_TIME_SHORT.format(date)
}

export function formatUtc(value) {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return `${UTC_DATE_TIME.format(date)} UTC`
}

export function formatDateTimeAttribute(value) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString()
}

export function formatNumber(value) {
  return Number(value || 0).toLocaleString('zh-CN')
}

export function nextHourLabel(value) {
  const date = value instanceof Date ? new Date(value) : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  date.setUTCMinutes(0, 0, 0)
  date.setUTCHours(date.getUTCHours() + 1)
  return `${String(date.getUTCHours()).padStart(2, '0')}:00 UTC`
}
