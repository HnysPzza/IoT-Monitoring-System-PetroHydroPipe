import { Component, createRef } from 'react'

export function reloadDashboardPage() {
  window.location.reload()
}

export default class DashboardErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
    this.errorRef = createRef()
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch() {
    this.errorRef.current?.focus()
  }

  componentDidUpdate(previousProps, previousState) {
    if (previousProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false })
      return
    }

    if (!previousState.hasError && this.state.hasError) {
      this.errorRef.current?.focus()
    }
  }

  render() {
    if (!this.state.hasError) return this.props.children

    const reloadPage = this.props.reloadPage || reloadDashboardPage

    return (
      <main className="dashboard-error-page">
        <section
          ref={this.errorRef}
          className="section-card dashboard-error-card"
          role="alert"
          aria-labelledby="dashboard-error-title"
          tabIndex="-1"
        >
          <p className="section-eyebrow">Dashboard unavailable</p>
          <h1 id="dashboard-error-title">This dashboard section could not load</h1>
          <p>Reload the application to try again, or return to the dashboard overview.</p>
          <div className="dashboard-error-actions">
            <button className="btn btn-primary" type="button" onClick={reloadPage}>
              Try again
            </button>
            <a className="btn btn-secondary" href="/dashboard">
              Return to overview
            </a>
          </div>
        </section>
      </main>
    )
  }
}
