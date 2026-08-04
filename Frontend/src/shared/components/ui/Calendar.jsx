import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { DayPicker, getDefaultClassNames } from 'react-day-picker'

export function Calendar({
  className = '',
  classNames = {},
  showOutsideDays = true,
  captionLayout = 'label',
  components = {},
  formatters,
  ...props
}) {
  const defaultClassNames = getDefaultClassNames()

  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      captionLayout={captionLayout}
      className={`shadcn-calendar ${className}`.trim()}
      formatters={{
        formatMonthDropdown: (date) => date.toLocaleString('en-PH', { month: 'short' }),
        ...formatters,
      }}
      classNames={{
        root: `${defaultClassNames.root} shadcn-calendar-root`,
        months: 'shadcn-calendar-months',
        month: 'shadcn-calendar-month',
        month_caption: 'shadcn-calendar-caption',
        caption_label: 'shadcn-calendar-caption-label',
        dropdowns: 'shadcn-calendar-dropdowns',
        dropdown_root: 'shadcn-calendar-dropdown-root',
        dropdown: 'shadcn-calendar-dropdown',
        nav: 'shadcn-calendar-nav',
        button_previous: 'shadcn-calendar-nav-button',
        button_next: 'shadcn-calendar-nav-button',
        month_grid: 'shadcn-calendar-grid',
        weekdays: 'shadcn-calendar-weekdays',
        weekday: 'shadcn-calendar-weekday',
        week: 'shadcn-calendar-week',
        day: 'shadcn-calendar-day',
        day_button: 'shadcn-calendar-day-button',
        selected: 'is-selected',
        today: 'is-today',
        outside: 'is-outside',
        disabled: 'is-disabled',
        hidden: 'is-hidden',
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation, ...chevronProps }) => {
          if (orientation === 'left') {
            return <ChevronLeft size={16} aria-hidden="true" {...chevronProps} />
          }

          if (orientation === 'right') {
            return <ChevronRight size={16} aria-hidden="true" {...chevronProps} />
          }

          return <ChevronDown size={16} aria-hidden="true" {...chevronProps} />
        },
        ...components,
      }}
      {...props}
    />
  )
}
