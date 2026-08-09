import { API_BASE_URL, createApiError, notifyUnauthorized } from './apiClient.js'

const LIVE_STABILITY_WINDOW_MS = 5000

function parseSseMessage(message) {
  const lines = message.replaceAll('\r\n', '\n').split('\n')
  let type = 'message'
  const dataLines = []

  lines.forEach((line) => {
    if (line.startsWith('event:')) {
      type = line.slice(6).trim()
    }

    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trim())
    }
  })

  if (dataLines.length === 0) return null

  return {
    type,
    payload: JSON.parse(dataLines.join('\n')),
  }
}

export function subscribeToServerEvents(path, token, {
  onEvent,
  onError,
  onFallback,
  onRecovery,
  onStatusChange,
} = {}) {
  const controller = new AbortController()
  let isClosed = false
  let retryCount = 0
  let retryTimer = null
  let fallbackStarted = false
  let activeReader = null
  let stabilityTimer = null
  let lastStatus = null

  function updateStatus(status) {
    if (lastStatus === status) return
    lastStatus = status
    onStatusChange?.(status)
  }

  function confirmLive() {
    const isRecovering = retryCount > 0 || fallbackStarted
    retryCount = 0
    fallbackStarted = false
    updateStatus('live')
    if (isRecovering) onRecovery?.()
  }

  function clearStabilityTimer() {
    if (!stabilityTimer) return
    window.clearTimeout(stabilityTimer)
    stabilityTimer = null
  }

  function scheduleLiveConfirmation(reader) {
    if (stabilityTimer) return
    stabilityTimer = window.setTimeout(() => {
      stabilityTimer = null
      if (!isClosed && activeReader === reader) confirmLive()
    }, LIVE_STABILITY_WINDOW_MS)
  }

  async function releaseActiveReader({ cancel = false } = {}) {
    const reader = activeReader
    activeReader = null
    clearStabilityTimer()
    if (!reader) return

    if (cancel) {
      try {
        await reader.cancel()
      } catch {
        // Retry handling continues even when the stream cannot be cancelled cleanly.
      }
    }

    try {
      reader.releaseLock()
    } catch {
      // Some stream implementations release the lock automatically.
    }
  }

  async function connect() {
    retryTimer = null
    if (retryCount === 0 && lastStatus !== 'live') updateStatus('connecting')

    try {
      const response = await fetch(`${API_BASE_URL}${path}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        signal: controller.signal,
      })

      if (!response.ok || !response.body) {
        const error = createApiError('Unable to connect to event stream.', response.status)
        notifyUnauthorized(error, { token, path })
        throw error
      }

      const reader = response.body.getReader()
      activeReader = reader
      const decoder = new TextDecoder()
      let buffer = ''

      while (!isClosed) {
        const { done, value } = await reader.read()

        if (done) break

        buffer += decoder.decode(value, { stream: true })
        let boundaryIndex = buffer.indexOf('\n\n')

        while (boundaryIndex >= 0) {
          const rawMessage = buffer.slice(0, boundaryIndex).trim()
          buffer = buffer.slice(boundaryIndex + 2)

          if (rawMessage) {
            const event = parseSseMessage(rawMessage)
            if (event) {
              onEvent?.(event)
              scheduleLiveConfirmation(reader)
            }
          }

          boundaryIndex = buffer.indexOf('\n\n')
        }
      }

      if (!isClosed) {
        throw createApiError('Event stream disconnected.', 0)
      }
    } catch (error) {
      await releaseActiveReader({ cancel: true })
      if (isClosed || error.name === 'AbortError') return

      retryCount += 1
      onError?.(error)

      if (error.status === 401) {
        updateStatus('degraded')
        return
      }

      if (retryCount >= 3 && !fallbackStarted) {
        fallbackStarted = true
        updateStatus('degraded')
        onFallback?.()
      } else if (!fallbackStarted) {
        updateStatus('reconnecting')
      }

      const retryDelay = Math.min(1000 * 2 ** retryCount, 10000)
      retryTimer = window.setTimeout(connect, retryDelay)
    }
  }

  connect()

  return () => {
    isClosed = true
    controller.abort()
    clearStabilityTimer()
    releaseActiveReader({ cancel: true })

    if (retryTimer) {
      window.clearTimeout(retryTimer)
    }
  }
}
