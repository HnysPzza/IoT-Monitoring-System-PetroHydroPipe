import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithAuth } from '../../../test/renderWithAuth.jsx'
import SettingsSection from './SettingsSection.jsx'
import { getMachines } from '../machines/machinesService.js'
import { getOperationalSettings, getWatchdogDiagnostics, updateOperationalSettings } from './settingsService.js'

vi.mock('../../../shared/hooks/useTheme.js', () => ({
  useTheme: () => ({ theme: 'light', setTheme: vi.fn() }),
}))
vi.mock('../machines/machinesService.js', () => ({ getMachines: vi.fn() }))
vi.mock('./settingsService.js', () => ({
  getOperationalSettings: vi.fn(),
  getWatchdogDiagnostics: vi.fn(),
  updateOperationalSettings: vi.fn(),
}))

const machine = { id: 'machine-1', machineCode: 'M-01', name: 'Spiral Mill 01' }
const constraints = {
  sensorCodes: ['S-01', 'S-02', 'S-03', 'S-04', 'S-05'],
  outputSensorCode: 'S-05',
  triggerSeconds: { minimum: 1, maximum: 3600, minimumWhenEnabled: 10 },
  recoverySeconds: { minimum: 1, maximum: 300, minimumWhenEnabled: 20 },
  breaks: { maximum: 10 },
  rampUpGraceMinutes: { minimum: 0, maximum: 30 },
  sameDayShiftOnly: true,
  timeZone: 'Asia/Manila',
}

function settingsFixture(overrides = {}) {
  return {
    machineId: machine.id,
    timeZone: 'Asia/Manila',
    sensorThresholds: {
      'S-01': { absenceDetectionEnabled: true, triggerSeconds: 30, recoverySeconds: 20 },
      'S-02': { absenceDetectionEnabled: false, triggerSeconds: 300, recoverySeconds: null },
      'S-03': { absenceDetectionEnabled: false, triggerSeconds: 60, recoverySeconds: null },
      'S-04': { absenceDetectionEnabled: false, triggerSeconds: 300, recoverySeconds: null },
      'S-05': { absenceDetectionEnabled: false, triggerSeconds: null, recoverySeconds: null },
    },
    shiftSchedule: {
      workStart: '08:00',
      workEnd: '17:00',
      breaks: [
        { name: 'Lunch', startTime: '12:00', endTime: '13:00' },
        { name: 'Morning', startTime: '10:00', endTime: '10:15' },
      ],
      rampUpGraceMinutes: 10,
    },
    version: '1',
    updatedAt: '2026-08-22T00:00:00.000Z',
    updatedBy: null,
    ...overrides,
  }
}

describe('SettingsSection operational settings', () => {
  beforeEach(() => {
    getMachines.mockReset().mockResolvedValue({ machines: [machine] })
    getOperationalSettings.mockReset().mockResolvedValue({ settings: settingsFixture(), constraints })
    getWatchdogDiagnostics.mockReset().mockResolvedValue({ watchdog: { mode: 'observe' } })
    updateOperationalSettings.mockReset()
  })

  it('loads backend constraints and keeps S-05 absence controls locked', async () => {
    renderWithAuth(<SettingsSection />)

    expect(await screen.findByRole('heading', { name: 'Spiral Mill 01' })).toBeInTheDocument()
    expect(screen.getByText(/Observe mode evaluates these values/i)).toBeInTheDocument()
    expect(screen.getByLabelText('S-01 trigger seconds')).toHaveAttribute('min', '10')
    expect(screen.getByLabelText('S-01 recovery seconds')).toHaveAttribute('min', '20')
    expect(screen.getByText(/S-05 counts output/i)).toBeInTheDocument()
    expect(screen.getByLabelText('S-05 trigger seconds')).toBeDisabled()
  })

  it('saves one complete versioned document with breaks ordered by start time', async () => {
    const user = userEvent.setup()
    const saved = settingsFixture({ version: '2' })
    updateOperationalSettings.mockResolvedValue({ settings: saved })
    renderWithAuth(<SettingsSection />)

    const trigger = await screen.findByLabelText('S-01 trigger seconds')
    await user.clear(trigger)
    await user.type(trigger, '45')
    await user.click(screen.getByRole('button', { name: 'Save settings' }))

    await waitFor(() => expect(updateOperationalSettings).toHaveBeenCalledTimes(1))
    const [token, machineId, payload] = updateOperationalSettings.mock.calls[0]
    expect(token).toBe('test-token')
    expect(machineId).toBe(machine.id)
    expect(payload.expectedVersion).toBe('1')
    expect(Object.keys(payload.sensorThresholds)).toEqual(constraints.sensorCodes)
    expect(payload.sensorThresholds['S-01'].triggerSeconds).toBe(45)
    expect(payload.shiftSchedule.breaks.map((entry) => entry.name)).toEqual(['Morning', 'Lunch'])
    expect(await screen.findByText('Operational settings saved.')).toBeInTheDocument()
  })

  it('fails closed when watchdog diagnostics are unavailable', async () => {
    getWatchdogDiagnostics.mockRejectedValue(new Error('Diagnostics offline'))
    renderWithAuth(<SettingsSection />)

    expect(await screen.findByRole('alert')).toHaveTextContent(/read-only/i)
    expect(screen.getByLabelText('S-01 trigger seconds')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Save settings' })).toBeDisabled()
  })

  it('keeps the draft and requires reload after a version conflict', async () => {
    const user = userEvent.setup()
    const conflict = new Error('Conflict')
    conflict.code = 'SETTINGS_VERSION_CONFLICT'
    updateOperationalSettings.mockRejectedValue(conflict)
    renderWithAuth(<SettingsSection />)

    const trigger = await screen.findByLabelText('S-01 trigger seconds')
    await user.clear(trigger)
    await user.type(trigger, '45')
    await user.click(screen.getByRole('button', { name: 'Save settings' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/draft was kept/i)
    expect(trigger).toHaveValue(45)
    expect(screen.getByRole('button', { name: 'Reload latest' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save settings' })).toBeDisabled()
  })
})
