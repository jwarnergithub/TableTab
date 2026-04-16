import { TonConnectButton } from '@tonconnect/ui-react'
import { Link, Route, Routes } from 'react-router-dom'
import { APP_NAME } from './lib/constants'
import BoardPage from './pages/BoardPage'
import PayPage from './pages/PayPage'

function App() {
  return (
    <div className="min-h-screen bg-stone-50 text-zinc-950">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Link to="/" className="text-xl font-semibold tracking-normal">
            {APP_NAME}
          </Link>
          <TonConnectButton />
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <Routes>
          <Route path="/" element={<BoardPage />} />
          <Route path="/pay" element={<PayPage />} />
        </Routes>
      </main>
    </div>
  )
}

export default App
