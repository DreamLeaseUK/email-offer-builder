/**
 * Offer library — a curated central repository (brief §6, §7.2 screen 4; redesigned 23 Sept 2026, `LibraryEntry`).
 *
 * Two surfaces: a salesperson's **personal** shelf, and the **shared** shelves an admin curates. An entry is a vehicle +
 * configuration + curation, NOT a frozen price: the price shown is "last known", and is re-fetched live from the
 * source URL when a salesperson uses it (`/reprice`, and again as the offer is added to a campaign) so nothing stale ships.
 * Dealer URLs move, so `urlHealth` tracks whether the source still resolves; a moved/gone entry is blocked until
 * the salesperson re-points it. Entries are current or archived; the daily Cron rechecks URLs and purges archived > 6 months
 * (retention.ts). The facet columns (make/model/fuel/body/contractType/monthly) exist so the future offer matcher
 * is a query over them, not a refactor.
 *
 *   POST   /api/offers/library { offer }              save one of the caller's offers to their personal shelf
 *   GET    /api/offers/library?scope=&category=&q=    current entries (personal for the caller, or a shared shelf)
 *   GET    /api/offers/library/archived               archived entries (the caller's, or shared for an admin)
 *   POST   /api/offers/library/:id/reprice            re-fetch the live price from the source; flag a dead URL
 *   POST   /api/offers/library/:id/archive | /unarchive
 *   POST   /api/offers/library/:id/promote { category }   admin: put an entry on a shared shelf
 *   DELETE /api/offers/library/:id
 */
import { LookupError, OfferBuildError, OfferPageError, OfferUrlError, PricingError } from '@offer-mailer/adapters';
import { LIBRARY_ARCHIVE_PURGE_DAYS, LibraryEntry, Offer, assertNoCapId, decodeOfferText, libraryFacets, vehicleKey } from '@offer-mailer/schema';
import type { Brochure, LibraryEntry as LibraryEntryT, LibraryFacets, Offer as OfferT, UrlHealth } from '@offer-mailer/schema';
import { and, desc, eq, like, lt, or } from 'drizzle-orm';
import { Hono } from 'hono';
import shelvesConfig from '../../../config/library-shelves.json' with { type: 'json' };
import { d1BrochureRepo } from './brochures.js';
import { db } from './db/index.js';
import { libraryEntries } from './db/schema.js';
import type { AppEnv, Env } from './env.js';
import { urlSource } from './lookup.js';
import { isAdmin } from './roles.js';

type NewEntry = { offer: OfferT; scope: LibraryEntryT['scope']; addedBy: string; category?: string };

