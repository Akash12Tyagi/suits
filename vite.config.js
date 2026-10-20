import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // three.js lives in its own lazily loaded chunk (~165 kB gzip).
    chunkSizeWarningLimit: 700,
  },
})
