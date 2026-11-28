const MANILA_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Manila',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

const MANILA_DATETIME_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Manila',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
})

const STEEL_DENSITY_KG_PER_M3 = 7850

export const PRODUCTION_EDIT_ROLES = new Set([
  'Admin',
  'Operation Manager',
  'Production Supervisor',
  'Quality Control',
])

export const SPEC_STATUS_OPTIONS = [
  { value: 'all', label: 'All Specifications' },
  { value: 'specified', label: 'Specified' },
  { value: 'unspecified', label: 'Unspecified' },
]

export function getManilaDateInputValue() {
  return MANILA_DATE_FORMATTER.format(new Date())
}

export function parseProductionDate(value) {
  if (!value) return undefined
  const [year, month, day] = String(value).split('-').map(Number)
  if (!year || !month || !day) return undefined
  return new Date(year, month - 1, day)
}

export function formatManilaDateTime(isoString) {
  if (!isoString) return '—'
  const date = new Date(isoString)
  if (isNaN(date.getTime())) return '—'
  return MANILA_DATETIME_FORMATTER.format(date).replace(', ', ' ')
}

export function formatDimension(value) {
  if (value === null || value === undefined || isNaN(Number(value))) return null
  return Number(value).toFixed(2)
}

export function formatTonnage(value) {
  if (value === null || value === undefined || isNaN(Number(value))) return null
  return Number(value).toFixed(4)
}

export function calculatePipeTonnage(diameter, thickness, length) {
  if (diameter == null || thickness == null || length == null) return null
  if (typeof diameter === 'string' && diameter.trim() === '') return null
  if (typeof thickness === 'string' && thickness.trim() === '') return null
  if (typeof length === 'string' && length.trim() === '') return null
  const d = Number(diameter)
  const t = Number(thickness)
  const l = Number(length)
  if (!Number.isFinite(d) || !Number.isFinite(t) || !Number.isFinite(l)) return null
  if (d <= 0 || t <= 0 || l <= 0 || d <= t) return null
  const weightKgPerMeter = Math.PI * (d - t) * t * (STEEL_DENSITY_KG_PER_M3 / 1000000)
  const totalWeightTons = (weightKgPerMeter * l) / 1000000
  const rounded = Math.round(totalWeightTons * 10000) / 10000
  return rounded > 0 ? rounded : null
}

export function hasInformation(record) {
  if (!record) return false
  if (record.isSpecified) return true
  if (record.customer && String(record.customer).trim() !== '') return true
  if (record.diameter !== null && record.diameter !== undefined && record.diameter !== '' && !isNaN(Number(record.diameter))) return true
  if (record.thickness !== null && record.thickness !== undefined && record.thickness !== '' && !isNaN(Number(record.thickness))) return true
  if (record.length !== null && record.length !== undefined && record.length !== '' && !isNaN(Number(record.length))) return true
  if (record.tonnage !== null && record.tonnage !== undefined && record.tonnage !== '' && !isNaN(Number(record.tonnage))) return true
  if (record.label && String(record.label).trim() !== '') return true
  if (record.size && String(record.size).trim() !== '') return true
  if (record.radius !== null && record.radius !== undefined && record.radius !== '' && !isNaN(Number(record.radius))) return true
  if (record.circumference !== null && record.circumference !== undefined && record.circumference !== '' && !isNaN(Number(record.circumference))) return true
  return false
}
