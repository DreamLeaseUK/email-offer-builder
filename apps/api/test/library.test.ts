/**
 * Offer library — the curated repository (LibraryEntry) inside workerd with real local D1. Two scopes
 * (personal / shared), the current/archived lifecycle, the 6-month purge, admin curation, and the dead-URL flag.
 */
import { env } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LIBRARY_ARCHIVE_PURGE_DAYS, findCapIdLeak, libraryFacets } from '@offer-mailer/schema';
import type { LibraryEntry, Offer } from '@offer-mailer/schema';
import { fixtureCampaign } from '@offer-mailer/render/fixtures';
import app from '../src/index.js';
import { purgeArchivedLibrary, withStoredBrochure } from '../src/library.js';
import type { Env } from '../src/env.js';
import { SAME_ORIGIN } from './same-origin.js';

const USER = 'matt.wilson@dreamlease.co.uk'; // the configured master admin
const REP = 'salesperson@dreamlease.co.uk';
const authed = (over: Partial<Env> = {}): Env => ({ ...env, DEV_USER_EMAIL: USER, ...over }) as Env;
const asRep = () => authed({ DEV_USER_EMAIL: REP });
const { DEV_USER_EMAIL: _dev, ...anonRest } = env as Env;
const anon = anonRest as Env;

const anOffer = (over: Partial<Offer> = {}): Offer => ({ ...fixtureCampaign({ offerCount: 1 }).campaign.offers[0]!, ...over });
const save = (offer: unknown, e: Env) => app.request('/api/offers/library', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ offer }) }, e);
const post = (path: string, e: Env, body?: unknown) => app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }, e);
const current = async (e: Env, qs = '') => ((await (await app.request(`/api/offers/library${qs}`, {}, e)).json()) as { entries: LibraryEntry[] }).entries;
const archived = async (e: Env, qs = '') => ((await (await app.request(`/api/offers/library/archived${qs}`, {}, e)).json()) as { entries: LibraryEntry[] }).entries;

/** Insert a LibraryEntry straight into D1 (for lifecycle/purge tests that need a crafted date). */
async function insert(e: LibraryEntry): Promise<void> {
  const f = libraryFacets(e.offer);
  await env.DB.prepare(
    'insert or replace into library_entries (id, scope, category, status, url_health, make, model, fuel_type, body_style, contract_type, monthly, vehicle_key, valid_until, added_by, added_at, archived_at, last_priced_at, updated_at, data) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
  )
    .bind(e.id, e.scope, e.category ?? null, e.status, e.urlHealth.state, f.make, f.model, f.fuelType ?? null, f.bodyStyle ?? null, f.contractType, f.monthly, f.vehicleKey, f.validUntil, e.addedBy, e.addedAt, e.archivedAt ?? null, e.lastPricedAt ?? null, e.updatedAt, JSON.stringify(e))
    .run();
}
const entry = (over: Partial<LibraryEntry> & { offer: Offer }): LibraryEntry => ({ id: over.offer.id, scope: 'personal', status: 'current', urlHealth: { state: 'ok' }, addedBy: USER, addedAt: '2026-09-23T09:00:00.000Z', updatedAt: '2026-09-23T09:00:00.000Z', ...over });

afterEach(() => vi.unstubAllGlobals());

