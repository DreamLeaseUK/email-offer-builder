import { Hono } from 'hono';
import { brochureLink, brochuresApi, recheckLinkedBrochures } from './brochures.js';
import { campaignsApi, redirect } from './campaigns.js';
import { dev } from './dev.js';
import type { AppEnv, Env } from './env.js';
import { runRetention } from './retention.js';
import { files } from './files.js';
import { hosted } from './hosted.js';
import { libraryApi, purgeArchivedLibrary, recheckLibraryUrls } from './library.js';
import { lookup } from './lookup.js';
import { requireAccess } from './middleware/access.js';
import { buildOpenApi } from './openapi.js';
import { profileApi } from './profile.js';
import { suppressionsApi } from './suppressions.js';
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
api.get('/openapi.json', (c) => c.json(buildOpenApi(c.env.APP_VERSION ?? 'dev'))); // the API described (openapi.ts; a test keeps it in step)
api.route('/', profileApi); // /me + /me/photo — the salesperson's profile and portrait
api.route('/', lookup);
api.route('/', brochuresApi);
api.route('/', campaignsApi);
api.route('/', libraryApi);
api.route('/', templatesApi); // /templates — master-admin only (requireAdmin inside)
api.route('/', suppressionsApi); // /suppressions — opt-out register (remove is admin only)
api.route('/dev', dev);
app.route('/api', api);

// ---------- fallbacks ----------

app.notFound((c) => c.json({ error: 'Not found' }, 404));
app.onError((err, c) => {
  console.error(err instanceof Error ? err.message : String(err));
  return c.json({ error: 'Internal error' }, 500);
});

// The default export stays the Hono app (so `.fetch` serves requests and tests can use `.request`); we
// attach `scheduled` to it for the daily retention/housekeeping Cron (see wrangler.jsonc).
const handler = app as typeof app & {
  scheduled: (controller: ScheduledController, env: Env, ctx: ExecutionContext) => void;
};
handler.scheduled = (_controller, env, ctx) => {
  ctx.waitUntil(
    runRetention(env, new Date())
      .then((r) => console.log('retention:', JSON.stringify(r)))
      .catch((e) => console.error('retention failed:', e instanceof Error ? e.message : String(e))),
  );
  // web brochures and request forms are links to someone else's page: drop any that have gone dead
  ctx.waitUntil(
    recheckLinkedBrochures(env)
      .then((r) => console.log('brochure links:', JSON.stringify(r)))
      .catch((e) => console.error('brochure link re-check failed:', e instanceof Error ? e.message : String(e))),
  );
  // library entries: flag any whose source offer URL has moved or gone (a dealer changed it), and purge the archive
  ctx.waitUntil(
    recheckLibraryUrls(env)
      .then((r) => console.log('library urls:', JSON.stringify(r)))
      .catch((e) => console.error('library url re-check failed:', e instanceof Error ? e.message : String(e))),
  );
  ctx.waitUntil(
    purgeArchivedLibrary(env, new Date())
      .then((n) => console.log('library archive purged:', n))
      .catch((e) => console.error('library archive purge failed:', e instanceof Error ? e.message : String(e))),
  );
};

export default handler;
