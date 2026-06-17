import { cleanCode } from './formatters.js'

export function formatSignal(signal) {
  return cleanCode(signal, 'No signal yet')
}

export const signalLabels = {
  active: 'Active',
  idle: 'Idle',
  no_pulse: 'No pulse',
  fault: 'Fault',
}

export function getSignalLabel(signal) {
  return signalLabels[signal] || cleanCode(signal)
}
