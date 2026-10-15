import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Built into dist/admin, which holds only the SPA (server code lives in dist/http), so emptyOutDir is safe.
export default defineConfig({
  root: import.meta.dirname,
  base: '/admin/',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  build: {
    outDir: path.resolve(import.meta.dirname, '../dist/admin'),
    emptyOutDir: true,
    assetsDir: 'assets',
  },
});
