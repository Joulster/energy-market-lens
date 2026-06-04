import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  root: __dirname,
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api':              { target: 'http://localhost:3001', changeOrigin: true },
      '/auth/magic-link':  { target: 'http://localhost:3001', changeOrigin: true },
      '/auth/verify-code': { target: 'http://localhost:3001', changeOrigin: true },
      '/auth/callback':    { target: 'http://localhost:3001', changeOrigin: true },
      '/auth/logout':      { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
})
