import { Navigate, Route, Routes } from 'react-router-dom'
import { useTheme } from './shell/useTheme'
import { HomePage } from './features/home/HomePage'
import { WriterPage } from './features/editor/WriterPage'
import { SettingsPage } from './features/settings/SettingsPage'
import { StorageProvider } from './features/storage/StorageProvider'

export default function App() {
  useTheme()
  return (
    <StorageProvider>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/write" element={<WriterPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </StorageProvider>
  )
}
