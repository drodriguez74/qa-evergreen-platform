import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev server on Vite's default port 5173 (per the steel-thread contract).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
  },
});
