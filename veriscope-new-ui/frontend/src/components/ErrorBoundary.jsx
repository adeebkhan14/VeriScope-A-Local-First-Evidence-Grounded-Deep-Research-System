import { Component } from 'react'

/**
 * Contains render errors (for example from model-generated Markdown) so one
 * bad message cannot blank the whole app. `fallback` receives the error and a reset function.
 */
export default class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error) {
    console.error('[VeriScope] Render error:', error)
  }

  componentDidUpdate(previousProps) {
    // A new resetKey (e.g. new message content) gets another chance to render.
    if (this.state.error && previousProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null })
    }
  }

  render() {
    if (this.state.error) {
      return this.props.fallback(this.state.error, () => this.setState({ error: null }))
    }
    return this.props.children
  }
}
