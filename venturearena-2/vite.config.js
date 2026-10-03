import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The web app builds to dist/, which the Node server serves. In development
// Vite serves the app and proxies the API and both socket namespaces to the
// Node server on :8000 (see scripts/dev.mjs).
export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 900 },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8000',
      '/socket.io': { target: 'http://localhost:8000', ws: true },
    },
  },
});
