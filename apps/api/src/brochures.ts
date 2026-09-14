/**
 * Brochures — brief §5.8.
 *   POST /api/brochures/ensure { make, model }        stored copy, or harvest (Firecrawl), or 404 → upload/paste
 *   POST /api/brochures/manual { make, model, url } | multipart pdf   the manual path
 *   GET  /api/brochures/current?make=&model=          the stored copy without triggering a harvest
 *   GET  /b/:id                                       recipient link: serves our PDF, or redirects to the
 *                                                     manufacturer's request page for a gated brochure
 * Superseded brochures keep serving: a campaign that used one must not break. Click logging is build step 6.
 */
import { BrochureNotFoundError, FirecrawlBrochureSource, ManualBrochureError, createFirecrawlClient, ensureBrochure, manualBrochure } from '@offer-mailer/adapters';
import type { BrochureRepo } from '@offer-mailer/adapters';
import { Brochure, assertNoCapId, vehicleKey } from '@offer-mailer/schema';
import type { Brochure as BrochureT } from '@offer-mailer/schema';
import { and, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import domainsConfig from '../../../config/manufacturer-uk-domains.json' with { type: 'json' };
import { db } from './db/index.js';
import { brochures as brochuresTable } from './db/schema.js';
import type { AppEnv, Env } from './env.js';
import { brochureStore, downloadFile } from './files.js';

export const ALLOWLIST: string[] = domainsConfig.domains;

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
  };
}

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
  const body = (await c.req.json().catch(() => ({}))) as { make?: unknown; model?: unknown };
  const vehicle = vehicleFrom(body);
  if (!vehicle) return c.json({ error: 'make and model are required' }, 400);
  const repo = d1BrochureRepo(c.env);
  const key = c.env.FIRECRAWL_API_KEY;
  if (!key) {
    const current = await repo.findCurrent(vehicleKey(vehicle));
    if (current) return c.json({ brochure: current, state: 'stored', warning: 'Brochure harvest is not configured (no Firecrawl key); using the stored copy.' });
    return c.json({ error: 'Brochure harvest is not configured (no Firecrawl key). Upload a PDF or paste a link.' }, 503);
  }
  const harvester = new FirecrawlBrochureSource({
    firecrawl: createFirecrawlClient(key),
    allowlist: ALLOWLIST,
    download: downloadFile,
    store: brochureStore(c.env),
    createdBy: c.get('user').email,
  });
  const result = await ensureBrochure(vehicle, { repo, harvester });
  if (!result) return c.json({ error: 'Not found. Upload a PDF or paste a link.' }, 404);
  return c.json(result);
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
  try {
    const b = await manualBrochure({ vehicle, ...(url ? { url } : {}), ...(pdf ? { pdf } : {}), createdBy, download: downloadFile, store: brochureStore(c.env) });
    const current = await repo.findCurrent(b.vehicleKey);
    await repo.save(b);
    if (current) await repo.markSuperseded(current.id);
    return c.json({ brochure: b, state: 'fresh' });
  } catch (err) {
    if (err instanceof ManualBrochureError) return c.json({ error: err.message }, 422);
    if (err instanceof BrochureNotFoundError) return c.json({ error: err.message }, 404);
    throw err;
  }
});

// ---------- recipient link (public) ----------

export const brochureLink = new Hono<AppEnv>();

brochureLink.get('/b/:id', async (c) => {
  const id = c.req.param('id');
  if (!/^[0-9a-f-]{36}$/i.test(id)) return c.text('Brochure not found.', 404);
  const b = await d1BrochureRepo(c.env).findById(id);
  if (!b) return c.text('Brochure not found.', 404);
  if (b.kind === 'gated') return c.redirect(b.sourceUrl, 302);
  const obj = b.file ? await c.env.BROCHURES.get(b.file.key) : null;
  if (!obj) return c.text('Brochure not found.', 404);
  const filename = `${b.title.replace(/[^A-Za-z0-9 ()-]+/g, '').trim() || 'brochure'}.pdf`;
  return new Response(obj.body, { headers: { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="${filename}"`, 'cache-control': 'private, max-age=3600', etag: obj.httpEtag } });
});
