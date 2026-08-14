// Deterministic local-only data for the frontend Analytics preview.
// These records are deliberately not a production telemetry contract.
export const analyticsFixture = {
  source: 'local-fixture',
  timeZone: 'Asia/Manila',
  referenceDate: '2026-08-14',
  machine: {
    code: 'M-01',
    name: 'Spiral Mill 01',
  },
  downtimeEvents: [
    {
      id: 'demo-downtime-001',
      startedAt: '2026-08-10T08:20:00+08:00',
      durationMinutes: 43,
      cause: 'Corrective Maintenance',
      sensorCode: 'S-01',
    },
    {
      id: 'demo-downtime-002',
      startedAt: '2026-08-11T11:05:00+08:00',
      durationMinutes: 18,
      cause: 'Coil Joint',
      sensorCode: 'S-03',
    },
    {
      id: 'demo-downtime-003',
      startedAt: '2026-08-12T14:30:00+08:00',
      durationMinutes: 26,
      cause: 'Weld Wire Refill',
      sensorCode: 'S-02',
    },
    {
      id: 'demo-downtime-004',
      startedAt: '2026-08-13T09:40:00+08:00',
      durationMinutes: 31,
      cause: 'Manual Cutting',
      sensorCode: 'S-04',
    },
    {
      id: 'demo-downtime-005',
      startedAt: '2026-08-14T07:55:00+08:00',
      durationMinutes: 12,
      cause: 'Flux Refill',
      sensorCode: 'S-05',
    },
  ],
  processEvents: [
    { id: 'demo-process-001', occurredAt: '2026-08-10T08:20:00+08:00', sensorCode: 'S-01', eventType: 'Downtime detected' },
    { id: 'demo-process-002', occurredAt: '2026-08-11T11:05:00+08:00', sensorCode: 'S-03', eventType: 'Downtime detected' },
    { id: 'demo-process-003', occurredAt: '2026-08-12T14:30:00+08:00', sensorCode: 'S-02', eventType: 'Downtime detected' },
    { id: 'demo-process-004', occurredAt: '2026-08-13T09:40:00+08:00', sensorCode: 'S-04', eventType: 'Downtime detected' },
    { id: 'demo-process-005', occurredAt: '2026-08-14T07:55:00+08:00', sensorCode: 'S-05', eventType: 'Downtime detected' },
  ],
  productionRecords: [
    { date: '2026-08-10', actualPieces: 118 },
    { date: '2026-08-11', actualPieces: 122 },
    { date: '2026-08-12', actualPieces: 111 },
    { date: '2026-08-13', actualPieces: 125 },
    { date: '2026-08-14', actualPieces: 119 },
  ],
}
