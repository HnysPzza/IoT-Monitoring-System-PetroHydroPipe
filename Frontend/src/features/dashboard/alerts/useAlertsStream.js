import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { onlineManager, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../../../shared/services/queryClient.js'
import {
  applyLiveAlertDelta,
  areAlertDeltasEquivalent,
  isAlertEventCompatible,
  parseAlertRevision,
  reconcileAlertSnapshot,
} from './alertReconciliation.js'
import { acknowledgeAlert, getAlerts, subscribeToAlerts } from './alertsService.js'

const ALERT_RESYNC_MIN_INTERVAL_MS = 5000
const MAX_BUFFERED_ALERT_DELTAS = 256
const ALERT_STREAM_EVENT_TYPES = new Set([
  'alert.acknowledged',
  'alert.created',
  'alert.resolved',
  'alert.updated',
])
const ACKNOWLEDGEMENT_RESPONSE_STATUSES = new Set(['Acknowledged', 'Resolved'])

export function useAlertsStream({
  token,
  enabled = true,
  online = true,
  onSensorStatus,
  onStreamOpen,
}) {
  const queryClient = useQueryClient()
  const [alerts, setAlerts] = useState([])
  const [acknowledgingAlertIds, setAcknowledgingAlertIds] = useState([])
  const [alertLoadError, setAlertLoadError] = useState('')
  const [alertAcknowledgementErrors, setAlertAcknowledgementErrors] = useState({})
  const [hasTrustedAlertList, setHasTrustedAlertList] = useState(false)
  const [cachedAlertsAt, setCachedAlertsAt] = useState(null)
  const [alertConnectionStatus, setAlertConnectionStatus] = useState('connecting')

  const retryAlertsRef = useRef(() => { })
  const sessionTokenRef = useRef(token)
  const acknowledgementIdRef = useRef(0)
  const acknowledgementOperationsRef = useRef(new Map())
  const applyAlertDeltaRef = useRef(() => { })
  const onSensorStatusRef = useRef(onSensorStatus)
  const onStreamOpenRef = useRef(onStreamOpen)

  useLayoutEffect(() => {
    sessionTokenRef.current = token
    onSensorStatusRef.current = onSensorStatus
    onStreamOpenRef.current = onStreamOpen
  }, [token, onSensorStatus, onStreamOpen])

  const activeAlerts = useMemo(
    () => alerts.filter((alert) => alert.status === 'Active'),
    [alerts],
  )
  const acknowledgedAlerts = useMemo(
    () => alerts.filter((alert) => alert.status === 'Acknowledged'),
    [alerts],
  )
  const unresolvedAlerts = useMemo(
    () => alerts.filter((alert) => alert.status === 'Active' || alert.status === 'Acknowledged'),
    [alerts],
  )

  useEffect(() => {
    if (!online) {
      setHasTrustedAlertList(false)
      setCachedAlertsAt(queryClient.getQueryData(queryKeys.alerts.snapshot)?.updatedAt || null)
    }
  }, [online, queryClient])

  useEffect(() => {
    if (!token || !enabled || !online) return undefined

    let isMounted = true
    let pollingId = null
    let resyncTimerId = null
    let activeListRequest = null
    let activeAbortController = null
    let reloadQueued = false
    let lastReloadStartedAt = null
    let currentAlerts = []
    let currentRevision = 0n
    let hasTrustedSnapshot = false

    const cachedAlerts = queryClient.getQueryData(queryKeys.alerts.snapshot)
    setAlerts(cachedAlerts?.alerts || [])
    setCachedAlertsAt(cachedAlerts?.updatedAt || null)
    setAcknowledgingAlertIds([])
    setAlertAcknowledgementErrors({})
    setAlertLoadError('')
    setHasTrustedAlertList(false)
    setAlertConnectionStatus('connecting')
    acknowledgementOperationsRef.current = new Map()

    function replaceAlertState(nextAlerts, nextRevision) {
      currentAlerts = nextAlerts
      currentRevision = nextRevision
      setAlerts(nextAlerts)
      if (hasTrustedSnapshot) {
        queryClient.setQueryData(queryKeys.alerts.snapshot, { alerts: nextAlerts, updatedAt: Date.now() })
      }
    }

    function scheduleAlertReload() {
      if (!isMounted) return

      if (activeListRequest) {
        reloadQueued = true
        return
      }

      const elapsed = lastReloadStartedAt === null
        ? ALERT_RESYNC_MIN_INTERVAL_MS
        : Date.now() - lastReloadStartedAt
      const delay = Math.max(0, ALERT_RESYNC_MIN_INTERVAL_MS - elapsed)

      if (delay > 0) {
        reloadQueued = true
        if (!resyncTimerId) {
          resyncTimerId = window.setTimeout(() => {
            resyncTimerId = null
            if (!isMounted || !reloadQueued) return
            reloadQueued = false
            void loadAlertState()
          }, delay)
        }
        return
      }

      reloadQueued = false
      void loadAlertState()
    }

    async function loadAlertState() {
      if (!isMounted || !token) return

      if (activeListRequest) {
        reloadQueued = true
        return
      }

      const listRequest = {
        bufferedByRevision: new Map(),
        hasUntrustedBuffer: false,
      }
      const controller = new AbortController()
      activeAbortController = controller
      activeListRequest = listRequest
      lastReloadStartedAt = Date.now()

      try {
        const payload = await getAlerts(token, { signal: controller.signal })
        if (isMounted && onlineManager.isOnline() && activeListRequest === listRequest) {
          const reconciliation = reconcileAlertSnapshot(
            payload,
            [...listRequest.bufferedByRevision.values()],
          )

          if (!reconciliation.trusted) {
            reloadQueued = true
            setAlertLoadError('Alert state could not be verified. Retrying...')
          } else if (reconciliation.revision < currentRevision) {
            reloadQueued = true
            if (!hasTrustedSnapshot) {
              setAlertLoadError('Alert state could not be verified. Retrying...')
            }
          } else {
            replaceAlertState(reconciliation.alerts, reconciliation.revision)
            if (reconciliation.needsResync || listRequest.hasUntrustedBuffer) {
              reloadQueued = true
            }
            hasTrustedSnapshot = true
            queryClient.setQueryData(queryKeys.alerts.snapshot, { alerts: reconciliation.alerts, updatedAt: Date.now() })
            setCachedAlertsAt(null)
            setHasTrustedAlertList(true)
            setAlertLoadError('')
          }
        }
      } catch (error) {
        if (
          isMounted
          && activeListRequest === listRequest
          && !controller.signal.aborted
          && error?.code !== 'REQUEST_ABORTED'
          && error?.name !== 'AbortError'
        ) {
          setAlertLoadError(error.message || 'Unable to load alerts. Please try again.')
        }
      } finally {
        if (activeAbortController === controller) {
          activeAbortController = null
        }
        if (activeListRequest === listRequest) {
          activeListRequest = null
          if (reloadQueued) scheduleAlertReload()
        }
      }
    }

    function bufferAlertDelta(alert) {
      if (!activeListRequest) return

      const revision = parseAlertRevision(alert?.revision)
      if (revision === null) {
        activeListRequest.hasUntrustedBuffer = true
        return
      }

      const existing = activeListRequest.bufferedByRevision.get(alert.revision)
      if (existing) {
        if (!areAlertDeltasEquivalent(existing, alert)) {
          activeListRequest.hasUntrustedBuffer = true
        }
        return
      }

      if (activeListRequest.bufferedByRevision.size >= MAX_BUFFERED_ALERT_DELTAS) {
        activeListRequest.hasUntrustedBuffer = true
        return
      }

      activeListRequest.bufferedByRevision.set(alert.revision, alert)
    }

    function applyAlertDelta(alert, { fromAcknowledgement = false } = {}) {
      if (!isMounted) return

      if (!alert) {
        if (fromAcknowledgement) scheduleAlertReload()
        return
      }

      const isBufferedByActiveRequest = Boolean(activeListRequest)

      if (fromAcknowledgement && !ACKNOWLEDGEMENT_RESPONSE_STATUSES.has(alert.status)) {
        if (activeListRequest) {
          activeListRequest.hasUntrustedBuffer = true
        } else {
          scheduleAlertReload()
        }
        return
      }

      bufferAlertDelta(alert)
      const result = applyLiveAlertDelta(currentAlerts, currentRevision, alert)

      if (result.applied) {
        replaceAlertState(result.alerts, result.revision)
      }

      if (result.needsResync && !isBufferedByActiveRequest) scheduleAlertReload()
    }

    function startFallbackPolling() {
      if (!isMounted || pollingId !== null) return

      setAlertConnectionStatus('polling')
      pollingId = window.setInterval(scheduleAlertReload, 10000)
    }

    function stopFallbackPolling() {
      if (!isMounted) return
      if (pollingId !== null) {
        window.clearInterval(pollingId)
        pollingId = null
      }
      setAlertConnectionStatus('live')
    }

    retryAlertsRef.current = scheduleAlertReload
    applyAlertDeltaRef.current = applyAlertDelta
    void loadAlertState()
    const unsubscribe = subscribeToAlerts(token, {
      onEvent: (event) => {
        if (!isMounted || !onlineManager.isOnline() || typeof event?.type !== 'string') return
        if (event.type === 'sensor.status' || event.type.startsWith('alert.')) {
          void queryClient.invalidateQueries({ queryKey: queryKeys.overview.all })
        }

        if (event.type === 'sensor.status') {
          void queryClient.invalidateQueries({ queryKey: queryKeys.production.all })
          onSensorStatusRef.current?.(event.payload?.live)
          return
        }

        if (!event.type.startsWith('alert.')) return

        if (
          !ALERT_STREAM_EVENT_TYPES.has(event.type)
          || !event.payload?.alert
          || !isAlertEventCompatible(event.type, event.payload.alert)
        ) {
          scheduleAlertReload()
          return
        }

        applyAlertDeltaRef.current(event.payload.alert)
      },
      onFallback: startFallbackPolling,
      onOpen: ({ isReconnect, isRetry } = {}) => {
        if (isMounted) {
          if (isReconnect || isRetry) {
            void queryClient.invalidateQueries({ queryKey: queryKeys.overview.all })
            void queryClient.invalidateQueries({ queryKey: queryKeys.production.all })
          }
          scheduleAlertReload()
          onStreamOpenRef.current?.({ isReconnect, isRetry })
        }
      },
      onRecovery: stopFallbackPolling,
      onStatusChange: (status) => {
        if (!isMounted) return
        if (status === 'live') setAlertConnectionStatus('live')
        if (status === 'connecting') setAlertConnectionStatus('connecting')
        if (status === 'reconnecting') setAlertConnectionStatus('reconnecting')
        if (status === 'degraded') setAlertConnectionStatus('degraded')
      },
    })

    return () => {
      isMounted = false
      activeAbortController?.abort()
      activeAbortController = null
      activeListRequest = null
      reloadQueued = false
      retryAlertsRef.current = () => { }
      applyAlertDeltaRef.current = () => { }
      unsubscribe()

      if (pollingId !== null) {
        window.clearInterval(pollingId)
      }

      if (resyncTimerId !== null) {
        window.clearTimeout(resyncTimerId)
      }
    }
  }, [enabled, token, queryClient, online])

  const acknowledgeAlertById = useCallback(async (alertId, { onAcknowledged } = {}) => {
    if (!token || acknowledgementOperationsRef.current.has(alertId)) return

    const operationId = acknowledgementIdRef.current + 1
    acknowledgementIdRef.current = operationId
    acknowledgementOperationsRef.current.set(alertId, operationId)
    setAcknowledgingAlertIds((currentIds) => [...currentIds, alertId])
    setAlertAcknowledgementErrors((current) => ({ ...current, [alertId]: '' }))

    try {
      const payload = await acknowledgeAlert(token, alertId)
      void queryClient.invalidateQueries({ queryKey: queryKeys.overview.all })
      void queryClient.invalidateQueries({ queryKey: queryKeys.audit.all })
      if (sessionTokenRef.current !== token || acknowledgementOperationsRef.current.get(alertId) !== operationId) return
      onAcknowledged?.(payload.alert)
      applyAlertDeltaRef.current(payload.alert, { fromAcknowledgement: true })
    } catch (error) {
      if (sessionTokenRef.current === token && acknowledgementOperationsRef.current.get(alertId) === operationId) {
        setAlertAcknowledgementErrors((current) => ({
          ...current,
          [alertId]: error.message || 'Unable to acknowledge alert.',
        }))
      }
    } finally {
      if (acknowledgementOperationsRef.current.get(alertId) === operationId) {
        acknowledgementOperationsRef.current.delete(alertId)
        setAcknowledgingAlertIds((currentIds) => currentIds.filter((id) => id !== alertId))
      }
    }
  }, [token, queryClient])

  const retryAlerts = useCallback(() => {
    retryAlertsRef.current()
  }, [])

  return {
    acknowledgeAlertById,
    acknowledgedAlerts,
    acknowledgingAlertIds,
    activeAlerts,
    alertAcknowledgementErrors,
    alertConnectionStatus,
    alertLoadError,
    alerts,
    cachedAlertsAt,
    hasTrustedAlertList,
    retryAlerts,
    unresolvedAlerts,
  }
}
