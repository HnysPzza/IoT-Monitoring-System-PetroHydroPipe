const DATE_LOCALE = 'en-PH'

export function formatDateOnly(value, fallback = 'Not available') {
  if (!value) {
    return fallback
  }

  return new Date(value).toLocaleDateString(DATE_LOCALE, {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
  })
}

export function formatDateTime(value, fallback = 'Not available', options = {}) {
  if (!value) {
    return fallback
  }

  return new Date(value).toLocaleString(DATE_LOCALE, options)
}

export function formatShortDateTime(value, fallback = 'Not available') {
  return formatDateTime(value, fallback, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatLiveDateTime(value, fallback = 'No event yet') {
  return formatDateTime(value, fallback, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export function formatNumber(value) {
  return Number(value || 0).toLocaleString(DATE_LOCALE)
}

export function cleanCode(value, fallback = 'Recorded') {
  if (!value) {
    return fallback
  }

  return String(value)
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}
