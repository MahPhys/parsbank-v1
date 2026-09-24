/**
 * Vite config — public application.
 *
 * The production build is served by the API process itself (see
 * apps/api/src/http/server.ts), so the bundle uses relative asset URLs under `/`.
 * The dev server proxies /api to the API so that a developer can run the two
 * processes independently without ever pointing the browser at a second origin:
 * the browser only ever talks to one origin, which is what the session cookie,
 * the CSRF double-submit and the CSP are all written against.
 */
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // The build runs from the repository root (`npm run build:public`), so the app
  // directory has to be stated explicitly rather than inferred from process.cwd().
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  base: '/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2022',
  },
  server: {
    host: true,
    port: 5173,
    strictPort: false,
    // The hosted preview reaches a dev server through a proxied host name.
    allowedHosts: true,
    proxy: {
      '/api': {
        target: process.env.PARS_API_ORIGIN ?? 'http://127.0.0.1:8787',
        changeOrigin: false,
      },
    },
  },
});