function libraryRepo(env: Env) {
  const d = db(env.DB);
  // decode on read too: a row stored before a parser fix may still carry the site's entity ("Techno &#x2B; Comfort")
  const decode = (e: LibraryEntryT): LibraryEntryT => ({ ...e, offer: decodeOfferText(e.offer) });
  const parse = (row: { data: unknown } | undefined): LibraryEntryT | undefined => (row ? decode(LibraryEntry.parse(row.data)) : undefined);
  const columns = (e: LibraryEntryT) => {
    const f: LibraryFacets = libraryFacets(e.offer);
    return {
      id: e.id,
      scope: e.scope,
      category: e.category ?? null,
      status: e.status,
      urlHealth: e.urlHealth.state,
      make: f.make,
      model: f.model,
      fuelType: f.fuelType ?? null,
      bodyStyle: f.bodyStyle ?? null,
      contractType: f.contractType,
      monthly: f.monthly,
      vehicleKey: f.vehicleKey,
      validUntil: f.validUntil,
      addedBy: e.addedBy,
      addedAt: e.addedAt,
      archivedAt: e.archivedAt ?? null,
      lastPricedAt: e.lastPricedAt ?? null,
      updatedAt: e.updatedAt,
      data: e,
    };
  };
  return {
    async save(e: LibraryEntryT): Promise<void> {
      assertNoCapId(e, 'library entry');
      const v = columns(e);
      await d.insert(libraryEntries).values(v).onConflictDoUpdate({ target: libraryEntries.id, set: v }).run();
    },
    async get(id: string): Promise<LibraryEntryT | undefined> {
      return parse(await d.select({ data: libraryEntries.data }).from(libraryEntries).where(eq(libraryEntries.id, id)).get());
    },
    /** Current entries. Personal = the caller's own; shared = the curated shelves (optionally one category). */
    async listCurrent(o: { scope: 'personal'; owner: string } | { scope: 'shared'; category?: string }, search?: string, maxMonthly?: number): Promise<LibraryEntryT[]> {
      const where = [eq(libraryEntries.status, 'current'), eq(libraryEntries.scope, o.scope)];
      if (o.scope === 'personal') where.push(eq(libraryEntries.addedBy, o.owner));
      else if (o.category) where.push(eq(libraryEntries.category, o.category));
      // the smart "Deals under £300 per month" shelf filters on the last-known price (re-priced live on use)
      if (maxMonthly && Number.isFinite(maxMonthly)) where.push(lt(libraryEntries.monthly, Math.round(maxMonthly)));
      if (search?.trim()) {
        const q = `%${search.trim().toLowerCase()}%`;
        where.push(or(like(libraryEntries.make, q), like(libraryEntries.model, q))!);
      }
      const rows = await d.select({ data: libraryEntries.data }).from(libraryEntries).where(and(...where)).orderBy(desc(libraryEntries.addedAt)).all();
      return rows.map((r) => decode(LibraryEntry.parse(r.data)));
    },
    async listArchived(o: { scope: 'personal'; owner: string } | { scope: 'shared' }): Promise<LibraryEntryT[]> {
      const where = [eq(libraryEntries.status, 'archived'), eq(libraryEntries.scope, o.scope)];
      if (o.scope === 'personal') where.push(eq(libraryEntries.addedBy, o.owner));
      const rows = await d.select({ data: libraryEntries.data }).from(libraryEntries).where(and(...where)).orderBy(desc(libraryEntries.archivedAt)).all();
      return rows.map((r) => decode(LibraryEntry.parse(r.data)));
    },
    async remove(id: string): Promise<void> {
      await d.delete(libraryEntries).where(eq(libraryEntries.id, id)).run();
    },
  };
}

/** Build a personal library entry from a freshly-saved offer: current, priced now, URL taken as ok. */
export function newLibraryEntry(o: NewEntry, now: Date): LibraryEntryT {
  const iso = now.toISOString();
  return {
    id: o.offer.id,
    offer: decodeOfferText(o.offer),
    scope: o.scope,
    ...(o.category ? { category: o.category } : {}),
    status: 'current',
    urlHealth: { state: 'ok', checkedAt: iso },
    addedBy: o.addedBy,
    addedAt: iso,
    lastPricedAt: iso,
    updatedAt: iso,
  };
}

/**
 * Re-attach the model's shared brochure to an offer being priced for use (library add / re-price). A live lookup
 * never carries a brochure, so without this the stored copy is silently dropped every time a saved offer is used
 * — the bug Matt hit with the Renault 5 (23 Sept 2026). The brochure is shared by vehicleKey; a European edition
 * stays offered, unticked (`market === 'eu'`), matching the finder's rule, and a prior explicit include wins.
 */
export function withStoredBrochure(offer: OfferT, brochure: Brochure | undefined, priorInclude?: boolean): OfferT {
  if (!brochure) return offer;
  const include = priorInclude ?? brochure.market !== 'eu';
  return { ...offer, brochure: { brochureId: brochure.id, include } };
}

export const libraryApi = new Hono<AppEnv>();

libraryApi.post('/offers/library', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { offer?: unknown };
  const parsed = Offer.safeParse(body.offer);
  if (!parsed.success) return c.json({ error: 'That is not a valid offer.', issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) }, 422);
  const email = c.get('user').email;
  const repo = libraryRepo(c.env);
  // saving the same offer again refreshes the existing entry rather than making a second (upsert by offer id)
  const existing = await repo.get(parsed.data.id);
  const now = new Date();
  const entry: LibraryEntryT = existing
    ? { ...existing, offer: decodeOfferText({ ...parsed.data, createdBy: existing.addedBy }), lastPricedAt: now.toISOString(), updatedAt: now.toISOString(), urlHealth: { state: 'ok', checkedAt: now.toISOString() } }
    : newLibraryEntry({ offer: { ...parsed.data, createdBy: email }, scope: 'personal', addedBy: email }, now);
  await repo.save(entry);
  return c.json({ entry, offer: entry.offer }, existing ? 200 : 201);
});

