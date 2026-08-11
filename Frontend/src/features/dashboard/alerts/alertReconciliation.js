const REVISION_PATTERN = /^(0|[1-9]\d*)$/
const SNAPSHOT_ALERT_STATUSES = new Set(['Active', 'Acknowledged'])
const DELTA_ALERT_STATUSES = new Set([...SNAPSHOT_ALERT_STATUSES, 'Resolved'])
const ALERT_STATUSES_BY_EVENT_TYPE = new Map([
  ['alert.acknowledged', new Set(['Acknowledged'])],
  ['alert.created', new Set(['Active'])],
  ['alert.resolved', new Set(['Resolved'])],
  ['alert.updated', new Set(['Active', 'Acknowledged'])],
])

export function parseAlertRevision(value) {
  if (typeof value !== 'string' || !REVISION_PATTERN.test(value)) return null

  try {
    return BigInt(value)
  } catch {
    return null
  }
}

function normalizeForComparison(value) {
  if (Array.isArray(value)) return value.map(normalizeForComparison)

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, normalizeForComparison(value[key])]),
    )
  }

  return value
}

export function areAlertDeltasEquivalent(left, right) {
  return JSON.stringify(normalizeForComparison(left)) === JSON.stringify(normalizeForComparison(right))
}

export function isAlertEventCompatible(eventType, alert) {
  return ALERT_STATUSES_BY_EVENT_TYPE.get(eventType)?.has(alert?.status) === true
}

function hasValidAlertShape(alert, allowedStatuses) {
  return Boolean(
    alert
    && typeof alert === 'object'
    && typeof alert.id === 'string'
    && alert.id.trim()
    && allowedStatuses.has(alert.status),
  )
}

export function mergeAlertUpdate(currentAlerts, incomingAlert) {
  if (!incomingAlert) return currentAlerts

  if (incomingAlert.status === 'Resolved') {
    return currentAlerts.filter((alert) => alert.id !== incomingAlert.id)
  }

  const alertExists = currentAlerts.some((alert) => alert.id === incomingAlert.id)

  if (!alertExists) {
    return [incomingAlert, ...currentAlerts]
  }

  return currentAlerts.map((alert) => (alert.id === incomingAlert.id ? incomingAlert : alert))
}

export function validateAlertSnapshot(payload) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.alerts)) return null

  const snapshotRevision = parseAlertRevision(payload.snapshotRevision)
  if (snapshotRevision === null) return null

  const hasInvalidAlert = payload.alerts.some((alert) => {
    const revision = parseAlertRevision(alert?.revision)
    return !hasValidAlertShape(alert, SNAPSHOT_ALERT_STATUSES)
      || revision === null
      || revision > snapshotRevision
  })

  if (hasInvalidAlert) return null

  return {
    alerts: payload.alerts,
    revision: snapshotRevision,
  }
}

export function applyLiveAlertDelta(currentAlerts, currentRevision, incomingAlert) {
  const incomingRevision = parseAlertRevision(incomingAlert?.revision)

  if (!hasValidAlertShape(incomingAlert, DELTA_ALERT_STATUSES) || incomingRevision === null) {
    return { alerts: currentAlerts, revision: currentRevision, applied: false, needsResync: true }
  }

  if (incomingRevision <= currentRevision) {
    return { alerts: currentAlerts, revision: currentRevision, applied: false, needsResync: false }
  }

  if (incomingRevision !== currentRevision + 1n) {
    return { alerts: currentAlerts, revision: currentRevision, applied: false, needsResync: true }
  }

  return {
    alerts: mergeAlertUpdate(currentAlerts, incomingAlert),
    revision: incomingRevision,
    applied: true,
    needsResync: false,
  }
}

export function reconcileAlertSnapshot(payload, bufferedAlerts) {
  const snapshot = validateAlertSnapshot(payload)
  if (!snapshot) return { trusted: false, needsResync: true }

  const newerByRevision = new Map()
  let hasMalformedDelta = false
  let hasConflictingDelta = false

  bufferedAlerts.forEach((alert) => {
    const revision = parseAlertRevision(alert?.revision)

    if (!hasValidAlertShape(alert, DELTA_ALERT_STATUSES) || revision === null) {
      hasMalformedDelta = true
      return
    }

    if (revision <= snapshot.revision) return

    const existing = newerByRevision.get(alert.revision)
    if (existing && !areAlertDeltasEquivalent(existing.alert, alert)) {
      hasConflictingDelta = true
      return
    }

    if (!existing) {
      newerByRevision.set(alert.revision, { alert, revision })
    }
  })

  const newerDeltas = [...newerByRevision.values()]
    .sort((left, right) => (left.revision < right.revision ? -1 : left.revision > right.revision ? 1 : 0))
  let expectedRevision = snapshot.revision + 1n

  const hasGap = newerDeltas.some(({ revision }) => {
    if (revision !== expectedRevision) return true
    expectedRevision += 1n
    return false
  })

  if (hasMalformedDelta || hasConflictingDelta || hasGap) {
    return {
      trusted: true,
      alerts: snapshot.alerts,
      revision: snapshot.revision,
      needsResync: true,
    }
  }

  const alerts = newerDeltas.reduce(
    (currentAlerts, { alert }) => mergeAlertUpdate(currentAlerts, alert),
    snapshot.alerts,
  )

  return {
    trusted: true,
    alerts,
    revision: newerDeltas.at(-1)?.revision ?? snapshot.revision,
    needsResync: false,
  }
}
