import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Download, Info, Minus, RotateCw, TrendingDown, TrendingUp } from 'lucide-react'
import { useAuth } from '../../../shared/hooks/useAuth.js'
import { formatSensorName } from '../../../shared/constants/sensorIdentity.js'
import TrendCalendarControl, { normalizeCalendarSelection } from '../overview/TrendCalendarControl.jsx'
import { Popover, PopoverContent, PopoverTrigger } from '../../../shared/components/ui/Popover.jsx'
import { exportReport, getReportSummary, reportTypes } from './reportsService.js'
import { getReportCards } from './reportsPresentation.js'

function downloadBlob(blob, filename) {
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

function parseLocalDate(value) {
  const [year, month, day] = String(value).split('-').map(Number)
  return new Date(year, (month || 1) - 1, day || 1)
}

function toDateInputValue(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getCalendarMode(reportType) {
  if (reportType === 'weekly') return 'week'
  if (reportType === 'monthly') return 'month'
  return 'day'
}

function formatCalendarDate(date) {
  return date.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
}

function getCalendarRangeLabel(reportType, date) {
  if (reportType === 'monthly') return date.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })
  if (reportType === 'weekly') {
    const weekStart = normalizeCalendarSelection('week', date)
    const weekEnd = new Date(weekStart)
    weekEnd.setDate(weekEnd.getDate() + 6)
    return `${formatCalendarDate(weekStart)} - ${formatCalendarDate(weekEnd)}`
  }
  return formatCalendarDate(date)
}

function formatSuccessfulUpdate(date) {
  return date.toLocaleString('en-PH', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Manila',
  })
}

function DeltaIcon({ direction }) {
  if (direction === 'up') return <TrendingUp size={13} aria-hidden="true" />
  if (direction === 'down') return <TrendingDown size={13} aria-hidden="true" />
  return <Minus size={13} aria-hidden="true" />
}

function ReportDeltaBadge({ delta }) {
  return (
    <span className={`reports-delta-badge is-${delta.sentiment}`} data-testid="report-delta">
      <DeltaIcon direction={delta.direction} />
      <span>{delta.label}</span>
      <span className="sr-only"> compared with the prior period</span>
    </span>
  )
}

function ReportSummaryCard({ card }) {
  const cardClasses = [
    'section-card',
    'reports-stat-card',
    card.isPrimary ? 'reports-primary-card' : 'reports-secondary-card',
    card.id === 'downtime' ? 'reports-downtime-card' : '',
    card.isWarning ? 'reports-card-warning' : '',
  ].filter(Boolean).join(' ')

  return (
    <article
      className={cardClasses}
      data-testid={`report-card-${card.id}`}
    >
      <div className="reports-stat-heading">
        <p className="stat-label">{card.label}</p>
        {card.isPrimary ? <ReportDeltaBadge delta={card.delta} /> : null}
      </div>
      <p className="reports-stat-value">{card.value}</p>
      <p className="stat-helper">{card.helper}</p>
    </article>
  )
}

