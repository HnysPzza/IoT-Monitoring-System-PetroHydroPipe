import { afterEach, describe, expect, it, vi } from 'vitest'
import { exportReport, getReportSummary } from './reportsService.js'
import { setUnauthorizedHandler } from '../../../shared/errors/unauthorizedSession.js'

function exportResponse(body, {
  status = 200,
  filename = 'report-daily-2026-09-02.pdf',
  contentType = 'application/pdf',
} = {}) {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}

describe('getReportSummary', () => {
  afterEach(() => {
    setUnauthorizedHandler(null, null)
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('fetches the summary endpoint with the bearer token and returns the payload', async () => {
    const payload = { report: { reportType: 'daily', rows: [] } }
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await getReportSummary('test-token', { reportType: 'daily', selectedDate: '2026-09' })

    expect(result).toEqual(payload)
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toContain('/api/reports/summary?type=daily&date=2026-09-01')
    expect(options.headers.Authorization).toBe('Bearer test-token')
  })

  it('requests prior-period comparison data when the report UI needs deltas', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ report: {} }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await getReportSummary('test-token', {
      reportType: 'weekly',
      selectedDate: '2026-09-07',
      includeComparison: true,
    })

    const [url] = fetchMock.mock.calls[0]
    expect(url).toContain('/api/reports/summary?type=weekly&date=2026-09-07&compare=true')
  })
})

describe('exportReport', () => {
  afterEach(() => {
    setUnauthorizedHandler(null, null)
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('posts to the export endpoint with the bearer token and requested format', async () => {
    const fetchMock = vi.fn().mockResolvedValue(exportResponse('%PDF-x'))
    vi.stubGlobal('fetch', fetchMock)

    const result = await exportReport('test-token', {
      reportType: 'daily',
      selectedDate: '2026-09-02',
      format: 'pdf',
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toContain('/api/reports/export')
    expect(options.method).toBe('POST')
    expect(options.headers.Authorization).toBe('Bearer test-token')
    expect(JSON.parse(options.body)).toEqual({ type: 'daily', date: '2026-09-02', format: 'pdf' })

    expect(result.filename).toBe('report-daily-2026-09-02.pdf')
    expect(result.blob).toBeInstanceOf(Blob)
  })

  it('normalizes a month-only date before exporting', async () => {
    const fetchMock = vi.fn().mockResolvedValue(exportResponse('%PDF-x'))
    vi.stubGlobal('fetch', fetchMock)

    await exportReport('test-token', {
      reportType: 'monthly',
      selectedDate: '2026-09',
      format: 'pdf',
    })

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      type: 'monthly',
      date: '2026-09-01',
      format: 'pdf',
    })
  })

  it('accepts the XLSX attachment and preserves its filename', async () => {
    const fetchMock = vi.fn().mockResolvedValue(exportResponse('xlsx-data', {
      filename: 'report-daily-2026-09-02.xlsx',
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await exportReport('test-token', {
      reportType: 'daily',
      selectedDate: '2026-09-02',
      format: 'xlsx',
    })

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      type: 'daily', date: '2026-09-02', format: 'xlsx',
    })
    expect(result.filename).toBe('report-daily-2026-09-02.xlsx')
    expect(result.blob).toBeInstanceOf(Blob)
  })

  it('surfaces backend error messages when the export is rejected', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { code: 'RATE_LIMITED', message: 'Too many export requests. Please try again later.' },
    }), { status: 429, headers: { 'Content-Type': 'application/json' } })))

    await expect(exportReport('test-token', {
      reportType: 'daily',
      selectedDate: '2026-09-02',
      format: 'pdf',
    })).rejects.toMatchObject({
      message: 'Too many export requests. Please try again later.',
      status: 429,
    })
  })

  it('falls back to a derived filename when the header is missing', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('%PDF-x', {
      status: 200,
      headers: { 'Content-Type': 'application/pdf' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await exportReport('test-token', {
      reportType: 'weekly',
      selectedDate: '2026-09-02',
      format: 'pdf',
    })

    expect(result.filename).toBe('report-weekly-2026-09-02.pdf')
  })

  it('normalizes request timeouts', async () => {
    const abortError = new DOMException('The operation was aborted.', 'AbortError')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortError))

    await expect(exportReport('test-token', {
      reportType: 'daily',
      selectedDate: '2026-09-02',
      format: 'pdf',
    })).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT' })
  })

  it('normalizes network failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    await expect(exportReport('test-token', {
      reportType: 'daily',
      selectedDate: '2026-09-02',
      format: 'pdf',
    })).rejects.toMatchObject({ code: 'NETWORK_ERROR' })
  })
})
