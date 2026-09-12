import { afterEach, describe, expect, it, vi } from 'vitest'
import { exportReport, getReportSummary } from './reportsService.js'
import { setUnauthorizedHandler } from '../../../shared/errors/unauthorizedSession.js'

function exportResponse(body, { status = 200, filename = 'report-daily-2026-09-02.csv' } = {}) {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
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
})

describe('exportReport', () => {
  afterEach(() => {
    setUnauthorizedHandler(null, null)
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('posts to the export endpoint with the bearer token and requested format', async () => {
    const fetchMock = vi.fn().mockResolvedValue(exportResponse('cause,sensor\n'))
    vi.stubGlobal('fetch', fetchMock)

    const result = await exportReport('test-token', {
      reportType: 'daily',
      selectedDate: '2026-09-02',
      format: 'csv',
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toContain('/api/reports/export')
    expect(options.method).toBe('POST')
    expect(options.headers.Authorization).toBe('Bearer test-token')
    expect(JSON.parse(options.body)).toEqual({ type: 'daily', date: '2026-09-02', format: 'csv' })

    expect(result.filename).toBe('report-daily-2026-09-02.csv')
    expect(result.blob).toBeInstanceOf(Blob)
  })

  it('normalizes a month-only date before exporting', async () => {
    const fetchMock = vi.fn().mockResolvedValue(exportResponse('cause,sensor\n'))
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

  it('surfaces backend error messages when the export is rejected', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { code: 'RATE_LIMITED', message: 'Too many export requests. Please try again later.' },
    }), { status: 429, headers: { 'Content-Type': 'application/json' } })))

    await expect(exportReport('test-token', {
      reportType: 'daily',
      selectedDate: '2026-09-02',
      format: 'csv',
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
      format: 'csv',
    })).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT' })
  })

  it('normalizes network failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    await expect(exportReport('test-token', {
      reportType: 'daily',
      selectedDate: '2026-09-02',
      format: 'csv',
    })).rejects.toMatchObject({ code: 'NETWORK_ERROR' })
  })
})
