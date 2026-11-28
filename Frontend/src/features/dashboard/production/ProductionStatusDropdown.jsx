import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'

export default function ProductionStatusDropdown({
  id,
  label,
  value,
  options,
  onChange,
  isActive = false,
  disabled = false,
  title,
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(() =>
    Math.max(0, options.findIndex((opt) => opt.value === value)),
  )
  const containerRef = useRef(null)
  const triggerRef = useRef(null)

  const dropdownId = id || 'production-dropdown'
  const selectedOption = options.find((opt) => opt.value === value) || options[0]
  const highlightedOption = options[highlightedIndex] || selectedOption

  const openMenu = () => {
    if (disabled) return
    const activeIndex = options.findIndex((opt) => opt.value === value)
    setHighlightedIndex(activeIndex >= 0 ? activeIndex : 0)
    setIsOpen(true)
  }

  useEffect(() => {
    if (disabled && isOpen) {
      setIsOpen(false)
    }
  }, [disabled, isOpen])

  useEffect(() => {
    if (!isOpen) return undefined

    function handlePointerDown(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false)
      }
    }

    function handleKeyDown(e) {
      if (e.key === 'Escape') {
        e.preventDefault()
        setIsOpen(false)
        triggerRef.current?.focus()
      } else if (e.key === 'Tab') {
        setIsOpen(false)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  const handleTriggerKeyDown = (e) => {
    if (disabled) return
    if (e.key === 'Escape') {
      if (isOpen) {
        e.preventDefault()
        setIsOpen(false)
      }
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!isOpen) {
        openMenu()
      } else {
        setHighlightedIndex((prev) =>
          e.key === 'ArrowDown'
            ? (prev + 1) % options.length
            : (prev - 1 + options.length) % options.length,
        )
      }
    } else if (e.key === 'Home' && isOpen) {
      e.preventDefault()
      setHighlightedIndex(0)
    } else if (e.key === 'End' && isOpen) {
      e.preventDefault()
      setHighlightedIndex(options.length - 1)
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      if (!isOpen) {
        openMenu()
      } else {
        if (highlightedOption) {
          onChange(highlightedOption.value)
        }
        setIsOpen(false)
        triggerRef.current?.focus()
      }
    }
  }

  return (
    <div className="production-dropdown-container" ref={containerRef}>
      <button
        ref={triggerRef}
        type="button"
        id={id}
        className={`production-dropdown-trigger ${isActive ? 'production-filter-btn-active' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={!disabled && isOpen}
        aria-activedescendant={
          !disabled && isOpen && highlightedOption ? `${dropdownId}-opt-${highlightedOption.value}` : undefined
        }
        aria-label={label}
        disabled={disabled}
        title={title}
        onClick={() => {
          if (disabled) return
          if (isOpen) setIsOpen(false)
          else openMenu()
        }}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className="production-dropdown-trigger-label">{selectedOption.label}</span>
        <ChevronDown size={14} strokeWidth={2} className={`production-dropdown-chevron ${!disabled && isOpen ? 'open' : ''}`} aria-hidden="true" />
      </button>

      {!disabled && isOpen && (
        <ul
          className="production-dropdown-popover"
          role="listbox"
          aria-label={label}
        >
          {options.map((option, index) => {
            const isSelected = option.value === value
            const isHighlighted = index === highlightedIndex
            return (
              <li
                key={option.value}
                id={`${dropdownId}-opt-${option.value}`}
                role="option"
                aria-selected={isSelected}
                className={`production-dropdown-item ${isSelected ? 'selected' : ''} ${isHighlighted ? 'highlighted' : ''}`.trim()}
                onMouseEnter={() => setHighlightedIndex(index)}
                onClick={() => {
                  onChange(option.value)
                  setIsOpen(false)
                  triggerRef.current?.focus()
                }}
              >
                <span>{option.label}</span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
