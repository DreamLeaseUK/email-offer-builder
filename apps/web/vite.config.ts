import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The Worker (apps/api) serves the API and the public routes. In dev it runs on `wrangler dev`
// (localhost:8787) with .dev.vars supplying the signed-in user, so the tool works without Access.
const WORKER = process.env.WORKER_ORIGIN ?? 'http://localhost:8787';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Allow importing source from the sibling workspace packages (schema, design-system).
    fs: { allow: ['../..'] },
    proxy: Object.fromEntries(['/api', '/r', '/c', '/b', '/f', '/a'].map((p) => [p, { target: WORKER, changeOrigin: true }])),
  },
});
