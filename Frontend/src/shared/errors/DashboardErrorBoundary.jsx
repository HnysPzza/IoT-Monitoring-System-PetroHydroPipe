import { Component, createRef } from 'react'
import { Link } from 'react-router'
import ServerErrorPage from './ServerErrorPage.jsx'

export function reloadDashboardPage() {
  window.location.reload()
}

export default class DashboardErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
    this.errorRef = createRef()
    this.handleNavigateHome = this.handleNavigateHome.bind(this)
  }

  static getDerivedStateFromError(error) {
    const offlineChunk = !navigator.onLine && /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed/i.test(error?.message || '')
    return { hasError: true, offlineChunk }
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

  handleNavigateHome() {
    if (this.state.hasError) {
      this.setState({ hasError: false })
    }
  }

  render() {
    if (!this.state.hasError) return this.props.children

    const reloadPage = this.props.reloadPage || reloadDashboardPage

    if (this.state.offlineChunk) {
      return (
        <section className="section-card section-placeholder" role="alert" tabIndex={-1} ref={this.errorRef}>
          <h1>Page unavailable offline</h1>
          <p>Reconnect to the internet, then try again.</p>
          <button className="btn btn-secondary" type="button" onClick={reloadPage}>Try again</button>
          <Link className="btn btn-secondary" to="/dashboard" onClick={this.handleNavigateHome}>Back to dashboard</Link>
        </section>
      )
    }

    return (
      <ServerErrorPage
        shellRef={this.errorRef}
        role="alert"
        tabIndex={-1}
        onRetry={reloadPage}
        onNavigateHome={this.handleNavigateHome}
      />
    )
  }
}
