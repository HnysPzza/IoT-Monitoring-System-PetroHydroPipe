import { describe, expect, it } from 'vitest'
import { getReportCards, getReportDelta } from './reportsPresentation.js'

function report(overrides = {}) {
  return {
    summary: [
      { id: 'production', label: 'Production Count', value: '1,250 pcs', helper: 'From Spiral Mill 01' },
      { id: 'process-events', label: 'Process Events', value: '12', helper: 'From S-01, S-02, and S-04 pulses' },
      { id: 'events', label: 'Downtime Events', value: '6', helper: 'Open and resolved events' },
      { id: 'duration', label: 'Downtime Duration', value: '38 min', helper: 'Unplanned minutes' },
      { id: 'availability', label: 'Availability', value: '92%', helper: 'Based on eligible production time' },
      { id: 'loss', label: 'Estimated Loss', value: '0 pcs', helper: 'Using 3 pcs/hr' },
    ],
    periodState: 'complete',
    metrics: {
      outputPieces: 1250,
      availabilityPercent: 92,
      estimatedLoss: 0,
    },
    comparison: {
      periodState: 'complete',
      metrics: {
        outputPieces: 1000,
        availabilityPercent: 90,
        estimatedLoss: 2,
      },
    },
    ...overrides,
  }
}

function productionReport(overrides = {}) {
  return {
    category: 'production',
    summary: [
      { id: 'total-output', label: 'Total Production Output', value: '1,250 pcs', helper: 'From Spiral Mill 01' },
      { id: 'specified-pipes', label: 'Specified Pipes', value: '1,000 pcs', helper: '80% of total output' },
      { id: 'unspecified-pipes', label: 'Unspecified Pipes', value: '250 pcs', helper: 'Pending specification tag' },
      { id: 'distinct-sizes', label: 'Distinct Product Sizes', value: '4', helper: 'Unique pipe specs produced' },
    ],
    periodState: 'complete',
    metrics: {
      totalProductionOutput: 1250,
      specifiedPipes: 1000,
      unspecifiedPipes: 250,
      distinctProductSizes: 4,
    },
    comparison: {
      periodState: 'complete',
      metrics: {
        totalProductionOutput: 1000,
        specifiedPipes: 900,
        unspecifiedPipes: 100,
        distinctProductSizes: 3,
      },
    },
    ...overrides,
  }
}

describe('getReportCards', () => {
  it('returns three primary cards and merges downtime details into one secondary card', () => {
    const cards = getReportCards(report())

    expect(cards.map((card) => card.id)).toEqual([
      'production',
      'availability',
      'loss',
      'downtime',
    ])
    expect(cards.find((card) => card.id === 'downtime')).toMatchObject({
      label: 'Downtime',
      value: '6 events · 38 min',
      helper: 'Open and resolved, unplanned',
      isPrimary: false,
    })
    expect(cards.find((card) => card.id === 'process-events')).toBeUndefined()
  })

  it('formats production report cards with 3 primary cards and distinct-sizes secondary card', () => {
    const cards = getReportCards(productionReport())

    expect(cards.map((card) => card.id)).toEqual([
      'total-output',
      'specified-pipes',
      'unspecified-pipes',
      'distinct-sizes',
    ])
    expect(cards.find((card) => card.id === 'unspecified-pipes')).toMatchObject({
      label: 'Unspecified Pipes',
      value: '250 pcs',
      isWarning: true,
      isPrimary: true,
    })
    expect(cards.find((card) => card.id === 'distinct-sizes')).toMatchObject({
      label: 'Distinct Sizes',
      value: '4',
      isPrimary: false,
    })
    expect(cards.find((card) => card.id === 'total-output').delta).toMatchObject({
      label: '+25.0%',
      sentiment: 'positive',
    })
  })

  it('keeps future values unobserved instead of fabricating downtime units', () => {
    const cards = getReportCards(report({
      periodState: 'future',
      metrics: { outputPieces: null, availabilityPercent: null, estimatedLoss: null },
      comparison: null,
      summary: [
        { id: 'production', label: 'Production Count', value: 'N/A', helper: 'Period not reached yet' },
        { id: 'process-events', label: 'Process Events', value: 'N/A', helper: 'Period not reached yet' },
        { id: 'events', label: 'Downtime Events', value: 'N/A', helper: 'Period not reached yet' },
        { id: 'duration', label: 'Downtime Duration', value: 'N/A', helper: 'Period not reached yet' },
        { id: 'availability', label: 'Availability', value: 'N/A', helper: 'Period not reached yet' },
        { id: 'loss', label: 'Estimated Loss', value: 'N/A', helper: 'Period not reached yet' },
      ],
    }))

    expect(cards.find((card) => card.id === 'downtime').value).toBe('N/A')
    expect(cards.find((card) => card.id === 'production').delta.label).toBe('Not observed')
  })
})

describe('getReportDelta', () => {
  it('uses percentage points for availability and relative percentages for counts', () => {
    expect(getReportDelta('availability', 92, 90)).toMatchObject({ label: '+2.0 pp', sentiment: 'positive' })
    expect(getReportDelta('production', 1250, 1000)).toMatchObject({ label: '+25.0%', sentiment: 'positive' })
    expect(getReportDelta('loss', 4, 2)).toMatchObject({ label: '+100.0%', sentiment: 'negative' })
    expect(getReportDelta('unspecified-pipes', 50, 100)).toMatchObject({ label: '-50.0%', sentiment: 'positive' })
  })

  it('reports no baseline and no prior period without inventing a percentage', () => {
    expect(getReportDelta('production', 2, 0)).toMatchObject({ label: 'No baseline', sentiment: 'neutral' })
    expect(getReportDelta('production', 2, null, false)).toMatchObject({ label: 'No prior period', sentiment: 'neutral' })
  })
})
