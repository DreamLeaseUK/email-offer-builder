import { Hono } from 'hono';
import { csrf } from 'hono/csrf';
import { HTTPException } from 'hono/http-exception';
import { brochureLink, brochuresApi, recheckLinkedBrochures } from './brochures.js';
import { campaignsApi, redirect } from './campaigns.js';
import { dev } from './dev.js';
import type { AppEnv, Env } from './env.js';
import { runRetention } from './retention.js';
import { files } from './files.js';
import { hosted } from './hosted.js';
import { libraryApi, purgeArchivedLibrary, recheckLibraryUrls } from './library.js';
import { lookup } from './lookup.js';
import { mailApi, purgeStaleMailConnections } from './mail.js';
import { requireAccess } from './middleware/access.js';
import { buildOpenApi } from './openapi.js';
import { profileApi } from './profile.js';
import { safeErrorLine } from './safe-log.js';
import { sendApi } from './send.js';
import { suppressionsApi } from './suppressions.js';
import { templatesApi } from './templates.js';
import { DREAMLEASE_HOME, isToolHost, ui } from './ui.js';

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
// The tool's web app: served only on the tool host (Access protects it at the edge); '/' elsewhere goes to dreamlease.co.uk.
app.route('/', ui);

// ---------- tool API (behind Cloudflare Access) ----------

const api = new Hono<AppEnv>();
// Cross-site request forgery guard: a write from another website's form or script (which the browser would send with
// the salesperson's Access cookie) is refused with 403. The tool's own requests (JSON, and the photo and brochure
// uploads) come from the same origin. A non-browser caller must send `content-type: application/json`, so it cannot
// use the two uploads until machine sign-in exists (docs/architecture.md B6, B12).
api.use('*', csrf());
api.use('*', requireAccess());
api.get('/openapi.json', (c) => c.json(buildOpenApi(c.env.APP_VERSION ?? 'dev'))); // the API described (openapi.ts; a test keeps it in step)
api.route('/', profileApi); // /me + /me/photo — the salesperson's profile and portrait
api.route('/', lookup);
api.route('/', brochuresApi);
api.route('/', campaignsApi);
api.route('/', sendApi); // /campaigns/:id/checks and /send: the pre-send checks and the Microsoft 365 send
api.route('/', mailApi); // /mail/*: Connect Outlook (the salesperson's own mailbox, runbook Part D)
api.route('/', libraryApi);
api.route('/', templatesApi); // /templates: read by admins or compliance, changed by compliance only (templates.ts)
api.route('/', suppressionsApi); // /suppressions — opt-out register (remove is admin only)
api.route('/dev', dev);
app.route('/api', api);

// ---------- fallbacks ----------

// A stray or mistyped address on a customer-facing host (offers.dreamlease.co.uk, or the old workers.dev one) goes to the
// website rather than a technical error (Matt, 6 Oct 2026). The tool host and /api keep a plain 404 for the tool itself.
app.notFound((c) => {
  const page = c.req.method === 'GET' || c.req.method === 'HEAD';
  if (page && !new URL(c.req.url).pathname.startsWith('/api/') && !isToolHost(c.req.url, c.req.header('cf-connecting-ip'), c.env)) {
    return c.redirect(DREAMLEASE_HOME, 302);
  }
  return c.json({ error: 'Not found' }, 404);
});
app.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ error: err.message || 'Request refused' }, err.status);
  console.error(safeErrorLine(err));
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
      .catch((e) => console.error('retention failed:', safeErrorLine(e))),
  );
  // web brochures and request forms are links to someone else's page: drop any that have gone dead
  ctx.waitUntil(
    recheckLinkedBrochures(env)
      .then((r) => console.log('brochure links:', JSON.stringify(r)))
      .catch((e) => console.error('brochure link re-check failed:', safeErrorLine(e))),
  );
  // library entries: flag any whose source offer URL has moved or gone (a dealer changed it), and purge the archive
  ctx.waitUntil(
    recheckLibraryUrls(env)
      .then((r) => console.log('library urls:', JSON.stringify(r)))
      .catch((e) => console.error('library url re-check failed:', safeErrorLine(e))),
  );
  // Microsoft refuses a connection unused for 90 days: delete it, so no dead token is kept
  ctx.waitUntil(
    purgeStaleMailConnections(env, new Date())
      .then((n) => console.log('mail connections purged:', n))
      .catch((e) => console.error('mail connection purge failed:', safeErrorLine(e))),
  );
  ctx.waitUntil(
    purgeArchivedLibrary(env, new Date())
      .then((n) => console.log('library archive purged:', n))
      .catch((e) => console.error('library archive purge failed:', safeErrorLine(e))),
  );
};

export default handler;
