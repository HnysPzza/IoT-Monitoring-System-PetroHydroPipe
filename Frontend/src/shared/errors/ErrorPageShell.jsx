export default function ErrorPageShell({ titleId, visual, children }) {
  return (
    <section className="error-page" aria-labelledby={titleId}>
      <div className="error-page-sparks" aria-hidden="true">
        <span className="error-spark is-1" />
        <span className="error-spark is-2" />
        <span className="error-spark is-3" />
        <span className="error-spark is-4" />
        <span className="error-spark is-5" />
        <span className="error-spark is-6" />
        <span className="error-spark is-7" />
        <span className="error-spark is-8" />
      </div>

      <div className="error-page-shell">
        <header className="error-page-header">
          <img className="error-page-logo" src="/assets/logo.png" alt="PetroHydroPipe logo" />
          <span className="error-page-kicker">PETROHYDROPIPE</span>
        </header>

        <div className="error-page-body">
          <div className="error-state-copy">
            {children}
          </div>

          <div className="error-state-visual" aria-hidden="true">
            {visual}
          </div>
        </div>
      </div>
    </section>
  )
}
