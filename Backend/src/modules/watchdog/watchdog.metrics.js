function createWatchdogMetrics() {
  const state = {
    cycles: 0,
    cycleSuccesses: 0,
    cyclePartialFailures: 0,
    cycleFailures: 0,
    cycleCancellations: 0,
    sensorEvaluations: 0,
    sensorFailures: 0,
    transitions: 0,
    lastStartedAt: null,
    lastCompletedAt: null,
    lastSuccessAt: null,
    lastOutcome: 'idle',
    lastErrorCode: null,
    states: {
      unknown: 0,
      online: 0,
      offline: 0,
      disabled: 0,
      suspended: 0,
      healthy: 0,
      grace: 0,
      downtime: 0,
      recovering: 0,
    },
  }

  return {
    cycleStarted(at) {
      state.cycles += 1
      state.lastStartedAt = at
    },
    cycleCompleted(at, { outcome, errorCode = null } = {}) {
      state.lastCompletedAt = at
      state.lastOutcome = outcome
      if (outcome === 'success') {
        state.cycleSuccesses += 1
        state.lastSuccessAt = at
        state.lastErrorCode = null
      } else if (outcome === 'partial') {
        state.cyclePartialFailures += 1
        state.lastErrorCode = errorCode || 'WATCHDOG_CYCLE_PARTIAL_FAILURE'
      } else if (outcome === 'cancelled') {
        state.cycleCancellations += 1
        state.lastErrorCode = null
      } else {
        state.cycleFailures += 1
        state.lastErrorCode = errorCode || 'WATCHDOG_CYCLE_FAILED'
      }
    },
    sensorEvaluated({ failed = false, transitions = 0 } = {}) {
      state.sensorEvaluations += 1
      if (failed) state.sensorFailures += 1
      state.transitions += transitions
    },
    setStates(counts = {}) {
      Object.keys(state.states).forEach((key) => {
        state.states[key] = Number.isInteger(counts[key]) && counts[key] >= 0 ? counts[key] : 0
      })
    },
    snapshot() {
      return structuredClone(state)
    },
  }
}

module.exports = {
  createWatchdogMetrics,
}
