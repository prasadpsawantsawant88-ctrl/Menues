import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import Kiosk from './pages/Kiosk.jsx'
import { StoreProvider } from './lib/store.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <StoreProvider>
      <Kiosk />
    </StoreProvider>
  </StrictMode>,
)
