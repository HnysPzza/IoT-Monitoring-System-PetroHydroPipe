function createWatchdogMetrics() {
  const state = {
    cycles: 0,
    cycleFailures: 0,
    sensorEvaluations: 0,
    sensorFailures: 0,
    transitions: 0,
    lastStartedAt: null,
    lastCompletedAt: null,
    lastSuccessAt: null,
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
      state.lastErrorCode = null
    },
    cycleCompleted(at, { success, errorCode = null } = {}) {
      state.lastCompletedAt = at
      if (success) state.lastSuccessAt = at
      else state.cycleFailures += 1
      state.lastErrorCode = errorCode
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
