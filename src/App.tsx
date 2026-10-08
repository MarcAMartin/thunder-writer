import { Navigate, Route, Routes } from 'react-router-dom'
import { useTheme } from './shell/useTheme'
import { HomePage } from './features/home/HomePage'
import { WriterPage } from './features/editor/WriterPage'
import { SettingsPage } from './features/settings/SettingsPage'
import { PrivacyPage } from './features/legal/PrivacyPage'
import { TermsPage } from './features/legal/TermsPage'
import { POLICY_PATH, PRIVACY_PATH, TERMS_PATH } from './features/home/routes'
import { StorageProvider } from './features/storage/StorageProvider'

export default function App() {
  useTheme()
  return (
    <StorageProvider>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/write" element={<WriterPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path={PRIVACY_PATH} element={<PrivacyPage />} />
        <Route path={POLICY_PATH} element={<Navigate to={PRIVACY_PATH} replace />} />
        <Route path={TERMS_PATH} element={<TermsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </StorageProvider>
  )
}
