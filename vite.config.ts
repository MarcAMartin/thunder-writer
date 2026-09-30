import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Word export/import load these with import() on first use. Pre-bundling them keeps the dev
  // server from discovering them mid-session and reloading the page (losing that save or import).
  optimizeDeps: { include: ['docx', 'mammoth'] },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
})
