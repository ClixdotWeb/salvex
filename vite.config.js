import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    // Development only: send /api requests to the FastAPI backend (run it on port 8000).
    // /docs and /openapi.json: the backend's API test page, served from this same address so its
    // requests pass the backend's cross-site check (the backend only offers them in development).
    proxy: {
      '/api': 'http://127.0.0.1:8000',
      '/docs': 'http://127.0.0.1:8000',
      '/openapi.json': 'http://127.0.0.1:8000'
    }
  }
})
