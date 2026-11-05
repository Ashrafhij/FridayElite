import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // GitHub Pages serves the site from a sub-path (e.g. /FridayElite/).
  // Change this to '/' if you use a custom domain.
  base: '/FridayElite/',
})
