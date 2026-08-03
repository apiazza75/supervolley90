import { defineConfig } from 'vite';

export default defineConfig({
  // Tauri serves the built files from a file:// style origin, so assets must be
  // referenced relatively rather than from the server root.
  base: './',
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: true,
  },
});
