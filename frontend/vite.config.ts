import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

const proxy = {
  '/telemetry-ws': { target: 'ws://127.0.0.1:8080', ws: true },
  '/api': { target: 'http://127.0.0.1:8080' },
}

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy,
  },
  preview: { host: '0.0.0.0', port: 5173, proxy },
})
