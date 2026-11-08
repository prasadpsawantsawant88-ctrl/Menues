import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// The kiosk is its own page (kiosk.html) so it can be installed as a separate app.
const kioskRoutes = {
  name: 'kiosk-routes',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      if (req.url && /^\/kiosk(\/|\?|$)/.test(req.url)) req.url = '/kiosk.html'
      next()
    })
  },
}

export default defineConfig({
  plugins: [react(), tailwindcss(), kioskRoutes],
  server: { host: true, port: 5170, proxy: { '/api': 'http://localhost:5173' } },
  build: { rollupOptions: { input: { main: 'index.html', kiosk: 'kiosk.html' } } },
})
