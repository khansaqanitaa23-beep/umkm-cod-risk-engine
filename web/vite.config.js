import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base MUST match the GitHub repo name for GitHub Pages:
// https://<user>.github.io/umkm-cod-risk-engine/
export default defineConfig({
  plugins: [react()],
  base: '/umkm-cod-risk-engine/',
  build: { outDir: 'dist' },
});
