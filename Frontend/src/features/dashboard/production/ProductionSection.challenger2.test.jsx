import { describe, expect, it, vi, beforeEach } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import fs from 'fs'
import path from 'path'
import { renderWithAuth } from '../../../test/renderWithAuth.jsx'
import ProductionSection from './ProductionSection.jsx'
import * as sensorIdentity from '../../../shared/constants/sensorIdentity.js'

describe('Challenger 2 Adversarial Stress Suite — Production Module M4', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('1. Hard Guardrail Verification', () => {
    it('strictly guarantees ZERO export buttons exist in /dashboard/production across all DOM elements', async () => {
      const mockLoad = vi.fn().mockResolvedValue({
        sensor: { code: 'S-05', label: 'Production Output Cutting' },
        machine: { code: 'M-01', name: 'Spiral Mill 01' },
        summary: { totalAccepted: 5, specifiedCount: 3, unspecifiedCount: 2, rejectedCount: 0 },
        records: [
          {
            id: 'cut-1',
            sensorEventId: 'cut-1',
            outputAccepted: true,
            status: 'accepted',
            isSpecified: true,
            customer: 'MCWD',
            diameter: 625.4,
            thickness: 12.7,
            length: 6000,
            pipeNumber: 101,
            tonnage: 1.1513,
            recordedAt: '2026-10-31T01:00:00.000Z',
          },
        ],
        pagination: { page: 1, pageSize: 25, total: 1, totalPages: 1 },
      })

      const { container } = renderWithAuth(<ProductionSection loadProduction={mockLoad} />)
      await screen.findByText('MCWD')

      // 1. Role-based button queries
      expect(screen.queryByRole('button', { name: /export/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /download/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /pdf/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /csv/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /excel/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /xlsx/i })).not.toBeInTheDocument()

      // 2. Query all interactive elements (buttons, links, inputs)
      const allButtons = container.querySelectorAll('button, a, input[type="button"], input[type="submit"]')
      allButtons.forEach((el) => {
        const text = (el.textContent || '').toLowerCase()
        const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase()
        const title = (el.getAttribute('title') || '').toLowerCase()
        const combined = `${text} ${ariaLabel} ${title}`

        expect(combined).not.toMatch(/\b(export|download|pdf|csv|excel|xlsx)\b/i)
      })

      // 3. Static source code verification of ProductionSection.jsx
      const sourcePath = path.resolve(__dirname, 'ProductionSection.jsx')
      const sourceContent = fs.readFileSync(sourcePath, 'utf-8')

      // Ensure no export action triggers exist in the JSX markup
      const lowerSource = sourceContent.toLowerCase()
      expect(lowerSource).not.toContain('export button')
      expect(lowerSource).not.toContain('export-button')
      expect(lowerSource).not.toContain('download-button')
      expect(lowerSource).not.toContain('handleexport')
      expect(lowerSource).not.toContain('handledownload')
    })

    it('strictly verifies sensorIdentity.js is the sole source of truth for S-05 and station labels', async () => {
      const spyGetSensorLabel = vi.spyOn(sensorIdentity, 'getSensorLabel')

      const mockLoad = vi.fn().mockResolvedValue({
        summary: { totalAccepted: 1, specifiedCount: 0, unspecifiedCount: 1, rejectedCount: 0 },
        records: [
          {
            id: 'cut-1',
            outputAccepted: true,
            status: 'accepted',
            isSpecified: false,
            customer: null,
            recordedAt: '2026-10-31T02:00:00.000Z',
          },
        ],
        pagination: { page: 1, pageSize: 25, total: 1, totalPages: 1 },
      })

      renderWithAuth(<ProductionSection loadProduction={mockLoad} />)

      // getSensorLabel must have been called with 'S-05' and 'Production Output Cutting' fallback
      expect(spyGetSensorLabel).toHaveBeenCalledWith('S-05', 'Production Output Cutting')

      // The rendered eyebrow header must reflect the label from sensorIdentity
      const expectedLabel = sensorIdentity.getSensorLabel('S-05', 'Production Output Cutting')
      const eyebrow = screen.getByText(new RegExp(`S-05 · ${expectedLabel.toUpperCase()} · SPIRAL MILL 01`, 'i'))
      expect(eyebrow).toBeInTheDocument()

      spyGetSensorLabel.mockRestore()
    })
  })

  describe('2. DOM & Table Layout Stress', () => {
    it('stress tests rendering 120 production logs cleanly without UI freeze and handles selection', async () => {
      const records120 = Array.from({ length: 120 }, (_, i) => ({
        id: `stress-${i + 1}`,
        sensorEventId: `stress-${i + 1}`,
        deviceEventId: 1000 + i,
        outputAccepted: i % 6 !== 0, // 100 accepted, 20 rejected
        status: i % 6 !== 0 ? 'accepted' : 'rejected',
        isSpecified: i % 2 === 0,
        customer: i % 2 === 0 ? `Client ${i + 1}` : null,
        diameter: i % 2 === 0 ? 625.4 : null,
        thickness: i % 2 === 0 ? 12.7 : null,
        length: i % 2 === 0 ? 6000 : null,
        pipeNumber: i % 2 === 0 ? i + 1 : null,
        tonnage: i % 2 === 0 ? 1.1513 : null,
        recordedAt: new Date(Date.UTC(2026, 9, 31, 8, Math.floor(i / 2), (i % 2) * 30)).toISOString(),
      }))

      const mockLoad = vi.fn().mockResolvedValue({
        summary: {
          totalAccepted: 100,
          specifiedCount: 60,
          unspecifiedCount: 40,
          rejectedCount: 20,
        },
        records: records120,
        pagination: {
          page: 1,
          pageSize: 120,
          total: 120,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      })

      const t0 = performance.now()
      const { container } = renderWithAuth(<ProductionSection loadProduction={mockLoad} />)

      await screen.findByText('Client 1')
      const t1 = performance.now()

      // DOM rendering of 120 complex table rows with Lucide icons must complete under 1.5 seconds in jsdom
      expect(t1 - t0).toBeLessThan(1500)

      // Verify all 120 rows are rendered in tbody
      const rows = container.querySelectorAll('tbody tr')
      expect(rows.length).toBe(120)

      // Verify KPI values rendered
      expect(screen.getByText('100')).toBeInTheDocument() // accepted
      expect(screen.getByText('60')).toBeInTheDocument()  // specified
      expect(screen.getByText('40')).toBeInTheDocument()  // unspecified

      // Verify pagination text handles 120 items
      expect(screen.getByText(/120 records/i)).toBeInTheDocument()

      // Select all 100 accepted items
      const user = userEvent.setup()
      const headerCheckbox = screen.getByLabelText('Select all cuts on this page')
      await user.click(headerCheckbox)

      expect(await screen.findByText('100 cuts selected')).toBeInTheDocument()
    })

    it('verifies CSS rules enforce font-variant-numeric: tabular-nums on all numeric data cells', () => {
      const cssPath = path.resolve(__dirname, 'ProductionSection.css')
      const cssContent = fs.readFileSync(cssPath, 'utf-8')

      // Check key CSS classes for tabular-nums
      const expectedTabularSelectors = [
        '.tabular-data',
        '.production-col-timestamp',
        '.production-col-num',
        '.production-inline-input.production-inline-num',
        '.production-kpi-pill .production-kpi-value',
        '.production-pagination-info',
      ]

      expectedTabularSelectors.forEach((selector) => {
        expect(cssContent).toContain(selector)
      })

      // Count occurrences of font-variant-numeric: tabular-nums in the stylesheet
      const tabularNumMatches = cssContent.match(/font-variant-numeric:\s*tabular-nums/g)
      expect(tabularNumMatches).not.toBeNull()
      expect(tabularNumMatches.length).toBeGreaterThanOrEqual(6)
    })

    it('verifies empty or null values render <span class="production-placeholder">—</span> and NEVER blank empty text', async () => {
      const allNullRecord = {
        id: 'null-cut-1',
        sensorEventId: 'null-cut-1',
        deviceEventId: 999,
        outputAccepted: true,
        status: 'accepted',
        isSpecified: false,
        customer: null,
        diameter: null,
        thickness: null,
        length: null,
        pipeNumber: null,
        tonnage: null,
        recordedAt: null,
      }

      const mockLoad = vi.fn().mockResolvedValue({
        summary: { totalAccepted: 1, specifiedCount: 0, unspecifiedCount: 1, rejectedCount: 0 },
        records: [allNullRecord],
        pagination: { page: 1, pageSize: 25, total: 1, totalPages: 1 },
      })

      const { container } = renderWithAuth(<ProductionSection loadProduction={mockLoad} />)

      await waitFor(() => {
        expect(container.querySelectorAll('tbody tr').length).toBe(1)
      })

      const row = container.querySelector('tbody tr')
      const placeholders = row.querySelectorAll('.production-placeholder')

      // Cut Time, Customer, Diameter, Thickness, Length, Pipe #, Tons -> all 7 cells must contain placeholder
      expect(placeholders.length).toBe(7)

      placeholders.forEach((placeholder) => {
        expect(placeholder.textContent).toBe('—')
        expect(placeholder.tagName.toLowerCase()).toBe('span')
      })

      // Ensure no table data cell is completely empty (no blank text or whitespace-only td)
      const dataCells = row.querySelectorAll('td:not(.production-col-select):not(.production-col-status):not(.production-col-action)')
      dataCells.forEach((td) => {
        expect(td.textContent.trim()).not.toBe('')
        expect(td.textContent).toContain('—')
      })
    })
  })

  describe('3. Concurrency Stress (409 Conflict)', () => {
    it('simulates concurrent modification (HTTP 409 Conflict) and verifies graceful reload and alert banner', async () => {
      const user = userEvent.setup()

      const staleRecord = {
        id: 'conflict-row-1',
        sensorEventId: 'conflict-row-1',
        outputAccepted: true,
        status: 'accepted',
        isSpecified: true,
        customer: 'Stale Customer',
        diameter: 625.4,
        thickness: 12.7,
        length: 6000,
        pipeNumber: 50,
        tonnage: 1.1513,
        recordedAt: '2026-10-31T01:00:00.000Z',
        updatedAt: '2026-10-31T01:00:00.000Z',
      }

      const freshServerRecord = {
        ...staleRecord,
        customer: 'Fresh Server Customer (Modified by Op 2)',
        diameter: 1020,
        thickness: 10.0,
        length: 12000,
        tonnage: 2.9888,
        updatedAt: '2026-10-31T01:05:00.000Z',
      }

      let loadCallCount = 0
      const mockLoad = vi.fn().mockImplementation(() => {
        loadCallCount++
        return Promise.resolve({
          summary: { totalAccepted: 1, specifiedCount: 1, unspecifiedCount: 0, rejectedCount: 0 },
          records: [loadCallCount === 1 ? staleRecord : freshServerRecord],
          pagination: { page: 1, pageSize: 25, total: 1, totalPages: 1 },
        })
      })

      // Mock update failing with HTTP 409 Conflict
      const conflictError = new Error('Specification was modified by another user.')
      conflictError.status = 409
      conflictError.code = 'PRODUCTION_SPEC_CONFLICT'
      const mockUpdate = vi.fn().mockRejectedValue(conflictError)

      renderWithAuth(<ProductionSection loadProduction={mockLoad} updateProductionSpec={mockUpdate} />)

      // Wait for initial load
      await screen.findByText('Stale Customer')
      expect(loadCallCount).toBe(1)

      // Start inline edit
      const editButton = screen.getByRole('button', { name: /edit specification/i })
      await user.click(editButton)

      const customerInput = screen.getByLabelText('Specification customer')
      await user.clear(customerInput)
      await user.type(customerInput, 'My Competing Update')

      // Save inline edit
      const saveBtn = screen.getByRole('button', { name: 'Save specification' })
      await user.click(saveBtn)

      // Assert update was attempted with expectedUpdatedAt
      expect(mockUpdate).toHaveBeenCalledWith(
        'test-token',
        'conflict-row-1',
        expect.objectContaining({ customer: 'My Competing Update' }),
        '2026-10-31T01:00:00.000Z',
      )

      // Conflict notice must appear as a non-crashing role="alert" banner
      const alert = await screen.findByRole('alert')
      expect(alert).toHaveClass('production-conflict-notice')
      expect(alert).toHaveTextContent(/production specification was modified by another user/i)

      // loadProduction must have been called again (silent reload) to fetch fresh state
      await waitFor(() => {
        expect(loadCallCount).toBeGreaterThanOrEqual(2)
      })

      // Fresh server record should now be rendered in the table without UI freeze or crash
      expect(await screen.findByText('Fresh Server Customer (Modified by Op 2)')).toBeInTheDocument()
      expect(screen.queryByText('My Competing Update')).not.toBeInTheDocument()

      // Conflict notice can be dismissed cleanly
      const dismissBtn = screen.getByRole('button', { name: /dismiss notice/i })
      await user.click(dismissBtn)

      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('handles rapid repeated conflict retries without crashing or duplicate alert banners', async () => {
      const user = userEvent.setup()

      const conflictError = new Error('Specification was modified by another user.')
      conflictError.status = 409
      const mockUpdate = vi.fn().mockRejectedValue(conflictError)

      const record = {
        id: 'conflict-row-2',
        outputAccepted: true,
        status: 'accepted',
        isSpecified: true,
        customer: 'Customer A',
        recordedAt: '2026-10-31T01:00:00.000Z',
        updatedAt: '2026-10-31T01:00:00.000Z',
      }

      const mockLoad = vi.fn().mockResolvedValue({
        summary: { totalAccepted: 1, specifiedCount: 1, unspecifiedCount: 0, rejectedCount: 0 },
        records: [record],
        pagination: { page: 1, pageSize: 25, total: 1, totalPages: 1 },
      })

      renderWithAuth(<ProductionSection loadProduction={mockLoad} updateProductionSpec={mockUpdate} />)

      await screen.findByText('Customer A')

      // Edit and trigger conflict
      await user.click(screen.getByRole('button', { name: /edit specification/i }))
      await user.click(screen.getByRole('button', { name: 'Save specification' }))

      // Conflict banner appears
      expect(await screen.findByText(/production specification was modified by another user/i)).toBeInTheDocument()

      // Edit again and trigger conflict second time
      await user.click(screen.getByRole('button', { name: /edit specification/i }))
      await user.click(screen.getByRole('button', { name: 'Save specification' }))

      // Ensure exactly one conflict alert banner exists in DOM (no duplicate alert accumulation)
      const alerts = screen.getAllByRole('alert')
      const conflictAlerts = alerts.filter((a) => a.classList.contains('production-conflict-notice'))
      expect(conflictAlerts.length).toBe(1)
    })
  })
})
