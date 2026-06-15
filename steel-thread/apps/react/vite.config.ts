import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// Tier-2 locator fallback: inject stable data-evergreen attrs onto role-less
// interactive elements that lack an accessible name. See
// ../../../toolkit/build-plugins/README.md
import evergreenAttrs from '../../../toolkit/build-plugins/vite-evergreen-attrs.mjs';

// Dev server on Vite's default port 5173 (per the steel-thread contract).
export default defineConfig({
  // evergreenAttrs runs with enforce:'pre' so it transforms JSX before
  // @vitejs/plugin-react compiles it away. It is ADDITIVE — it only appends a
  // data-* attribute and never changes roles or accessible names.
  plugins: [evergreenAttrs(), react()],
  server: {
    port: 5173,
    strictPort: true,
  },
});
