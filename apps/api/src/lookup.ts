/**
 * URL lookup — brief §5.3. POST /api/offers/lookup { url } → { offer, options, message, cached, warnings }.
 * The `url` OfferSource does the work; this file wires it to the Worker: global fetch and
 * HTMLRewriter, the D1 lookup cache (parsed results only, 24 hours), the image pipeline, the badge
 * list, and Firecrawl as the fallback fetcher when the direct fetch is refused.
 */
import { LookupError, LOOKUP_CACHE_TTL_MS, OfferBuildError, OfferPageError, OfferUrlError, PricingError, UrlOfferSource, createFirecrawlClient } from '@offer-mailer/adapters';
import type { HtmlFallback, HtmlRewriterCtor, LookupCache, LookupResult } from '@offer-mailer/adapters';
import { assertNoCapId } from '@offer-mailer/schema';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import badgesConfig from '../../../config/badges.json' with { type: 'json' };
import { db } from './db/index.js';
import { lookupCache } from './db/schema.js';
import type { AppEnv, Env } from './env.js';
import { vehicleImageStore } from './files.js';

export const KNOWN_BADGES: string[] = badgesConfig.badges;

/** D1-backed cache of parsed lookup results. Never HTML. */
export function d1LookupCache(env: Env, now: () => Date = () => new Date()): LookupCache {
  const d = db(env.DB);
  return {
    async get(key) {
      const row = await d.select().from(lookupCache).where(eq(lookupCache.urlKey, key)).get();
      if (!row) return undefined;
      if (now().getTime() - new Date(row.fetchedAt).getTime() > LOOKUP_CACHE_TTL_MS) {
        await d.delete(lookupCache).where(eq(lookupCache.urlKey, key)).run();
        return undefined;
      }
      return row.data as LookupResult;
    },
    async set(key, value) {
      assertNoCapId(value, 'lookup cache entry');
      await d
        .insert(lookupCache)
        .values({ urlKey: key, fetchedAt: value.fetchedAt, data: value })
        .onConflictDoUpdate({ target: lookupCache.urlKey, set: { fetchedAt: value.fetchedAt, data: value } })
        .run();
    },
  };
}

function firecrawlFallback(env: Env): HtmlFallback | undefined {
  if (!env.FIRECRAWL_API_KEY) return undefined;
  const client = createFirecrawlClient(env.FIRECRAWL_API_KEY);
  return {
    async fetchHtml(url) {
      const r = await client.scrape(url, { formats: ['rawHtml'], onlyMainContent: false });
      return r.rawHtml ?? r.html ?? '';
    },
  };
}

export function urlSource(env: Env): UrlOfferSource {
  const fallback = firecrawlFallback(env);
  return new UrlOfferSource({
    fetch: globalThis.fetch.bind(globalThis),
    HTMLRewriter: HTMLRewriter as unknown as HtmlRewriterCtor,
    knownBadges: KNOWN_BADGES,
    images: vehicleImageStore(env),
    ...(env.DB ? { cache: d1LookupCache(env) } : {}),
    ...(fallback ? { fallback } : {}),
  });
}

export const lookup = new Hono<AppEnv>();

lookup.post('/offers/lookup', async (c) => {
  let body: { url?: unknown };
  try {
    body = (await c.req.json()) as { url?: unknown };
  } catch {
    return c.json({ error: 'Send JSON with a url.' }, 400);
  }
  if (typeof body.url !== 'string' || !body.url.trim()) return c.json({ error: 'Paste a dreamlease.co.uk offer URL.' }, 400);
  try {
    const result = await urlSource(c.env).lookupFull({ url: body.url, createdBy: c.get('user').email });
    return c.json(result);
  } catch (err) {
    if (err instanceof OfferUrlError || err instanceof OfferBuildError) return c.json({ error: err.message }, 422);
    if (err instanceof OfferPageError || err instanceof PricingError || err instanceof LookupError) return c.json({ error: err.message }, 502);
    throw err;
  }
});
