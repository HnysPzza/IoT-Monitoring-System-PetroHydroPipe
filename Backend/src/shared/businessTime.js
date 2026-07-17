const BUSINESS_TIME_ZONE = 'Asia/Manila'
const BUSINESS_UTC_OFFSET = '+08:00'
const DAY_MS = 24 * 60 * 60 * 1000

function getBusinessDateParts(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value))

  return Object.fromEntries(parts.map((part) => [part.type, part.value]))
}

function formatBusinessDate(value = new Date()) {
  const { year, month, day } = getBusinessDateParts(value)
  return `${year}-${month}-${day}`
}

function parseBusinessDate(value) {
  const dateValue = value || formatBusinessDate()
  return new Date(`${dateValue}T00:00:00${BUSINESS_UTC_OFFSET}`)
}

function startOfBusinessDay(value = new Date()) {
  return parseBusinessDate(formatBusinessDate(value))
}

function addBusinessDays(value, days) {
  return new Date(new Date(value).getTime() + (days * DAY_MS))
}

function startOfBusinessWeek(value) {
  const start = startOfBusinessDay(value)
  const localDay = new Date(start.getTime() + (8 * 60 * 60 * 1000)).getUTCDay() || 7
  return addBusinessDays(start, 1 - localDay)
}

function startOfBusinessMonth(value) {
  const { year, month } = getBusinessDateParts(value)
  return parseBusinessDate(`${year}-${month}-01`)
}

function addBusinessMonths(value, months) {
  const { year, month } = getBusinessDateParts(value)
  const target = new Date(Date.UTC(Number(year), Number(month) - 1 + months, 1))
  const targetYear = target.getUTCFullYear()
  const targetMonth = String(target.getUTCMonth() + 1).padStart(2, '0')
  return parseBusinessDate(`${targetYear}-${targetMonth}-01`)
}

function getBusinessDayRange(dateValue) {
  const start = parseBusinessDate(dateValue)
  return { start, end: addBusinessDays(start, 1) }
}

function formatBusinessTime(value, options = {}) {
  return new Date(value).toLocaleTimeString('en-PH', {
    timeZone: BUSINESS_TIME_ZONE,
    ...options,
  })
}

function formatBusinessWeekday(value) {
  return new Date(value).toLocaleDateString('en-PH', {
    timeZone: BUSINESS_TIME_ZONE,
    weekday: 'short',
  })
}

module.exports = {
  BUSINESS_TIME_ZONE,
  addBusinessDays,
  addBusinessMonths,
  formatBusinessDate,
  formatBusinessTime,
  formatBusinessWeekday,
  getBusinessDayRange,
  parseBusinessDate,
  startOfBusinessDay,
  startOfBusinessMonth,
  startOfBusinessWeek,
}
