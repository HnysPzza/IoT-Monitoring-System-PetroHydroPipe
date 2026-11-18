import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import userEvent from '@testing-library/user-event'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithAuth } from '../../../test/renderWithAuth.jsx'
import { sensorIdentities } from '../../../shared/constants/sensorIdentity.js'
import SettingsSection from './SettingsSection.jsx'
import { getMachines } from '../machines/machinesService.js'
import {
  getOperationalSettings,
  getProductionCalendar,
  getWatchdogDiagnostics,
  removeProductionCalendarDay,
  removeProductionCalendarRange,
  setProductionCalendarDay,
  setProductionCalendarRange,
  updateOperationalSettings,
} from './settingsService.js'

const originalShowModal = HTMLDialogElement.prototype.showModal
const originalClose = HTMLDialogElement.prototype.close

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
    this.dispatchEvent(new Event('close'))
  }
})

afterAll(() => {
  HTMLDialogElement.prototype.showModal = originalShowModal
  HTMLDialogElement.prototype.close = originalClose
})

vi.mock('../../../shared/hooks/useTheme.js', () => ({
  useTheme: () => ({ theme: 'light', setTheme: vi.fn() }),
}))
vi.mock('../machines/machinesService.js', () => ({ getMachines: vi.fn() }))
vi.mock('./settingsService.js', () => ({
  getOperationalSettings: vi.fn(),
  getProductionCalendar: vi.fn(),
  getWatchdogDiagnostics: vi.fn(),
  removeProductionCalendarDay: vi.fn(),
  removeProductionCalendarRange: vi.fn(),
  setProductionCalendarDay: vi.fn(),
  setProductionCalendarRange: vi.fn(),
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
    getProductionCalendar.mockReset().mockResolvedValue({ entries: [] })
    getWatchdogDiagnostics.mockReset().mockResolvedValue({ watchdog: { mode: 'observe' } })
    removeProductionCalendarDay.mockReset()
    removeProductionCalendarRange.mockReset()
    setProductionCalendarDay.mockReset()
    setProductionCalendarRange.mockReset()
    updateOperationalSettings.mockReset()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-16T10:00:00+08:00'))
  })

  afterEach(() => {
    vi.useRealTimers()
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

    const matrix = screen.getByRole('table', { name: 'Sensor absence tolerance matrix' })
    for (const identity of sensorIdentities) {
      expect(within(matrix).getByText(identity.label)).toBeInTheDocument()
      expect(within(matrix).queryByText(identity.purpose)).not.toBeInTheDocument()
    }
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
    expect(screen.queryByText(/Version/i)).not.toBeInTheDocument()
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
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument()
    expect(screen.queryByText(/Version/i)).not.toBeInTheDocument()
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

  it('allows editing and saving operational settings while watchdog mode is enforce', async () => {
    const user = userEvent.setup()
    getWatchdogDiagnostics.mockResolvedValue({ watchdog: { mode: 'enforce' } })
    updateOperationalSettings.mockResolvedValue({ settings: settingsFixture({ version: '2' }) })
    renderWithAuth(<SettingsSection />)

    expect(await screen.findByText(/Enforcement is active\. Saved changes apply immediately/i)).toBeInTheDocument()
    const trigger = screen.getByLabelText('S-01 trigger minutes')
    expect(trigger).toBeEnabled()
    await user.clear(trigger)
    await user.type(trigger, '5')
    const save = screen.getByRole('button', { name: 'Save' })
    expect(save).toBeEnabled()
    await user.click(save)

    await waitFor(() => expect(updateOperationalSettings).toHaveBeenCalledTimes(1))
    expect(updateOperationalSettings.mock.calls[0][2].sensorThresholds['S-01'].triggerSeconds).toBe(300)
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

  it('edits S-03 rotation stall window in seconds while absence detection is disabled and saves milliseconds', async () => {
    const user = userEvent.setup()
    const saved = settingsFixture({
      version: '2',
      sensorThresholds: {
        ...settingsFixture().sensorThresholds,
        'S-03': { absenceDetectionEnabled: false, triggerSeconds: 60, recoverySeconds: null, rotationStallMs: 4500 },
      },
    })
    updateOperationalSettings.mockResolvedValue({ settings: saved })
    renderWithAuth(<SettingsSection />)

    const stallInput = await screen.findByLabelText('S-03 rotation stall seconds')
    expect(stallInput).toBeEnabled()
    expect(stallInput).toHaveValue(3)
    expect(screen.queryByLabelText('S-01 rotation stall seconds')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('S-05 rotation stall seconds')).not.toBeInTheDocument()

    await user.clear(stallInput)
    await user.type(stallInput, '0.2')
    const stallError = screen.getByText('Rotation stall must be 0.5-30 seconds.')
    expect(stallError).toBeInTheDocument()
    expect(stallInput).toHaveAttribute('aria-invalid', 'true')
    expect(stallInput.closest('.col-sensor')).toContainElement(stallError)
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()

    await user.clear(stallInput)
    await user.type(stallInput, '3.55')
    expect(screen.getByText('Rotation stall must use 0.1-second steps.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()

    await user.clear(stallInput)
    await user.type(stallInput, '4.5')
    expect(stallInput).not.toHaveAttribute('aria-invalid', 'true')
    expect(screen.queryByText('Rotation stall must be 0.5-30 seconds.')).not.toBeInTheDocument()
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(updateOperationalSettings).toHaveBeenCalledTimes(1))
    expect(updateOperationalSettings.mock.calls[0][2].sensorThresholds['S-03'].rotationStallMs).toBe(4500)
    expect(await screen.findByText('Operational settings saved.')).toBeInTheDocument()
  })

  it('displays S-03 rotation stall and trigger errors simultaneously in their own columns', async () => {
    const user = userEvent.setup()
    renderWithAuth(<SettingsSection />)

    const stallInput = await screen.findByLabelText('S-03 rotation stall seconds')
    const checkboxes = screen.getAllByRole('checkbox', { name: /Detect missing pulse/i })
    await user.click(checkboxes[2])

    const s03Trigger = screen.getByLabelText('S-03 trigger minutes')
    await user.clear(stallInput)
    await user.type(stallInput, '0.2')
    await user.clear(s03Trigger)
    await user.type(s03Trigger, '0')

    const stallError = screen.getByText('Rotation stall must be 0.5-30 seconds.')
    const triggerError = screen.getByText('Trigger must be 1-60 minutes.')
    expect(stallInput.closest('.col-sensor')).toContainElement(stallError)
    expect(s03Trigger.closest('.col-trigger')).toContainElement(triggerError)
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('renders recovery validation errors in the recovery column with aria-invalid and aria-describedby', async () => {
    const user = userEvent.setup()
    renderWithAuth(<SettingsSection />)

    const s01Trigger = await screen.findByLabelText('S-01 trigger minutes')
    const s01Recovery = screen.getByLabelText('S-01 recovery minutes')

    await user.clear(s01Trigger)
    await user.type(s01Trigger, '0')
    await user.clear(s01Recovery)
    await user.type(s01Recovery, '9')

    const triggerError = screen.getByText('Trigger must be 1-60 minutes.')
    const recoveryError = screen.getByText('Recovery must be 1-5 minutes.')

    expect(s01Trigger.closest('.col-trigger')).toContainElement(triggerError)
    expect(s01Recovery.closest('.col-recovery')).toContainElement(recoveryError)
    expect(s01Trigger).toHaveAttribute('aria-invalid', 'true')
    expect(s01Recovery).toHaveAttribute('aria-invalid', 'true')
    expect(s01Recovery).toHaveAttribute('aria-describedby', 'S-01-recovery-error')
  })

  it('adds a non-overlapping break slot and supports Ctrl+S keyboard save', async () => {
    const user = userEvent.setup()
    updateOperationalSettings.mockResolvedValue({ settings: settingsFixture({ version: '2' }) })
    renderWithAuth(<SettingsSection />)

    const addBreakBtn = await screen.findByRole('button', { name: /Add break/i })
    await user.click(addBreakBtn)

    expect(screen.queryByText(/no overlap/i)).not.toBeInTheDocument()
    const saveBtn = screen.getByRole('button', { name: 'Save' })
    expect(saveBtn).toBeEnabled()

    fireEvent.keyDown(window, { key: 's', ctrlKey: true })
    await waitFor(() => expect(updateOperationalSettings).toHaveBeenCalledTimes(1))
  })

  it('flags only invalid break rows instead of marking valid breaks as aria-invalid', async () => {
    const user = userEvent.setup()
    renderWithAuth(<SettingsSection />)

    const break1Start = await screen.findByLabelText('Break 1 start')
    const break2Start = screen.getByLabelText('Break 2 start')

    await user.clear(break2Start)
    await user.type(break2Start, '10:20')

    expect(screen.getByText(/end time must be later than start time/i)).toBeInTheDocument()
    expect(break2Start).toHaveAttribute('aria-invalid', 'true')
    expect(break1Start).not.toHaveAttribute('aria-invalid', 'true')
  })

  it('moves static explanatory prose into info popovers instead of cluttering the form inline', async () => {
    const user = userEvent.setup()
    renderWithAuth(<SettingsSection />)

    expect(await screen.findByRole('heading', { name: 'Spiral Mill 01' })).toBeInTheDocument()
    expect(screen.queryByText(/Trigger limit sets how long missing pulses are tolerated/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Applies at shift start and after each planned break/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Selected weekdays have 0 scheduled production time/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Advance edits only/i)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Threshold rules information/i }))
    expect(screen.getByRole('dialog', { name: /Threshold rules information/i })).toHaveTextContent(/Trigger limit sets how long missing pulses are tolerated/i)
  })

  it('displays the grace period beside break duration as lighter secondary text', async () => {
    renderWithAuth(<SettingsSection />)

    const breaksTable = await screen.findByRole('table', { name: 'Planned breaks table' })
    const durationHeader = within(breaksTable).getByRole('columnheader', { name: 'Duration' })
    expect(durationHeader).toHaveTextContent(/^Duration$/i)

    const graceNotes = within(breaksTable).getAllByText('+10m grace')
    expect(graceNotes).toHaveLength(2)
    expect(graceNotes[0]).toHaveClass('settings-break-grace-text')
  })

  it('toggles weekly rest days, tracks dirty state, and saves shiftSchedule.restDays', async () => {
    const user = userEvent.setup()
    updateOperationalSettings.mockResolvedValue({
      settings: settingsFixture({
        version: '2',
        shiftSchedule: {
          ...settingsFixture().shiftSchedule,
          restDays: ['sunday'],
        },
      }),
    })
    renderWithAuth(<SettingsSection />)

    const sundayCheckbox = await screen.findByRole('checkbox', { name: 'Sunday' })
    expect(sundayCheckbox).not.toBeChecked()

    await user.click(sundayCheckbox)
    expect(sundayCheckbox).toBeChecked()
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(updateOperationalSettings).toHaveBeenCalledTimes(1))
    expect(updateOperationalSettings.mock.calls[0][2].shiftSchedule.restDays).toEqual(['sunday'])
  })

  it('blocks saving when all 7 weekdays are selected as rest days', async () => {
    const user = userEvent.setup()
    renderWithAuth(<SettingsSection />)

    const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    for (const day of weekdays) {
      await user.click(await screen.findByRole('checkbox', { name: day }))
    }

    expect(screen.getByText(/At least one working day per week is required/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('retains focus on the holiday row toggle across version updates without resetting unsaved settings', async () => {
    const user = userEvent.setup()
    const entriesState = [
      {
        calendarDate: '2026-12-25',
        name: 'Christmas Day',
        dayType: 'holiday',
        isWorking: false,
        reason: null,
        source: 'seeded',
        groupId: null,
        version: '1',
        updatedBy: null,
        updatedAt: '2026-11-16T00:00:00.000Z',
      },
    ]
    getProductionCalendar.mockImplementation(async () => ({ entries: [...entriesState] }))
    setProductionCalendarDay.mockImplementation(async () => {
      entriesState[0] = {
        ...entriesState[0],
        isWorking: true,
        version: '2',
        updatedBy: 'user-1',
        updatedAt: '2026-11-16T01:00:00.000Z',
      }
      return { entry: entriesState[0] }
    })
    renderWithAuth(<SettingsSection />)

    const trigger = await screen.findByLabelText('S-01 trigger minutes')
    await user.clear(trigger)
    await user.type(trigger, '6')
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()

    expect(screen.queryByRole('button', { name: /Set Christmas Day \(2026-12-25\) to Working/i })).not.toBeInTheDocument()
    const holidaysToggle = screen.getByRole('button', { name: /Show holidays/i })
    expect(holidaysToggle).toHaveAttribute('aria-expanded', 'false')
    await user.click(holidaysToggle)
    expect(screen.getByRole('button', { name: /Hide holidays/i })).toHaveAttribute('aria-expanded', 'true')

    const toggleButton = await screen.findByRole('button', { name: /Set Christmas Day \(2026-12-25\) to Working/i })
    await user.click(toggleButton)

    await waitFor(() => expect(setProductionCalendarDay).toHaveBeenCalledTimes(1))
    expect(setProductionCalendarDay).toHaveBeenCalledWith(
      'test-token',
      machine.id,
      '2026-12-25',
      expect.objectContaining({
        dayType: 'holiday',
        name: 'Christmas Day',
        isWorking: true,
        expectedVersion: '1',
      }),
    )
    const updatedToggleButton = await screen.findByRole('button', { name: /Set Christmas Day \(2026-12-25\) to Day off/i })
    expect(updatedToggleButton).toHaveFocus()
    expect(updateOperationalSettings).not.toHaveBeenCalled()
    expect(trigger).toHaveValue(6)
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
  })

  it('shows a loading skeleton while the production calendar query is pending and a retry button on error', async () => {
    let resolvePending
    getProductionCalendar
      .mockReturnValueOnce(new Promise((resolve) => { resolvePending = resolve }))
      .mockRejectedValueOnce(new Error('Calendar service unavailable'))
      .mockResolvedValueOnce({ entries: [] })

    renderWithAuth(<SettingsSection />)

    expect(await screen.findByLabelText('Loading production calendar')).toBeInTheDocument()
    expect(screen.queryByText(/No custom days off or shutdown ranges scheduled/i)).not.toBeInTheDocument()

    await act(async () => resolvePending({ entries: [] }))
    expect(await screen.findByText(/No custom days off or shutdown ranges scheduled/i)).toBeInTheDocument()
  })

  it('renders a retry button when loading production calendar fails and recovers on click', async () => {
    const user = userEvent.setup()
    getProductionCalendar
      .mockRejectedValueOnce(new Error('Calendar service unavailable'))
      .mockResolvedValueOnce({ entries: [] })

    renderWithAuth(<SettingsSection />)

    const alert = await screen.findByText(/Calendar service unavailable/i)
    const retryBtn = within(alert.closest('[role="alert"]')).getByRole('button', { name: /Retry/i })
    await user.click(retryBtn)

    expect(await screen.findByText(/No custom days off or shutdown ranges scheduled/i)).toBeInTheDocument()
  })

  it('previews Back to work using persisted rest days inside the Schedule exception modal and submits a multi-day range', async () => {
    const user = userEvent.setup()
    getOperationalSettings.mockResolvedValue({
      settings: settingsFixture({
        shiftSchedule: {
          ...settingsFixture().shiftSchedule,
          restDays: ['sunday'],
        },
      }),
      constraints,
    })
    setProductionCalendarRange.mockResolvedValue({
      groupId: 'group-shutdown-1',
      entries: [],
    })
    renderWithAuth(<SettingsSection />)

    await user.click(await screen.findByRole('checkbox', { name: 'Monday' }))
    await user.click(screen.getByRole('button', { name: /Schedule exception/i }))

    const dialog = await screen.findByRole('dialog', { name: /Schedule exception/i })
    expect(dialog).toHaveAttribute('open')
    expect(within(dialog).getByText(/Using saved weekly rest days/i)).toBeInTheDocument()

    const rangeRadio = within(dialog).getByRole('radio', { name: /Date range/i })
    await user.click(rangeRadio)

    const startInput = within(dialog).getByLabelText(/First day off/i)
    const endInput = within(dialog).getByLabelText(/Last day off/i)
    fireEvent.change(startInput, { target: { value: '2026-12-23' } })
    fireEvent.change(endInput, { target: { value: '2027-01-02' } })

    expect(within(dialog).getByText(/Back to work:\s*Mon, Jan 4, 2027/i)).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: /Add to calendar/i }))
    await waitFor(() => expect(setProductionCalendarRange).toHaveBeenCalledTimes(1))
    expect(setProductionCalendarRange).toHaveBeenCalledWith(
      'test-token',
      machine.id,
      expect.objectContaining({
        startDate: '2026-12-23',
        endDate: '2027-01-02',
        dayType: 'day_off',
      }),
    )
  })

  it('disables toggle and remove buttons for calendar entries on or before Manila today', async () => {
    const user = userEvent.setup()
    getProductionCalendar.mockResolvedValue({
      entries: [
        {
          calendarDate: '2020-01-01',
          name: "New Year's Day",
          dayType: 'holiday',
          isWorking: false,
          reason: null,
          source: 'seeded',
          groupId: null,
          version: '1',
          updatedBy: null,
          updatedAt: '2020-01-01T00:00:00.000Z',
        },
        {
          calendarDate: '2020-01-02',
          name: 'Past Manual Closure',
          dayType: 'day_off',
          isWorking: false,
          reason: null,
          source: 'manual',
          groupId: null,
          version: '1',
          updatedBy: 'user-1',
          updatedAt: '2020-01-01T00:00:00.000Z',
        },
      ],
    })
    renderWithAuth(<SettingsSection />)

    const pastManualRemove = await screen.findByRole('button', { name: /Remove Past Manual Closure \(2020-01-02\)/i })
    expect(pastManualRemove).toBeDisabled()

    await user.click(screen.getByRole('button', { name: /Show holidays/i }))
    const pastHolidayToggle = await screen.findByRole('button', { name: /Set New Year's Day \(2020-01-01\) to Working/i })
    expect(pastHolidayToggle).toBeDisabled()
  })

  it('groups multi-day range entries into one row and requires confirmation before removing', async () => {
    const user = userEvent.setup()
    getProductionCalendar.mockResolvedValue({
      entries: [
        {
          calendarDate: '2020-12-23',
          name: 'Holiday Shutdown',
          dayType: 'day_off',
          isWorking: false,
          reason: null,
          source: 'manual',
          groupId: 'group-partial-1',
          version: '1',
          updatedBy: 'user-1',
          updatedAt: '2020-12-01T00:00:00.000Z',
        },
        {
          calendarDate: '2027-01-03',
          name: 'Holiday Shutdown',
          dayType: 'day_off',
          isWorking: false,
          reason: null,
          source: 'manual',
          groupId: 'group-partial-1',
          version: '1',
          updatedBy: 'user-1',
          updatedAt: '2020-12-01T00:00:00.000Z',
        },
      ],
    })
    removeProductionCalendarRange.mockResolvedValue({
      result: {
        machineId: machine.id,
        groupId: 'group-partial-1',
        removedCount: 1,
        removedDates: ['2027-01-03'],
        lockedDates: ['2020-12-23'],
        restoredDates: [],
        restoredHolidays: [],
      },
    })
    renderWithAuth(<SettingsSection />)

    const exclusionsTable = await screen.findByRole('table', { name: 'Scheduled production calendar exclusions' })
    expect(within(exclusionsTable).getAllByText('Holiday Shutdown')).toHaveLength(1)

    const removeRangeBtn = within(exclusionsTable).getByRole('button', { name: /Remove range Holiday Shutdown/i })
    await user.click(removeRangeBtn)
    expect(removeProductionCalendarRange).not.toHaveBeenCalled()

    const confirmDialog = await screen.findByRole('dialog', { name: /Remove shutdown range/i })
    expect(confirmDialog).toHaveClass('confirm-dialog')
    expect(confirmDialog.querySelector('.confirm-dialog-icon.danger')).not.toBeNull()
    expect(confirmDialog.querySelector('.confirm-dialog-actions')).not.toBeNull()
    const cancelBtn = within(confirmDialog).getByRole('button', { name: /Cancel/i })
    const removeConfirmBtn = within(confirmDialog).getByRole('button', { name: /Confirm remove/i })
    expect(cancelBtn).toHaveClass('confirm-cancel-btn')
    expect(removeConfirmBtn).toHaveClass('btn-danger')
    await user.click(cancelBtn)
    expect(removeProductionCalendarRange).not.toHaveBeenCalled()

    await user.click(removeRangeBtn)
    const confirmDialogRetry = await screen.findByRole('dialog', { name: /Remove shutdown range/i })

    try {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-11-16T10:00:00+08:00'))

      await act(async () => {
        fireEvent.click(within(confirmDialogRetry).getByRole('button', { name: /Confirm remove/i }))
      })

      expect(within(exclusionsTable).queryByText('Holiday Shutdown')).not.toBeInTheDocument()
      expect(screen.getByRole('status')).toHaveTextContent(/Undo available for 7 seconds/i)
      expect(screen.getByRole('button', { name: /Undo remove Holiday Shutdown/i })).toHaveFocus()
      expect(removeProductionCalendarRange).not.toHaveBeenCalled()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(7000)
      })

      expect(removeProductionCalendarRange).toHaveBeenCalledWith('test-token', machine.id, 'group-partial-1')
      expect(screen.getByText(/only remaining future dates were removed/i)).toBeInTheDocument()
    } finally {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date('2026-11-16T10:00:00+08:00'))
    }
  })

  it('optimistically removes a calendar entry and restores it when Undo is clicked within 7 seconds', async () => {
    const user = userEvent.setup()
    getProductionCalendar.mockResolvedValue({
      entries: [
        {
          calendarDate: '2026-12-20',
          name: 'Maintenance Day',
          dayType: 'day_off',
          isWorking: false,
          reason: null,
          source: 'manual',
          groupId: null,
          version: '1',
          updatedBy: 'user-1',
          updatedAt: '2026-11-16T00:00:00.000Z',
        },
      ],
    })
    renderWithAuth(<SettingsSection />)

    const exclusionsTable = await screen.findByRole('table', { name: 'Scheduled production calendar exclusions' })
    const removeBtn = within(exclusionsTable).getByRole('button', { name: /Remove Maintenance Day \(2026-12-20\)/i })
    await user.click(removeBtn)

    const confirmDialog = await screen.findByRole('dialog', { name: /Remove calendar exclusion/i })

    try {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-11-16T10:00:00+08:00'))

      await act(async () => {
        fireEvent.click(within(confirmDialog).getByRole('button', { name: /Confirm remove/i }))
      })

      expect(screen.getByText('No custom days off or shutdown ranges scheduled.')).toBeInTheDocument()
      const undoBtn = screen.getByRole('button', { name: /Undo remove Maintenance Day/i })
      expect(undoBtn).toHaveFocus()
      expect(removeProductionCalendarDay).not.toHaveBeenCalled()

      await act(async () => {
        fireEvent.click(undoBtn)
      })

      const restoredTable = screen.getByRole('table', { name: 'Scheduled production calendar exclusions' })
      expect(within(restoredTable).getByText('Maintenance Day')).toBeInTheDocument()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(7000)
      })
      expect(removeProductionCalendarDay).not.toHaveBeenCalled()
    } finally {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date('2026-11-16T10:00:00+08:00'))
    }
  })

  it('restores a removed calendar entry and shows an alert if delayed deletion fails after 7 seconds', async () => {
    const user = userEvent.setup()
    getProductionCalendar.mockResolvedValue({
      entries: [
        {
          calendarDate: '2026-12-20',
          name: 'Maintenance Day',
          dayType: 'day_off',
          isWorking: false,
          reason: null,
          source: 'manual',
          groupId: null,
          version: '1',
          updatedBy: 'user-1',
          updatedAt: '2026-11-16T00:00:00.000Z',
        },
      ],
    })
    removeProductionCalendarDay.mockRejectedValueOnce(new Error('Network delete failed'))
    renderWithAuth(<SettingsSection />)

    const exclusionsTable = await screen.findByRole('table', { name: 'Scheduled production calendar exclusions' })
    await user.click(within(exclusionsTable).getByRole('button', { name: /Remove Maintenance Day \(2026-12-20\)/i }))
    const confirmDialog = await screen.findByRole('dialog', { name: /Remove calendar exclusion/i })

    try {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-11-16T10:00:00+08:00'))

      await act(async () => {
        fireEvent.click(within(confirmDialog).getByRole('button', { name: /Confirm remove/i }))
      })

      expect(screen.getByText('No custom days off or shutdown ranges scheduled.')).toBeInTheDocument()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(7000)
      })

      expect(removeProductionCalendarDay).toHaveBeenCalledWith('test-token', machine.id, '2026-12-20')
      const restoredTable = screen.getByRole('table', { name: 'Scheduled production calendar exclusions' })
      expect(within(restoredTable).getByText('Maintenance Day')).toBeInTheDocument()
      expect(screen.getByRole('alert')).toHaveTextContent(/Network delete failed/i)
    } finally {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date('2026-11-16T10:00:00+08:00'))
    }
  })

  it('validates that Machine not scheduled requires a non-empty reason inside custom-select-wrap before calling the API', async () => {
    const user = userEvent.setup()
    renderWithAuth(<SettingsSection />)

    await user.click(await screen.findByRole('button', { name: /Schedule exception/i }))
    const dialog = await screen.findByRole('dialog', { name: /Schedule exception/i })

    const dayTypeSelect = within(dialog).getByLabelText(/Exclusion type/i)
    expect(dayTypeSelect.closest('.custom-select-wrap')).not.toBeNull()
    await user.selectOptions(dayTypeSelect, 'machine_not_scheduled')

    const dateInput = within(dialog).getByLabelText('Exclusion date')
    fireEvent.change(dateInput, { target: { value: '2026-12-20' } })

    await user.click(within(dialog).getByRole('button', { name: /Add to calendar/i }))

    expect(await within(dialog).findByText(/reason is required/i)).toBeInTheDocument()
    expect(setProductionCalendarDay).not.toHaveBeenCalled()
    expect(setProductionCalendarRange).not.toHaveBeenCalled()
  })

  it('prompts for overwrite confirmation inside the dialog with conflictingDates on 409 and retries with confirmOverwrite: true', async () => {
    const user = userEvent.setup()
    const conflictError = Object.assign(new Error('Manual entries exist'), {
      status: 409,
      code: 'CALENDAR_OVERWRITE_CONFIRM_REQUIRED',
      details: { conflictingDates: ['2026-12-28'] },
    })
    setProductionCalendarRange
      .mockRejectedValueOnce(conflictError)
      .mockResolvedValueOnce({ groupId: 'group-overwrite-1', entries: [] })

    renderWithAuth(<SettingsSection />)

    await user.click(await screen.findByRole('button', { name: /Schedule exception/i }))
    const dialog = await screen.findByRole('dialog', { name: /Schedule exception/i })

    await user.click(within(dialog).getByRole('radio', { name: /Date range/i }))
    fireEvent.change(within(dialog).getByLabelText(/First day off/i), { target: { value: '2026-12-23' } })
    fireEvent.change(within(dialog).getByLabelText(/Last day off/i), { target: { value: '2027-01-02' } })
    await user.click(within(dialog).getByRole('button', { name: /Add to calendar/i }))

    await waitFor(() => expect(setProductionCalendarRange).toHaveBeenCalledTimes(1))
    expect(setProductionCalendarRange.mock.calls[0][2].confirmOverwrite).toBeFalsy()

    expect(await within(dialog).findByText(/2026-12-28/)).toBeInTheDocument()
    const confirmBtn = within(dialog).getByRole('button', { name: /Confirm overwrite/i })
    await user.click(confirmBtn)

    await waitFor(() => expect(setProductionCalendarRange).toHaveBeenCalledTimes(2))
    expect(setProductionCalendarRange.mock.calls[1][2]).toEqual(
      expect.objectContaining({
        startDate: '2026-12-23',
        endDate: '2027-01-02',
        confirmOverwrite: true,
      }),
    )
  })

  it('disables production calendar mutation controls for unauthorized roles while allowing holiday list expand and collapse', async () => {
    const user = userEvent.setup()
    getProductionCalendar.mockResolvedValue({
      entries: [
        {
          calendarDate: '2026-12-25',
          name: 'Christmas Day',
          dayType: 'holiday',
          isWorking: false,
          reason: null,
          source: 'seeded',
          groupId: null,
          version: '1',
          updatedBy: null,
          updatedAt: '2026-11-16T00:00:00.000Z',
        },
      ],
    })
    renderWithAuth(<SettingsSection />, {
      authValue: {
        user: { id: 'user-op', name: 'operator', username: 'operator', role: 'Operation Manager' },
      },
    })

    const scheduleTrigger = await screen.findByRole('button', { name: /Schedule exception/i })
    expect(scheduleTrigger).toBeDisabled()

    const showHolidaysBtn = await screen.findByRole('button', { name: /Show holidays/i })
    expect(showHolidaysBtn).toBeEnabled()
    expect(showHolidaysBtn).toHaveAttribute('aria-expanded', 'false')

    await user.click(showHolidaysBtn)
    expect(await screen.findByRole('button', { name: /Set Christmas Day \(2026-12-25\) to Working/i })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: /Hide holidays/i }))
    expect(screen.queryByRole('button', { name: /Set Christmas Day \(2026-12-25\) to Working/i })).not.toBeInTheDocument()
  })

  it('places calendar caption and nav side-by-side inside the month container in the Schedule exception modal', async () => {
    const user = userEvent.setup()
    renderWithAuth(<SettingsSection />)

    await user.click(await screen.findByRole('button', { name: /Schedule exception/i }))
    const dialog = await screen.findByRole('dialog', { name: /Schedule exception/i })

    const root = dialog.querySelector('.shadcn-calendar-root')
    const month = dialog.querySelector('.shadcn-calendar-month')
    expect(root).toHaveAttribute('data-nav-layout', 'after')
    expect(month).not.toBeNull()

    const directChildClasses = Array.from(month.children).map((node) => node.className)
    expect(directChildClasses).toEqual([
      'shadcn-calendar-caption',
      'shadcn-calendar-nav',
      'shadcn-calendar-grid',
    ])
  })

  it('keeps Operating hours columns in a two-row label-and-control structure for grid alignment', async () => {
    renderWithAuth(<SettingsSection />)

    await screen.findByLabelText('Work start')
    const workGrid = document.querySelector('.settings-work-grid')
    expect(workGrid).not.toBeNull()

    const columns = Array.from(workGrid.children)
    expect(columns).toHaveLength(3)
    for (const column of columns) {
      expect(column).toHaveClass('settings-field-col')
      expect(column.children).toHaveLength(2)
    }
    expect(columns[2].firstElementChild).toHaveClass('settings-field-label-row')
  })

  it('allows Engineering Supervisor to edit operational settings and production calendar controls', async () => {
    const user = userEvent.setup()
    getProductionCalendar.mockResolvedValue({
      entries: [
        {
          calendarDate: '2026-12-25',
          name: 'Christmas Day',
          dayType: 'holiday',
          isWorking: false,
          reason: null,
          source: 'seeded',
          groupId: null,
          version: '1',
          updatedBy: null,
          updatedAt: '2026-11-16T00:00:00.000Z',
        },
      ],
    })
    updateOperationalSettings.mockResolvedValue({ settings: settingsFixture({ version: '2' }) })
    renderWithAuth(<SettingsSection />, {
      authValue: {
        user: { id: 'user-eng', name: 'Nico Peralta', username: 'engsupervisor', role: 'Engineering Supervisor' },
      },
    })

    const trigger = await screen.findByLabelText('S-01 trigger minutes')
    expect(trigger).toBeEnabled()

    const scheduleTrigger = await screen.findByRole('button', { name: /Schedule exception/i })
    expect(scheduleTrigger).toBeEnabled()

    await user.click(screen.getByRole('button', { name: /Show holidays/i }))
    expect(await screen.findByRole('button', { name: /Set Christmas Day \(2026-12-25\) to Working/i })).toBeEnabled()

    await user.clear(trigger)
    await user.type(trigger, '5')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(updateOperationalSettings).toHaveBeenCalledTimes(1))
  })
})
