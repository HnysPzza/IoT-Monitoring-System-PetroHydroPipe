import { useEffect, useRef } from 'react'
import { Check, Pencil, X } from 'lucide-react'
import Status from '../../../shared/components/Status.jsx'
import { formatDimension, formatManilaDateTime, formatTonnage } from './productionUtils.js'

export default function ProductionTable({
  records,
  canEdit,
  isHeaderChecked,
  isHeaderIndeterminate,
  isHeaderDisabled,
  selectedIds,
  editingRecordId,
  editForm,
  savingRecordIds,
  flashingRecordId,
  flashingRecordIds,
  onSelectAllToggle,
  onRowCheckboxClick,
  onInputChange,
  onInputKeyDown,
  onStartEdit,
  onSave,
  onCancel,
}) {
  const headerCheckboxRef = useRef(null)

  useEffect(() => {
    if (headerCheckboxRef.current) {
      headerCheckboxRef.current.indeterminate = isHeaderIndeterminate
    }
  }, [isHeaderIndeterminate])

  return (
    <div className="production-table-container">
      <table className="production-table" aria-label="Production Cuts Table">
        <thead>
          <tr>
            {canEdit && (
              <th className="production-col-select">
                <input
                  type="checkbox"
                  ref={headerCheckboxRef}
                  className="production-checkbox"
                  checked={isHeaderChecked}
                  disabled={isHeaderDisabled}
                  onChange={onSelectAllToggle}
                  aria-label="Select all cuts on this page"
                  title="Select all unfilled cuts on this page"
                />
              </th>
            )}
            <th className="production-col-status">Status</th>
            <th>Cut Time</th>
            <th>Customer</th>
            <th className="production-col-num tabular-data">Diameter (OD mm)</th>
            <th className="production-col-num tabular-data">Thickness (mm)</th>
            <th className="production-col-num tabular-data">Length (mm)</th>
            <th className="production-col-num tabular-data">Pipe #</th>
            <th className="production-col-num tabular-data">Tons</th>
            {canEdit && <th className="production-col-action">Action</th>}
          </tr>
        </thead>
        <tbody>
          {records.length === 0 ? (
            <tr>
              <td colSpan={canEdit ? 10 : 8} className="production-empty-state">
                No production records found for the selected filters.
              </td>
            </tr>
          ) : (
            records.map((record, index) => {
              const rowId = record.id || record.sensorEventId
              const isAccepted = Boolean(record.outputAccepted)
              const isSpec = Boolean(record.isSpecified)
              const isEditing = editingRecordId === rowId
              const isRowSaving = savingRecordIds.has(rowId)
              const isFlashing = flashingRecordId === rowId || flashingRecordIds.has(rowId)
              const isSelected = selectedIds.has(rowId)

              const rowClasses = []
              if (isSelected) rowClasses.push('production-row-selected')
              if (isEditing) rowClasses.push('production-row-editing')
              if (isFlashing) rowClasses.push('production-row-flash')
              const rowClass = rowClasses.join(' ')

              const statusBadge = !isAccepted
                ? <Status tone="danger" title={record.rejectionReason || 'Rejected pulse'}>Rejected</Status>
                : <Status tone={isSpec ? 'active' : 'fault'} title={isSpec ? 'Accepted · Specified' : 'Accepted · Needs details'}>{isSpec ? 'Specified' : 'Needs details'}</Status>
              const formattedCutTime = formatManilaDateTime(record.recordedAt || record.timestamp)

              return (
                <tr key={rowId} className={rowClass || undefined}>
                  {canEdit && (
                    <td className="production-col-select" data-label="Select">
                      <input
                        type="checkbox"
                        className="production-checkbox"
                        checked={isSelected}
                        disabled={!isAccepted}
                        onChange={() => {}}
                        onClick={(e) => onRowCheckboxClick(e, record, index)}
                        aria-label={`Select cut at ${record.recordedAt || record.timestamp}`}
                      />
                    </td>
                  )}
                  <td className="production-col-status" data-label="Status">
                    <div className="production-status-cell">{statusBadge}</div>
                  </td>
                  <td className="production-col-timestamp tabular-data" data-label="Cut Time">
                    {formattedCutTime === '—' ? (
                      <span className="production-placeholder">—</span>
                    ) : (
                      formattedCutTime
                    )}
                  </td>
                  {isEditing ? (
                    <>
                      <td data-label="Customer">
                        <input
                          type="text"
                          className="production-inline-input"
                          aria-label="Specification customer"
                          name="customer"
                          value={editForm.customer}
                          maxLength={100}
                          autoFocus
                          onChange={onInputChange}
                          onKeyDown={(e) => onInputKeyDown(e, record)}
                        />
                      </td>
                      <td className="production-col-num tabular-data" data-label="Diameter (OD mm)">
                        <input
                          type="number"
                          inputMode="decimal"
                          className="production-inline-input production-inline-num tabular-data"
                          aria-label="Specification diameter"
                          name="diameter"
                          step="any"
                          min="0"
                          value={editForm.diameter}
                          onChange={onInputChange}
                          onKeyDown={(e) => onInputKeyDown(e, record)}
                        />
                      </td>
                      <td className="production-col-num tabular-data" data-label="Thickness (mm)">
                        <input
                          type="number"
                          inputMode="decimal"
                          className="production-inline-input production-inline-num tabular-data"
                          aria-label="Specification thickness"
                          name="thickness"
                          step="any"
                          min="0"
                          value={editForm.thickness}
                          onChange={onInputChange}
                          onKeyDown={(e) => onInputKeyDown(e, record)}
                        />
                      </td>
                      <td className="production-col-num tabular-data" data-label="Length (mm)">
                        <input
                          type="number"
                          inputMode="decimal"
                          className="production-inline-input production-inline-num tabular-data"
                          aria-label="Specification length"
                          name="length"
                          step="any"
                          min="0"
                          value={editForm.length}
                          onChange={onInputChange}
                          onKeyDown={(e) => onInputKeyDown(e, record)}
                        />
                      </td>
                      <td className="production-col-num tabular-data" data-label="Pipe #">
                        <input
                          type="number"
                          inputMode="numeric"
                          className="production-inline-input production-inline-num tabular-data"
                          aria-label="Specification pipe number"
                          name="pipeNumber"
                          step="1"
                          min="1"
                          value={editForm.pipeNumber}
                          onChange={onInputChange}
                          onKeyDown={(e) => onInputKeyDown(e, record)}
                        />
                      </td>
                      <td className="production-col-num tabular-data" data-label="Tons">
                        <input
                          type="number"
                          inputMode="decimal"
                          className="production-inline-input production-inline-num tabular-data"
                          aria-label="Specification tonnage"
                          name="tonnage"
                          step="0.0001"
                          min="0"
                          value={editForm.tonnage}
                          onChange={onInputChange}
                          onKeyDown={(e) => onInputKeyDown(e, record)}
                        />
                      </td>
                    </>
                  ) : (
                    <>
                      <td data-label="Customer">{record.customer || <span className="production-placeholder">—</span>}</td>
                      <td className="production-col-num tabular-data" data-label="Diameter (OD mm)">
                        {record.diameter !== null && record.diameter !== undefined ? (
                          formatDimension(record.diameter)
                        ) : (
                          <span className="production-placeholder">—</span>
                        )}
                      </td>
                      <td className="production-col-num tabular-data" data-label="Thickness (mm)">
                        {record.thickness !== null && record.thickness !== undefined ? (
                          formatDimension(record.thickness)
                        ) : (
                          <span className="production-placeholder">—</span>
                        )}
                      </td>
                      <td className="production-col-num tabular-data" data-label="Length (mm)">
                        {record.length !== null && record.length !== undefined ? (
                          formatDimension(record.length)
                        ) : (
                          <span className="production-placeholder">—</span>
                        )}
                      </td>
                      <td className="production-col-num tabular-data" data-label="Pipe #">
                        {record.pipeNumber !== null && record.pipeNumber !== undefined ? (
                          record.pipeNumber
                        ) : (
                          <span className="production-placeholder">—</span>
                        )}
                      </td>
                      <td className="production-col-num tabular-data" data-label="Tons">
                        {record.tonnage !== null && record.tonnage !== undefined ? (
                          formatTonnage(record.tonnage)
                        ) : (
                          <span className="production-placeholder">—</span>
                        )}
                      </td>
                    </>
                  )}
                  {canEdit && (
                    <td className="production-col-action" data-label="Action">
                      {isEditing ? (
                        <div className="production-inline-actions">
                          <button
                            type="button"
                            className="production-action-btn production-save-btn"
                            aria-label="Save specification"
                            title="Save specification"
                            disabled={isRowSaving}
                            onClick={() => onSave(record)}
                          >
                            <Check size={15} strokeWidth={2} aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            className="production-action-btn production-cancel-btn"
                            aria-label="Cancel editing"
                            title="Cancel editing"
                            disabled={isRowSaving}
                            onClick={onCancel}
                          >
                            <X size={15} strokeWidth={2} aria-hidden="true" />
                          </button>
                        </div>
                      ) : isAccepted ? (
                        <button
                          type="button"
                          className="production-action-btn"
                          aria-label="Edit specification"
                          title="Edit specification"
                          disabled={isRowSaving}
                          onClick={() => onStartEdit(record)}
                        >
                          <Pencil size={14} strokeWidth={1.75} aria-hidden="true" />
                        </button>
                      ) : null}
                    </td>
                  )}
                </tr>
              )
            })
          )}
        </tbody>
      </table>
    </div>
  )
}
