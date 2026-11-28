import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { queryKeys } from '../../../shared/services/queryClient.js'
import { getSessionGeneration } from '../../../shared/services/sessionRefresh.js'
import { calculatePipeTonnage } from './productionUtils.js'

const EMPTY_EDIT_FORM = {
  customer: '',
  diameter: '',
  thickness: '',
  length: '',
  pipeNumber: '',
  tonnage: '',
}

const EMPTY_BULK_FORM = {
  customer: '',
  diameter: '',
  thickness: '',
  length: '',
  tonnage: '',
}

function invalidateProductionDependents(queryClient) {
  void queryClient.invalidateQueries({ queryKey: queryKeys.production.all })
  void queryClient.invalidateQueries({ queryKey: queryKeys.analytics.all })
  void queryClient.invalidateQueries({ queryKey: queryKeys.reports.all })
  void queryClient.invalidateQueries({ queryKey: queryKeys.audit.all })
  void queryClient.invalidateQueries({ queryKey: queryKeys.overview.all })
}

function applySummaryDelta(setSummary, specifiedDelta, tonnageDelta) {
  if (specifiedDelta === 0 && tonnageDelta === 0) return
  setSummary((prev) => ({
    ...prev,
    specifiedCount: Math.max(0, (prev.specifiedCount ?? 0) + specifiedDelta),
    unspecifiedCount: Math.max(0, (prev.unspecifiedCount ?? 0) - specifiedDelta),
    totalTonnage: Math.max(0, Math.round(((prev.totalTonnage ?? 0) + tonnageDelta) * 10000) / 10000),
  }))
}