function ExportMenu({ isBlocked, exportState, exportingFormat, onExport }) {
  const [isOpen, setIsOpen] = useState(false)
  const isExporting = exportState === 'exporting'

  function chooseFormat(format) {
    setIsOpen(false)
    onExport(format)
  }

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <button
          className="btn reports-icon-button"
          type="button"
          aria-label="Export report"
          aria-haspopup="dialog"
          aria-expanded={isOpen}
          disabled={isBlocked}
        >
          {isExporting ? <RotateCw className="spin-icon" size={18} aria-hidden="true" /> : <Download size={18} aria-hidden="true" />}
        </button>
      </PopoverTrigger>
      <PopoverContent className="reports-export-menu" aria-label="Export report format">
        <div className="reports-export-menu-list">
          <button
            className="reports-export-option"
            type="button"
            disabled={isBlocked}
            onClick={() => chooseFormat('pdf')}
          >
            <img src="/assets/report-export-pdf.png" alt="" aria-hidden="true" />
            <span>{isExporting && exportingFormat === 'pdf' ? 'Exporting...' : 'Export PDF'}</span>
          </button>
          <button
            className="reports-export-option"
            type="button"
            disabled={isBlocked}
            onClick={() => chooseFormat('xlsx')}
          >
            <img src="/assets/report-export-excel.png" alt="" aria-hidden="true" />
            <span>{isExporting && exportingFormat === 'xlsx' ? 'Exporting...' : 'Export Excel'}</span>
          </button>
        </div>
      </PopoverContent>
    </Popover>
  )
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
  const [exportState, setExportState] = useState('idle')
  const [exportingFormat, setExportingFormat] = useState(null)
  const [exportErrorMessage, setExportErrorMessage] = useState('')
  const requestIdRef = useRef(0)
  const successfulReportRef = useRef(null)
  const currentDate = getManilaDateInputValue()
  const selectedCalendarDate = parseLocalDate(selectedDate)
  const maxCalendarDate = parseLocalDate(currentDate)
  const calendarMode = getCalendarMode(reportType)
  const calendarRangeLabel = getCalendarRangeLabel(reportType, selectedCalendarDate)
  const queryKey = getQueryKey(reportType, selectedDate)
  const requestKey = `${token || 'anonymous'}:${queryKey}`
  const hasCurrentReport = Boolean(report && loadedRequestKey === requestKey)
  const isCurrentSuccess = loadState === 'success' && hasCurrentReport
  const reportCards = hasCurrentReport ? getReportCards(report) : []

  useEffect(() => {
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    let isCancelled = false

    async function loadReport() {
      setLoadState('loading')
      setErrorMessage('')

      try {
        const payload = await getReportSummary(token, { reportType, selectedDate, includeComparison: true })
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

  function handleReportTypeChange(nextReportType) {
    const nextMode = getCalendarMode(nextReportType)
    const nextDate = normalizeCalendarSelection(nextMode, selectedCalendarDate)
    setReportType(nextReportType)
    setSelectedDate(toDateInputValue(nextDate))
  }

  function handleCalendarDateChange(date) {
    setSelectedDate(toDateInputValue(date))
  }

  const isExportBlocked = !isCurrentSuccess || report?.periodState === 'future' || exportState === 'exporting'

  async function handleExport(format) {
    if (isExportBlocked) return

    setExportState('exporting')
    setExportingFormat(format)
    setExportErrorMessage('')

    try {
      const { blob, filename } = await exportReport(token, { reportType, selectedDate, format })
      downloadBlob(blob, filename)
      setExportState('idle')
      setExportingFormat(null)
    } catch (error) {
      setExportErrorMessage(error.message || 'Unable to export the report.')
      setExportState('error')
      setExportingFormat(null)
    }
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
        </div>

        <div className="reports-controls">
          <fieldset className="reports-period-fieldset">
            <legend className="sr-only">Report period</legend>
            <div className="trend-mode-toggle reports-period-toggle" role="group" aria-label="Report period">
              {reportTypes.map((type) => (
                <button
                  key={type.id}
                  className={`trend-mode-button reports-period-button ${reportType === type.id ? 'is-selected' : ''}`}
                  type="button"
                  aria-pressed={reportType === type.id}
                  onClick={() => handleReportTypeChange(type.id)}
                >
                  {type.label}
                </button>
              ))}
            </div>
          </fieldset>
          <TrendCalendarControl
            mode={calendarMode}
            selectedDate={selectedCalendarDate}
            maxDate={maxCalendarDate}
            rangeLabel={calendarRangeLabel}
            onDateChange={handleCalendarDateChange}
          />
          <div className="reports-controls-actions">
            <button
              className="btn reports-icon-button"
              type="button"
              aria-label="Refresh report"
              disabled={loadState === 'loading'}
              onClick={retryCurrentReport}
            >
              <RotateCw className={loadState === 'loading' ? 'spin-icon' : ''} size={18} aria-hidden="true" />
            </button>
            <ExportMenu
              isBlocked={isExportBlocked}
              exportState={exportState}
              exportingFormat={exportingFormat}
              onExport={handleExport}
            />
          </div>
        </div>

        {exportErrorMessage ? (
          <div className="notice notice-error dashboard-alert" role="alert">
            <AlertTriangle size={16} aria-hidden="true" />
            <span>{exportErrorMessage}</span>
          </div>
        ) : null}
      </section>

      {hasCurrentReport && report.periodState === 'partial' ? (
        <div className="notice reports-period-banner dashboard-alert" role="status">
          <Info size={16} aria-hidden="true" />
          <span>Partial report. Values cover recorded time so far.</span>
        </div>
      ) : null}

      {hasCurrentReport && report.periodState === 'future' ? (
        <div className="notice reports-period-banner dashboard-alert" role="status">
          <Info size={16} aria-hidden="true" />
          <span>Period not reached yet. No values have been observed.</span>
        </div>
      ) : null}

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
        <>
          <section className="reports-summary-primary-grid" aria-label="Primary report summary">
            {reportCards.filter((card) => card.isPrimary).map((card) => (
              <ReportSummaryCard key={card.id} card={card} />
            ))}
          </section>
          <section className="reports-summary-secondary-grid" aria-label="Secondary report summary">
            {reportCards.filter((card) => !card.isPrimary).map((card) => (
              <ReportSummaryCard key={card.id} card={card} />
            ))}
          </section>
        </>
      ) : null}

      {loadState !== 'error' ? (
        <section className="section-card reports-table-card" aria-labelledby="reports-process-title">
          <div className="section-heading">
            <div>
              <p className="section-eyebrow">Process activity</p>
              <h2 id="reports-process-title">Events by process sensor</h2>
            </div>
          </div>

          <div className="account-table-wrap">
            <table className="account-table reports-table">
              <thead>
                <tr>
                  <th scope="col">Sensor</th>
                  <th scope="col">Recorded events</th>
                </tr>
              </thead>
              <tbody>
                {hasCurrentReport && report.processSensors?.length ? report.processSensors.map((sensor) => (
                  <tr key={sensor.sensorCode}>
                    <td data-label="Sensor">{formatSensorName(sensor.sensorCode)}</td>
                    <td data-label="Recorded events">{sensor.eventCount ?? 'Not observed'}</td>
                  </tr>
                )) : (
                  <tr><td colSpan="2">{hasCurrentReport && report.periodState === 'future' ? 'Process events not observed yet.' : hasCurrentReport ? 'No process events found for this report range.' : 'Loading process events...'}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
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
                    <td colSpan="5">{report.periodState === 'future' ? 'Downtime not observed yet.' : 'No downtime rows found for this report range.'}</td>
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
