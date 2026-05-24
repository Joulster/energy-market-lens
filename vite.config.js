import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

const isDev = process.env.NODE_ENV !== 'production'

export default defineConfig({
  root: __dirname,
  plugins: [react()],
  server: {
    port: 5173,
    ...(isDev && {
      proxy: {
        '/api': {
          target: 'http://localhost:3001',
          changeOrigin: true,
        },
      },
    }),
  },
})
