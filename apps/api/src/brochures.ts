/**
 * Brochures — brief §5.8; discovery is the finder (docs/brochure-finder-brief.md).
 *   POST /api/brochures/ensure { make, model, force? }  stored copy, or a search. Always 200 with
 *                                                        { state, brochure?, search?, remembered? }:
 *                                                        state 'none' means nothing attached — `search` says
 *                                                        what was checked and the UI offers the manual paths.
 *   POST /api/brochures/accept { make, model }         the rep accepts an official page / request form the
 *                                                        finder would not attach by itself (URL from the stored search)
 *   POST /api/brochures/manual { make, model, url } | multipart pdf   the manual path
 *   GET  /api/brochures/current?make=&model=           the stored copy without triggering a search
 *   GET  /b/:id                                        recipient link: serves our PDF, or redirects to the
 *                                                      manufacturer's page for a web brochure / request form
 * Superseded brochures keep serving: a campaign that used one must not break.
 */
import { FirecrawlBrochureSource, ManualBrochureError, acceptSearchOutcome, createFirecrawlClient, ensureBrochure, manualBrochure } from '@offer-mailer/adapters';
import type { BrochureRepo, Downloaded, FinderHttp } from '@offer-mailer/adapters';
import { Brochure, BrochureSearch, assertNoCapId, vehicleKey } from '@offer-mailer/schema';
import type { Brochure as BrochureT, BrochureSearch as BrochureSearchT } from '@offer-mailer/schema';
import { and, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from './db/index.js';
import { brochureSearches, brochures as brochuresTable } from './db/schema.js';
import type { AppEnv, Env } from './env.js';
import { BROWSER_UA, brochureStore, downloadFile } from './files.js';

export function d1BrochureRepo(env: Env): BrochureRepo & { findById(id: string): Promise<BrochureT | undefined> } {
  const d = db(env.DB);
  const parse = (row: { data: unknown } | undefined) => (row ? Brochure.parse(row.data) : undefined);
  return {
    async findCurrent(key) {
      return parse(await d.select().from(brochuresTable).where(and(eq(brochuresTable.vehicleKey, key), eq(brochuresTable.status, 'current'))).orderBy(desc(brochuresTable.fetchedAt)).get());
    },
    async findById(id) {
      return parse(await d.select().from(brochuresTable).where(eq(brochuresTable.id, id)).get());
    },
    async save(b) {
      assertNoCapId(b, 'brochure');
      await d.insert(brochuresTable).values({ id: b.id, vehicleKey: b.vehicleKey, kind: b.kind, status: b.status, fetchedAt: b.fetchedAt, expiresAt: b.expiresAt, data: b }).run();
    },
    async markSuperseded(id) {
      const row = await d.select().from(brochuresTable).where(eq(brochuresTable.id, id)).get();
      if (!row) return;
      const data = { ...(row.data as BrochureT), status: 'superseded' as const };
      await d.update(brochuresTable).set({ status: 'superseded', data }).where(eq(brochuresTable.id, id)).run();
    },
    async findSearch(key) {
      const row = await d.select().from(brochureSearches).where(eq(brochureSearches.vehicleKey, key)).get();
      const parsed = row ? BrochureSearch.safeParse(row.data) : undefined;
      return parsed?.success ? parsed.data : undefined;
    },
    async saveSearch(s: BrochureSearchT) {
      assertNoCapId(s, 'brochure search');
      const values = { vehicleKey: s.vehicleKey, status: s.status, searchedAt: s.searchedAt, data: s };
      await d.insert(brochureSearches).values(values).onConflictDoUpdate({ target: brochureSearches.vehicleKey, set: values }).run();
    },
  };
}

/** The finder's plain GET: follows redirects, never throws, reads the body only when asked. */
export const finderHttp: FinderHttp = async (url) => {
  try {
    const res = await fetch(url, { headers: { 'user-agent': BROWSER_UA, accept: 'text/html,application/pdf;q=0.9,*/*;q=0.8', 'accept-language': 'en-GB,en;q=0.9' }, redirect: 'follow', signal: AbortSignal.timeout(15_000) });
    const lastModified = res.headers.get('last-modified');
    return { status: res.status, contentType: res.headers.get('content-type') ?? '', finalUrl: res.url || url, ...(lastModified ? { lastModified } : {}), text: () => res.text() };
  } catch {
    return undefined;
  }
};

const vehicleFrom = (q: { make?: unknown; model?: unknown }): { make: string; model: string } | undefined =>
  typeof q.make === 'string' && q.make.trim() && typeof q.model === 'string' && q.model.trim() ? { make: q.make.trim(), model: q.model.trim() } : undefined;

export const brochuresApi = new Hono<AppEnv>();

brochuresApi.get('/brochures/current', async (c) => {
  const vehicle = vehicleFrom(c.req.query());
  if (!vehicle) return c.json({ error: 'make and model are required' }, 400);
  const current = await d1BrochureRepo(c.env).findCurrent(vehicleKey(vehicle));
  return current ? c.json({ brochure: current }) : c.json({ brochure: null }, 404);
});

brochuresApi.post('/brochures/ensure', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { make?: unknown; model?: unknown; force?: unknown };
  const vehicle = vehicleFrom(body);
  if (!vehicle) return c.json({ error: 'make and model are required' }, 400);
  const repo = d1BrochureRepo(c.env);
  const key = c.env.FIRECRAWL_API_KEY;
  if (!key) {
    const current = await repo.findCurrent(vehicleKey(vehicle));
    if (current) return c.json({ brochure: current, state: 'stored', warning: 'Brochure search is not configured (no Firecrawl key); using the stored copy.' });
    return c.json({ error: 'Brochure search is not configured (no Firecrawl key). Upload a PDF or paste a link.' }, 503);
  }
  const harvester = new FirecrawlBrochureSource({ firecrawl: createFirecrawlClient(key), http: finderHttp, download: downloadFile, store: brochureStore(c.env), createdBy: c.get('user').email });
  return c.json(await ensureBrochure(vehicle, { repo, harvester, force: body.force === true }));
});

