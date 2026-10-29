import { Component, createRef } from 'react'
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

  handleNavigateHome() {
    if (this.state.hasError) {
      this.setState({ hasError: false })
    }
  }

  render() {
    if (!this.state.hasError) return this.props.children

    const reloadPage = this.props.reloadPage || reloadDashboardPage

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
