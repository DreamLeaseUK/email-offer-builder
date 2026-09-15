/**
 * Build step 3 end to end inside workerd: lookup route with the D1 cache and the image pipeline,
 * stored-file routes, brochure routes with real D1 and R2, and the Firecrawl client's wire format.
 * Outbound fetch is stubbed; the app runs in this isolate so the stub applies to it too.
 */
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findCapIdLeak } from '@offer-mailer/schema';
import type { Brochure } from '@offer-mailer/schema';
import type { LookupResult } from '@offer-mailer/adapters';
import pageHtml from '../../../packages/adapters/test/fixtures/offer-page-personal.html?raw';
import pricingJson from '../../../packages/adapters/test/fixtures/pricing-personal.json?raw';
import app from '../src/index.js';
import type { Env } from '../src/env.js';
import { vehicleImageStore } from '../src/files.js';

const USER = 'matt.wilson@dreamlease.co.uk';
const authed = (over: Partial<Env> = {}): Env => ({ ...env, DEV_USER_EMAIL: USER, ...over }) as Env;
/** .dev.vars may carry a real FIRECRAWL_API_KEY; tests of the no-key behaviour force it empty. */
const noKey = (over: Partial<Env> = {}): Env => authed({ ...over, FIRECRAWL_API_KEY: '' });
/** The pool loads .dev.vars, so the bare env already has a dev user; this one has none. */
const { DEV_USER_EMAIL: _devUser, ...anonRest } = env as Env;
const anon = anonRest as Env;

/** 1×1 PNG. */
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
const PDF = new TextEncoder().encode('%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');

const PAGE_URL = 'https://www.dreamlease.co.uk/offers/personal/byd-seal-390kw-excellence-83kwh-awd-102n/?initialRental=12&contractLength=48&annualMileage=6000&includeMaintenance=false';

// ---------- outbound fetch stub ----------

interface Route {
  origin: string;
  path: string | ((p: string) => boolean);
  reply: (body: string | undefined) => Response;
}
const routes: Route[] = [];
const calls: { url: string; method: string; body?: string }[] = [];

function on(origin: string, path: Route['path'], reply: Route['reply']): void {
  routes.push({ origin, path, reply });
}
const bytes = (data: Uint8Array | ArrayBuffer, type: string, status = 200) => () => new Response(data as BodyInit, { status, headers: { 'content-type': type } });
const text = (data: string, type: string, status = 200) => () => new Response(data, { status, headers: { 'content-type': type } });
const json = (data: unknown) => () => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  routes.length = 0;
  calls.length = 0;
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(String(input), init);
    const u = new URL(req.url);
    const body = req.method === 'POST' ? await req.text() : undefined;
    calls.push({ url: req.url, method: req.method, ...(body !== undefined ? { body } : {}) });
    const route = routes.find((r) => r.origin === u.origin && (typeof r.path === 'string' ? r.path === u.pathname : r.path(u.pathname)));
    return route ? route.reply(body) : new Response(`unmocked ${req.url}`, { status: 599 });
  });
});
afterEach(() => vi.unstubAllGlobals());

function mockSite(): void {
  on('https://www.dreamlease.co.uk', (p) => p.startsWith('/offers/personal/byd-seal'), text(pageHtml, 'text/html; charset=utf-8'));
  on('https://www.dreamlease.co.uk', '/api/carresults/GetOfferDropdownsForCar', text(pricingJson, 'application/json'));
  on('https://images.example.invalid', '/vehicle.webp', bytes(PNG, 'image/png'));
}

