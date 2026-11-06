import { useCallback, useEffect, useRef, useState } from 'react'
import { onlineManager, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../../../shared/services/queryClient.js'
import { useNetworkOnline } from '../../../shared/hooks/useNetworkOnline.js'
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
  const queryClient = useQueryClient()
  const online = useNetworkOnline()
  const cached = token ? queryClient.getQueryData(queryKeys.live.snapshot) : null
  const [data, setData] = useState(cached?.data || null)
  const [state, setState] = useState(cached ? 'stale' : 'loading')
  const [error, setError] = useState('')
  const [lastUpdated, setLastUpdated] = useState(cached ? new Date(cached.updatedAt) : null)
  const [isRefreshing, setIsRefreshing] = useState(false)

  const inFlightRef = useRef(false)
  const requestIdRef = useRef(0)
  const latestCapturedAtRef = useRef(getTimestamp(cached?.data?.monitoring?.capturedAt))
  const mountedRef = useRef(true)
  const hasSuccessfulDataRef = useRef(Boolean(cached?.data?.machine))
  const wasOfflineRef = useRef(!online)

  const loadFeed = useCallback(async ({ initial = false } = {}) => {
    if (!token) return false
    if (inFlightRef.current && !initial) return false
    inFlightRef.current = true
    const requestId = ++requestIdRef.current

    if (initial && !hasSuccessfulDataRef.current) setState('loading')
    else setIsRefreshing(true)

    try {
      const payload = await getLiveFeed(token)
      if (!mountedRef.current || requestId !== requestIdRef.current) return false
      if (!onlineManager.isOnline()) return false

      const feedCapturedAt = getTimestamp(payload.monitoring?.capturedAt)
      if (feedCapturedAt > 0 && feedCapturedAt < latestCapturedAtRef.current) {
        return false
      }

      if (feedCapturedAt > 0) {
        latestCapturedAtRef.current = Math.max(latestCapturedAtRef.current, feedCapturedAt)
      }

      const normalized = normalizeLivePayload(payload)
      queryClient.setQueryData(queryKeys.live.snapshot, { data: normalized, updatedAt: Date.now() })
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
  }, [token, queryClient])

  const applyEvent = useCallback((incomingLive) => {
    if (!onlineManager.isOnline() || !incomingLive || typeof incomingLive !== 'object') return false

    const eventCapturedAt = getTimestamp(incomingLive.monitoring?.capturedAt)
    if (eventCapturedAt > 0 && eventCapturedAt < latestCapturedAtRef.current) {
      return false
    }

    if (eventCapturedAt > 0) {
      latestCapturedAtRef.current = Math.max(latestCapturedAtRef.current, eventCapturedAt)
    }

    const normalized = normalizeLivePayload(incomingLive)
    queryClient.setQueryData(queryKeys.live.snapshot, { data: normalized, updatedAt: Date.now() })
    setData(normalized)
    setLastUpdated(new Date())
    setError('')
    hasSuccessfulDataRef.current = Boolean(normalized?.machine)
    setState(normalized?.machine ? 'success' : 'empty')
    return true
  }, [queryClient])

  useEffect(() => {
    if (!token) return
    if (!online) {
      wasOfflineRef.current = true
      setError('Unable to refresh while offline.')
      setState(hasSuccessfulDataRef.current ? 'stale' : 'error')
    } else if (wasOfflineRef.current) {
      wasOfflineRef.current = false
      void loadFeed()
    }
  }, [online, token, loadFeed])

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
