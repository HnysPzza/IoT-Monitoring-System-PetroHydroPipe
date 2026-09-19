// Deterministic API-shaped Analytics data used only by tests.
const selectedTrends = [
  ['2026-08-10', 43, 93, 118, 1, 2.15],
  ['2026-08-11', 18, 95, 122, 1, 0.9],
  ['2026-08-12', 26, 90, 111, 1, 1.3],
  ['2026-08-13', 31, 90, 125, 1, 1.55],
  ['2026-08-14', 12, 92, 119, 1, 0.6],
  ['2026-08-15', 0, null, 0, 0, 0],
  ['2026-08-16', null, null, null, null, null],
].map(([date, downtimeMinutes, availabilityPercent, outputPieces, processEventCount, estimatedLossPieces]) => ({
  key: date,
  label: new Intl.DateTimeFormat('en-PH', { timeZone: 'UTC', month: 'short', day: '2-digit' })
    .format(new Date(`${date}T00:00:00Z`)),
  startAt: `${date}T00:00:00+08:00`,
  endAt: `${date}T23:59:59+08:00`,
  periodState: date === '2026-08-16' ? 'future' : date === '2026-08-15' ? 'partial' : 'complete',
  metrics: { downtimeMinutes, availabilityPercent, outputPieces, processEventCount, estimatedLossPieces },
}))

const comparisonTrends = selectedTrends.map((trend, index) => ({
  ...trend,
  key: `comparison-${index + 1}`,
  label: `Prior ${index + 1}`,
  metrics: {
    downtimeMinutes: index < 5 ? 20 : 0,
    availabilityPercent: index < 5 ? 93 : null,
    outputPieces: index < 5 ? 110 : 0,
    processEventCount: index < 5 ? 1 : 0,
    estimatedLossPieces: index < 5 ? 1 : 0,
  },
}))

const processSensors = [
  { sensorCode: 'S-01', sensorLabel: 'Raw Material & Coil Joint', eventCount: 2 },
  { sensorCode: 'S-02', sensorLabel: 'Inside Filler Wire', eventCount: 1 },
  { sensorCode: 'S-04', sensorLabel: 'Outside Filler Wire', eventCount: 2 },
]

export const analyticsTestFixture = {
  generatedAt: '2026-08-15T12:00:00+08:00',
  timeZone: 'Asia/Manila',
  lossEstimateBasis: {
    source: 'configured-fallback',
    ratePiecesPerMinute: 0.05,
    windowStartAt: '2026-07-16T16:00:00.000Z',
    windowEndAt: '2026-08-15T16:00:00.000Z',
    qualifiedProductionDays: 2,
    productiveMinutes: 240,
    outputPieces: 8,
  },
  selectionMode: 'dates',
  coverage: {
    historicalHeartbeatAvailable: false,
    message: 'Historical sensor heartbeat coverage is not stored. Analytics uses recorded system events and downtime records.',
  },
  comparisonMode: 'immediately-preceding-matching-elapsed',
  comparisonClipped: false,
  trendAlignment: {
    mode: 'ordinal-equal-duration-buckets', selectedBucketCount: 7, comparisonBucketCount: 7,
  },
  selected: {
    range: {
      requestedStartDate: '2026-08-10', requestedEndDate: '2026-08-16',
      observedStartAt: '2026-08-10T00:00:00+08:00', observedEndAt: '2026-08-15T12:00:00+08:00',
      periodState: 'partial', daysInclusive: 7, bucket: 'daily',
    },
    summary: {
      downtimeMinutes: 130, downtimeEventCount: 5, availabilityPercent: 91,
      outputPieces: 595, processEventCount: 5, estimatedLossPieces: 6.5,
    },
    causeCoverage: {
      reviewedDurationMinutes: 130, pendingReviewDurationMinutes: 0,
      pendingReviewEventCount: 0, coveragePercent: 100,
    },
    trends: selectedTrends,
    downtimeCauses: [
      { cause: 'Corrective Maintenance', eventCount: 2, durationMinutes: 61, estimatedLossPieces: 3.05 },
      { cause: 'Consumable Shortage', eventCount: 1, durationMinutes: 38, estimatedLossPieces: 1.9 },
      { cause: 'Manual Cutting', eventCount: 2, durationMinutes: 31, estimatedLossPieces: 1.55 },
    ],
    processSensors,
  },
  comparison: {
    range: {
      requestedStartDate: '2026-08-03', requestedEndDate: '2026-08-09',
      observedStartAt: '2026-08-03T00:00:00+08:00', observedEndAt: '2026-08-09T23:59:59+08:00',
      periodState: 'complete', daysInclusive: 7, bucket: 'daily',
    },
    summary: {
      downtimeMinutes: 100, downtimeEventCount: 5, availabilityPercent: 93,
      outputPieces: 550, processEventCount: 5, estimatedLossPieces: 5,
    },
    causeCoverage: {
      reviewedDurationMinutes: 100, pendingReviewDurationMinutes: 0,
      pendingReviewEventCount: 0, coveragePercent: 100,
    },
    trends: comparisonTrends,
    downtimeCauses: [], processSensors,
  },
}

export const analyticsTestResponse = { analytics: analyticsTestFixture }
