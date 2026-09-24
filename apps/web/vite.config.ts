import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The Worker (apps/api) serves the API and the public routes. In dev it runs on `wrangler dev`
// (localhost:8787) with .dev.vars supplying the signed-in user, so the tool works without Access.
const WORKER = process.env.WORKER_ORIGIN ?? 'http://localhost:8787';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Accept requests that arrive through a dev "share" tunnel (cloudflared / ngrok / localtunnel), so the whole
    // running tool can be handed to someone off-network without a deploy. Vite already always allows localhost and
    // LAN IPs; this only *additionally* trusts these tunnel domains — not the open internet. The tool still has no
    // login in dev and talks to production data via `dev:live`, so only share the link narrowly and briefly.
    allowedHosts: ['.trycloudflare.com', '.ngrok-free.app', '.ngrok.app', '.ngrok.io', '.loca.lt'],
    // Allow importing source from the sibling workspace packages (schema, design-system).
    fs: { allow: ['../..'] },
    proxy: Object.fromEntries(['/api', '/r', '/c', '/b', '/f', '/a'].map((p) => [p, { target: WORKER, changeOrigin: true }])),
  },
});
