import { createContext, useCallback, useContext, useRef, useState } from 'react'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import { useExitPresence } from '../../hooks/useExitPresence.js'

const PopoverPresenceContext = createContext(null)

function mergeRefs(...refs) {
  return (node) => {
    for (const ref of refs) {
      if (typeof ref === 'function') {
        ref(node)
      } else if (ref && typeof ref === 'object') {
        ref.current = node
      }
    }
  }
}

export function Popover({ open, defaultOpen = false, onOpenChange, ...props }) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen)
  const resolvedOpen = open !== undefined ? open : internalOpen

  const handleOpenChange = useCallback((nextOpen) => {
    if (open === undefined) {
      setInternalOpen(nextOpen)
    }
    onOpenChange?.(nextOpen)
  }, [onOpenChange, open])

  return (
    <PopoverPresenceContext.Provider value={resolvedOpen}>
      <PopoverPrimitive.Root
        data-slot="popover"
        open={open}
        defaultOpen={open === undefined ? defaultOpen : undefined}
        onOpenChange={handleOpenChange}
        {...props}
      />
    </PopoverPresenceContext.Provider>
  )
}

export function PopoverTrigger(props) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

export function PopoverContent({ className = '', align = 'end', sideOffset = 8, onAnimationEnd, ref, ...props }) {
  const contextOpen = useContext(PopoverPresenceContext)
  const isManaged = contextOpen !== null
  const isOpen = isManaged ? contextOpen : true
  const contentRef = useRef(null)
  const { isPresent, isExiting, handleAnimationEnd } = useExitPresence(isOpen, contentRef, 150)

  if (isManaged && !isPresent) {
    return null
  }

  return (
    <PopoverPrimitive.Portal forceMount={isManaged ? true : undefined}>
      <PopoverPrimitive.Content
        ref={mergeRefs(ref, contentRef)}
        forceMount={isManaged ? true : undefined}
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        collisionPadding={12}
        inert={isExiting || undefined}
        onAnimationEnd={(event) => {
          onAnimationEnd?.(event)
          handleAnimationEnd(event)
        }}
        className={`shadcn-calendar-popover ${className}`.trim()}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
}
