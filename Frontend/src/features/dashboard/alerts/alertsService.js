import { API_BASE_URL, apiRequest, createApiError } from '../../../shared/services/apiClient.js'

export function getAlerts(token) {
  return apiRequest('/api/alerts', { token })
}

export function acknowledgeAlert(token, alertId) {
  return apiRequest(`/api/alerts/${alertId}/acknowledge`, {
    token,
    method: 'PATCH',
    fallbackError: 'Unable to acknowledge alert.',
  })
}

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

  if (dataLines.length === 0) {
    return { type, payload: null }
  }

  return {
    type,
    payload: JSON.parse(dataLines.join('\n')),
  }
}

export function subscribeToAlerts(token, { onEvent, onError, onFallback } = {}) {
  const controller = new AbortController()
  let isClosed = false
  let retryCount = 0
  let retryTimer = null

  async function connect() {
    try {
      const response = await fetch(`${API_BASE_URL}/api/alerts/stream`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        signal: controller.signal,
      })

      if (!response.ok || !response.body) {
        throw createApiError('Unable to connect to alerts stream.', response.status)
      }

      retryCount = 0
      const reader = response.body.getReader()
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
            onEvent?.(parseSseMessage(rawMessage))
          }

          boundaryIndex = buffer.indexOf('\n\n')
        }
      }

      if (!isClosed) {
        throw createApiError('Alerts stream disconnected.', 0)
      }
    } catch (error) {
      if (isClosed || error.name === 'AbortError') {
        return
      }

      retryCount += 1
      onError?.(error)

      if (retryCount >= 3) {
        onFallback?.()
      }

      const retryDelay = Math.min(1000 * 2 ** retryCount, 10000)
      retryTimer = window.setTimeout(connect, retryDelay)
    }
  }

  connect()

  return () => {
    isClosed = true
    controller.abort()

    if (retryTimer) {
      window.clearTimeout(retryTimer)
    }
  }
}