describe('offer library', () => {
  it('needs a login', async () => {
    expect((await save(anOffer(), anon)).status).toBe(503);
  });

  it('saves to the caller’s personal shelf, current and priced, lists it, and deletes it', async () => {
    const o = anOffer({ id: '1a000000-0000-4000-8000-000000000001' });
    const res = await save(o, authed());
    expect(res.status).toBe(201);
    const e = ((await res.json()) as { entry: LibraryEntry }).entry;
    expect(e).toMatchObject({ scope: 'personal', status: 'current', addedBy: USER, urlHealth: { state: 'ok' } });
    expect(e.offer.createdBy).toBe(USER);
    expect(e.lastPricedAt).toBeTruthy();
    expect(findCapIdLeak(e)).toBeNull();

    expect((await current(authed())).some((x) => x.id === o.id)).toBe(true);
    expect((await app.request(`/api/offers/library/${o.id}`, { method: 'DELETE', headers: SAME_ORIGIN }, authed())).status).toBe(200);
    expect((await current(authed())).some((x) => x.id === o.id)).toBe(false);
  });

  it('is personal: one salesperson does not see another’s saved offers', async () => {
    const mine = anOffer({ id: '1a000000-0000-4000-8000-000000000002' });
    await save(mine, authed());
    expect((await current(asRep())).some((x) => x.id === mine.id)).toBe(false);
  });

  it('rejects an invalid offer', async () => {
    expect((await save({ not: 'an offer' }, authed())).status).toBe(422);
  });

  it('never hands on the site’s HTML entity, saved now or stored before the fix', async () => {
    const ENTITY = '110kW Techno &#x2B; Comfort Range 52kWh 5dr Auto';
    const CLEAN = '110kW Techno + Comfort Range 52kWh 5dr Auto';
    const withEntity = (id: string): Offer => anOffer({ id, vehicle: { ...anOffer().vehicle, derivative: ENTITY } });
    const res = await save(withEntity('0e000000-0000-4000-8000-000000000001'), authed());
    expect(((await res.json()) as { entry: LibraryEntry }).entry.offer.vehicle.derivative).toBe(CLEAN);
    await insert(entry({ offer: { ...withEntity('0e000000-0000-4000-8000-000000000002'), createdBy: USER } }));
    for (const e of (await current(authed())).filter((x) => x.id.startsWith('0e000000-'))) expect(e.offer.vehicle.derivative).toBe(CLEAN);
  });

  it('archives out of the current list and back, and an admin promotes to a shared shelf', async () => {
    const o = anOffer({ id: '1a000000-0000-4000-8000-000000000003' });
    await save(o, authed());
    expect((await post(`/api/offers/library/${o.id}/archive`, authed())).status).toBe(200);
    expect((await current(authed())).some((x) => x.id === o.id)).toBe(false);
    expect((await archived(authed())).some((x) => x.id === o.id)).toBe(true);
    await post(`/api/offers/library/${o.id}/unarchive`, authed());
    expect((await current(authed())).some((x) => x.id === o.id)).toBe(true);

    // a salesperson cannot curate the shared shelves; an admin can
    expect((await post(`/api/offers/library/${o.id}/promote`, asRep(), { category: 'EVs' })).status).toBe(403);
    expect((await post(`/api/offers/library/${o.id}/promote`, authed(), { category: 'EVs' })).status).toBe(200);
    // COPY: the salesperson keeps their personal entry, AND a shared entry appears on the shelf (a new entry id, same offer)
    expect((await current(authed())).some((x) => x.id === o.id)).toBe(true);
    const shelf = await current(authed(), '?scope=shared&category=EVs');
    const promoted = shelf.find((x) => x.offer.id === o.id);
    expect(promoted).toMatchObject({ scope: 'shared', category: 'EVs' });
    expect(promoted!.id).not.toBe(o.id); // its own entry id, distinct from the personal one
  });

  it('the smart shelf filters by price: "under £300" shows only current shared entries below £300', async () => {
    const cheap = anOffer({ id: '5a000000-0000-4000-8000-000000000001' });
    cheap.pricing = { ...cheap.pricing, monthly: 249 };
    const dear = anOffer({ id: '5a000000-0000-4000-8000-000000000002' });
    dear.pricing = { ...dear.pricing, monthly: 620 };
    await insert(entry({ offer: cheap, scope: 'shared', category: 'PCH latest deals' }));
    await insert(entry({ offer: dear, scope: 'shared', category: 'PCH latest deals' }));
    const under = await current(authed(), '?scope=shared&maxMonthly=300');
    expect(under.some((x) => x.offer.id === cheap.id)).toBe(true);
    expect(under.some((x) => x.offer.id === dear.id)).toBe(false);
  });

  it('lists most-recently-added first and searches by make/model', async () => {
    await insert(entry({ offer: anOffer({ id: '2a000000-0000-4000-8000-000000000001', vehicle: { ...anOffer().vehicle, make: 'Polestar', model: '2' } }), addedAt: '2026-09-20T09:00:00.000Z' }));
    await insert(entry({ offer: anOffer({ id: '2a000000-0000-4000-8000-000000000002', vehicle: { ...anOffer().vehicle, make: 'Kia', model: 'EV3' } }), addedAt: '2026-09-23T09:00:00.000Z' }));
    const list = await current(authed());
    const idx = (id: string) => list.findIndex((x) => x.id === id);
    expect(idx('2a000000-0000-4000-8000-000000000002')).toBeLessThan(idx('2a000000-0000-4000-8000-000000000001')); // newest first
    const kia = await current(authed(), '?q=polestar');
    expect(kia.every((x) => x.offer.vehicle.make === 'Polestar')).toBe(true);
    expect(kia.length).toBeGreaterThan(0);
  });

  it('flags a dead source URL on reprice and returns 409 "update with the latest"', async () => {
    const o = anOffer({ id: '3a000000-0000-4000-8000-000000000001' });
    await save(o, authed());
    vi.stubGlobal('fetch', vi.fn(async () => new Response('gone', { status: 404 })));
    // no Firecrawl fallback here, so a 404 is a clean "gone" rather than a fallback error
    const res = await post(`/api/offers/library/${o.id}/reprice`, authed({ FIRECRAWL_API_KEY: '' }));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; entry: LibraryEntry };
    expect(body.error).toMatch(/URL not current — update with the latest/);
    expect(body.entry.urlHealth.state).toBe('gone');
    expect(body.entry.urlHealth.note).toBeTruthy();
  });

  it('re-attaches the model’s stored brochure to an offer priced for use; a European edition stays unticked', () => {
    const pdf = Object.values(fixtureCampaign({ offerCount: 1, brochure: 'pdf' }).brochures)[0]!;
    const o = anOffer();
    expect(withStoredBrochure(o, pdf).brochure).toEqual({ brochureId: pdf.id, include: true }); // UK: attached and included
    expect(withStoredBrochure(o, { ...pdf, market: 'eu' }).brochure).toEqual({ brochureId: pdf.id, include: false }); // EU: offered, unticked
    expect(withStoredBrochure(o, pdf, false).brochure).toEqual({ brochureId: pdf.id, include: false }); // a prior explicit choice wins
    expect(withStoredBrochure(o, undefined).brochure).toBeUndefined(); // nothing stored → the offer is unchanged
  });

  it('purges archived entries older than six months, keeping recent archived and all current', async () => {
    const old = new Date(Date.now() - (LIBRARY_ARCHIVE_PURGE_DAYS + 5) * 86_400_000).toISOString();
    const recent = new Date(Date.now() - 10 * 86_400_000).toISOString();
    await insert(entry({ offer: anOffer({ id: '4a000000-0000-4000-8000-000000000001' }), status: 'archived', archivedAt: old }));
    await insert(entry({ offer: anOffer({ id: '4a000000-0000-4000-8000-000000000002' }), status: 'archived', archivedAt: recent }));
    await insert(entry({ offer: anOffer({ id: '4a000000-0000-4000-8000-000000000003' }), status: 'current' }));
    const purged = await purgeArchivedLibrary(env as Env, new Date());
    expect(purged).toBe(1);
    const ids = new Set([...(await current(authed())), ...(await archived(authed()))].map((x) => x.id));
    expect(ids.has('4a000000-0000-4000-8000-000000000001')).toBe(false); // old archived gone
    expect(ids.has('4a000000-0000-4000-8000-000000000002')).toBe(true); // recent archived kept
    expect(ids.has('4a000000-0000-4000-8000-000000000003')).toBe(true); // current kept
  });
});
