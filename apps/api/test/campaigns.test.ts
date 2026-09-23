/**
 * Campaign persistence, the /r redirect and click/view logging (brief §5.4, §5.6), end to end inside
 * workerd with real local D1 and R2. No outbound fetch: rendering is pure and the offers are fixtures.
 */
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { findCapIdLeak } from '@offer-mailer/schema';
import type { Campaign } from '@offer-mailer/schema';
import { fixtureCampaign } from '@offer-mailer/render/fixtures';
import app from '../src/index.js';
import { salespersonTag } from '../src/campaigns.js';
import type { Env } from '../src/env.js';

const USER = 'matt.wilson@dreamlease.co.uk';
const authed = (over: Partial<Env> = {}): Env => ({ ...env, DEV_USER_EMAIL: USER, ...over }) as Env;
const { DEV_USER_EMAIL: _dev, ...anonRest } = env as Env;
const anon = anonRest as Env;

const post = (body: unknown, e: Env) => app.request('/api/campaigns', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, e);

/** A valid draft built from the render fixtures (real, schema-valid offers and sender). */
function draft(over: Record<string, unknown> = {}) {
  const { campaign } = fixtureCampaign({ offerCount: 2, brochure: 'none' });
  return {
    name: campaign.name,
    useCase: campaign.useCase,
    subject: campaign.subject,
    preheader: campaign.preheader,
    intro: campaign.intro,
    layout: 'grid2',
    offers: campaign.offers,
    sender: campaign.sender,
    recipient: campaign.recipient,
    ...over,
  };
}

async function createCampaign(e = authed()): Promise<{ campaign: Campaign; hostedUrl: string; layout: string }> {
  const res = await post(draft(), e);
  expect(res.status).toBe(201);
  return (await res.json()) as { campaign: Campaign; hostedUrl: string; layout: string };
}

describe('salespersonTag', () => {
  it('derives a stable, readable tag from the work email local part', () => {
    expect(salespersonTag('matt.wilson@dreamlease.co.uk')).toBe('matt-wilson');
    expect(salespersonTag('Jo.Bloggs+sales@dreamlease.co.uk')).toBe('jo-bloggs-sales');
    expect(salespersonTag('weird@@x')).toBe('weird');
  });
});

