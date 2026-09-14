import { Hono } from 'hono';
import { dev } from './dev.js';
import type { AppEnv } from './env.js';
import { hosted } from './hosted.js';
import { requireAccess } from './middleware/access.js';

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
  return c.json({ ok: true, service: 'offer-mailer', version: c.env.APP_VERSION ?? 'dev', db, time: new Date().toISOString() });
});

// Hosted pages (§5.4), click redirects (§5.6) and brochure links (§5.8) need no login.
app.route('/', hosted);
app.get('/r/:slug/:link', (c) => c.text('Link not found.', 404)); // build step 6
app.get('/b/:id', (c) => c.text('Brochure not found.', 404)); // build step 3

// ---------- tool API (behind Cloudflare Access) ----------

const api = new Hono<AppEnv>();
api.use('*', requireAccess());
api.get('/me', (c) => c.json(c.get('user')));
api.route('/dev', dev);
app.route('/api', api);

// ---------- fallbacks ----------

app.notFound((c) => c.json({ error: 'Not found' }, 404));
app.onError((err, c) => {
  console.error(err instanceof Error ? err.message : String(err));
  return c.json({ error: 'Internal error' }, 500);
});

export default app;
