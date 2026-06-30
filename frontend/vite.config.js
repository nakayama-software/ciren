import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Parse root .config (key=value, # comments, blank lines ignored)
function loadRootConfig() {
  try {
    const text = fs.readFileSync(path.resolve(__dirname, '../.config'), 'utf-8')
    const env = {}
    for (const line of text.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const idx = trimmed.indexOf('=')
      if (idx === -1) continue
      env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim()
    }
    return env
  } catch {
    console.warn('[vite] .config not found at repo root — using defaults')
    return {}
  }
}

const cfg = loadRootConfig()

// Build defineEnv: VITE_API_BASE always set; VITE_WS_URL only when explicitly configured
// When VITE_WS_URL is not set, the frontend auto-derives the WS URL from VITE_API_BASE
const apiBase = cfg.FRONTEND_API_BASE || 'http://localhost:3000'
const defineEnv = {
  'import.meta.env.VITE_API_BASE': JSON.stringify(apiBase),
}
if (cfg.FRONTEND_WS_URL) {
  defineEnv['import.meta.env.VITE_WS_URL'] = JSON.stringify(cfg.FRONTEND_WS_URL)
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  define: defineEnv,
  server: {
    host:  cfg.FRONTEND_DEV_HOST || 'localhost',
    port:  Number(cfg.FRONTEND_DEV_PORT) || 5173,
    proxy: {
      '/api': {
        target:      cfg.FRONTEND_PROXY_TARGET || 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: cfg.FRONTEND_DEV_HOST || 'localhost',
    port: Number(cfg.FRONTEND_PREVIEW_PORT) || 4173,
  },
})