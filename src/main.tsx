import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Omniston, OmnistonProvider } from '@ston-fi/omniston-sdk-react'
import { TonConnectUIProvider } from '@tonconnect/ui-react'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { OMNISTON_API_URL } from './lib/constants.ts'

const manifestUrl = `${window.location.origin}/tonconnect-manifest.json`
const omniston = new Omniston({ apiUrl: OMNISTON_API_URL })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TonConnectUIProvider manifestUrl={manifestUrl}>
      <OmnistonProvider omniston={omniston}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </OmnistonProvider>
    </TonConnectUIProvider>
  </StrictMode>,
)
