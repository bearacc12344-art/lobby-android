import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: { outDir: 'dist', assetsDir: 'build', target: 'es2020', assetsInlineLimit: 0, chunkSizeWarningLimit: 4000,
    rollupOptions: { input: { main: 'index.html', test: 'test.html' } } },
  worker: { format: 'es' },
  server: { host: '127.0.0.1', port: 5173 },
});
