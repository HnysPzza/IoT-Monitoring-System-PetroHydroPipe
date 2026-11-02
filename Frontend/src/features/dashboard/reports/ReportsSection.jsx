import './reports-compact.css'
import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Check, Download, Info, Minus, RotateCw, TrendingDown, TrendingUp } from 'lucide-react'
import { useAuth } from '../../../shared/hooks/useAuth.js'
import { formatSensorName } from '../../../shared/constants/sensorIdentity.js'
import TrendCalendarControl, { normalizeCalendarSelection } from '../overview/TrendCalendarControl.jsx'
import { Popover, PopoverContent, PopoverTrigger } from '../../../shared/components/ui/Popover.jsx'
import { exportReport, getReportSummary, reportCategories } from './reportsService.js'
import { formatDimension, formatPercentage, formatTonnage, getReportCards } from './reportsPresentation.js'
import '../production/ProductionSection.css'

function renderSpecCustomer(group) {
  if (group?.customer && String(group.customer).trim() !== '') {
    return group.customer
  }
  if (group?.isSpecified === false) {
    return 'Unspecified / Pending Tag'
  }
  if (group?.label && String(group.label).trim() !== '') {
    return group.label
  }
  return <span className="production-placeholder">—</span>
}

function renderCutLogCustomer(log) {
  if (log?.customer && String(log.customer).trim() !== '') {
    return log.customer
  }
  if (log?.label && String(log.label).trim() !== '') {
    return log.label
  }
  return <span className="production-placeholder">—</span>
}

function renderDimension(val) {
  const formatted = formatDimension(val)
  return formatted !== null ? formatted : <span className="production-placeholder">—</span>
}

function renderTonnage(val) {
  const formatted = formatTonnage(val)
  return formatted !== null ? formatted : <span className="production-placeholder">—</span>
}

function renderPipeNumber(log) {
  const num = log?.pipeNumber ?? log?.pipe_number
  return num !== null && num !== undefined && num !== '' ? num : <span className="production-placeholder">—</span>
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  try {
    link.click()
  } finally {
    document.body.removeChild(link)
    setTimeout(() => {
      URL.revokeObjectURL(url)
    }, 1000)
  }
}

