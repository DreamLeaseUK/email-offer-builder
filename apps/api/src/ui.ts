/**
 * The tool's web app, served by the Worker (built into public/app by `pnpm --filter @offer-mailer/web build`;
 * `pnpm run deploy` builds it first). Served ONLY on the tool host (TOOL_BASE_URL: marketingtools.dreamelectric.uk),
 * which Cloudflare Access protects at the edge. That is the same origin as /api, so the Access cookie and the
 * cross-site guard need nothing special. On every other host (offers.dreamlease.co.uk, workers.dev) the app does
 * not exist: '/' sends a stray visitor to dreamlease.co.uk and /app/* answers 404, so the internal tool is never
 * exposed on the customer-facing address. Since 6 Oct 2026 (Matt) any address those hosts do not serve also goes to
 * dreamlease.co.uk (index.ts notFound) instead of a technical error, and /robots.txt keeps search engines out everywhere. `wrangler dev` on this laptop counts as the tool host (local.ts), so the
 * served build can be checked locally; the live site can never pass that test.
 *
 *   GET /        tool host: 302 → /app/        elsewhere: 302 → https://www.dreamlease.co.uk/
 *   GET /app/*   tool host: the built files (index.html, JS, CSS)        elsewhere: 302 → https://www.dreamlease.co.uk/
 *   GET /robots.txt   every host: Disallow everything (offer pages are noindex too; the tool is behind Access)
 *
 * wrangler.jsonc sends only these two paths to the Worker first ("run_worker_first"); the /a/* email assets are
 * served straight from the assets directory on every host, as before.
 */
import { Hono } from 'hono';
import type { AppEnv, Env } from './env.js';
import { isThisLaptop } from './local.js';

export const DREAMLEASE_HOME = 'https://www.dreamlease.co.uk/';

/** Is this request for the tool itself: its own host, or wrangler dev on this laptop? */
export const isToolHost = (url: string, caller: string | undefined, env: Pick<Env, 'TOOL_BASE_URL'>): boolean => {
  if (isThisLaptop(url, caller)) return true;
  try {
    return new URL(url).host === new URL(env.TOOL_BASE_URL).host;
  } catch {
    return false; // an unparseable TOOL_BASE_URL serves the app nowhere rather than everywhere
  }
};

export const ui = new Hono<AppEnv>();

const forTool = (c: { req: { url: string; header(name: string): string | undefined }; env: Env }) =>
  isToolHost(c.req.url, c.req.header('cf-connecting-ip'), c.env);

ui.get('/', (c) => c.redirect(forTool(c) ? '/app/' : DREAMLEASE_HOME, 302));

ui.get('/robots.txt', (c) => c.text('User-agent: *\nDisallow: /\n'));

ui.get('/app/*', async (c) => {
  if (!forTool(c)) return c.redirect(DREAMLEASE_HOME, 302);
  return c.env.ASSETS.fetch(c.req.raw);
});
