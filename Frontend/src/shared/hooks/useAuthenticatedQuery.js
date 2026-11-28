import { useLayoutEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from './useAuth.js'

// Token changes update the next request without changing query identity.
export function useAuthenticatedQuery({ queryFn, enabled = true, ...options }) {
  const { token, user, isAuthenticated, isRestoring } = useAuth()
  const tokenRef = useRef(token)
  useLayoutEffect(() => {
    tokenRef.current = token
  }, [token])
  const [previous, setPrevious] = useState(null)
  const identity = `${user?.id || ''}:${user?.role || ''}`
  const validPrevious = isAuthenticated && previous?.identity === identity ? previous : null

  const query = useQuery({
    ...options,
    enabled: enabled && isAuthenticated && !isRestoring,
    queryFn: (context) => queryFn({ ...context, token: tokenRef.current }),
  })
  if (isAuthenticated && query.data !== undefined && !query.isPlaceholderData) {
    if (validPrevious?.data !== query.data || validPrevious?.updatedAt !== query.dataUpdatedAt) {
      setPrevious({ identity, data: query.data, updatedAt: query.dataUpdatedAt })
    }
  } else if (previous !== null && !validPrevious) {
    setPrevious(null)
  }
  if (options.placeholderData && query.isError && query.data === undefined && validPrevious) {
    return { ...query, data: validPrevious.data, dataUpdatedAt: validPrevious.updatedAt, isPlaceholderData: true }
  }
  return query
}
