import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Download, FileText, Lock } from 'lucide-react'
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
  // Browser-only CSV download; PDF export waits for backend generation.
  const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

export default function ReportsSection() {
  const { token } = useAuth()
  const [reportType, setReportType] = useState('daily')
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [report, setReport] = useState({ summary: [], rows: [] })
  const [notice, setNotice] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const selectedReportLabel = reportTypes.find((type) => type.id === reportType)?.label || 'Report'

  useEffect(() => {
    let isMounted = true

    async function loadReport() {
      setIsLoading(true)
      setNotice(null)

      try {
        const payload = await getReportSummary(token, { reportType, selectedDate })
        if (!isMounted) return
        setReport(payload.report || { summary: [], rows: [] })
      } catch (error) {
        if (!isMounted) return
        setNotice({ type: 'error', message: error.message || 'Unable to load report summary.' })
        setReport({ summary: [], rows: [] })
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    loadReport()

    return () => {
      isMounted = false
    }
  }, [reportType, selectedDate, token])

  return (
    <div className="reports-layout">
      {notice ? (
        <div className={`notice notice-${notice.type} dashboard-alert`} role={notice.type === 'error' ? 'alert' : 'status'}>
          {notice.type === 'error' ? <AlertTriangle size={16} aria-hidden="true" /> : <CheckCircle2 size={16} aria-hidden="true" />}
          <span>{notice.message}</span>
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
            className="btn btn-primary reports-action"
            type="button"
            disabled={isLoading}
            onClick={() => downloadCsv(`petrohydropipe-${reportType}-report.csv`, report.rows)}
          >
            <Download size={17} aria-hidden="true" />
            Export CSV
          </button>
          <button className="btn btn-secondary reports-action" type="button" disabled>
            <Lock size={17} aria-hidden="true" />
            PDF Export (Coming Soon)
          </button>
        </div>
      </section>

      {isLoading ? (
        <section className="section-card">
          <div className="skeleton skeleton-panel" />
        </section>
      ) : (
        <div className="reports-summary-grid">
          {report.summary.map((item) => (
            <article key={item.id} className="section-card stat-card">
              <p className="stat-label">{item.label}</p>
              <p className="stat-value">{item.value}</p>
              <p className="stat-helper">{item.helper}</p>
            </article>
          ))}
        </div>
      )}

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
              {isLoading ? (
                <tr>
                  <td colSpan="5">Loading report rows...</td>
                </tr>
              ) : report.rows.length === 0 ? (
                <tr>
                  <td colSpan="5">No downtime rows found for this report range.</td>
                </tr>
              ) : (
                report.rows.map((row) => (
                  <tr key={`${row.cause}-${row.sensor}`}>
                    <td>{row.cause}</td>
                    <td>{row.sensor === 'Unassigned' ? row.sensor : formatSensorName(row.sensor)}</td>
                    <td>{row.events}</td>
                    <td>{row.durationMinutes} min</td>
                    <td>{row.estimatedLoss} pcs</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
