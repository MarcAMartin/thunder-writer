import { afterEach, describe, expect, it, vi } from 'vitest'
import { googleApiKey, googleClientId, googleProjectNumber, projectNumberFromClientId } from './googleConfig'

describe('googleConfig (the deployment’s Google Cloud project)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('reads the client id and Picker key from the build, trimmed', () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', ' 42-a.apps.googleusercontent.com ')
    vi.stubEnv('VITE_GOOGLE_API_KEY', ' AIza-build ')
    expect(googleClientId()).toBe('42-a.apps.googleusercontent.com')
    expect(googleApiKey()).toBe('AIza-build')
  })

  it('is empty in a build without Google Drive', () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', '')
    vi.stubEnv('VITE_GOOGLE_API_KEY', '')
    vi.stubEnv('VITE_GOOGLE_PROJECT_NUMBER', '')
    expect(googleClientId()).toBe('')
    expect(googleApiKey()).toBe('')
    expect(googleProjectNumber()).toBe('')
  })

  it('derives the project number from the client id, unless the build overrides it', () => {
    expect(projectNumberFromClientId('698829428298-xxxx.apps.googleusercontent.com')).toBe('698829428298')
    expect(projectNumberFromClientId(' 42-a.apps.googleusercontent.com ')).toBe('42')
    expect(projectNumberFromClientId('not-a-number.apps.googleusercontent.com')).toBe('')
    expect(projectNumberFromClientId('')).toBe('')

    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', '698829428298-xxxx.apps.googleusercontent.com')
    vi.stubEnv('VITE_GOOGLE_PROJECT_NUMBER', '')
    expect(googleProjectNumber()).toBe('698829428298')
    vi.stubEnv('VITE_GOOGLE_PROJECT_NUMBER', ' 111 ')
    expect(googleProjectNumber()).toBe('111')
  })
})
