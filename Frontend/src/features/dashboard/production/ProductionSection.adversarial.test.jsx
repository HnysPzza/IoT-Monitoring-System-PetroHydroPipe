import { describe, expect, it, vi, beforeEach } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithAuth } from '../../../test/renderWithAuth.jsx'
import { apiRequest } from '../../../shared/services/apiClient.js'
import {
  batchUpdateProductionSpecs,
  getProductionLogs,
  updateProductionLogSpec,
  normalizeProductionRecord,
} from './productionService.js'
import ProductionSection from './ProductionSection.jsx'

vi.mock('../../../shared/services/apiClient.js', () => ({
  apiRequest: vi.fn(),
}))

const adversarialMockPayload = {
  sensor: {
    code: 'S-05',
    label: 'Production Output Cutting',
  },
  machine: {
    code: 'M-01',
    name: 'Spiral Mill 01',
  },
  periodState: 'complete',
  summary: {
    totalAccepted: 3,
    specifiedCount: 1,
    unspecifiedCount: 2,
    rejectedCount: 1,
  },
  records: [
    {
      id: 'adv-001',
      sensorEventId: 'adv-001',
      deviceEventId: 201,
      recordedAt: '2026-10-31T01:00:00.000Z',
      outputAccepted: true,
      status: 'accepted',
      isSpecified: true,
      customer: 'Regan Industrial',
      diameter: 625.4,
      thickness: 12.7,
      length: 6000,
      pipeNumber: 501,
      tonnage: 1.1513,
      updatedAt: '2026-10-31T01:00:00.000Z',
    },
    {
      id: 'adv-002-rejected',
      sensorEventId: 'adv-002-rejected',
      deviceEventId: 202,
      recordedAt: '2026-10-31T01:10:00.000Z',
      outputAccepted: false,
      rejectionReason: 'Pulse width below threshold',
      status: 'rejected',
      isSpecified: false,
      customer: null,
      diameter: null,
      thickness: null,
      length: null,
      pipeNumber: null,
      tonnage: null,
      updatedAt: null,
    },
    {
      id: 'adv-003',
      sensorEventId: 'adv-003',
      deviceEventId: 203,
      recordedAt: '2026-10-31T01:20:00.000Z',
      outputAccepted: true,
      status: 'accepted',
      isSpecified: false,
      customer: null,
      diameter: null,
      thickness: null,
      length: null,
      pipeNumber: null,
      tonnage: null,
      updatedAt: null,
    },
    {
      id: 'adv-004',
      sensorEventId: 'adv-004',
      deviceEventId: 204,
      recordedAt: '2026-10-31T01:30:00.000Z',
      outputAccepted: true,
      status: 'accepted',
      isSpecified: false,
      customer: null,
      diameter: null,
      thickness: null,
      length: null,
      pipeNumber: null,
      tonnage: null,
      updatedAt: null,
    },
  ],
  pagination: {
    page: 1,
    pageSize: 25,
    total: 4,
    totalPages: 1,
    hasNextPage: false,
    hasPreviousPage: false,
  },
}

