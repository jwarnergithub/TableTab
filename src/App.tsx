import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Link, Route, Routes } from 'react-router-dom'
import { APP_NAME } from './lib/constants'
import BoardPage from './pages/BoardPage'
import PayPage from './pages/PayPage'

type ErrorBoundaryProps = {
  children: ReactNode
}

type ErrorBoundaryState = {
  error: Error | null
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    error: null,
  }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(error, errorInfo)
  }

  render() {
    if (this.state.error) {
      return (
        <section className="ston-panel p-5 text-red-100">
          <p className="text-sm font-bold uppercase">Something crashed</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-normal">
            TableTab hit a page error.
          </h1>
          <p className="mt-3 text-sm">
            Try Reset Demo on the tablet page, or refresh and scan a fresh QR.
          </p>
          <pre className="ston-card-muted mt-4 overflow-auto p-3 text-xs">
            {this.state.error.message}
          </pre>
        </section>
      )
    }

    return this.props.children
  }
}

function App() {
  return (
    <div className="ston-shell">
      <header className="ston-header">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Link to="/" className="ston-brand text-3xl font-black tracking-normal">
            <span>{APP_NAME}</span>
            <img
              src="/icon-192.png"
              alt=""
              className="h-10 w-10 rounded-lg object-cover shadow-[0_0_18px_rgba(57,245,236,0.42)]"
            />
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <ErrorBoundary>
          <Routes>
            <Route path="/" element={<BoardPage />} />
            <Route path="/pay" element={<PayPage />} />
          </Routes>
        </ErrorBoundary>
      </main>
    </div>
  )
}

export default App
