import { useCallback, useEffect, useRef, useState } from 'react'
import { getLiveFeed } from './liveService.js'
import { presentLiveSensors } from './livePresentation.js'

const RECONCILE_INTERVAL_MS = 60000
const FALLBACK_INTERVAL_MS = 10000

function normalizeLivePayload(payload) {
  if (!payload) return null
  const mode = payload.monitoring?.mode
  const sensors = Array.isArray(payload.sensors) ? payload.sensors : []
  const formattedSensors = presentLiveSensors(sensors, mode).map((sensor) => ({
    ...sensor,
    operationalStatus: sensor.status,
    status: sensor.displayStatus || sensor.status,
  }))

  return {
    ...payload,
    sensors: formattedSensors,
  }
}

function getTimestamp(isoString) {
  if (!isoString) return 0
  const time = new Date(isoString).getTime()
  return Number.isNaN(time) ? 0 : time
}

export function useLiveFeedStream(token, { isFallbackPolling = false } = {}) {
  const [data, setData] = useState(null)
  const [state, setState] = useState('loading')
  const [error, setError] = useState('')
  const [lastUpdated, setLastUpdated] = useState(null)
  const [isRefreshing, setIsRefreshing] = useState(false)

  const inFlightRef = useRef(false)
  const requestIdRef = useRef(0)
  const latestCapturedAtRef = useRef(0)
  const mountedRef = useRef(true)
  const hasSuccessfulDataRef = useRef(false)

  const loadFeed = useCallback(async ({ initial = false } = {}) => {
    if (!token) return false
    if (inFlightRef.current && !initial) return false
    inFlightRef.current = true
    const requestId = ++requestIdRef.current

    if (initial) setState('loading')
    else setIsRefreshing(true)

    try {
      const payload = await getLiveFeed(token)
      if (!mountedRef.current || requestId !== requestIdRef.current) return false

      const feedCapturedAt = getTimestamp(payload.monitoring?.capturedAt)
      if (feedCapturedAt > 0 && feedCapturedAt < latestCapturedAtRef.current) {
        return false
      }

      if (feedCapturedAt > 0) {
        latestCapturedAtRef.current = Math.max(latestCapturedAtRef.current, feedCapturedAt)
      }

      const normalized = normalizeLivePayload(payload)
      setData(normalized)
      setLastUpdated(new Date())
      setError('')
      hasSuccessfulDataRef.current = Boolean(normalized?.machine)
      setState(normalized?.machine ? 'success' : 'empty')
      return true
    } catch (requestError) {
      if (!mountedRef.current || requestId !== requestIdRef.current) return false

      const errorMessage = requestError.message || 'Unable to load live machine status.'
      setError(errorMessage)
      setState(hasSuccessfulDataRef.current ? 'stale' : 'error')
      return false
    } finally {
      if (requestId === requestIdRef.current) {
        inFlightRef.current = false
      }
      if (mountedRef.current && requestId === requestIdRef.current) {
        setIsRefreshing(false)
      }
    }
  }, [token])

  const applyEvent = useCallback((incomingLive) => {
    if (!incomingLive || typeof incomingLive !== 'object') return false

    const eventCapturedAt = getTimestamp(incomingLive.monitoring?.capturedAt)
    if (eventCapturedAt > 0 && eventCapturedAt < latestCapturedAtRef.current) {
      return false
    }

    if (eventCapturedAt > 0) {
      latestCapturedAtRef.current = Math.max(latestCapturedAtRef.current, eventCapturedAt)
    }

    const normalized = normalizeLivePayload(incomingLive)
    setData(normalized)
    setLastUpdated(new Date())
    setError('')
    hasSuccessfulDataRef.current = Boolean(normalized?.machine)
    setState(normalized?.machine ? 'success' : 'empty')
    return true
  }, [])

  useEffect(() => {
    mountedRef.current = true
    inFlightRef.current = false
    if (!token) return

    loadFeed({ initial: true })

    const intervalMs = isFallbackPolling ? FALLBACK_INTERVAL_MS : RECONCILE_INTERVAL_MS
    const intervalId = window.setInterval(() => {
      if (!document.hidden) void loadFeed()
    }, intervalMs)

    function handleVisibilityChange() {
      if (!document.hidden) void loadFeed()
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      mountedRef.current = false
      window.clearInterval(intervalId)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [isFallbackPolling, loadFeed, token])

  const reload = useCallback(() => loadFeed({ initial: !hasSuccessfulDataRef.current }), [loadFeed])

  return {
    data,
    machine: data?.machine || null,
    sensors: data?.sensors || [],
    monitoring: data?.monitoring || { mode: 'unknown', capturedAt: null },
    state,
    isLoading: state === 'loading' && !data,
    isRefreshing,
    error,
    lastUpdated,
    reload,
    applyEvent,
  }
}