const post = (body: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('image pipeline', () => {
  it('transforms the source image to a JPEG in R2 under its hash and returns only our URL', async () => {
    on('https://images.example.invalid', '/one.png', bytes(PNG, 'image/png'));
    const image = await vehicleImageStore(env).store('https://images.example.invalid/one.png', 'BYD Seal');
    expect(image).toBeDefined();
    expect(image!.key).toMatch(/^vehicles\/[a-f0-9]{64}\.jpg$/);
    expect(image!.url).toBe(`${env.PUBLIC_BASE_URL}/f/${image!.key}`);
    expect(image!.width).toBeGreaterThan(0);
    expect(image!.height).toBeGreaterThan(0);
    expect(JSON.stringify(image)).not.toMatch(/example\.invalid/);
    const stored = await env.IMAGES.get(image!.key);
    expect(stored?.httpMetadata?.contentType).toBe('image/jpeg');

    const res = await app.request(`/f/${image!.key}`, {}, env);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(res.headers.get('cache-control')).toMatch(/immutable/);
  });

  it('returns nothing when the source cannot be fetched', async () => {
    on('https://images.example.invalid', '/missing.png', text('no', 'text/plain', 404));
    expect(await vehicleImageStore(env).store('https://images.example.invalid/missing.png', 'x')).toBeUndefined();
  });

  it('404s for keys that are not a hash', async () => {
    expect((await app.request('/f/vehicles/../secret.jpg', {}, env)).status).toBe(404);
    expect((await app.request(`/f/vehicles/${'0'.repeat(64)}.jpg`, {}, env)).status).toBe(404);
  });
});

describe('POST /api/offers/lookup', () => {
  it('needs a login and a URL', async () => {
    expect((await app.request('/api/offers/lookup', post({ url: PAGE_URL }), anon)).status).toBe(503);
    expect((await app.request('/api/offers/lookup', { method: 'POST', body: 'nope' }, authed())).status).toBe(400);
    expect((await app.request('/api/offers/lookup', post({}), authed())).status).toBe(400);
  });

  it('rejects a non-vehicle URL with a message the UI can show', async () => {
    const res = await app.request('/api/offers/lookup', post({ url: 'https://www.dreamlease.co.uk/hubs/in-stock/' }), authed());
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toMatch(/vehicle page/);
    expect(calls).toEqual([]);
  });

  it('returns a validated offer with our image, caches it in D1 and serves the cache next time', async () => {
    mockSite();
    const first = await app.request('/api/offers/lookup', post({ url: PAGE_URL }), authed());
    expect(first.status).toBe(200);
    const r1 = (await first.json()) as LookupResult;
    expect(r1.cached).toBe(false);
    expect(r1.offer.vehicle.model).toBe('Seal');
    expect(r1.offer.pricing.monthly).toBe(347.8);
    expect(r1.offer.createdBy).toBe(USER);
    expect(r1.offer.image?.url).toMatch(/\/f\/vehicles\/[a-f0-9]{64}\.jpg$/);
    expect(r1.options.contractLength.length).toBe(6);
    expect(r1.warnings).toEqual([]);
    expect(findCapIdLeak(r1)).toBeNull();

    const row = await env.DB.prepare('select url_key, data from lookup_cache').first<{ url_key: string; data: string }>();
    expect(row?.url_key).toBe('https://www.dreamlease.co.uk/offers/personal/byd-seal-390kw-excellence-83kwh-awd-102n/?initialRental=12&contractLength=48&annualMileage=6000&includeMaintenance=false');
    expect(row?.data).not.toMatch(/capId|motorleaseplatform|example\.invalid|000000/i);

    const before = calls.length;
    const second = await app.request('/api/offers/lookup', post({ url: `${PAGE_URL}&utm_medium=x` }), authed({ DEV_USER_EMAIL: 'sam.carter@dreamlease.co.uk' }));
    const r2 = (await second.json()) as LookupResult;
    expect(r2.cached).toBe(true);
    expect(r2.offer.id).toBe(r1.offer.id);
    expect(r2.offer.createdBy).toBe('sam.carter@dreamlease.co.uk');
    expect(calls.length).toBe(before);
  });

  it('answers 502 with a clear message when the site cannot be read', async () => {
    on('https://www.dreamlease.co.uk', (p) => p.startsWith('/offers/'), text('blocked', 'text/html', 503));
    const res = await app.request('/api/offers/lookup', post({ url: 'https://www.dreamlease.co.uk/offers/personal/kia-ev3-gt-line-81kwh-5dr-auto-109ty/?offer=p-9-36-8000-n' }), noKey());
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: string }).error).toMatch(/could not be fetched/);
  });
});

