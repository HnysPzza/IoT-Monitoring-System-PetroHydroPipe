import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Database, RotateCw } from 'lucide-react'
import { getAnalyticsSnapshot } from './analyticsService.js'

function hasAnalyticsRecords(snapshot) {
  return Boolean(
    snapshot?.downtimeEvents?.length
    || snapshot?.processEvents?.length
    || snapshot?.productionRecords?.length,
  )
}

export default function AnalyticsSection({ loadAnalytics = getAnalyticsSnapshot }) {
  const [snapshot, setSnapshot] = useState(null)
  const [loadState, setLoadState] = useState('loading')
  const [errorMessage, setErrorMessage] = useState('')
  const requestIdRef = useRef(0)
  const successfulSnapshotRef = useRef(null)

  const loadSnapshot = useCallback(async () => {
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    const previousSnapshot = successfulSnapshotRef.current

    setLoadState(previousSnapshot ? 'refreshing' : 'loading')
    setErrorMessage('')

    try {
      const nextSnapshot = await loadAnalytics()
      if (requestId !== requestIdRef.current) return

      successfulSnapshotRef.current = nextSnapshot
      setSnapshot(nextSnapshot)
      setLoadState('success')
    } catch (error) {
      if (requestId !== requestIdRef.current) return

      const nextErrorMessage = error?.message || 'Unable to prepare the local Analytics preview.'
      setErrorMessage(nextErrorMessage)

      if (previousSnapshot) {
        setSnapshot(previousSnapshot)
        setLoadState('stale')
      } else {
        setLoadState('error')
      }
    }
  }, [loadAnalytics])

  useEffect(() => {
    loadSnapshot()
  }, [loadSnapshot])

  const isInitialLoading = loadState === 'loading' && !snapshot
  const isEmpty = loadState !== 'error' && snapshot && !hasAnalyticsRecords(snapshot)

  return (
    <div className="reports-layout analytics-layout">
      {loadState === 'refreshing' ? (
        <div className="notice dashboard-alert" role="status" aria-live="polite">
          <RotateCw className="spin-icon" size={16} aria-hidden="true" />
          <span>Refreshing local Analytics preview...</span>
        </div>
      ) : null}

      {loadState === 'stale' ? (
        <div className="notice notice-error dashboard-alert" role="alert">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>Showing the last local preview because refresh failed. {errorMessage}</span>
          <button className="btn btn-secondary table-action-button" type="button" onClick={loadSnapshot}>
            Retry
          </button>
        </div>
      ) : null}

      {isInitialLoading ? (
        <section className="section-card" aria-label="Loading Analytics preview">
          <div className="notice dashboard-alert" role="status" aria-live="polite">
            <RotateCw className="spin-icon" size={16} aria-hidden="true" />
            <span>Loading Analytics workspace...</span>
          </div>
          <div className="skeleton skeleton-panel" />
        </section>
      ) : null}

      {loadState === 'error' ? (
        <section className="section-card section-placeholder" aria-labelledby="analytics-error-title">
          <div className="section-copy">
            <p className="section-eyebrow">Analytics preview unavailable</p>
            <h2 id="analytics-error-title">Unable to prepare Analytics</h2>
            <p role="alert">{errorMessage}</p>
            <button className="btn btn-secondary" type="button" onClick={loadSnapshot}>
              Retry
            </button>
          </div>
        </section>
      ) : null}

      {snapshot && loadState !== 'error' ? (
        <section className="section-card" aria-labelledby="analytics-foundation-title">
          <div className="section-heading">
            <div>
              <p className="section-eyebrow">Analytics workspace</p>
              <h2 id="analytics-foundation-title">Local Analytics preview</h2>
            </div>
            <span className="section-chip">
              <Database size={16} aria-hidden="true" />
              Local fixture only
            </span>
          </div>
          <div className="section-copy">
            <p>
              This frontend preview uses deterministic local data for {snapshot.machine.code} / {snapshot.machine.name}.
              It has no Analytics backend connection.
            </p>
            <p>
              Range: <strong>{snapshot.range.startDate}</strong> to <strong>{snapshot.range.endDate}</strong>{' '}
              ({snapshot.range.bucket} buckets, {snapshot.timeZone}).
            </p>
          </div>

          {isEmpty ? (
            <p className="empty-state" role="status">
              No local Analytics records fall inside this preview range.
            </p>
          ) : (
            <p className="empty-state" role="status">
              Local data is ready. Filters, trend exploration, and detailed analysis are added in the next UI passes.
            </p>
          )}

          <button className="btn btn-secondary table-action-button" type="button" onClick={loadSnapshot}>
            <RotateCw size={16} aria-hidden="true" />
            Refresh local data
          </button>
        </section>
      ) : null}
    </div>
  )
}