brochuresApi.post('/brochures/accept', async (c) => {
  const vehicle = vehicleFrom((await c.req.json().catch(() => ({}))) as { make?: unknown; model?: unknown });
  if (!vehicle) return c.json({ error: 'make and model are required' }, 400);
  const repo = d1BrochureRepo(c.env);
  const search = await repo.findSearch(vehicleKey(vehicle));
  const b = search ? acceptSearchOutcome(search, { vehicle, createdBy: c.get('user').email }) : undefined;
  if (!b) return c.json({ error: 'There is no official page or request form on record for this vehicle. Search again, or upload / paste a link.' }, 404);
  const current = await repo.findCurrent(b.vehicleKey);
  await repo.save(b);
  if (current) await repo.markSuperseded(current.id);
  return c.json({ brochure: b, state: 'fresh' });
});

brochuresApi.post('/brochures/manual', async (c) => {
  const repo = d1BrochureRepo(c.env);
  const createdBy = c.get('user').email;
  const contentType = c.req.header('content-type') ?? '';
  let vehicle: { make: string; model: string } | undefined;
  let url: string | undefined;
  let pdf: { bytes: ArrayBuffer; contentType: string | null } | undefined;
  if (contentType.includes('multipart/form-data')) {
    const form = await c.req.formData();
    vehicle = vehicleFrom({ make: form.get('make'), model: form.get('model') });
    const u = form.get('url');
    if (typeof u === 'string' && u.trim()) url = u.trim();
    const file = form.get('pdf');
    if (file instanceof File) pdf = { bytes: await file.arrayBuffer(), contentType: file.type || null };
  } else {
    const body = (await c.req.json().catch(() => ({}))) as { make?: unknown; model?: unknown; url?: unknown };
    vehicle = vehicleFrom(body);
    if (typeof body.url === 'string' && body.url.trim()) url = body.url.trim();
  }
  if (!vehicle) return c.json({ error: 'make and model are required' }, 400);
  // a pasted manufacturer PDF link is often bot-protected against the Worker: Firecrawl fetches the same public file
  const key = c.env.FIRECRAWL_API_KEY;
  const fetchFile = key
    ? async (u: string): Promise<Downloaded> => {
        const f = await createFirecrawlClient(key).fetchFile(u);
        return f.ok ? { bytes: f.bytes, contentType: f.contentType } : { bytes: new ArrayBuffer(0), contentType: null };
      }
    : undefined;
  try {
    const b = await manualBrochure({ vehicle, ...(url ? { url } : {}), ...(pdf ? { pdf } : {}), ...(fetchFile ? { fetchFile } : {}), createdBy, download: downloadFile, store: brochureStore(c.env) });
    const current = await repo.findCurrent(b.vehicleKey);
    await repo.save(b);
    if (current) await repo.markSuperseded(current.id);
    return c.json({ brochure: b, state: 'fresh' });
  } catch (err) {
    if (err instanceof ManualBrochureError) return c.json({ error: err.message }, 422);
    throw err;
  }
});

// ---------- daily link re-check (Cron) ----------

/**
 * A `web` or `gated` brochure is a link to somebody else's page, so it is re-checked daily: one that now
 * answers 404/410 is superseded, which stops it being attached to new campaigns. A campaign already sent keeps
 * its /b/:id link (it redirects to wherever the manufacturer now sends that URL). Transient errors change nothing.
 */
export async function recheckLinkedBrochures(env: Env, http: FinderHttp = finderHttp, limit = 40): Promise<{ checked: number; superseded: number }> {
  const d = db(env.DB);
  const repo = d1BrochureRepo(env);
  const rows = await d.select().from(brochuresTable).where(eq(brochuresTable.status, 'current')).all();
  const linked = rows.filter((r) => r.kind === 'web' || r.kind === 'gated').slice(0, limit);
  let superseded = 0;
  for (const row of linked) {
    const b = Brochure.safeParse(row.data);
    if (!b.success) continue;
    const res = await http(b.data.sourceUrl);
    if (res && (res.status === 404 || res.status === 410)) {
      await repo.markSuperseded(b.data.id);
      superseded += 1;
    }
  }
  return { checked: linked.length, superseded };
}

// ---------- recipient link (public) ----------

export const brochureLink = new Hono<AppEnv>();

brochureLink.get('/b/:id', async (c) => {
  const id = c.req.param('id');
  if (!/^[0-9a-f-]{36}$/i.test(id)) return c.text('Brochure not found.', 404);
  const b = await d1BrochureRepo(c.env).findById(id);
  if (!b) return c.text('Brochure not found.', 404);
  if (b.kind !== 'pdf') return c.redirect(b.sourceUrl, 302);
  const obj = b.file ? await c.env.BROCHURES.get(b.file.key) : null;
  if (!obj) return c.text('Brochure not found.', 404);
  const filename = `${b.title.replace(/[^A-Za-z0-9 ()&-]+/g, '').trim() || 'brochure'}.pdf`;
  return new Response(obj.body, { headers: { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="${filename}"`, 'cache-control': 'private, max-age=3600', etag: obj.httpEtag } });
});
