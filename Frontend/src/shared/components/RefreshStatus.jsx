import './RefreshStatus.css'

export default function RefreshStatus({ active, isPlaceholder, message, placeholderMessage }) {
  return (
    <div className="refresh-status-slot" data-message={message} data-placeholder={placeholderMessage}>
      <span role={active ? 'status' : undefined} aria-live="polite">
        {active ? (isPlaceholder ? placeholderMessage : message) : ''}
      </span>
    </div>
  )
}