/** The shared shelves the tool offers (config/library-shelves.json). Admin-maintained; a 'smart' shelf filters live. */
libraryApi.get('/library/shelves', (c) => c.json({ shelves: shelvesConfig.shelves }));

libraryApi.get('/offers/library', async (c) => {
  const email = c.get('user').email;
  const scope = c.req.query('scope') === 'shared' ? 'shared' : 'personal';
  const search = c.req.query('q');
  const category = c.req.query('category');
  const maxMonthly = c.req.query('maxMonthly') ? Number(c.req.query('maxMonthly')) : undefined;
  const repo = libraryRepo(c.env);
  const entries = scope === 'shared' ? await repo.listCurrent({ scope: 'shared', ...(category ? { category } : {}) }, search, maxMonthly) : await repo.listCurrent({ scope: 'personal', owner: email }, search, maxMonthly);
  // `offers` is kept for the current UI until the rich library view lands; new callers read `entries`.
  return c.json({ entries, offers: entries.map((e) => e.offer) });
});

libraryApi.get('/offers/library/archived', async (c) => {
  const email = c.get('user').email;
  const scope = c.req.query('scope') === 'shared' && isAdmin(c.env, email) ? 'shared' : 'personal';
  const repo = libraryRepo(c.env);
  const entries = scope === 'shared' ? await repo.listArchived({ scope: 'shared' }) : await repo.listArchived({ scope: 'personal', owner: email });
  return c.json({ entries });
});

libraryApi.post('/offers/library/:id/reprice', async (c) => {
  const repo = libraryRepo(c.env);
  const entry = await repo.get(c.req.param('id'));
  if (!entry) return c.json({ error: 'That library entry no longer exists.' }, 404);
  const now = new Date();
  try {
    // re-fetch the live price from the source page at the saved terms; the URL is the offer's own canonical URL
    const fresh = await urlSource(c.env).lookupFull({ url: entry.offer.offerUrl, createdBy: entry.addedBy });
    // …and re-attach the model's shared brochure the same way: the lookup drops it, so without this a saved offer
    // loses its brochure every time it is used. The record rides back in the response so the tray can show it.
    const brochure = await d1BrochureRepo(c.env).findCurrent(vehicleKey(fresh.offer.vehicle));
    const offer = withStoredBrochure({ ...fresh.offer, id: entry.offer.id, createdBy: entry.addedBy }, brochure, entry.offer.brochure?.include);
    const updated: LibraryEntryT = { ...entry, offer, urlHealth: { state: 'ok', checkedAt: now.toISOString() }, lastPricedAt: now.toISOString(), updatedAt: now.toISOString() };
    await repo.save(updated);
    return c.json({ entry: updated, offer: updated.offer, ...(brochure ? { brochure } : {}), message: fresh.message });
  } catch (err) {
    // the source no longer resolves to this vehicle: flag it, do not guess a price
    const gone = err instanceof OfferPageError || err instanceof LookupError || err instanceof OfferUrlError;
    const urlHealth: UrlHealth = gone ? { state: 'gone', checkedAt: now.toISOString(), note: 'The offer page is no longer available. Update this entry with the latest URL.' } : { state: 'moved', checkedAt: now.toISOString(), note: 'The offer page no longer prices this configuration. Update this entry with the latest URL.' };
    const flagged: LibraryEntryT = { ...entry, urlHealth, updatedAt: now.toISOString() };
    await repo.save(flagged);
    const detail = err instanceof OfferBuildError || err instanceof PricingError ? err.message : urlHealth.note;
    return c.json({ entry: flagged, error: `URL not current — update with the latest. ${detail}` }, 409);
  }
});

libraryApi.post('/offers/library/:id/archive', async (c) => {
  const repo = libraryRepo(c.env);
  const entry = await repo.get(c.req.param('id'));
  if (!entry) return c.json({ error: 'That library entry no longer exists.' }, 404);
  const now = new Date().toISOString();
  const archived: LibraryEntryT = { ...entry, status: 'archived', archivedAt: now, updatedAt: now };
  await repo.save(archived);
  return c.json({ entry: archived });
});

