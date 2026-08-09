import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthContext } from '../../auth/authSession.jsx'
import { renderWithAuth } from '../../../test/renderWithAuth.jsx'
import MachinesSection from './MachinesSection.jsx'
import { getMachines, getMachineSensors, updateMachineStatus, updateSensorStatus } from './machinesService.js'

vi.mock('./machinesService.js', () => ({
  getMachines: vi.fn(),
  getMachineSensors: vi.fn(),
  updateMachineStatus: vi.fn(),
  updateSensorStatus: vi.fn(),
}))

function machineFixture(overrides = {}) {
  return {
    id: 'machine-1',
    machineCode: 'M-01',
    name: 'Spiral Mill 01',
    location: 'Dunggoan',
    sensorCount: 5,
    status: 'Running',
    updatedAt: '2026-08-09T02:00:00.000Z',
    ...overrides,
  }
}

function sensorFixture(overrides = {}) {
  return {
    id: 'sensor-1',
    sensorCode: 'S-01',
    label: 'Raw Material Detection',
    esp32DeviceId: 'ESP32-01',
    purpose: 'Raw Material Detection',
    status: 'Active',
    updatedAt: '2026-08-09T02:00:00.000Z',
    ...overrides,
  }
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

describe('MachinesSection request states', () => {
  beforeEach(() => {
    getMachines.mockReset()
    getMachineSensors.mockReset()
    updateMachineStatus.mockReset()
    updateSensorStatus.mockReset()
  })

  it('shows machine-list failure with Retry and does not call it empty', async () => {
    const user = userEvent.setup()
    getMachines
      .mockRejectedValueOnce(new Error('Machine registry failed.'))
      .mockResolvedValueOnce({ machines: [machineFixture()] })
    getMachineSensors.mockResolvedValue({ sensors: [] })

    renderWithAuth(<MachinesSection />)

    expect(await screen.findByRole('heading', { name: 'Unable to load machines' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Machine registry failed.')
    expect(screen.queryByRole('heading', { name: 'No machines found' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Retry machines' }))

    expect(await screen.findByRole('heading', { name: 'Spiral Mill 01' })).toBeInTheDocument()
    expect(getMachines).toHaveBeenCalledTimes(2)
  })

  it('keeps a successful empty machine list as the valid empty state', async () => {
    getMachines.mockResolvedValue({ machines: [] })

    renderWithAuth(<MachinesSection />)

    expect(await screen.findByRole('heading', { name: 'No machines found' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Unable to load machines' })).not.toBeInTheDocument()
  })

  it('preserves a successful empty machine registry as stale after refresh failure', async () => {
    const user = userEvent.setup()
    getMachines
      .mockResolvedValueOnce({ machines: [] })
      .mockRejectedValueOnce(new Error('Empty registry refresh failed.'))

    renderWithAuth(<MachinesSection />)

    expect(await screen.findByRole('heading', { name: 'No machines found' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Refresh machines' }))

    const staleNotice = await screen.findByText(/Machine registry data is stale/i)
    expect(staleNotice).toHaveTextContent('Empty registry refresh failed.')
    expect(staleNotice.querySelector('time')).toHaveAttribute('dateTime')
    expect(screen.getByRole('heading', { name: 'No machines found' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry machines' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Spiral Mill 01' })).not.toBeInTheDocument()
  })

  it('preserves machines as stale and disables machine mutation after refresh failure', async () => {
    const user = userEvent.setup()
    getMachines
      .mockResolvedValueOnce({ machines: [machineFixture()] })
      .mockRejectedValueOnce(new Error('Machine refresh failed.'))
    getMachineSensors.mockResolvedValue({ sensors: [sensorFixture()] })

    renderWithAuth(<MachinesSection />)

    expect(await screen.findByRole('heading', { name: 'Spiral Mill 01' })).toBeInTheDocument()
    expect(screen.getByLabelText('Machine status')).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Refresh machines' }))

    const staleNotice = await screen.findByText(/Machine registry data is stale/i)
    expect(staleNotice).toHaveTextContent('Machine refresh failed.')
    expect(staleNotice.querySelector('time')).toHaveAttribute('dateTime')
    expect(screen.getByRole('heading', { name: 'Spiral Mill 01' })).toBeInTheDocument()
    expect(screen.getByLabelText('Machine status')).toBeDisabled()
  })

  it('distinguishes sensor error from successful empty and retries sensors', async () => {
    const user = userEvent.setup()
    getMachines.mockResolvedValue({ machines: [machineFixture()] })
    getMachineSensors
      .mockRejectedValueOnce(new Error('Sensor read failed.'))
      .mockResolvedValueOnce({ sensors: [] })

    renderWithAuth(<MachinesSection />)

    expect(await screen.findByRole('heading', { name: 'Unable to load machine sensors' })).toBeInTheDocument()
    expect(screen.queryByText('No sensors are connected to this machine.')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry sensors' }))

    expect(await screen.findByText('No sensors are connected to this machine.')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Unable to load machine sensors' })).not.toBeInTheDocument()
  })

  it('preserves sensor cards as stale and disables sensor mutations after refresh failure', async () => {
    const user = userEvent.setup()
    getMachines.mockResolvedValue({ machines: [machineFixture()] })
    getMachineSensors
      .mockResolvedValueOnce({ sensors: [sensorFixture()] })
      .mockRejectedValueOnce(new Error('Sensor refresh failed.'))

    renderWithAuth(<MachinesSection />)

    expect(await screen.findByRole('heading', { name: 'Raw Material Detection' })).toBeInTheDocument()
    expect(screen.getByLabelText('Sensor status')).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Refresh sensors' }))

    const staleNotice = await screen.findByText(/Sensor data is stale/i)
    expect(staleNotice).toHaveTextContent('Sensor refresh failed.')
    expect(staleNotice.querySelector('time')).toHaveAttribute('dateTime')
    expect(screen.getByRole('heading', { name: 'Raw Material Detection' })).toBeInTheDocument()
    expect(screen.getByLabelText('Sensor status')).toBeDisabled()
  })

  it('ignores a late prior-token machine response and never displays it', async () => {
    const firstTokenRequest = deferred()
    getMachines
      .mockReturnValueOnce(firstTokenRequest.promise)
      .mockResolvedValueOnce({ machines: [machineFixture({ id: 'machine-2', machineCode: 'M-02', name: 'Current token machine' })] })
    getMachineSensors.mockResolvedValue({ sensors: [] })

    function renderTree(token) {
      return (
        <AuthContext.Provider value={{ token }}>
          <MemoryRouter>
            <MachinesSection />
          </MemoryRouter>
        </AuthContext.Provider>
      )
    }

    const view = render(renderTree('first-token'))
    view.rerender(renderTree('second-token'))

    expect(await screen.findByRole('heading', { name: 'Current token machine' })).toBeInTheDocument()
    firstTokenRequest.resolve({ machines: [machineFixture({ name: 'Late prior-token machine' })] })

    await waitFor(() => {
      expect(screen.queryByText('Late prior-token machine')).not.toBeInTheDocument()
    })
    expect(screen.getByRole('heading', { name: 'Current token machine' })).toBeInTheDocument()
  })

  it('does not request sensors for the old machine while a new-token machine list is pending', async () => {
    const secondTokenRequest = deferred()
    getMachines
      .mockResolvedValueOnce({ machines: [machineFixture()] })
      .mockReturnValueOnce(secondTokenRequest.promise)
    getMachineSensors.mockResolvedValue({ sensors: [] })

    function renderTree(token) {
      return (
        <AuthContext.Provider value={{ token }}>
          <MemoryRouter>
            <MachinesSection />
          </MemoryRouter>
        </AuthContext.Provider>
      )
    }

    const view = render(renderTree('first-token'))

    expect(await screen.findByRole('heading', { name: 'Spiral Mill 01' })).toBeInTheDocument()
    await waitFor(() => expect(getMachineSensors).toHaveBeenCalledWith('first-token', 'machine-1'))

    view.rerender(renderTree('second-token'))

    await waitFor(() => expect(getMachines).toHaveBeenCalledWith('second-token'))
    expect(getMachineSensors).not.toHaveBeenCalledWith('second-token', 'machine-1')

    await act(async () => {
      secondTokenRequest.resolve({
        machines: [machineFixture({ id: 'machine-2', machineCode: 'M-02', name: 'Current token machine' })],
      })
      await secondTokenRequest.promise
    })

    expect(await screen.findByRole('heading', { name: 'Current token machine' })).toBeInTheDocument()
    expect(getMachineSensors).toHaveBeenCalledWith('second-token', 'machine-2')
    expect(getMachineSensors).not.toHaveBeenCalledWith('second-token', 'machine-1')
  })

  it('ignores a late machine mutation after the token and machine context change', async () => {
    const user = userEvent.setup()
    const oldMutation = deferred()
    getMachines
      .mockResolvedValueOnce({ machines: [machineFixture()] })
      .mockResolvedValueOnce({
        machines: [machineFixture({ id: 'machine-2', machineCode: 'M-02', name: 'Current token machine' })],
      })
    getMachineSensors.mockResolvedValue({ sensors: [] })
    updateMachineStatus.mockReturnValue(oldMutation.promise)

    function renderTree(token) {
      return (
        <AuthContext.Provider value={{ token }}>
          <MemoryRouter>
            <MachinesSection />
          </MemoryRouter>
        </AuthContext.Provider>
      )
    }

    const view = render(renderTree('first-token'))
    const oldMachineStatus = await screen.findByLabelText('Machine status')
    await user.selectOptions(oldMachineStatus, 'Idle')
    expect(oldMachineStatus).toBeDisabled()

    view.rerender(renderTree('second-token'))
    expect(await screen.findByRole('heading', { name: 'Current token machine' })).toBeInTheDocument()

    await act(async () => {
      oldMutation.resolve({ machine: machineFixture({ name: 'Old session machine', status: 'Idle' }) })
      await oldMutation.promise
    })

    expect(screen.getByLabelText('Machine status')).toHaveValue('Running')
    expect(screen.queryByText('Old session machine is now Idle.')).not.toBeInTheDocument()
  })

  it('clears an already-rendered mutation notice when the token changes', async () => {
    const user = userEvent.setup()
    getMachines
      .mockResolvedValueOnce({ machines: [machineFixture()] })
      .mockResolvedValueOnce({
        machines: [machineFixture({ id: 'machine-2', machineCode: 'M-02', name: 'Current token machine' })],
      })
    getMachineSensors.mockResolvedValue({ sensors: [] })
    updateMachineStatus.mockResolvedValue({ machine: machineFixture({ status: 'Idle' }) })

    function renderTree(token) {
      return (
        <AuthContext.Provider value={{ token }}>
          <MemoryRouter>
            <MachinesSection />
          </MemoryRouter>
        </AuthContext.Provider>
      )
    }

    const view = render(renderTree('first-token'))
    await user.selectOptions(await screen.findByLabelText('Machine status'), 'Idle')
    expect(await screen.findByText('Spiral Mill 01 is now Idle.')).toBeInTheDocument()

    view.rerender(renderTree('second-token'))

    expect(await screen.findByRole('heading', { name: 'Current token machine' })).toBeInTheDocument()
    expect(screen.queryByText('Spiral Mill 01 is now Idle.')).not.toBeInTheDocument()
  })

  it('ignores a late sensor mutation after the token and machine context change', async () => {
    const user = userEvent.setup()
    const oldMutation = deferred()
    getMachines
      .mockResolvedValueOnce({ machines: [machineFixture()] })
      .mockResolvedValueOnce({
        machines: [machineFixture({ id: 'machine-2', machineCode: 'M-02', name: 'Current token machine' })],
      })
    getMachineSensors
      .mockResolvedValueOnce({ sensors: [sensorFixture()] })
      .mockResolvedValueOnce({
        sensors: [sensorFixture({ id: 'sensor-2', sensorCode: 'S-02', label: 'Current token sensor' })],
      })
    updateSensorStatus.mockReturnValue(oldMutation.promise)

    function renderTree(token) {
      return (
        <AuthContext.Provider value={{ token }}>
          <MemoryRouter>
            <MachinesSection />
          </MemoryRouter>
        </AuthContext.Provider>
      )
    }

    const view = render(renderTree('first-token'))
    const oldSensorStatus = await screen.findByLabelText('Sensor status')
    await user.selectOptions(oldSensorStatus, 'Inactive')
    expect(oldSensorStatus).toBeDisabled()

    view.rerender(renderTree('second-token'))
    expect(await screen.findByRole('heading', { name: 'Outside Filler' })).toBeInTheDocument()

    await act(async () => {
      oldMutation.resolve({ sensor: sensorFixture({ label: 'Old session sensor', status: 'Inactive' }) })
      await oldMutation.promise
    })

    expect(screen.getByLabelText('Sensor status')).toHaveValue('Active')
    expect(screen.queryByText('Old session sensor is now Inactive.')).not.toBeInTheDocument()
  })

  it('keeps concurrent sensor mutations independently disabled until each settles', async () => {
    const user = userEvent.setup()
    const firstMutation = deferred()
    const secondMutation = deferred()
    const firstSensor = sensorFixture()
    const secondSensor = sensorFixture({
      id: 'sensor-2',
      sensorCode: 'S-02',
      label: 'Edge Alignment Detection',
      purpose: 'Edge Alignment Detection',
    })
    getMachines.mockResolvedValue({ machines: [machineFixture()] })
    getMachineSensors.mockResolvedValue({ sensors: [firstSensor, secondSensor] })
    updateSensorStatus
      .mockReturnValueOnce(firstMutation.promise)
      .mockReturnValueOnce(secondMutation.promise)

    renderWithAuth(<MachinesSection />)

    const sensorStatuses = await screen.findAllByLabelText('Sensor status')
    await user.selectOptions(sensorStatuses[0], 'Inactive')
    await user.selectOptions(sensorStatuses[1], 'Fault')

    expect(sensorStatuses[0]).toBeDisabled()
    expect(sensorStatuses[1]).toBeDisabled()

    await act(async () => {
      firstMutation.resolve({ sensor: { ...firstSensor, status: 'Inactive' } })
      await firstMutation.promise
    })

    await waitFor(() => expect(screen.getAllByLabelText('Sensor status')[0]).toBeEnabled())
    expect(screen.getAllByLabelText('Sensor status')[1]).toBeDisabled()

    await act(async () => {
      secondMutation.resolve({ sensor: { ...secondSensor, status: 'Fault' } })
      await secondMutation.promise
    })

    await waitFor(() => expect(screen.getAllByLabelText('Sensor status')[1]).toBeEnabled())
    expect(screen.getAllByLabelText('Sensor status')[0]).toHaveValue('Inactive')
    expect(screen.getAllByLabelText('Sensor status')[1]).toHaveValue('Fault')
  })
})
