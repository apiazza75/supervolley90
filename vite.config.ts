import { defineConfig } from 'vite';

export default defineConfig({
  // Tauri serves the built files from a file:// style origin, so assets must be
  // referenced relatively rather than from the server root.
  base: './',
  server: {
    port: 5173,
    strictPort: true,
    // The macOS sandbox can suppress native file events. Polling prevents a
    // long-lived local preview from silently serving old sprite/timing code.
    watch: {
      usePolling: process.platform === 'darwin',
      interval: 400,
      ignored: ['**/artifacts/**', '**/assets/source/**'],
    },
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: true,
  },
});
