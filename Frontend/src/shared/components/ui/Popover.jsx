import { Popover as PopoverPrimitive } from 'radix-ui'

export function Popover(props) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />
}

export function PopoverTrigger(props) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

export function PopoverContent({ className = '', align = 'end', sideOffset = 8, ...props }) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        collisionPadding={12}
        className={`shadcn-calendar-popover ${className}`.trim()}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
}