export function useProductionMutations({
  token,
  user,
  queryClient,
  queryKey,
  records,
  updateFn,
  batchUpdateFn,
  selectedIds,
  onClearSelection,
  onRefetch,
  setError,
  setConflictNotice,
  setAnnouncement,
}) {
  const identityRef = useRef(`${user?.id || ''}:${user?.role || ''}`)
  useLayoutEffect(() => {
    identityRef.current = `${user?.id || ''}:${user?.role || ''}`
  }, [user?.id, user?.role])

  const mountedRef = useRef(false)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const [editingRecordId, setEditingRecordId] = useState(null)
  const [editForm, setEditForm] = useState(EMPTY_EDIT_FORM)
  const [flashingRecordId, setFlashingRecordId] = useState(null)
  const [bulkForm, setBulkForm] = useState(EMPTY_BULK_FORM)
  const [isConfirmingBulk, setIsConfirmingBulk] = useState(false)
  const [isApplyingBulk, setIsApplyingBulk] = useState(false)
  const [savingRecordIds, setSavingRecordIds] = useState(() => new Set())
  const [flashingRecordIds, setFlashingRecordIds] = useState(() => new Set())

  const flashTimeoutRef = useRef(null)
  const bulkApplyingRef = useRef(false)
  const savingIdsRef = useRef(new Set())
  const lastSavedSpecRef = useRef(null)

  useEffect(() => () => {
    if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current)
  }, [])

  const setRecords = (update) => queryClient.setQueryData(
    queryKey,
    (current) => (current
      ? { ...current, records: typeof update === 'function' ? update(current.records || []) : update }
      : current),
    { updatedAt: queryClient.getQueryState(queryKey)?.dataUpdatedAt },
  )

  const setSummary = (update) => queryClient.setQueryData(
    queryKey,
    (current) => (current
      ? { ...current, summary: typeof update === 'function' ? update(current.summary || {}) : update }
      : current),
    { updatedAt: queryClient.getQueryState(queryKey)?.dataUpdatedAt },
  )

  const resetBulkConfirm = useCallback(() => {
    setIsConfirmingBulk(false)
  }, [])

  const handleBulkCustomerChange = (value) => {
    setBulkForm((prev) => ({ ...prev, customer: value }))
  }

  const handleBulkDimensionChange = (field, value) => {
    setBulkForm((prev) => {
      const next = { ...prev, [field]: value }
      const autoTons = calculatePipeTonnage(next.diameter, next.thickness, next.length)
      next.tonnage = autoTons !== null ? String(autoTons) : ''
      return next
    })
  }

  const handleBulkTonnageChange = (value) => {
    setBulkForm((prev) => ({ ...prev, tonnage: value }))
  }

  const handleRepeatLastSpec = () => {
    const lastSpec =
      lastSavedSpecRef.current ||
      records.find(
        (r) =>
          r.isSpecified ||
          Boolean(
            (r.customer && String(r.customer).trim()) ||
            r.diameter != null ||
            r.thickness != null ||
            r.length != null ||
            r.tonnage != null,
          ),
      )
    if (!lastSpec) return
    const fallbackTonnage =
      lastSpec.tonnage !== null && lastSpec.tonnage !== undefined
        ? lastSpec.tonnage
        : calculatePipeTonnage(lastSpec.diameter, lastSpec.thickness, lastSpec.length)
    setBulkForm({
      customer: lastSpec.customer || '',
      diameter: lastSpec.diameter !== null && lastSpec.diameter !== undefined ? String(lastSpec.diameter) : '',
      thickness: lastSpec.thickness !== null && lastSpec.thickness !== undefined ? String(lastSpec.thickness) : '',
      length: lastSpec.length !== null && lastSpec.length !== undefined ? String(lastSpec.length) : '',
      tonnage: fallbackTonnage !== null && fallbackTonnage !== undefined ? String(fallbackTonnage) : '',
    })
  }

  const handleBulkApplyClick = () => {
    const hasField = Boolean(
      bulkForm.customer.trim() ||
        (bulkForm.diameter !== '' && !isNaN(Number(bulkForm.diameter))) ||
        (bulkForm.thickness !== '' && !isNaN(Number(bulkForm.thickness))) ||
        (bulkForm.length !== '' && !isNaN(Number(bulkForm.length))) ||
        (bulkForm.tonnage !== '' && !isNaN(Number(bulkForm.tonnage))),
    )
    if (!hasField) {
      setError('Provide at least one specification field to update.')
      return
    }
    setError(null)
    setIsConfirmingBulk(true)
  }

  const handleBulkKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleBulkApplyClick()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      if (isConfirmingBulk) {
        setIsConfirmingBulk(false)
      } else {
        onClearSelection()
      }
    }
  }

  const handleConfirmBulkApply = async () => {
    if (bulkApplyingRef.current) return
    bulkApplyingRef.current = true
    const sessionGeneration = getSessionGeneration()
    const identity = identityRef.current
    const isCurrentSession = () => mountedRef.current && identityRef.current === identity && sessionGeneration === getSessionGeneration()
    setIsConfirmingBulk(false)
    setIsApplyingBulk(true)
    setError(null)

    const targetIds = Array.from(selectedIds)
    const targetSet = new Set(targetIds)
    const prevById = new Map(
      records
        .filter((r) => targetSet.has(r.id || r.sensorEventId))
        .map((r) => [r.id || r.sensorEventId, r]),
    )

    const newCustomer = bulkForm.customer.trim() || undefined
    const newDiameter =
      bulkForm.diameter !== '' && !isNaN(Number(bulkForm.diameter)) ? Number(bulkForm.diameter) : undefined
    const newThickness =
      bulkForm.thickness !== '' && !isNaN(Number(bulkForm.thickness)) ? Number(bulkForm.thickness) : undefined
    const newLength =
      bulkForm.length !== '' && !isNaN(Number(bulkForm.length)) ? Number(bulkForm.length) : undefined
    const newTonnage =
      bulkForm.tonnage !== '' && !isNaN(Number(bulkForm.tonnage)) ? Number(bulkForm.tonnage) : undefined

    const appliedSpec = {}
    if (newCustomer !== undefined) appliedSpec.customer = newCustomer
    if (newDiameter !== undefined) appliedSpec.diameter = newDiameter
    if (newThickness !== undefined) appliedSpec.thickness = newThickness
    if (newLength !== undefined) appliedSpec.length = newLength
    if (newTonnage !== undefined) appliedSpec.tonnage = newTonnage

    void queryClient.cancelQueries({ queryKey, exact: true })
    let newlySpecifiedCount = 0
    let tonnageDelta = 0
    setRecords((prev) =>
      prev.map((r) => {
        const id = r.id || r.sensorEventId
        if (!targetSet.has(id)) return r
        const effCustomer = newCustomer !== undefined ? newCustomer : r.customer
        const effDiameter = newDiameter !== undefined ? newDiameter : r.diameter
        const effThickness = newThickness !== undefined ? newThickness : r.thickness
        const effLength = newLength !== undefined ? newLength : r.length
        const effTonnage =
          newTonnage !== undefined
            ? newTonnage
            : newDiameter !== undefined || newThickness !== undefined || newLength !== undefined
              ? calculatePipeTonnage(effDiameter, effThickness, effLength)
              : (r.tonnage ?? calculatePipeTonnage(effDiameter, effThickness, effLength))
        const prevRowTonnage = r.tonnage != null && Number.isFinite(Number(r.tonnage)) ? Number(r.tonnage) : 0
        tonnageDelta += (effTonnage ?? 0) - prevRowTonnage
        const isNowSpecified = Boolean(
          (effCustomer && effCustomer.trim() !== '') ||
          effDiameter != null ||
          effThickness != null ||
          effLength != null ||
          effTonnage != null ||
          r.pipeNumber != null,
        )
        if (!r.isSpecified && isNowSpecified) {
          newlySpecifiedCount++
        }
        return {
          ...r,
          customer: effCustomer,
          diameter: effDiameter,
          thickness: effThickness,
          length: effLength,
          tonnage: effTonnage,
          isSpecified: isNowSpecified,
          specStatus: isNowSpecified ? 'specified' : 'unspecified',
        }
      }),
    )

    applySummaryDelta(setSummary, newlySpecifiedCount, tonnageDelta)

    setFlashingRecordIds(new Set(targetIds))
    if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current)
    flashTimeoutRef.current = setTimeout(() => {
      setFlashingRecordIds(new Set())
    }, 500)

    try {
      await batchUpdateFn(token, {
        sensorEventIds: targetIds,
        appliedSpec,
      })
      if (sessionGeneration === getSessionGeneration()) {
        invalidateProductionDependents(queryClient)
      }
      if (!isCurrentSession()) return

      lastSavedSpecRef.current = {
        customer: newCustomer || '',
        diameter: newDiameter ?? null,
        thickness: newThickness ?? null,
        length: newLength ?? null,
        tonnage: newTonnage ?? null,
      }
      onClearSelection()
      setBulkForm(EMPTY_BULK_FORM)
      setAnnouncement(`Applied specifications to ${targetIds.length} cuts.`)
    } catch (err) {
      if (!isCurrentSession()) {
        if (sessionGeneration === getSessionGeneration()) {
          void queryClient.invalidateQueries({ queryKey: queryKeys.production.all })
        }
        return
      }
      setRecords((prev) => prev.map((r) => prevById.get(r.id || r.sensorEventId) || r))
      applySummaryDelta(setSummary, -newlySpecifiedCount, -tonnageDelta)
      setError(err.message || 'Unable to update production specifications.')
    } finally {
      bulkApplyingRef.current = false
      if (mountedRef.current) setIsApplyingBulk(false)
    }
  }

  const handleStartEdit = (record) => {
    const rowId = record.id || record.sensorEventId
    setEditingRecordId(rowId)
    setConflictNotice(null)
    setError(null)
    const fallbackTonnage =
      record.tonnage !== null && record.tonnage !== undefined
        ? record.tonnage
        : calculatePipeTonnage(record.diameter, record.thickness, record.length)
    setEditForm({
      customer: record.customer ?? '',
      diameter: record.diameter !== null && record.diameter !== undefined ? String(record.diameter) : '',
      thickness: record.thickness !== null && record.thickness !== undefined ? String(record.thickness) : '',
      length: record.length !== null && record.length !== undefined ? String(record.length) : '',
      pipeNumber: record.pipeNumber !== null && record.pipeNumber !== undefined ? String(record.pipeNumber) : '',
      tonnage: fallbackTonnage !== null && fallbackTonnage !== undefined ? String(fallbackTonnage) : '',
    })
  }

  const handleCancel = () => {
    setEditingRecordId(null)
    setError(null)
    setEditForm(EMPTY_EDIT_FORM)
  }

  const handleInputChange = (e) => {
    const { name, value } = e.target
    setEditForm((prev) => {
      const next = {
        ...prev,
        [name]: value,
      }
      if (name === 'diameter' || name === 'thickness' || name === 'length') {
        const autoTons = calculatePipeTonnage(next.diameter, next.thickness, next.length)
        next.tonnage = autoTons !== null ? String(autoTons) : ''
      }
      return next
    })
  }

  const handleSave = async (record) => {
    const rowId = record.id || record.sensorEventId
    if (savingIdsRef.current.has(rowId)) return
    savingIdsRef.current.add(rowId)
    setSavingRecordIds((prev) => new Set(prev).add(rowId))
    const sessionGeneration = getSessionGeneration()
    const identity = identityRef.current
    const isCurrentSession = () => mountedRef.current && identityRef.current === identity && sessionGeneration === getSessionGeneration()
    const savedEditForm = { ...editForm }
    setEditingRecordId(null)
    setError(null)

    const newCustomer = editForm.customer?.trim() || null
    const newDiameter = editForm.diameter === '' || editForm.diameter === null ? null : Number(editForm.diameter)
    const newThickness = editForm.thickness === '' || editForm.thickness === null ? null : Number(editForm.thickness)
    const newLength = editForm.length === '' || editForm.length === null ? null : Number(editForm.length)
    const newPipeNumber =
      editForm.pipeNumber === '' || editForm.pipeNumber === null ? null : parseInt(editForm.pipeNumber, 10)
    const rawManualTonnage =
      editForm.tonnage === '' || editForm.tonnage === null || editForm.tonnage === undefined
        ? null
        : Number(editForm.tonnage)
    const manualTonnage =
      rawManualTonnage !== null && Number.isFinite(rawManualTonnage) && rawManualTonnage > 0
        ? Math.round(rawManualTonnage * 10000) / 10000
        : null
    const newTonnage = manualTonnage ?? calculatePipeTonnage(newDiameter, newThickness, newLength)

    const isNowSpecified = Boolean(
      newCustomer ||
        newDiameter != null ||
        newThickness != null ||
        newLength != null ||
        newPipeNumber != null ||
        newTonnage != null,
    )
    const wasSpecified = Boolean(record.isSpecified)
    const specifiedDelta = !wasSpecified && isNowSpecified ? 1 : wasSpecified && !isNowSpecified ? -1 : 0

    void queryClient.cancelQueries({ queryKey, exact: true })
    setRecords((prev) =>
      prev.map((r) => {
        if ((r.id || r.sensorEventId) === rowId) {
          return {
            ...r,
            customer: newCustomer,
            diameter: newDiameter,
            thickness: newThickness,
            length: newLength,
            pipeNumber: newPipeNumber,
            tonnage: newTonnage,
            isSpecified: isNowSpecified,
            specStatus: isNowSpecified ? 'specified' : 'unspecified',
          }
        }
        return r
      }),
    )

    const prevRecordTonnage = record.tonnage != null && Number.isFinite(Number(record.tonnage)) ? Number(record.tonnage) : 0
    const tonnageDelta = (newTonnage ?? 0) - prevRecordTonnage
    applySummaryDelta(setSummary, specifiedDelta, tonnageDelta)

    setFlashingRecordId(rowId)
    if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current)
    flashTimeoutRef.current = setTimeout(() => {
      setFlashingRecordId(null)
    }, 500)

    const payload = {
      customer: newCustomer,
      diameter: newDiameter,
      thickness: newThickness,
      length: newLength,
      pipeNumber: newPipeNumber,
      tonnage: newTonnage,
    }

    const rollbackRow = () => {
      setRecords((prev) => prev.map((r) => ((r.id || r.sensorEventId) === rowId ? record : r)))
      applySummaryDelta(setSummary, -specifiedDelta, -tonnageDelta)
    }

    try {
      const response = await updateFn(
        token,
        rowId,
        payload,
        record.updatedAt,
      )
      if (sessionGeneration === getSessionGeneration()) {
        invalidateProductionDependents(queryClient)
      }
      if (!isCurrentSession()) return

      if (response?.spec) {
        setRecords((prev) =>
          prev.map((r) => {
            if ((r.id || r.sensorEventId) === rowId) {
              const updatedDiameter = response.spec.diameter != null ? Number(response.spec.diameter) : newDiameter
              const updatedThickness = response.spec.thickness != null ? Number(response.spec.thickness) : newThickness
              const updatedLength = response.spec.length != null ? Number(response.spec.length) : newLength
              const updatedPipeNumber =
                response.spec.pipe_number != null
                  ? Number(response.spec.pipe_number)
                  : response.spec.pipeNumber != null
                    ? Number(response.spec.pipeNumber)
                    : newPipeNumber
              const updatedTonnage =
                response.spec.tonnage != null
                  ? Number(response.spec.tonnage)
                  : (newTonnage ?? calculatePipeTonnage(updatedDiameter, updatedThickness, updatedLength))
              return {
                ...r,
                customer: response.spec.customer ?? newCustomer,
                diameter: updatedDiameter,
                thickness: updatedThickness,
                length: updatedLength,
                pipeNumber: updatedPipeNumber,
                tonnage: updatedTonnage,
                updatedAt: response.spec.updatedAt || response.spec.updated_at || r.updatedAt,
              }
            }
            return r
          }),
        )
      }
      if (isNowSpecified) {
        lastSavedSpecRef.current = {
          customer: response?.spec?.customer ?? newCustomer ?? '',
          diameter: response?.spec?.diameter != null ? Number(response.spec.diameter) : newDiameter,
          thickness: response?.spec?.thickness != null ? Number(response.spec.thickness) : newThickness,
          length: response?.spec?.length != null ? Number(response.spec.length) : newLength,
          tonnage:
            response?.spec?.tonnage != null
              ? Number(response.spec.tonnage)
              : newTonnage,
        }
      }
      setAnnouncement(`Specification updated for cut at ${record.recordedAt || record.timestamp}.`)
    } catch (err) {
      if (!isCurrentSession()) {
        if (sessionGeneration === getSessionGeneration()) {
          void queryClient.invalidateQueries({ queryKey: queryKeys.production.all })
        }
        return
      }
      const isConflict =
        err?.status === 409 ||
        err?.code === 'PRODUCTION_SPEC_CONFLICT' ||
        (err?.message && /modified by another user/i.test(err.message))

      if (isConflict) {
        rollbackRow()
        setConflictNotice('Production specification was modified by another user.')
        onRefetch({ silent: true })
      } else {
        rollbackRow()
        setEditingRecordId(rowId)
        setEditForm(savedEditForm)
        setError(err.message || 'Unable to update production specification.')
      }
    } finally {
      savingIdsRef.current.delete(rowId)
      if (mountedRef.current) {
        setSavingRecordIds((prev) => {
          if (!prev.has(rowId)) return prev
          const next = new Set(prev)
          next.delete(rowId)
          return next
        })
      }
    }
  }

  const handleInputKeyDown = (e, record) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSave(record)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      handleCancel()
    }
  }

  return {
    bulkForm,
    editForm,
    editingRecordId,
    flashingRecordId,
    flashingRecordIds,
    handleBulkApplyClick,
    handleBulkCustomerChange,
    handleBulkDimensionChange,
    handleBulkKeyDown,
    handleBulkTonnageChange,
    handleCancel,
    handleConfirmBulkApply,
    handleInputChange,
    handleInputKeyDown,
    handleRepeatLastSpec,
    handleSave,
    handleStartEdit,
    isApplyingBulk,
    isConfirmingBulk,
    resetBulkConfirm,
    savingRecordIds,
  }
}