describe('POST /api/campaigns', () => {
  it('needs a login', async () => {
    expect((await post(draft(), anon)).status).toBe(503);
  });

  it('assembles, renders, writes the hosted page and stores the campaign with its link map', async () => {
    const { campaign, hostedUrl, layout } = await createCampaign();
    expect(layout).toBe('stack'); // the draft names grid2 (accepted for stored campaigns); the grids were deleted 22 Sept, it renders stacked
    expect(campaign.hostedPage.slug).toMatch(/^[A-Za-z0-9_-]{16,}$/);
    expect(campaign.createdBy).toBe(USER);
    expect(campaign.tracking.utm.utm_term).toBe('matt-wilson'); // salesperson attribution tag, auto-generated
    expect(campaign.status).toBe('draft');
    expect(hostedUrl).toBe(campaign.hostedPage.url);
    expect(findCapIdLeak(campaign)).toBeNull();

    // hosted page is live
    const hosted = await app.request(`/c/${campaign.hostedPage.slug}`, {}, env);
    expect(hosted.status).toBe(200);

    // retrievable by id and in the caller's list
    const one = await app.request(`/api/campaigns/${campaign.id}`, {}, authed());
    expect(one.status).toBe(200);
    const list = (await (await app.request('/api/campaigns', {}, authed())).json()) as { campaigns: Campaign[] };
    expect(list.campaigns.some((c) => c.id === campaign.id)).toBe(true);

    // the link map was stored: the offer CTA and the hosted link resolve
    const row = await env.DB.prepare('select links from campaigns where id = ?').bind(campaign.id).first<{ links: string }>();
    const links = JSON.parse(row!.links) as Record<string, string>;
    expect(links['hosted']).toBe(campaign.hostedPage.url);
    expect(Object.keys(links)).toContain('o1-cta');
    // the footer homepage link back to the website carries the salesperson attribution too
    expect(links['footer-site']).toContain('utm_term=matt-wilson');
    expect(links['footer-site']).toContain('utm_campaign=');
    expect(row!.links).not.toMatch(/capId|motorleaseplatform/i);
  });

  it('does not persist recipient PII, keeps the name off the hosted page, but still greets in the email', async () => {
    // the draft carries a recipient (fixture: Priya + email)
    const res = await post(draft(), authed());
    const body = (await res.json()) as { campaign: Campaign; html: string; text: string };
    const id = body.campaign.id;

    // stored snapshot has no recipient object, and none of the recipient's structured PII (e.g. their
    // email) survives. (The campaign *name* is salesperson-authored internal metadata, not a recipient field.)
    const row = await env.DB.prepare('select data from campaigns where id = ?').bind(id).first<{ data: string }>();
    const stored = JSON.parse(row!.data) as Record<string, unknown>;
    expect(stored.recipient).toBeUndefined();
    expect(row!.data).not.toContain('priya@example.com');
    const readBack = (await (await app.request(`/api/campaigns/${id}`, {}, authed())).json()) as { campaign: Record<string, unknown> };
    expect(readBack.campaign.recipient).toBeUndefined();

    // the public hosted page carries no customer name, but the salesperson's email copy still greets them
    const hosted = await (await app.request(`/c/${body.campaign.hostedPage.slug}`, {}, env)).text();
    expect(hosted).not.toContain('Hi Priya,');
    expect(body.html).toContain('Hi Priya,');
  });

  it('returns the rendered html (with working /r links) for Copy-for-Outlook', async () => {
    const res = await post(draft(), authed());
    const body = (await res.json()) as { campaign: Campaign; html: string; text: string };
    expect(body.html).toContain('<!DOCTYPE');
    expect(body.html).toContain(`/r/${body.campaign.hostedPage.slug}/`);
    expect(body.text).toContain('View these offers online');
  });

  it('decodes an HTML entity an offer still carries (saved or opened before a parser fix): email, hosted page, preview and the stored record', async () => {
    const stale = draft({ layout: 'auto' });
    (stale.offers as { vehicle: { derivative: string } }[])[0]!.vehicle.derivative = '110kW Techno &#x2B; Comfort Range 52kWh 5dr Auto';

    const res = await post(stale, authed());
    expect(res.status).toBe(201);
    const body = (await res.json()) as { campaign: Campaign; html: string; text: string };
    for (const out of [body.html, body.text]) {
      expect(out).toContain('110kW Techno + Comfort Range 52kWh 5dr Auto');
      expect(out).not.toMatch(/x2B/i);
    }
    expect(body.campaign.offers[0]!.vehicle.derivative).toBe('110kW Techno + Comfort Range 52kWh 5dr Auto');
    const row = await env.DB.prepare('select data from campaigns where id = ?').bind(body.campaign.id).first<{ data: string }>();
    expect(row!.data).not.toMatch(/x2B/i);
    const hosted = await (await app.request(`/c/${body.campaign.hostedPage.slug}`, {}, env)).text();
    expect(hosted).not.toMatch(/x2B/i);

    const preview = await app.request('/api/campaigns/preview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(stale) }, authed());
    expect(((await preview.json()) as { html: string }).html).not.toMatch(/x2B/i);
  });

  it('rejects mixed contract types and an invalid body', async () => {
    const mixed = draft();
    (mixed.offers as { contractType: string }[])[1]!.contractType = 'business';
    expect((await post(mixed, authed())).status).toBe(422);
    expect((await post({ name: '' }, authed())).status).toBe(422);
    expect((await app.request('/api/campaigns', { method: 'POST', body: 'not json' }, authed())).status).toBe(400);
  });
});

describe('POST /api/campaigns/preview', () => {
  it('renders a draft without persisting it', async () => {
    const before = (await env.DB.prepare('select count(*) as n from campaigns').first<{ n: number }>())!.n;
    const res = await app.request('/api/campaigns/preview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(draft({ layout: 'stack' })) }, authed());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { html: string; layout: string };
    expect(body.layout).toBe('stack');
    expect(body.html).toContain('<!DOCTYPE');
    const after = (await env.DB.prepare('select count(*) as n from campaigns').first<{ n: number }>())!.n;
    expect(after).toBe(before);
  });
});

describe('GET /r/:slug/:link', () => {
  it('resolves a stored link, logs the click and 302s to the destination', async () => {
    const { campaign } = await createCampaign();
    const res = await app.request(`/r/${campaign.hostedPage.slug}/o1-cta`, {}, env);
    expect(res.status).toBe(302);
    const dest = res.headers.get('location')!;
    expect(dest).toContain('dreamlease.co.uk');
    expect(dest).toContain('utm_source=offer_mailer');
    expect(dest).toContain('utm_term=matt-wilson'); // the salesperson is identifiable for enquiry attribution

    const click = await env.DB.prepare("select kind, ua_class from clicks where campaign_id = ? and link_id = 'o1-cta'").bind(campaign.id).first<{ kind: string; ua_class: string }>();
    expect(click?.kind).toBe('click');
  });

  it('404s for an unknown slug or an unknown link id', async () => {
    const { campaign } = await createCampaign();
    expect((await app.request('/r/nosuchslugnosuchslug/o1-cta', {}, env)).status).toBe(404);
    expect((await app.request(`/r/${campaign.hostedPage.slug}/o9-cta`, {}, env)).status).toBe(404);
  });
});

describe('stats', () => {
  it('counts clicks and hosted views and excludes link scanners', async () => {
    const { campaign } = await createCampaign();
    const slug = campaign.hostedPage.slug;
    const desktop = { headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } };
    const scanner = { headers: { 'user-agent': 'Mozilla/5.0 (Proofpoint URL Defense)' } };

    await app.request(`/r/${slug}/o1-cta`, desktop, env); // real click
    await app.request(`/r/${slug}/o1-cta`, scanner, env); // scanner pre-fetch, excluded
    await app.request(`/c/${slug}`, desktop, env); // hosted view

    const stats = (await (await app.request(`/api/campaigns/${campaign.id}/stats`, {}, authed())).json()) as {
      clicks: number;
      views: number;
      byLink: { linkId: string; count: number }[];
      scannerHits: number;
      lastClick: string | null;
      lastView: string | null;
    };
    expect(stats.clicks).toBe(1);
    expect(stats.views).toBe(1);
    expect(stats.scannerHits).toBe(1);
    expect(stats.byLink).toContainEqual({ linkId: 'o1-cta', count: 1 });
    expect(stats.lastClick).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(stats.lastView).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('404s stats for an unknown campaign', async () => {
    expect((await app.request('/api/campaigns/00000000-0000-4000-8000-000000000000/stats', {}, authed())).status).toBe(404);
  });
});

describe('promotions register', () => {
  it('returns the register as JSON columns + rows', async () => {
    const { campaign } = await createCampaign();
    const res = await app.request('/api/register', {}, authed());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { columns: { key: string; label: string }[]; rows: Record<string, string>[] };
    expect(body.columns.map((c) => c.key)).toContain('subject');
    const row = body.rows.find((r) => r.campaignCode === campaign.tracking.campaignCode);
    expect(row?.subject).toBe(campaign.subject);
    expect(row?.hostedUrl).toBe(campaign.hostedPage.url);
    expect(row?.intro).toBe(campaign.intro);
  });

  it('exports the same as a CSV download', async () => {
    const { campaign } = await createCampaign();
    const res = await app.request('/api/register.csv', {}, authed());
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/csv/);
    expect(res.headers.get('content-disposition')).toMatch(/promotions-register\.csv/);
    const csv = await res.text();
    expect(csv.split('\r\n')[0]).toContain('Subject');
    expect(csv).toContain(campaign.subject);
    expect(csv).toContain(campaign.hostedPage.url);
  });
});
