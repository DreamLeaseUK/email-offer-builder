import { Hono } from 'hono';
import type { AppEnv } from './env.js';
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

// Hosted pages, click redirects and brochure links live on offers.dreamlease.co.uk and need no login.
// Implemented in build steps 2, 3 and 6; registered now so the route shape is fixed.
app.get('/c/:slug', (c) => c.text('These offers are not available yet.', 404));
app.get('/r/:campaign/:link', (c) => c.text('Link not found.', 404));
app.get('/b/:id', (c) => c.text('Brochure not found.', 404));

// ---------- tool API (behind Cloudflare Access) ----------

const api = new Hono<AppEnv>();
api.use('*', requireAccess());
api.get('/me', (c) => c.json(c.get('user')));
app.route('/api', api);

// ---------- fallbacks ----------

app.notFound((c) => c.json({ error: 'Not found' }, 404));
app.onError((err, c) => {
  console.error(err instanceof Error ? err.message : String(err));
  return c.json({ error: 'Internal error' }, 500);
});

export default app;
