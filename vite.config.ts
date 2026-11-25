import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwind()],
  clearScreen: false,
  envPrefix: ['VITE_'],
  server: { watch: { ignored: ['**/src-tauri/**'] } },
  // Both native entry points use the stylesheet linked by index.html.
  build: { target: 'es2022', assetsInlineLimit: 0, cssCodeSplit: false },
})
