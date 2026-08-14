import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { renderWithAuth } from '../../../test/renderWithAuth.jsx'
import AnalyticsOperationsDetails from './AnalyticsOperationsDetails.jsx'
import { buildAnalyticsSnapshot } from './analyticsService.js'

describe('AnalyticsOperationsDetails', () => {
  it('filters the downtime event record from the selected supported cause', async () => {
    const user = userEvent.setup()
    renderWithAuth(<AnalyticsOperationsDetails snapshot={buildAnalyticsSnapshot()} />)
    const downtimeTable = screen.getByRole('table', { name: 'Downtime event records' })

    expect(within(downtimeTable).getAllByRole('row')).toHaveLength(6)

    await user.click(screen.getByRole('button', { name: /Coil Joint/i }))

    expect(within(downtimeTable).getAllByRole('row')).toHaveLength(2)
    expect(within(downtimeTable).getByText('Coil Joint')).toBeInTheDocument()
    expect(within(downtimeTable).getByText('S-03')).toBeInTheDocument()
  })

  it('filters the process event record by neutral sensor code', async () => {
    const user = userEvent.setup()
    renderWithAuth(<AnalyticsOperationsDetails snapshot={buildAnalyticsSnapshot()} />)
    const processTable = screen.getByRole('table', { name: 'Process event records' })

    expect(within(processTable).getAllByRole('row')).toHaveLength(6)

    await user.click(screen.getByRole('button', { name: 'S-04, 1 process event' }))

    expect(within(processTable).getAllByRole('row')).toHaveLength(2)
    expect(within(processTable).getByText('S-04')).toBeInTheDocument()
    expect(within(processTable).getByText('Downtime detected')).toBeInTheDocument()
  })
})
