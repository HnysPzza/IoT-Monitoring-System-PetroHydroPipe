import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

/** Keeps an overlay mounted until its CSS exit animation finishes when styles define one. */
export function useExitPresence(isOpen, elementRef, fallbackDurationMs = 150) {
  const [isPresent, setIsPresent] = useState(Boolean(isOpen))
  const timeoutRef = useRef(null)

  const clearExitTimer = useCallback(() => {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }, [])

  useLayoutEffect(() => {
    clearExitTimer()

    if (isOpen) {
      setIsPresent(true)
      return undefined
    }

    if (!isPresent) {
      return undefined
    }

    const node = elementRef.current
    const computedStyle = node && typeof window !== 'undefined' && typeof window.getComputedStyle === 'function'
      ? window.getComputedStyle(node)
      : null
    const animationName = computedStyle?.animationName || ''
    const animationDuration = parseFloat(computedStyle?.animationDuration || '0')

    // Unmount immediately in JSDOM or unstyled elements where no CSS exit keyframe runs.
    if (!node || !animationName || animationName === 'none' || !Number.isFinite(animationDuration) || animationDuration <= 0) {
      setIsPresent(false)
      return undefined
    }

    const timeoutMs = Math.max(Math.ceil(animationDuration * 1000) + 40, fallbackDurationMs)
    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null
      setIsPresent(false)
    }, timeoutMs)

    return clearExitTimer
  }, [clearExitTimer, elementRef, fallbackDurationMs, isOpen, isPresent])

  useEffect(() => clearExitTimer, [clearExitTimer])

  const handleAnimationEnd = useCallback((event) => {
    if (isOpen || event.target !== event.currentTarget) return
    clearExitTimer()
    setIsPresent(false)
  }, [clearExitTimer, isOpen])

  return {
    isPresent: Boolean(isOpen || isPresent),
    isExiting: Boolean(!isOpen && isPresent),
    handleAnimationEnd,
  }
}