function getManilaDateInputValue() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function getQueryKey(category, reportType, selectedDate) {
  return `${category}:${reportType}:${selectedDate}`
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
        {card.isPrimary ? <ReportDeltaBadge delta={card.delta} /> : card.id === 'downtime' && card.value.includes(' · ') ? <span className="reports-delta-badge">{card.value.split(' · ')[0]}</span> : null}
      </div>
      <p className="reports-stat-value">{card.id === 'downtime' && card.value.includes(' · ') ? card.value.split(' · ')[1] : card.value}</p>
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
          {isExporting ? <RotateCw className="spin-icon" size={16} aria-hidden="true" /> : <Download size={16} aria-hidden="true" />}
          <span>Export</span>
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

function ReportCategoryFilter({ category, onSelectCategory }) {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef(null)
  const buttonRef = useRef(null)

  useEffect(() => {
    if (!isOpen) return

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault()
        setIsOpen(false)
        buttonRef.current?.focus()
        return
      }

      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        const items = containerRef.current?.querySelectorAll('[role="menuitem"]')
        if (!items || items.length === 0) return
        const activeIdx = Array.from(items).indexOf(document.activeElement)
        const nextIdx = event.key === 'ArrowDown'
          ? (activeIdx + 1) % items.length
          : (activeIdx - 1 + items.length) % items.length
        items[nextIdx]?.focus()
      }
    }

    function handlePointerDown(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false)
      }
    }

    function handleFocusOut(event) {
      if (containerRef.current && !containerRef.current.contains(event.relatedTarget)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('focusout', handleFocusOut)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('focusout', handleFocusOut)
    }
  }, [isOpen])

  function handleSelect(categoryId) {
    onSelectCategory(categoryId)
    setIsOpen(false)
    buttonRef.current?.focus()
  }

  const activeCategory = reportCategories.find((cat) => cat.id === category)

  return (
    <div className="reports-filter-container" ref={containerRef}>
      <button
        ref={buttonRef}
        className={`reports-funnel-trigger ${isOpen ? 'is-active' : ''}`}
        type="button"
        aria-label="Filter report type"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls="reports-filter-menu"
        title={`Filter report type (Current: ${activeCategory?.label || 'Regular Report'})`}
        onClick={() => setIsOpen((prev) => !prev)}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="lucide lucide-funnel preview-icon"
          aria-hidden="true"
        >
          <path d="M10 20a1 1 0 0 0 .553.895l2 1A1 1 0 0 0 14 21v-7a2 2 0 0 1 .517-1.341L21.74 4.67A1 1 0 0 0 21 3H3a1 1 0 0 0-.742 1.67l7.225 7.989A2 2 0 0 1 10 14z" />
        </svg>
      </button>

      {isOpen ? (
        <div
          id="reports-filter-menu"
          className="reports-filter-popover rounded-2xl p-2 min-w-[220px] shadow-lg"
          role="menu"
          aria-label="Report category"
        >
          <div className="reports-filter-popover-list" role="none">
            {reportCategories.map((cat) => {
              const isSelected = category === cat.id
              return (
                <button
                  key={cat.id}
                  className={`reports-filter-popover-item flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-medium cursor-pointer transition-colors ${isSelected ? 'is-active' : ''
                    }`}
                  type="button"
                  role="menuitem"
                  aria-checked={isSelected}
                  onClick={() => handleSelect(cat.id)}
                >
                  <span className="reports-filter-item-left">
                    <span className="reports-filter-dot" aria-hidden="true" />
                    <span className="reports-filter-item-label">{cat.label}</span>
                  </span>
                  {isSelected ? <Check size={16} className="reports-filter-check" aria-hidden="true" /> : null}
                </button>
              )
            })}
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default function ReportsSection() {
  const { token } = useAuth()
  const [category, setCategory] = useState('regular')
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
  const queryKey = getQueryKey(category, reportType, selectedDate)
  const requestKey = `${token || 'anonymous'}:${queryKey}`
  const hasCurrentReport = Boolean(report && loadedRequestKey === requestKey)
  const isCurrentSuccess = loadState === 'success' && hasCurrentReport
  const reportCards = hasCurrentReport ? getReportCards(report) : []
  const isProduction = category === 'production'

  useEffect(() => {
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    let isCancelled = false

    async function loadReport() {
      setLoadState('loading')
      setErrorMessage('')

      try {
        const payload = await getReportSummary(token, { category, reportType, selectedDate, includeComparison: true })
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
  }, [category, queryKey, refreshRequest, reportType, requestKey, selectedDate, token])

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
      const { blob, filename } = await exportReport(token, { category, reportType, selectedDate, format })
      downloadBlob(blob, filename)
      setExportState('idle')
      setExportingFormat(null)
    } catch (error) {
      setExportErrorMessage(error.message || 'Unable to export the report.')
      setExportState('error')
      setExportingFormat(null)
    }
  }

  const controls = (
        <div className="reports-controls">
          <ReportCategoryFilter category={category} onSelectCategory={setCategory} />
          <TrendCalendarControl
            mode={calendarMode}
            selectedDate={selectedCalendarDate}
            maxDate={maxCalendarDate}
            rangeLabel={calendarRangeLabel}
            onDateChange={handleCalendarDateChange}
            onModeChange={(nextMode) => {
              const nextType = nextMode === 'week' ? 'weekly' : nextMode === 'month' ? 'monthly' : 'daily'
              handleReportTypeChange(nextType)
            }}
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
  )

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

      {controls}
      {exportErrorMessage ? <div className="notice notice-error dashboard-alert" role="alert"><AlertTriangle size={16} aria-hidden="true" /><span>{exportErrorMessage}</span></div> : null}

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
          <section className="reports-compact-summary" aria-label="Report summary">
            {reportCards.map((card) => <ReportSummaryCard key={card.id} card={card} />)}
          </section>
        </>
      ) : null}

      {isProduction ? (
        <>
          {loadState !== 'error' ? (
            <section className="section-card reports-table-card" aria-labelledby="reports-specs-title">
              <div className="section-heading">
                <div>
                  <h2 id="reports-specs-title">Output by product specification</h2>
                </div>
              </div>

              <div className="account-table-wrap">
                <table className="account-table reports-table">
                  <thead>
                    <tr>
                      <th scope="col">Customer</th>
                      <th scope="col" className="production-col-num tabular-data" style={{ textAlign: 'right' }}>Diameter (OD mm)</th>
                      <th scope="col" className="production-col-num tabular-data" style={{ textAlign: 'right' }}>Thickness (mm)</th>
                      <th scope="col" className="production-col-num tabular-data" style={{ textAlign: 'right' }}>Length (mm)</th>
                      <th scope="col" className="production-col-num tabular-data" style={{ textAlign: 'right' }}>Total Tons</th>
                      <th scope="col" className="production-col-num tabular-data" style={{ textAlign: 'right' }}>Quantity</th>
                      <th scope="col" className="production-col-num tabular-data" style={{ textAlign: 'right' }}>% of Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loadState === 'loading' && !hasCurrentReport ? (
                      <tr><td colSpan="7">Loading specification breakdown...</td></tr>
                    ) : hasCurrentReport && (!report.specBreakdown || report.specBreakdown.length === 0) ? (
                      <tr><td colSpan="7">{report.periodState === 'future' ? 'Output not observed yet.' : 'No accepted pipe cutting events recorded for this period.'}</td></tr>
                    ) : hasCurrentReport ? (
                      report.specBreakdown.map((group, index) => (
                        <tr key={group.customer || group.label || group.size || index}>
                          <td data-label="Customer">{renderSpecCustomer(group)}</td>
                          <td data-label="Diameter (OD mm)" className="production-col-num tabular-data" style={{ textAlign: 'right' }}>
                            {renderDimension(group.diameter)}
                          </td>
                          <td data-label="Thickness (mm)" className="production-col-num tabular-data" style={{ textAlign: 'right' }}>
                            {renderDimension(group.thickness)}
                          </td>
                          <td data-label="Length (mm)" className="production-col-num tabular-data" style={{ textAlign: 'right' }}>
                            {renderDimension(group.length)}
                          </td>
                          <td data-label="Total Tons" className="production-col-num tabular-data" style={{ textAlign: 'right' }}>
                            {renderTonnage(group.totalTonnage ?? group.tonnage)}
                          </td>
                          <td data-label="Quantity" className="production-col-num tabular-data" style={{ textAlign: 'right' }}>
                            {group.pipeCount !== null && group.pipeCount !== undefined
                              ? `${group.pipeCount} pcs`
                              : <span className="production-placeholder">—</span>}
                          </td>
                          <td data-label="% of Total" className="production-col-num tabular-data" style={{ textAlign: 'right' }}>
                            {group.percentageOfTotal !== null && group.percentageOfTotal !== undefined
                              ? formatPercentage(group.percentageOfTotal)
                              : <span className="production-placeholder">—</span>}
                          </td>
                        </tr>
                      ))
                    ) : null}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {loadState !== 'error' ? (
            <section className="section-card reports-table-card" aria-labelledby="reports-cuts-title">
              <div className="section-heading">
                <div>
                  <h2 id="reports-cuts-title">S-05 cutting events</h2>
                </div>
              </div>

              <div className="account-table-wrap">
                <table className="account-table reports-table">
                  <thead>
                    <tr>
                      <th scope="col">Cut Time</th>
                      <th scope="col">Customer</th>
                      <th scope="col" className="production-col-num tabular-data" style={{ textAlign: 'right' }}>Diameter (OD mm)</th>
                      <th scope="col" className="production-col-num tabular-data" style={{ textAlign: 'right' }}>Thickness (mm)</th>
                      <th scope="col" className="production-col-num tabular-data" style={{ textAlign: 'right' }}>Length (mm)</th>
                      <th scope="col" className="production-col-num tabular-data" style={{ textAlign: 'right' }}>Pipe #</th>
                      <th scope="col" className="production-col-num tabular-data" style={{ textAlign: 'right' }}>Tons</th>
                      <th scope="col">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loadState === 'loading' && !hasCurrentReport ? (
                      <tr><td colSpan="8">Loading cutting events...</td></tr>
                    ) : hasCurrentReport && (!report.productionLogs || report.productionLogs.length === 0) ? (
                      <tr><td colSpan="8">{report.periodState === 'future' ? 'Pipe cuts not observed yet.' : 'No pipe cutting events registered for this period.'}</td></tr>
                    ) : hasCurrentReport ? (
                      report.productionLogs.map((log, index) => (
                        <tr key={log.id || log.deviceEventId || log.sensorEventId || index}>
                          <td data-label="Cut Time" className="production-col-timestamp tabular-data">
                            {log.recordedAt && !Number.isNaN(new Date(log.recordedAt).getTime())
                              ? formatSuccessfulUpdate(new Date(log.recordedAt))
                              : 'N/A'}
                          </td>
                          <td data-label="Customer">{renderCutLogCustomer(log)}</td>
                          <td data-label="Diameter (OD mm)" className="production-col-num tabular-data" style={{ textAlign: 'right' }}>
                            {renderDimension(log.diameter)}
                          </td>
                          <td data-label="Thickness (mm)" className="production-col-num tabular-data" style={{ textAlign: 'right' }}>
                            {renderDimension(log.thickness)}
                          </td>
                          <td data-label="Length (mm)" className="production-col-num tabular-data" style={{ textAlign: 'right' }}>
                            {renderDimension(log.length)}
                          </td>
                          <td data-label="Pipe #" className="production-col-num tabular-data" style={{ textAlign: 'right' }}>
                            {renderPipeNumber(log)}
                          </td>
                          <td data-label="Tons" className="production-col-num tabular-data" style={{ textAlign: 'right' }}>
                            {renderTonnage(log.tonnage ?? log.singleTonnage)}
                          </td>
                          <td data-label="Status">
                            <span className={`production-status-badge ${log.isSpecified ? 'green' : 'amber'}`}>
                              {log.isSpecified ? 'Specified' : 'Pending Tag'}
                            </span>
                          </td>
                        </tr>
                      ))
                    ) : null}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
        </>
      ) : (
        <div className="reports-detail-grid">
          {loadState !== 'error' ? (
            <section className="section-card reports-table-card" aria-labelledby="reports-process-title">
              <div className="section-heading">
                <div>
                  <h2 id="reports-process-title">Events by process sensor</h2>
                </div>
                {hasCurrentReport && report.processSensors?.length > 0 && report.processSensors.every((sensor) => Number.isFinite(sensor.eventCount)) ? (
                  <span className="section-chip">{report.processSensors.reduce((total, sensor) => total + sensor.eventCount, 0)} events</span>
                ) : null}
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
                        <td colSpan="5">{report.periodState === 'future' ? 'Downtime not observed yet.' : <span className="reports-empty-state"><Check size={16} aria-hidden="true" /><span>No downtime events</span></span>}</td>
                      </tr>
                    ) : hasCurrentReport ? (
                      report.rows.map((row, index) => (
                        <tr key={`${row.cause || ''}-${row.sensor || ''}-${row.id || index}`}>
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
      )}
    </div>
  )
}
