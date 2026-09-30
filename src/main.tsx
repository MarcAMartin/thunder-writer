import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { hasGoogleDrive } from './features/storage/googleConfig'
import './styles/theme.css'

if (import.meta.env.DEV && !hasGoogleDrive()) {
  // For whoever runs this copy, never for writers: without the project's values the app simply has no Drive.
  console.info('[thunder-writer] Google Drive is off: VITE_GOOGLE_CLIENT_ID is not set (see .env.example and tech_notes.md → Google Cloud setup).')
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
