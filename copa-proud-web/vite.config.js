import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Sin service worker a propósito: en la app principal un SW cacheó versiones viejas (commit 822d846)
// y durante el torneo necesitamos que cada deploy llegue al instante.
export default defineConfig({
  plugins: [react()],
  test: {
    include: ['src/**/*.test.{js,jsx}'],
  },
})
