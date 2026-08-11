import { describe, expect, it } from 'vitest'
import {
  applyLiveAlertDelta,
  isAlertEventCompatible,
  parseAlertRevision,
  reconcileAlertSnapshot,
  validateAlertSnapshot,
} from './alertReconciliation.js'

function alert(id, revision, status = 'Active') {
  return { id, revision, status }
}

describe('alert revision reconciliation', () => {
  it('accepts only canonical nonnegative decimal revision strings', () => {
    expect(parseAlertRevision('0')).toBe(0n)
    expect(parseAlertRevision('9007199254740993')).toBe(9007199254740993n)

    for (const invalid of [0, 1, -1, '-1', '+1', '01', '1.0', '', null, undefined]) {
      expect(parseAlertRevision(invalid)).toBeNull()
    }
  })

  it('rejects malformed snapshots and rows newer than their snapshot watermark', () => {
    expect(validateAlertSnapshot({ alerts: [], snapshotRevision: '01' })).toBeNull()
    expect(validateAlertSnapshot({ alerts: [alert('a', 1)], snapshotRevision: '1' })).toBeNull()
    expect(validateAlertSnapshot({ alerts: [alert('a', '2')], snapshotRevision: '1' })).toBeNull()
    expect(validateAlertSnapshot({ alerts: [{ revision: '1', status: 'Active' }], snapshotRevision: '1' })).toBeNull()
    expect(validateAlertSnapshot({ alerts: [{ id: 'a', revision: '1' }], snapshotRevision: '1' })).toBeNull()
    expect(validateAlertSnapshot({ alerts: [alert('a', '1', 'Resolved')], snapshotRevision: '1' })).toBeNull()
  })

  it('discards old buffered deltas and replays newer contiguous revisions in order', () => {
    const result = reconcileAlertSnapshot(
      { alerts: [alert('snapshot', '10')], snapshotRevision: '10' },
      [alert('old', '9'), alert('second', '12'), alert('first', '11')],
    )

    expect(result).toEqual({
      trusted: true,
      alerts: [alert('second', '12'), alert('first', '11'), alert('snapshot', '10')],
      revision: 12n,
      needsResync: false,
    })
  })

  it('keeps the snapshot unchanged when buffered revisions are malformed or have a gap', () => {
    const snapshot = { alerts: [alert('snapshot', '10')], snapshotRevision: '10' }

    expect(reconcileAlertSnapshot(snapshot, [alert('gap', '12')])).toEqual({
      trusted: true,
      alerts: snapshot.alerts,
      revision: 10n,
      needsResync: true,
    })
    expect(reconcileAlertSnapshot(snapshot, [alert('malformed', '01')])).toEqual({
      trusted: true,
      alerts: snapshot.alerts,
      revision: 10n,
      needsResync: true,
    })
  })

  it('deduplicates equivalent buffered revisions but rejects conflicting reuse', () => {
    const snapshot = { alerts: [], snapshotRevision: '10' }
    const first = alert('first', '11')
    const equivalent = { revision: '11', status: 'Active', id: 'first' }
    const conflicting = alert('different', '11')

    expect(reconcileAlertSnapshot(snapshot, [first, equivalent])).toEqual({
      trusted: true,
      alerts: [first],
      revision: 11n,
      needsResync: false,
    })
    expect(reconcileAlertSnapshot(snapshot, [first, conflicting])).toEqual({
      trusted: true,
      alerts: [],
      revision: 10n,
      needsResync: true,
    })
  })

  it('applies only the next live revision and ignores stale or duplicate deltas', () => {
    const current = [alert('current', '10')]
    const stale = applyLiveAlertDelta(current, 10n, alert('stale', '10'))
    const gap = applyLiveAlertDelta(current, 10n, alert('gap', '12'))
    const next = applyLiveAlertDelta(current, 10n, alert('next', '11'))

    expect(stale).toEqual({ alerts: current, revision: 10n, applied: false, needsResync: false })
    expect(gap).toEqual({ alerts: current, revision: 10n, applied: false, needsResync: true })
    expect(next).toEqual({
      alerts: [alert('next', '11'), ...current],
      revision: 11n,
      applied: true,
      needsResync: false,
    })
    expect(applyLiveAlertDelta(current, 10n, { revision: '11', status: 'Active' }).needsResync).toBe(true)
    expect(applyLiveAlertDelta(current, 10n, { id: 'missing-status', revision: '11' }).needsResync).toBe(true)
  })

  it('requires each alert event type to match its lifecycle status', () => {
    expect(isAlertEventCompatible('alert.created', alert('a', '1', 'Active'))).toBe(true)
    expect(isAlertEventCompatible('alert.updated', alert('a', '1', 'Acknowledged'))).toBe(true)
    expect(isAlertEventCompatible('alert.acknowledged', alert('a', '1', 'Acknowledged'))).toBe(true)
    expect(isAlertEventCompatible('alert.resolved', alert('a', '1', 'Resolved'))).toBe(true)

    expect(isAlertEventCompatible('alert.created', alert('a', '1', 'Resolved'))).toBe(false)
    expect(isAlertEventCompatible('alert.acknowledged', alert('a', '1', 'Active'))).toBe(false)
    expect(isAlertEventCompatible('alert.resolved', alert('a', '1', 'Acknowledged'))).toBe(false)
    expect(isAlertEventCompatible('alert.future', alert('a', '1', 'Active'))).toBe(false)
  })
})
