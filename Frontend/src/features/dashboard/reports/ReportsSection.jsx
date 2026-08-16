import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Download, FileText, RotateCw } from 'lucide-react'
import { useAuth } from '../../../shared/hooks/useAuth.js'
import { formatSensorName } from '../../../shared/constants/sensorIdentity.js'
import { getReportSummary, reportTypes } from './reportsService.js'

function toCsv(rows) {
  // Escapes quote characters so exported CSV stays valid.
  const headers = ['Cause', 'Sensor', 'Events', 'Duration Minutes', 'Estimated Loss']
  const body = rows.map((row) => [
    row.cause,
    row.sensor,
    row.events,
    row.durationMinutes,
    row.estimatedLoss,
  ])

  return [headers, ...body]
    .map((cells) => cells.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(','))
    .join('\n')
}

function downloadCsv(filename, rows) {
  const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

function getManilaDateInputValue() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function getQueryKey(reportType, selectedDate) {
  return `${reportType}:${selectedDate}`
}

function formatSuccessfulUpdate(date) {
  return date.toLocaleString('en-PH', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Manila',
  })
}

export default function ReportsSection() {
  const { token } = useAuth()
  const [reportType, setReportType] = useState('daily')
  const [selectedDate, setSelectedDate] = useState(getManilaDateInputValue)
  const [report, setReport] = useState(null)
  const [loadedRequestKey, setLoadedRequestKey] = useState('')
  const [loadState, setLoadState] = useState('loading')
  const [errorMessage, setErrorMessage] = useState('')
  const [lastSuccessfulUpdate, setLastSuccessfulUpdate] = useState(null)
  const [refreshRequest, setRefreshRequest] = useState(0)
  const requestIdRef = useRef(0)
  const successfulReportRef = useRef(null)
  const selectedReportLabel = reportTypes.find((type) => type.id === reportType)?.label || 'Report'
  const queryKey = getQueryKey(reportType, selectedDate)
  const requestKey = `${token || 'anonymous'}:${queryKey}`
  const hasCurrentReport = Boolean(report && loadedRequestKey === requestKey)
  const isCurrentSuccess = loadState === 'success' && hasCurrentReport

  useEffect(() => {
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    let isCancelled = false

    async function loadReport() {
      setLoadState('loading')
      setErrorMessage('')

      try {
        const payload = await getReportSummary(token, { reportType, selectedDate })
        if (isCancelled || requestId !== requestIdRef.current) return

        const nextReport = payload.report || { summary: [], rows: [] }
        const updatedAt = new Date()
        successfulReportRef.current = { requestKey, report: nextReport, updatedAt }
        setReport(nextReport)
        setLoadedRequestKey(requestKey)
        setLastSuccessfulUpdate(updatedAt)
        setLoadState('success')
      } catch (error) {
        if (isCancelled || requestId !== requestIdRef.current) return

        setErrorMessage(error.message || 'Unable to load report summary.')

        if (successfulReportRef.current?.requestKey === requestKey) {
          setReport(successfulReportRef.current.report)
          setLoadedRequestKey(requestKey)
          setLastSuccessfulUpdate(successfulReportRef.current.updatedAt)
          setLoadState('stale')
        } else {
          setLoadState('error')
        }
      }
    }

    loadReport()

    return () => {
      isCancelled = true
    }
  }, [queryKey, refreshRequest, reportType, requestKey, selectedDate, token])

  function retryCurrentReport() {
    setRefreshRequest((current) => current + 1)
  }

  return (
    <div className="reports-layout">
      {loadState === 'loading' ? (
        <div className="notice dashboard-alert" role="status" aria-live="polite">
          <RotateCw className="spin-icon" size={16} aria-hidden="true" />
          <span>{hasCurrentReport ? 'Refreshing report...' : 'Loading report...'}</span>
        </div>
      ) : null}

      {loadState === 'stale' ? (
        <div className="notice notice-error dashboard-alert" role="alert">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>
            Report data is stale. Showing the last successful result from{' '}
            <time dateTime={lastSuccessfulUpdate?.toISOString()}>
              {lastSuccessfulUpdate ? formatSuccessfulUpdate(lastSuccessfulUpdate) : 'an earlier update'}
            </time>
            . {errorMessage}
          </span>
          <button className="btn btn-secondary table-action-button" type="button" onClick={retryCurrentReport}>
            Retry
          </button>
        </div>
      ) : null}

      <section className="section-card reports-controls-card" aria-labelledby="reports-title">
        <div className="section-heading">
          <div>
            <p className="section-eyebrow">Management report</p>
            <h2 id="reports-title">Generate summary</h2>
          </div>
          <span className="section-chip">
            <FileText size={16} aria-hidden="true" />
            {selectedReportLabel}
          </span>
        </div>

        <div className="reports-controls">
          <label className="filter-field" htmlFor="reports-type-filter">
            <span>Report type</span>
            <select
              id="reports-type-filter"
              name="reportType"
              value={reportType}
              onChange={(event) => setReportType(event.target.value)}
              autoComplete="off"
            >
              {reportTypes.map((type) => (
                <option key={type.id} value={type.id}>{type.label}</option>
              ))}
            </select>
          </label>
          <label className="filter-field" htmlFor="reports-date-filter">
            <span>Date</span>
            <input
              id="reports-date-filter"
              name="reportDate"
              type={reportType === 'monthly' ? 'month' : 'date'}
              value={reportType === 'monthly' ? selectedDate.slice(0, 7) : selectedDate}
              onChange={(event) => setSelectedDate(event.target.value)}
              autoComplete="off"
            />
          </label>
          <button
            className="btn btn-success reports-action reports-refresh-button"
            type="button"
            aria-label="Refresh report"
            disabled={loadState === 'loading'}
            onClick={retryCurrentReport}
          >
            <RotateCw className={loadState === 'loading' ? 'spin-icon' : ''} size={17} aria-hidden="true" />
            Refresh
          </button>
          <button
            className="btn btn-primary reports-action"
            type="button"
            disabled={!isCurrentSuccess}
            onClick={() => downloadCsv(`petrohydropipe-${reportType}-report.csv`, report.rows)}
          >
            <Download size={17} aria-hidden="true" />
            Export CSV
          </button>
        </div>
      </section>

      {loadState === 'error' ? (
        <section className="section-card section-placeholder" aria-labelledby="reports-error-title">
          <div className="section-copy">
            <p className="section-eyebrow">Report unavailable</p>
            <h2 id="reports-error-title">Unable to load this report</h2>
            <p role="alert">{errorMessage}</p>
            <button className="btn btn-secondary" type="button" onClick={retryCurrentReport}>
              Retry
            </button>
          </div>
        </section>
      ) : loadState === 'loading' && !hasCurrentReport ? (
        <section className="section-card">
          <div className="skeleton skeleton-panel" />
        </section>
      ) : hasCurrentReport ? (
        <div className="reports-summary-grid">
          {report.summary.map((item) => (
            <article key={item.id} className="section-card stat-card">
              <p className="stat-label">{item.label}</p>
              <p className="stat-value">{item.value}</p>
              <p className="stat-helper">{item.helper}</p>
            </article>
          ))}
        </div>
      ) : null}

      {loadState !== 'error' ? (
        <section className="section-card reports-table-card" aria-labelledby="reports-table-title">
          <div className="section-heading">
            <div>
              <p className="section-eyebrow">Grouped output</p>
              <h2 id="reports-table-title">Downtime by cause and sensor</h2>
            </div>
          </div>

          <div className="account-table-wrap">
            <table className="account-table reports-table">
              <thead>
                <tr>
                  <th scope="col">Cause</th>
                  <th scope="col">Sensor</th>
                  <th scope="col">Events</th>
                  <th scope="col">Duration</th>
                  <th scope="col">Estimated Loss</th>
                </tr>
              </thead>
              <tbody>
                {loadState === 'loading' && !hasCurrentReport ? (
                  <tr>
                    <td colSpan="5">Loading report rows...</td>
                  </tr>
                ) : hasCurrentReport && report.rows.length === 0 ? (
                  <tr>
                    <td colSpan="5">No downtime rows found for this report range.</td>
                  </tr>
                ) : hasCurrentReport ? (
                  report.rows.map((row) => (
                    <tr key={`${row.cause}-${row.sensor}`}>
                      <td data-label="Cause">{row.cause}</td>
                      <td data-label="Sensor">{row.sensor === 'Unassigned' ? row.sensor : formatSensorName(row.sensor)}</td>
                      <td data-label="Events">{row.events}</td>
                      <td data-label="Duration">{row.durationMinutes} min</td>
                      <td data-label="Estimated Loss">{row.estimatedLoss} pcs</td>
                    </tr>
                  ))
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  )
}
