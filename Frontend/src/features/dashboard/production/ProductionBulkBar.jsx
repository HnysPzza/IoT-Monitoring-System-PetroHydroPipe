import { useEffect, useRef } from 'react'
import { Check, Copy, X } from 'lucide-react'

export default function ProductionBulkBar({
  selectedCount,
  bulkForm,
  isConfirmingBulk,
  isApplyingBulk,
  onDeselectAll,
  onCustomerChange,
  onDimensionChange,
  onTonnageChange,
  onKeyDown,
  onRepeatLastSpec,
  onApplyClick,
  onConfirmApply,
  onCancelConfirm,
}) {
  const bulkConfirmRef = useRef(null)

  useEffect(() => {
    if (isConfirmingBulk && bulkConfirmRef.current) {
      bulkConfirmRef.current.focus()
    }
  }, [isConfirmingBulk])

  return (
    <section
      className="production-bulk-strip"
      role="region"
      aria-label="Bulk specification editor"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && isConfirmingBulk) {
          e.preventDefault()
          onCancelConfirm()
        }
      }}
    >
      <div className="production-bulk-header">
        <div className="production-bulk-indicator">
          <span className="production-bulk-count tabular-data">
            {selectedCount} {selectedCount === 1 ? 'cut' : 'cuts'} selected
          </span>
        </div>
        <button
          type="button"
          className="production-deselect-btn"
          onClick={onDeselectAll}
          aria-label="Deselect all cuts"
        >
          <X size={14} strokeWidth={1.75} aria-hidden="true" />
          <span>Deselect all</span>
        </button>
      </div>

      {isConfirmingBulk ? (
        <div ref={bulkConfirmRef} tabIndex={-1} className="production-bulk-confirmation" role="alert">
          <span>
            Apply specifications to {selectedCount} {selectedCount === 1 ? 'cut' : 'cuts'}? Blank fields will keep their current values.
          </span>
          <div className="production-confirm-buttons">
            <button
              type="button"
              className="production-bulk-apply-btn"
              onClick={onConfirmApply}
              disabled={isApplyingBulk}
            >
              {isApplyingBulk ? 'Applying...' : 'Confirm'}
            </button>
            <button
              type="button"
              className="production-tool-btn production-confirm-cancel-btn"
              onClick={onCancelConfirm}
              disabled={isApplyingBulk}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="production-bulk-fields">
          <input
            type="text"
            className="production-bulk-input"
            placeholder="Customer / Client"
            aria-label="Bulk customer"
            value={bulkForm.customer}
            maxLength={100}
            onChange={(e) => onCustomerChange(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <div className="dimension-input-wrapper production-dimension-wrapper">
            <input
              type="number"
              inputMode="decimal"
              placeholder="Diameter (OD)"
              aria-label="Bulk diameter"
              step="any"
              min="0"
              value={bulkForm.diameter}
              onChange={(e) => onDimensionChange('diameter', e.target.value)}
              onKeyDown={onKeyDown}
            />
            <span className="unit-suffix production-unit-badge" aria-hidden="true">mm</span>
          </div>
          <div className="dimension-input-wrapper production-dimension-wrapper">
            <input
              type="number"
              inputMode="decimal"
              placeholder="Thickness"
              aria-label="Bulk thickness"
              step="any"
              min="0"
              value={bulkForm.thickness}
              onChange={(e) => onDimensionChange('thickness', e.target.value)}
              onKeyDown={onKeyDown}
            />
            <span className="unit-suffix production-unit-badge" aria-hidden="true">mm</span>
          </div>
          <div className="dimension-input-wrapper production-dimension-wrapper">
            <input
              type="number"
              inputMode="decimal"
              placeholder="Length"
              aria-label="Bulk length"
              step="any"
              min="0"
              value={bulkForm.length}
              onChange={(e) => onDimensionChange('length', e.target.value)}
              onKeyDown={onKeyDown}
            />
            <span className="unit-suffix production-unit-badge" aria-hidden="true">mm</span>
          </div>
          <div className="dimension-input-wrapper production-dimension-wrapper">
            <input
              type="number"
              inputMode="decimal"
              placeholder="Tons"
              aria-label="Bulk tonnage"
              step="0.0001"
              min="0"
              value={bulkForm.tonnage}
              onChange={(e) => onTonnageChange(e.target.value)}
              onKeyDown={onKeyDown}
            />
            <span className="unit-suffix production-unit-badge" aria-hidden="true">t</span>
          </div>

          <div className="production-bulk-tools">
            <button
              type="button"
              className="production-tool-btn"
              title="Repeat last saved specification"
              aria-label="Repeat last saved specification"
              onClick={onRepeatLastSpec}
            >
              <Copy size={15} strokeWidth={1.75} aria-hidden="true" />
            </button>

            <button
              type="button"
              className="production-bulk-apply-btn"
              onClick={onApplyClick}
              disabled={isApplyingBulk}
            >
              <Check size={14} strokeWidth={2} aria-hidden="true" />
              <span>Apply to {selectedCount} {selectedCount === 1 ? 'cut' : 'cuts'}</span>
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
