import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // server: {
  //   host: '192.168.100.10', // <-- your desired IP
  //   port: 5173,             // optional, defaults to 5173
  //   strictPort: true        // optional, prevents Vite from picking another port if 5173 is busy
  // }
})