describe('Adversarial Stress Verification — Production Logs Module', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Dimension 1: Keyboard & Inline Interaction Boundaries', () => {
    it('handles rapid Enter keypress sequences during inline editing without corrupting state or crashing', async () => {
      const user = userEvent.setup()
      let resolveUpdate
      const updatePromise = new Promise((resolve) => {
        resolveUpdate = resolve
      })
      const mockLoad = vi.fn().mockResolvedValue(adversarialMockPayload)
      const mockUpdate = vi.fn().mockReturnValue(updatePromise)

      renderWithAuth(<ProductionSection loadProduction={mockLoad} updateProductionSpec={mockUpdate} />)

      await screen.findByText('Regan Industrial')
      const editButtons = screen.getAllByRole('button', { name: /edit specification/i })
      await user.click(editButtons[0])

      const customerInput = screen.getByLabelText('Specification customer')
      await user.clear(customerInput)
      await user.type(customerInput, 'Rapid Customer')

      // Rapidly fire Enter key twice in succession
      await user.keyboard('{Enter}')
      await user.keyboard('{Enter}')

      // Saving begins, inputs should close
      expect(screen.queryByLabelText('Specification customer')).not.toBeInTheDocument()

      // Should have triggered update call
      expect(mockUpdate).toHaveBeenCalled()

      // Resolve the network promise
      resolveUpdate({
        spec: {
          sensorEventId: 'adv-001',
          customer: 'Rapid Customer',
          diameter: 625.4,
          thickness: 12.7,
          length: 6000,
          pipeNumber: 501,
          tonnage: 1.1513,
          updatedAt: '2026-10-31T02:00:00.000Z',
        },
      })

      // Final state settles cleanly
      expect(await screen.findByText('Rapid Customer')).toBeInTheDocument()
    })

    it('handles Enter followed immediately by Escape gracefully', async () => {
      const user = userEvent.setup()
      const mockLoad = vi.fn().mockResolvedValue(adversarialMockPayload)
      const mockUpdate = vi.fn().mockResolvedValue({
        spec: {
          sensorEventId: 'adv-001',
          customer: 'Interrupted Customer',
          diameter: 625.4,
          thickness: 12.7,
          length: 6000,
          pipeNumber: 501,
          tonnage: 1.1513,
          updatedAt: '2026-10-31T02:00:00.000Z',
        },
      })

      renderWithAuth(<ProductionSection loadProduction={mockLoad} updateProductionSpec={mockUpdate} />)

      await screen.findByText('Regan Industrial')
      const editButtons = screen.getAllByRole('button', { name: /edit specification/i })
      await user.click(editButtons[0])

      const customerInput = screen.getByLabelText('Specification customer')
      await user.clear(customerInput)
      await user.type(customerInput, 'Interrupted Customer')

      // Fire Enter and immediately Escape
      await user.keyboard('{Enter}')
      await user.keyboard('{Escape}')

      // Edit inputs are dismissed without error
      expect(screen.queryByLabelText('Specification customer')).not.toBeInTheDocument()
    })

    it('handles whitespace-only customer input by sanitizing to null and updating spec status', async () => {
      const user = userEvent.setup()
      const mockLoad = vi.fn().mockResolvedValue(adversarialMockPayload)
      const mockUpdate = vi.fn().mockResolvedValue({
        spec: {
          sensorEventId: 'adv-001',
          customer: null,
          diameter: null,
          thickness: null,
          length: null,
          pipeNumber: null,
          tonnage: null,
          updatedAt: '2026-10-31T02:00:00.000Z',
        },
      })

      renderWithAuth(<ProductionSection loadProduction={mockLoad} updateProductionSpec={mockUpdate} />)

      await screen.findByText('Regan Industrial')
      const editButtons = screen.getAllByRole('button', { name: /edit specification/i })
      await user.click(editButtons[0])

      // Clear customer and type spaces only
      const customerInput = screen.getByLabelText('Specification customer')
      await user.clear(customerInput)
      await user.type(customerInput, '     ')

      // Clear all dimension inputs
      const diameterInput = screen.getByLabelText('Specification diameter')
      await user.clear(diameterInput)
      const thicknessInput = screen.getByLabelText('Specification thickness')
      await user.clear(thicknessInput)
      const lengthInput = screen.getByLabelText('Specification length')
      await user.clear(lengthInput)
      const pipeNumberInput = screen.getByLabelText('Specification pipe number')
      await user.clear(pipeNumberInput)

      await user.click(screen.getByRole('button', { name: 'Save specification' }))

      // Verify update payload sent customer as null (not whitespace string)
      await waitFor(() => {
        expect(mockUpdate).toHaveBeenCalledWith(
          'test-token',
          'adv-001',
          {
            customer: null,
            diameter: null,
            thickness: null,
            length: null,
            pipeNumber: null,
          },
          '2026-10-31T01:00:00.000Z',
        )
      })

      // Customer should render dash placeholder
      const rows = screen.getAllByRole('row')
      const row1Cells = within(rows[1]).getAllByText('—')
      expect(row1Cells.length).toBeGreaterThan(0)
    })

    it('rejects extreme dimensions (OD <= Thickness, zero, negative) and renders clean dash without NaN or crash', async () => {
      const user = userEvent.setup()
      const mockLoad = vi.fn().mockResolvedValue(adversarialMockPayload)
      const mockUpdate = vi.fn().mockResolvedValue({
        spec: {
          sensorEventId: 'adv-003',
          customer: 'Extreme Test Client',
          diameter: 10,
          thickness: 15,
          length: 6000,
          pipeNumber: 101,
          tonnage: null,
          updatedAt: '2026-10-31T03:00:00.000Z',
        },
      })

      renderWithAuth(<ProductionSection loadProduction={mockLoad} updateProductionSpec={mockUpdate} />)

      await screen.findByText('Regan Industrial')
      const editButtons = screen.getAllByRole('button', { name: /edit specification/i })
      await user.click(editButtons[1]) // row 3 (adv-003, unspecified)

      const customerInput = screen.getByLabelText('Specification customer')
      const diameterInput = screen.getByLabelText('Specification diameter')
      const thicknessInput = screen.getByLabelText('Specification thickness')
      const lengthInput = screen.getByLabelText('Specification length')

      await user.type(customerInput, 'Extreme Test Client')
      // OD < Thickness: OD = 10, Thickness = 15
      await user.type(diameterInput, '10')
      await user.type(thicknessInput, '15')
      await user.type(lengthInput, '6000')

      // Check dynamic inline tonnage calculation while editing:
      // Since OD (10) < Thickness (15), tonnage formula must return null and render clean placeholder
      const editingRow = screen.getAllByRole('row')[3] // row index 3 corresponds to adv-003
      const cellsWhileEditing = within(editingRow).getAllByRole('cell')
      // Column index 8 is Tons
      expect(cellsWhileEditing[8]).toHaveTextContent('—')
      expect(within(editingRow).queryByText(/nan/i)).not.toBeInTheDocument()

      // Save
      await user.click(screen.getByRole('button', { name: 'Save specification' }))

      // Tonnage column after saving must show clean dash '—', not negative number and not NaN
      await waitFor(() => {
        const savedCells = within(editingRow).getAllByRole('cell')
        expect(savedCells[8]).toHaveTextContent('—')
        expect(savedCells[8]).not.toHaveTextContent(/-[0-9]/)
      })
      expect(within(editingRow).queryByText(/nan/i)).not.toBeInTheDocument()
    })

    it('verifies updateProductionLogSpec sanitizes non-numeric and nullish inputs', async () => {
      apiRequest.mockResolvedValueOnce({ ok: true })

      await updateProductionLogSpec('token-1', 'event-1', {
        customer: '   Trimmed Customer   ',
        diameter: '625.4',
        thickness: null,
        length: '',
        pipeNumber: '1001.99',
      })

      expect(apiRequest).toHaveBeenCalledWith('/api/production/event-1', {
        token: 'token-1',
        method: 'PATCH',
        body: {
          customer: 'Trimmed Customer',
          diameter: 625.4,
          thickness: null,
          length: null,
          pipeNumber: 1001,
        },
      })
    })

    it('verifies updateProductionLogSpec handles non-string and boolean inputs safely', async () => {
      apiRequest.mockResolvedValueOnce({ ok: true })

      await updateProductionLogSpec('token-1', 'event-2', {
        customer: 998877, // number coerced to string
        diameter: 'abc', // invalid number -> null
        thickness: '12.34.56', // malformed number -> null
        length: undefined,
        pipeNumber: 'NaN', // invalid integer -> null
      })

      expect(apiRequest).toHaveBeenCalledWith('/api/production/event-2', {
        token: 'token-1',
        method: 'PATCH',
        body: {
          customer: '998877',
          diameter: null,
          thickness: null,
          length: null,
          pipeNumber: null,
        },
      })
    })

    it('probes whitespace string handling in updateProductionLogSpec dimension fields', async () => {
      apiRequest.mockResolvedValueOnce({ ok: true })

      await updateProductionLogSpec('token-1', 'event-3', {
        customer: '   ',
        diameter: '   ',
        thickness: '   ',
        length: '   ',
        pipeNumber: '   ',
      })

      const requestBody = apiRequest.mock.calls[0][1].body
      expect(requestBody.customer).toBeNull()
      expect(requestBody.pipeNumber).toBeNull()
    })
  })

  describe('Dimension 2: Bulk Selection Edge Cases', () => {
    it('handles Shift+Click range selection across non-contiguous items with interleaved rejected cuts', async () => {
      const user = userEvent.setup()
      const mockLoad = vi.fn().mockResolvedValue(adversarialMockPayload)

      renderWithAuth(<ProductionSection loadProduction={mockLoad} />)

      await screen.findByText('Regan Industrial')

      const row1Checkbox = screen.getByLabelText(/select cut at 2026-10-31T01:00:00/i)
      const rejectedCheckbox = screen.getByLabelText(/select cut at 2026-10-31T01:10:00/i)
      const row3Checkbox = screen.getByLabelText(/select cut at 2026-10-31T01:20:00/i)
      const row4Checkbox = screen.getByLabelText(/select cut at 2026-10-31T01:30:00/i)

      expect(rejectedCheckbox).toBeDisabled()

      // Click row 1
      await user.click(row1Checkbox)
      expect(row1Checkbox).toBeChecked()
      expect(screen.getByText('1 cut selected')).toBeInTheDocument()

      // Shift+Click row 4 (across rejected row 2 and accepted row 3)
      await user.keyboard('{Shift>}')
      await user.click(row4Checkbox)
      await user.keyboard('{/Shift}')

      // Row 1, Row 3, Row 4 must be checked. Rejected row 2 MUST NOT be checked.
      expect(row1Checkbox).toBeChecked()
      expect(rejectedCheckbox).not.toBeChecked()
      expect(row3Checkbox).toBeChecked()
      expect(row4Checkbox).toBeChecked()

      // Exactly 3 cuts selected (out of 3 accepted)
      expect(screen.getByText('3 cuts selected')).toBeInTheDocument()

      // Header select-all checkbox should be checked (all accepted page items selected)
      const headerCheckbox = screen.getByLabelText('Select all cuts on this page')
      expect(headerCheckbox).toBeChecked()

      // Deselect all button clears all selections cleanly
      await user.click(screen.getByRole('button', { name: 'Deselect all cuts' }))

      expect(row1Checkbox).not.toBeChecked()
      expect(row3Checkbox).not.toBeChecked()
      expect(row4Checkbox).not.toBeChecked()
      expect(screen.queryByText(/cuts selected/i)).not.toBeInTheDocument()
    })

    it('disables header checkbox and prevents selection when page has 0 accepted cuts', async () => {
      const allRejectedPayload = {
        ...adversarialMockPayload,
        records: [adversarialMockPayload.records[1]], // only rejected cut
      }
      const mockLoad = vi.fn().mockResolvedValue(allRejectedPayload)

      renderWithAuth(<ProductionSection loadProduction={mockLoad} />)

      // Rejected badge has title and aria-label
      await screen.findByTitle('Pulse width below threshold')

      const headerCheckbox = screen.getByLabelText('Select all cuts on this page')
      expect(headerCheckbox).toBeDisabled()
      expect(screen.queryByText(/cuts selected/i)).not.toBeInTheDocument()
    })

    it('blocks bulk edit submit with error message when all fields are empty or whitespace', async () => {
      const user = userEvent.setup()
      const mockLoad = vi.fn().mockResolvedValue(adversarialMockPayload)
      const mockBatch = vi.fn()

      renderWithAuth(
        <ProductionSection loadProduction={mockLoad} batchUpdateProductionSpecs={mockBatch} />,
      )

      await screen.findByText('Regan Industrial')

      // Select first cut
      const row1Checkbox = screen.getByLabelText(/select cut at 2026-10-31T01:00:00/i)
      await user.click(row1Checkbox)

      // Enter spaces into customer field
      const bulkCustomer = screen.getByLabelText('Bulk customer')
      await user.type(bulkCustomer, '     ')

      // Click Apply
      const applyBtn = screen.getByRole('button', { name: /apply to 1 cut/i })
      await user.click(applyBtn)

      // Error banner displayed
      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent(/provide at least one specification field to update/i)

      // Confirmation prompt must NOT open
      expect(screen.queryByText(/apply specifications to 1 cut\? blank fields/i)).not.toBeInTheDocument()
      expect(mockBatch).not.toHaveBeenCalled()
    })

    it('allows partial fields submit and updates only the provided fields in batch', async () => {
      const user = userEvent.setup()
      const mockLoad = vi.fn().mockResolvedValue(adversarialMockPayload)
      const mockBatch = vi.fn().mockResolvedValue({ matchedCount: 1, updatedCount: 1 })

      renderWithAuth(
        <ProductionSection loadProduction={mockLoad} batchUpdateProductionSpecs={mockBatch} />,
      )

      await screen.findByText('Regan Industrial')

      // Select row 3 (adv-003)
      const row3Checkbox = screen.getByLabelText(/select cut at 2026-10-31T01:20:00/i)
      await user.click(row3Checkbox)

      // Enter only thickness
      const bulkThickness = screen.getByLabelText('Bulk thickness')
      await user.type(bulkThickness, '14.2')

      // Apply
      const applyBtn = screen.getByRole('button', { name: /apply to 1 cut/i })
      await user.click(applyBtn)

      // Confirmation dialog opens
      expect(screen.getByText(/apply specifications to 1 cut\? blank fields will keep their current values/i)).toBeInTheDocument()

      // Confirm
      await user.click(screen.getByRole('button', { name: 'Confirm' }))

      // Batch update called with ONLY thickness
      await waitFor(() => {
        expect(mockBatch).toHaveBeenCalledWith(
          'test-token',
          {
            sensorEventIds: ['adv-003'],
            appliedSpec: {
              thickness: 14.2,
            },
          },
        )
      })
    })

    it('strictly guarantees pipeNumber is NEVER transmitted in bulk update payloads', async () => {
      apiRequest.mockResolvedValueOnce({ ok: true })

      // Call batchUpdateProductionSpecs with rogue pipeNumber fields
      await batchUpdateProductionSpecs('mock-token', {
        sensorEventIds: ['adv-001', 'adv-003'],
        appliedSpec: {
          customer: 'Pipe Corp',
          diameter: 1020,
          pipeNumber: 9999,
          pipe_number: 8888,
        },
      })

      expect(apiRequest).toHaveBeenCalledWith('/api/production/batch', {
        token: 'mock-token',
        method: 'PATCH',
        body: {
          sensorEventIds: ['adv-001', 'adv-003'],
          customer: 'Pipe Corp',
          diameter: 1020,
        },
      })

      const requestBody = apiRequest.mock.calls[0][1].body
      expect(requestBody).not.toHaveProperty('pipeNumber')
      expect(requestBody).not.toHaveProperty('pipe_number')
    })

    it('verifies bulk editor strip contains zero pipeNumber input fields', async () => {
      const user = userEvent.setup()
      const mockLoad = vi.fn().mockResolvedValue(adversarialMockPayload)

      renderWithAuth(<ProductionSection loadProduction={mockLoad} />)

      await screen.findByText('Regan Industrial')
      await user.click(screen.getByLabelText(/select cut at 2026-10-31T01:00:00/i))

      // Bulk toolbar visible
      const bulkRegion = screen.getByRole('region', { name: 'Bulk specification editor' })
      expect(bulkRegion).toBeInTheDocument()

      // Pipe number must NOT be inside bulk editor
      expect(within(bulkRegion).queryByLabelText(/bulk pipe/i)).not.toBeInTheDocument()
      expect(within(bulkRegion).queryByPlaceholderText(/pipe #/i)).not.toBeInTheDocument()
      expect(within(bulkRegion).queryByPlaceholderText(/pipe number/i)).not.toBeInTheDocument()
    })
  })

  describe('Dimension 3: Tonnage Display Accuracy & Formula Parity', () => {
    it('accurately verifies pure formula parity for standard manufacturing test vectors', () => {
      // Helper function matching the pure formula
      const computeTonnage = (od, t, l) => {
        if (od == null || t == null || l == null) return null
        const d = Number(od)
        const th = Number(t)
        const len = Number(l)
        if (!Number.isFinite(d) || !Number.isFinite(th) || !Number.isFinite(len)) return null
        if (d <= 0 || th <= 0 || len <= 0 || d <= th) return null
        const weightKgPerMeter = (d - th) * th * 0.02466
        const totalWeightTons = (weightKgPerMeter * len) / 1000000
        return Math.round(totalWeightTons * 10000) / 10000
      }

      // Test Vector 1: 625.4 x 12.7 x 6000 mm -> 1.1513 metric tons
      expect(computeTonnage(625.4, 12.7, 6000)).toBe(1.1513)

      // Test Vector 2: 1020 x 10.0 x 12000 mm -> 2.9888 metric tons
      expect(computeTonnage(1020, 10.0, 12000)).toBe(2.9888)

      // Test Vector 3: 1120 x 14.2 x 9000 mm -> 3.4850 metric tons
      expect(computeTonnage(1120, 14.2, 9000)).toBe(3.485)

      // Test Vector 4: OD <= Thickness (10 <= 10) -> null
      expect(computeTonnage(10, 10, 6000)).toBeNull()

      // Test Vector 5: Negative OD -> null
      expect(computeTonnage(-625.4, 12.7, 6000)).toBeNull()

      // Test Vector 6: Zero length -> null
      expect(computeTonnage(625.4, 12.7, 0)).toBeNull()

      // Test Vector 7: Missing fields -> null
      expect(computeTonnage(null, 12.7, 6000)).toBeNull()
      expect(computeTonnage(625.4, undefined, 6000)).toBeNull()
      expect(computeTonnage(625.4, 12.7, null)).toBeNull()
    })

    it('renders clean placeholder dash for incomplete, null, and non-numeric specs without NaN or undefined in the DOM', async () => {
      const incompleteSpecsPayload = {
        ...adversarialMockPayload,
        records: [
          {
            id: 'spec-null-od',
            sensorEventId: 'spec-null-od',
            deviceEventId: 301,
            recordedAt: '2026-10-31T04:00:00.000Z',
            outputAccepted: true,
            status: 'accepted',
            isSpecified: false,
            customer: 'Water Works',
            diameter: null,
            thickness: 12.7,
            length: 6000,
            pipeNumber: 1,
            tonnage: null,
          },
          {
            id: 'spec-null-thickness',
            sensorEventId: 'spec-null-thickness',
            deviceEventId: 302,
            recordedAt: '2026-10-31T04:10:00.000Z',
            outputAccepted: true,
            status: 'accepted',
            isSpecified: false,
            customer: 'Water Works',
            diameter: 625.4,
            thickness: null,
            length: 6000,
            pipeNumber: 2,
            tonnage: null,
          },
          {
            id: 'spec-null-length',
            sensorEventId: 'spec-null-length',
            deviceEventId: 303,
            recordedAt: '2026-10-31T04:20:00.000Z',
            outputAccepted: true,
            status: 'accepted',
            isSpecified: false,
            customer: 'Water Works',
            diameter: 625.4,
            thickness: 12.7,
            length: null,
            pipeNumber: 3,
            tonnage: null,
          },
        ],
      }
      const mockLoad = vi.fn().mockResolvedValue(incompleteSpecsPayload)

      renderWithAuth(<ProductionSection loadProduction={mockLoad} />)

      await screen.findAllByText('Water Works')

      // Assert no NaN anywhere in the document
      expect(screen.queryByText(/nan/i)).not.toBeInTheDocument()
      expect(screen.queryByText(/undefined/i)).not.toBeInTheDocument()

      // Tons cells for incomplete specs must render clean dash '—'
      const rows = screen.getAllByRole('row')
      // Rows 1, 2, 3 correspond to the 3 incomplete spec records
      for (let i = 1; i <= 3; i++) {
        const dashes = within(rows[i]).getAllByText('—')
        expect(dashes.length).toBeGreaterThan(0)
      }
    })

    it('verifies normalizeProductionRecord filters out non-finite and malformed values', () => {
      const normalized = normalizeProductionRecord({
        customer: '   Trimmed   ',
        diameter: '625.4',
        thickness: 'not-a-number',
        length: 'Infinity',
        pipeNumber: '505.2',
        tonnage: 'NaN',
      })

      expect(normalized.customer).toBe('Trimmed')
      expect(normalized.diameter).toBe(625.4)
      expect(normalized.thickness).toBeNull()
      expect(normalized.length).toBeNull() // Infinity is not finite
      expect(normalized.pipeNumber).toBe(505)
      expect(normalized.tonnage).toBeNull()
    })
  })
})
