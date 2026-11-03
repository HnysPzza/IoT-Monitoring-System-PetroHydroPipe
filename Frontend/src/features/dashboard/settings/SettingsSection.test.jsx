import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
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
      'S-01': { absenceDetectionEnabled: true, triggerSeconds: 120, recoverySeconds: 60 },
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

  it('loads backend constraints in minutes and keeps S-05 absence controls locked', async () => {
    renderWithAuth(<SettingsSection />)

    expect(await screen.findByRole('heading', { name: 'Spiral Mill 01' })).toBeInTheDocument()
    expect(screen.getByText(/Observe mode evaluates these values/i)).toBeInTheDocument()
    expect(screen.getByLabelText('S-01 trigger minutes')).toHaveAttribute('min', '1')
    expect(screen.getByLabelText('S-01 trigger minutes')).toHaveAttribute('max', '60')
    expect(screen.getByLabelText('S-01 trigger minutes')).toHaveValue(2)
    expect(screen.getByLabelText('S-01 recovery minutes')).toHaveAttribute('min', '1')
    expect(screen.getByLabelText('S-01 recovery minutes')).toHaveAttribute('max', '5')
    expect(screen.getByLabelText('S-01 recovery minutes')).toHaveValue(1)
    expect(screen.getByText(/S-05 counts output/i)).toBeInTheDocument()
    expect(screen.getByLabelText('S-05 trigger minutes')).toBeDisabled()
  })

  it('keeps an unsaved draft when the window loses and regains focus', async () => {
    const user = userEvent.setup()
    renderWithAuth(<SettingsSection />)
    const trigger = await screen.findByLabelText('S-01 trigger minutes')
    await user.clear(trigger)
    await user.type(trigger, '5')
    fireEvent.blur(window)
    fireEvent.focus(window)
    expect(trigger).toHaveValue(5)
    expect(getOperationalSettings).toHaveBeenCalledTimes(1)
  })

  it('updates a clean cached draft when newer settings arrive', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(['machines', 'list'], { machines: [machine] })
    client.setQueryData(['settings', 'machine', machine.id], { settings: settingsFixture(), constraints }, { updatedAt: Date.now() - 120000 })
    let resolveSettings
    getOperationalSettings.mockReturnValue(new Promise((resolve) => { resolveSettings = resolve }))
    renderWithAuth(<QueryClientProvider client={client}><SettingsSection /></QueryClientProvider>)
    const trigger = await screen.findByLabelText('S-01 trigger minutes')
    expect(trigger).toHaveValue(2)
    await act(async () => resolveSettings({ settings: settingsFixture({ version: '2', sensorThresholds: { ...settingsFixture().sensorThresholds, 'S-01': { ...settingsFixture().sensorThresholds['S-01'], triggerSeconds: 300 } } }), constraints }))
    await waitFor(() => expect(trigger).toHaveValue(5))
    expect(screen.getByText('Version 2')).toBeInTheDocument()
  })

  it('keeps unsaved edits when a newer cached settings request completes', async () => {
    const user = userEvent.setup()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(['machines', 'list'], { machines: [machine] })
    client.setQueryData(['settings', 'machine', machine.id], { settings: settingsFixture(), constraints }, { updatedAt: Date.now() - 120000 })
    let resolveSettings
    getOperationalSettings.mockReturnValue(new Promise((resolve) => { resolveSettings = resolve }))
    renderWithAuth(<QueryClientProvider client={client}><SettingsSection /></QueryClientProvider>)
    const trigger = await screen.findByLabelText('S-01 trigger minutes')
    await user.clear(trigger)
    await user.type(trigger, '7')
    await act(async () => resolveSettings({ settings: settingsFixture({ version: '2' }), constraints }))
    expect(trigger).toHaveValue(7)
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
    expect(await screen.findByRole('alert')).toHaveTextContent('Your draft was kept')
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Reload latest' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Discard' }))
    expect(trigger).toHaveValue(2)
    expect(screen.getByText('Version 2')).toBeInTheDocument()
  })

  it('saves edits from the header controls', async () => {
    const user = userEvent.setup()
    const header = document.createElement('div')
    header.id = 'settings-header-controls'
    document.body.appendChild(header)
    updateOperationalSettings.mockResolvedValue({ settings: settingsFixture({ version: '2' }) })
    try {
      renderWithAuth(<SettingsSection />)
      const trigger = await screen.findByLabelText('S-01 trigger minutes')
      await user.clear(trigger)
      await user.type(trigger, '5')
      const save = screen.getByRole('button', { name: 'Save' })
      expect(header).toContainElement(save)
      await user.click(save)
      await waitFor(() => expect(updateOperationalSettings).toHaveBeenCalledTimes(1))
      expect(updateOperationalSettings.mock.calls[0][2].sensorThresholds['S-01'].triggerSeconds).toBe(300)
    } finally {
      header.remove()
    }
  })

  it('converts edited minute inputs back to seconds when saving', async () => {
    const user = userEvent.setup()
    const saved = settingsFixture({ version: '2' })
    updateOperationalSettings.mockResolvedValue({ settings: saved })
    renderWithAuth(<SettingsSection />)

    const trigger = await screen.findByLabelText('S-01 trigger minutes')
    await user.clear(trigger)
    await user.type(trigger, '5')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(updateOperationalSettings).toHaveBeenCalledTimes(1))
    const [token, machineId, payload] = updateOperationalSettings.mock.calls[0]
    expect(token).toBe('test-token')
    expect(machineId).toBe(machine.id)
    expect(payload.expectedVersion).toBe('1')
    expect(Object.keys(payload.sensorThresholds)).toEqual(constraints.sensorCodes)
    expect(payload.sensorThresholds['S-01'].triggerSeconds).toBe(300)
    expect(payload.shiftSchedule.breaks.map((entry) => entry.name)).toEqual(['Morning', 'Lunch'])
    expect(await screen.findByText('Operational settings saved.')).toBeInTheDocument()
  })

  it('fails closed when watchdog diagnostics are unavailable', async () => {
    getWatchdogDiagnostics.mockRejectedValue(new Error('Diagnostics offline'))
    renderWithAuth(<SettingsSection />)

    expect(await screen.findByRole('alert')).toHaveTextContent(/read-only/i)
    expect(screen.getByLabelText('S-01 trigger minutes')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('keeps editing blocked after the server reports enforcement, even if the draft is discarded', async () => {
    const user = userEvent.setup()
    const error = Object.assign(new Error('Enforcement active'), { code: 'SETTINGS_ENFORCEMENT_ACTIVE' })
    updateOperationalSettings.mockRejectedValue(error)
    renderWithAuth(<SettingsSection />)
    const trigger = await screen.findByLabelText('S-01 trigger minutes')
    await user.clear(trigger)
    await user.type(trigger, '5')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('read-only')
    expect(trigger).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Discard' }))
    expect(trigger).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Reload latest' }))
    await waitFor(() => expect(trigger).toBeEnabled())
  })

  it('keeps the draft and requires reload after a version conflict', async () => {
    const user = userEvent.setup()
    const conflict = new Error('Conflict')
    conflict.code = 'SETTINGS_VERSION_CONFLICT'
    updateOperationalSettings.mockRejectedValue(conflict)
    renderWithAuth(<SettingsSection />)

    const trigger = await screen.findByLabelText('S-01 trigger minutes')
    await user.clear(trigger)
    await user.type(trigger, '5')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/draft was kept/i)
    expect(trigger).toHaveValue(5)
    expect(screen.getByRole('button', { name: 'Reload latest' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('keeps the conflict and draft when reloading machines fails', async () => {
    const user = userEvent.setup()
    updateOperationalSettings.mockRejectedValue(Object.assign(new Error('Conflict'), { code: 'SETTINGS_VERSION_CONFLICT' }))
    renderWithAuth(<SettingsSection />)
    const trigger = await screen.findByLabelText('S-01 trigger minutes')
    await user.clear(trigger)
    await user.type(trigger, '5')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByRole('button', { name: 'Reload latest' })
    getMachines.mockRejectedValueOnce(new Error('Machine reload failed'))
    await user.click(screen.getByRole('button', { name: 'Reload latest' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Machine reload failed')
    expect(trigger).toHaveValue(5)
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('populates default whole-minute limits when enabling a sensor with null or sub-minute recovery', async () => {
    const user = userEvent.setup()
    renderWithAuth(<SettingsSection />)

    const s03Recovery = await screen.findByLabelText('S-03 recovery minutes')
    expect(s03Recovery).toBeDisabled()
    expect(s03Recovery).toHaveValue(null)

    const checkboxes = screen.getAllByRole('checkbox', { name: /Detect missing pulse/i })
    await user.click(checkboxes[2])

    expect(screen.getByLabelText('S-03 trigger minutes')).toHaveValue(1)
    expect(s03Recovery).toBeEnabled()
    expect(s03Recovery).toHaveValue(1)
  })
})
