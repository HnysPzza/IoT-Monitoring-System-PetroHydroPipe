import { QueryClient } from '@tanstack/react-query'

export const queryKeys = {
  live: { snapshot: ['live', 'snapshot'] },
  alerts: { snapshot: ['alerts', 'snapshot'] },
  downtime: { all: ['downtime'], list: (filters) => ['downtime', 'list', filters] },
  production: { all: ['production'], list: (filters) => ['production', 'list', filters] },
  analytics: { all: ['analytics'], snapshot: (params) => ['analytics', 'snapshot', params] },
  reports: { all: ['reports'], summary: (params) => ['reports', 'summary', params] },
  audit: { all: ['audit'], list: (params) => ['audit', 'list', params] },
  users: { all: ['users'], list: (params) => ['users', 'list', params], roles: ['users', 'roles'] },
  machines: { all: ['machines'], list: ['machines', 'list'] },
  settings: { all: ['settings'], machine: (id) => ['settings', 'machine', id], watchdog: ['settings', 'watchdog'] },
  overview: { all: ['overview'], summary: ['overview', 'summary'], downtimeImpact: (params) => ['overview', 'downtime-impact', params] },
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      gcTime: 10 * 60 * 1000,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      retry: (failureCount, error) => failureCount < 2 && !(error?.status >= 400 && error?.status < 500) && (
        error?.status >= 500 || error?.code === 'NETWORK_ERROR' || error?.code === 'REQUEST_TIMEOUT'
      ),
    },
  },
})