describe('brochures', () => {
  const vehicle = { make: 'Kia', model: 'EV3' };

  it('needs a login', async () => {
    expect((await app.request('/api/brochures/ensure', post(vehicle), anon)).status).toBe(503);
  });

  it('refuses to harvest without a Firecrawl key but still returns a stored copy', async () => {
    const before = await app.request('/api/brochures/ensure', post(vehicle), noKey());
    expect(before.status).toBe(503);
    on('https://www.kia.co.uk', '/ev3.pdf', bytes(PDF, 'application/pdf'));
    const manual = await app.request('/api/brochures/manual', post({ ...vehicle, url: 'https://www.kia.co.uk/ev3.pdf' }), noKey());
    expect(manual.status).toBe(200);
    const after = await app.request('/api/brochures/ensure', post(vehicle), noKey());
    expect(after.status).toBe(200);
    expect(((await after.json()) as { state: string }).state).toBe('stored');
  });

  it('serves a manual PDF at /b/:id, redirects a gated one, and keeps serving a superseded copy', async () => {
    const car = { make: 'Hyundai', model: 'Kona Electric' };
    on('https://www.hyundai.co.uk', '/kona.pdf', bytes(PDF, 'application/octet-stream'));
    const first = (await (await app.request('/api/brochures/manual', post({ ...car, url: 'https://www.hyundai.co.uk/kona.pdf' }), authed())).json()) as { brochure: Brochure };
    expect(first.brochure.kind).toBe('pdf');
    expect(first.brochure.ukVerified.by).toBe('user');
    expect(first.brochure.file?.url).toMatch(/\/f\/brochures\/[a-f0-9]{64}\.pdf$/);

    const served = await app.request(`/b/${first.brochure.id}`, {}, env);
    expect(served.status).toBe(200);
    expect(served.headers.get('content-type')).toBe('application/pdf');
    expect(served.headers.get('content-disposition')).toMatch(/Hyundai Kona Electric brochure \(UK\)\.pdf/);
    expect(new TextDecoder().decode(await served.arrayBuffer()).startsWith('%PDF')).toBe(true);
    expect((await app.request(`/f/brochures/${first.brochure.file!.sha256}.pdf`, {}, env)).status).toBe(200);

    const second = (await (await app.request('/api/brochures/manual', post({ ...car, url: 'https://www.hyundai.co.uk/request-a-brochure' }), authed())).json()) as { brochure: Brochure };
    expect(second.brochure.kind).toBe('gated');
    const redirected = await app.request(`/b/${second.brochure.id}`, {}, env);
    expect(redirected.status).toBe(302);
    expect(redirected.headers.get('location')).toBe('https://www.hyundai.co.uk/request-a-brochure');

    const current = (await (await app.request('/api/brochures/current?make=Hyundai&model=Kona%20Electric', {}, authed())).json()) as { brochure: Brochure };
    expect(current.brochure.id).toBe(second.brochure.id);
    expect((await app.request(`/b/${first.brochure.id}`, {}, env)).status).toBe(200);
    const oldRow = await env.DB.prepare('select status from brochures where id = ?').bind(first.brochure.id).first<{ status: string }>();
    expect(oldRow?.status).toBe('superseded');
  });

  it('accepts an uploaded PDF and rejects a non-PDF upload', async () => {
    const form = new FormData();
    form.set('make', 'BMW');
    form.set('model', 'iX1');
    form.set('pdf', new File([PDF], 'ix1.pdf', { type: 'application/pdf' }));
    const ok = await app.request('/api/brochures/manual', { method: 'POST', body: form }, authed());
    expect(ok.status).toBe(200);
    const bad = new FormData();
    bad.set('make', 'BMW');
    bad.set('model', 'iX1');
    bad.set('pdf', new File([new TextEncoder().encode('hello')], 'ix1.txt', { type: 'text/plain' }));
    expect((await app.request('/api/brochures/manual', { method: 'POST', body: bad }, authed())).status).toBe(422);
  });

  it('harvests through Firecrawl with the v2 wire format when a key is set', async () => {
    on('https://api.firecrawl.dev', '/v2/search', json({ success: true, creditsUsed: 2, data: { web: [{ url: 'https://www.tesla.com/de_de/brochure.pdf' }, { url: 'https://www.tesla.com/en_gb/model3-brochure.pdf', title: 'Model 3' }] } }));
    on('https://api.firecrawl.dev', '/v2/scrape', json({ success: true, data: { markdown: 'Model 3 from £39,990 OTR' } }));
    on('https://www.tesla.com', '/en_gb/model3-brochure.pdf', bytes(PDF, 'application/pdf'));

    const res = await app.request('/api/brochures/ensure', post({ make: 'Tesla', model: 'Model 3' }), authed({ FIRECRAWL_API_KEY: 'fc-test' }));
    expect(res.status).toBe(200);
    const r = (await res.json()) as { brochure: Brochure; state: string };
    expect(r.state).toBe('fresh');
    expect(r.brochure.kind).toBe('pdf');
    expect(r.brochure.sourceUrl).toBe('https://www.tesla.com/en_gb/model3-brochure.pdf');
    expect(r.brochure.ukVerified).toEqual({ by: 'content', note: 'tesla.com/en_gb, £ pricing on the first pages' });
    expect(findCapIdLeak(r)).toBeNull();

    const search = calls.find((c) => c.url.endsWith('/v2/search'));
    expect(JSON.parse(search?.body ?? '{}')).toMatchObject({ query: 'Tesla Model 3 brochure pdf', country: 'GB', limit: 10 });
    const scrape = calls.find((c) => c.url.endsWith('/v2/scrape'));
    expect(JSON.parse(scrape?.body ?? '{}')).toMatchObject({ url: 'https://www.tesla.com/en_gb/model3-brochure.pdf', formats: ['markdown'], parsers: [{ type: 'pdf', maxPages: 2 }] });
    expect(calls.some((c) => c.url.includes('de_de'))).toBe(false);
  });
});

describe('health', () => {
  it('reports the images and firecrawl bindings', async () => {
    const body = (await (await app.request('/health', {}, noKey())).json()) as { images: boolean; firecrawl: boolean; db: string };
    expect(body.db).toBe('ok');
    expect(body.images).toBe(true);
    expect(body.firecrawl).toBe(false);
  });
});
