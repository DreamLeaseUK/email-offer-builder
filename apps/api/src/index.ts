import { Hono } from 'hono';
import { brochureLink, brochuresApi } from './brochures.js';
import { campaignsApi, redirect } from './campaigns.js';
import { dev } from './dev.js';
import type { AppEnv } from './env.js';
import { files } from './files.js';
import { hosted } from './hosted.js';
import { libraryApi } from './library.js';
import { lookup } from './lookup.js';
import { requireAccess } from './middleware/access.js';
import { profileApi } from './profile.js';
import { templatesApi } from './templates.js';

const app = new Hono<AppEnv>();

// ---------- public ----------

app.get('/health', async (c) => {
  let db: 'ok' | 'error' | 'unbound' = 'unbound';
  if (c.env.DB) {
    try {
      await c.env.DB.prepare('select 1').first();
      db = 'ok';
    } catch {
      db = 'error';
    }
  }
  return c.json({ ok: true, service: 'offer-mailer', version: c.env.APP_VERSION ?? 'dev', db, images: !!c.env.TRANSFORM, firecrawl: !!c.env.FIRECRAWL_API_KEY, time: new Date().toISOString() });
});

// Hosted pages (§5.4), stored files (§5.3, §5.8), brochure links (§5.8) and click redirects (§5.6) need no login.
app.route('/', hosted);
app.route('/', files);
app.route('/', brochureLink);
app.route('/', redirect); // /r/:slug/:link — resolves a stored campaign's link and logs the click

// ---------- tool API (behind Cloudflare Access) ----------

const api = new Hono<AppEnv>();
api.use('*', requireAccess());
api.route('/', profileApi); // /me + /me/photo — the rep's profile and portrait
api.route('/', lookup);
api.route('/', brochuresApi);
api.route('/', campaignsApi);
api.route('/', libraryApi);
api.route('/', templatesApi); // /templates — master-admin only (requireAdmin inside)
api.route('/dev', dev);
app.route('/api', api);

// ---------- fallbacks ----------

app.notFound((c) => c.json({ error: 'Not found' }, 404));
app.onError((err, c) => {
  console.error(err instanceof Error ? err.message : String(err));
  return c.json({ error: 'Internal error' }, 500);
});

export default app;