libraryApi.post('/offers/library/:id/unarchive', async (c) => {
  const repo = libraryRepo(c.env);
  const entry = await repo.get(c.req.param('id'));
  if (!entry) return c.json({ error: 'That library entry no longer exists.' }, 404);
  const { archivedAt: _drop, ...rest } = entry;
  const restored: LibraryEntryT = { ...rest, status: 'current', updatedAt: new Date().toISOString() };
  await repo.save(restored);
  return c.json({ entry: restored });
});

libraryApi.post('/offers/library/:id/promote', async (c) => {
  const email = c.get('user').email;
  if (!isAdmin(c.env, email)) return c.json({ error: 'Only an admin can curate the shared shelves.' }, 403);
  const body = (await c.req.json().catch(() => ({}))) as { category?: unknown };
  const category = typeof body.category === 'string' && body.category.trim() ? body.category.trim().slice(0, 60) : undefined;
  if (!category) return c.json({ error: 'Give the shelf a name (category).' }, 422);
  const repo = libraryRepo(c.env);
  const entry = await repo.get(c.req.param('id'));
  if (!entry) return c.json({ error: 'That library entry no longer exists.' }, 404);
  const now = new Date().toISOString();
  // COPY, not move (Matt, 23 Sept 2026): the shared shelf gets its own entry; the salesperson keeps their own.
  // A new entry id so it never collides with the personal one; the admin becomes its owner.
  const shared: LibraryEntryT = { ...entry, id: crypto.randomUUID(), scope: 'shared', category, status: 'current', addedBy: email, addedAt: now, updatedAt: now, urlHealth: entry.urlHealth };
  await repo.save(shared);
  return c.json({ entry: shared });
});

libraryApi.delete('/offers/library/:id', async (c) => {
  const repo = libraryRepo(c.env);
  const entry = await repo.get(c.req.param('id'));
  // a salesperson may remove their own; an admin may remove any (incl. a shared shelf entry)
  if (entry && entry.addedBy !== c.get('user').email && !isAdmin(c.env, c.get('user').email)) return c.json({ error: 'That is not yours to delete.' }, 403);
  await repo.remove(c.req.param('id'));
  return c.json({ ok: true });
});

// ---------- Cron: keep URLs honest, purge the archive ----------

/**
 * Re-check the source URL of current library entries and flag any that no longer resolve to their vehicle, so a
 * dead URL is caught before a salesperson reaches for it (mirrors recheckLinkedBrochures). A transient failure changes
 * nothing. Bounded per run.
 */
export async function recheckLibraryUrls(env: Env, limit = 40): Promise<{ checked: number; flagged: number }> {
  const repo = libraryRepo(env);
  const d = db(env.DB);
  const rows = await d.select({ data: libraryEntries.data }).from(libraryEntries).where(eq(libraryEntries.status, 'current')).orderBy(libraryEntries.lastPricedAt).limit(limit).all();
  const source = urlSource(env);
  let flagged = 0;
  const now = new Date().toISOString();
  for (const row of rows) {
    const parsed = LibraryEntry.safeParse(row.data);
    if (!parsed.success) continue;
    const entry = parsed.data;
    try {
      await source.lookupFull({ url: entry.offer.offerUrl, createdBy: entry.addedBy });
      if (entry.urlHealth.state !== 'ok') await repo.save({ ...entry, urlHealth: { state: 'ok', checkedAt: now }, lastPricedAt: now, updatedAt: now });
    } catch (err) {
      if (!(err instanceof OfferPageError || err instanceof LookupError || err instanceof OfferUrlError || err instanceof PricingError)) continue; // transient
      const gone = err instanceof OfferPageError || err instanceof LookupError || err instanceof OfferUrlError;
      await repo.save({ ...entry, urlHealth: { state: gone ? 'gone' : 'moved', checkedAt: now, note: 'The offer page could not be priced. Update this entry with the latest URL.' }, updatedAt: now });
      flagged += 1;
    }
  }
  return { checked: rows.length, flagged };
}

/** Purge archived library entries older than 6 months (LIBRARY_ARCHIVE_PURGE_DAYS). Called from the retention Cron. */
export async function purgeArchivedLibrary(env: Env, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - LIBRARY_ARCHIVE_PURGE_DAYS * 86_400_000).toISOString();
  const r = await env.DB.prepare("DELETE FROM library_entries WHERE status = 'archived' AND archived_at < ?").bind(cutoff).run();
  return r.meta?.changes ?? 0;
}
