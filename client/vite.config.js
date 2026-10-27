import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Topic 42: Vite dev server + production build. In development /api is proxied to the Express server,
// so the browser sees ONE origin and the httpOnly session cookie "just works".
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': { target: process.env.VITE_API_TARGET || 'http://localhost:5000', changeOrigin: false } } },
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 900 },
  test: { environment: 'jsdom', globals: true, setupFiles: ['./src/test/setup.js'], css: false },
});
