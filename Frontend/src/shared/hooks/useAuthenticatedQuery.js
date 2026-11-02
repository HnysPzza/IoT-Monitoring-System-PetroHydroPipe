import { useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from './useAuth.js'

// Token changes update the next request without changing query identity.
export function useAuthenticatedQuery({ queryFn, enabled = true, ...options }) {
  const { token, user, isAuthenticated, isRestoring } = useAuth()
  const tokenRef = useRef(token)
  tokenRef.current = token
  const previousRef = useRef(null)
  const identity = `${user?.id || ''}:${user?.role || ''}`
  if (!isAuthenticated || previousRef.current?.identity !== identity) previousRef.current = null

  const query = useQuery({
    ...options,
    enabled: enabled && isAuthenticated && !isRestoring,
    queryFn: (context) => queryFn({ ...context, token: tokenRef.current }),
  })
  if (isAuthenticated && query.data !== undefined && !query.isPlaceholderData) {
    previousRef.current = { identity, data: query.data, updatedAt: query.dataUpdatedAt }
  }
  if (options.placeholderData && query.isError && query.data === undefined && previousRef.current) {
    return { ...query, data: previousRef.current.data, dataUpdatedAt: previousRef.current.updatedAt, isPlaceholderData: true }
  }
  return query
}
