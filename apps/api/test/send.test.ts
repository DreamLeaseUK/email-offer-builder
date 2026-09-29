/**
 * Connect Outlook and Send (Phase 1), end to end inside workerd with real local D1 and R2 and a stand-in for
 * Microsoft (sign-in and Graph). Proves rule 4 as built: only the signed-in salesperson, only their own mailbox,
 * only after the checks pass, once per campaign, and the customer's address is never stored.
 */
import { env } from 'cloudflare:test';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { fixtureCampaign, fixtureTemplate } from '@offer-mailer/render/fixtures';
import type { Campaign } from '@offer-mailer/schema';
import app from '../src/index.js';
import type { Env } from '../src/env.js';
import { importTokenKey, open, seal } from '../src/mail-crypto.js';

const SAM = 'sam.carter@dreamlease.co.uk'; // the fixture sender
const EMMA = 'emma@dreamlease.co.uk'; // the compliance approver (config/compliance.json)
const CUSTOMER = 'priya.customer@example.com';
const KEY = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
const MAIL = { MAIL_TENANT_ID: 'tenant-123', MAIL_CLIENT_ID: 'client-abc', MAIL_CLIENT_SECRET: 'test-secret', MAIL_TOKEN_KEY: KEY };
const as = (email: string, over: Partial<Env> = {}): Env => ({ ...env, DEV_USER_EMAIL: email, ...MAIL, ...over }) as Env;
const sam = as(SAM);

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
/** The tool's own page on this PC: the tests run on the local sign-in bypass, where Send accepts only a localhost page. */
const LOCAL = { origin: 'http://localhost:5173' };
const postJson = (path: string, body: unknown, e: Env, headers: Record<string, string> = LOCAL) =>
  app.request(path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }, e);

/** A stand-in for Microsoft. `me` is whose mailbox the token belongs to; every call is recorded. */
function microsoft(opts: { me?: string; refresh?: () => Response; send?: () => Response } = {}) {
  const calls: { url: string; body: string }[] = [];
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push({ url, body: String(init?.body ?? '') });
    if (url.startsWith('https://login.microsoftonline.com/tenant-123/oauth2/v2.0/token')) {
      const grant = new URLSearchParams(String(init?.body)).get('grant_type');
      if (grant === 'refresh_token' && opts.refresh) return opts.refresh();
      return json(200, { access_token: 'AT', refresh_token: grant === 'refresh_token' ? 'RT-rotated' : 'RT-first', expires_in: 3600, scope: 'https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/User.Read openid email' });
    }
    if (url.startsWith('https://graph.microsoft.com/v1.0/me?')) return json(200, { mail: opts.me ?? SAM, userPrincipalName: opts.me ?? SAM });
    if (url === 'https://graph.microsoft.com/v1.0/me/sendMail') return opts.send ? opts.send() : new Response(null, { status: 202 });
    return new Response('not stubbed', { status: 599 });
  });
  return calls;
}
afterEach(() => vi.unstubAllGlobals());

/** Connect Outlook through the real routes: /connect, then Microsoft's return to /callback. */
async function connect(e: Env, me?: string): Promise<string> {
  const start = await app.request('/api/mail/connect', {}, e);
  expect(start.status).toBe(302);
  const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
  const cookie = start.headers.get('set-cookie')!.split(';')[0]!;
  microsoft(me ? { me } : {});
  const back = await app.request(`/api/mail/callback?code=the-code&state=${state}`, { headers: { cookie } }, e);
  vi.unstubAllGlobals();
  expect(back.status).toBe(302);
  return new URL(back.headers.get('location')!).searchParams.get('outlook')!;
}

let approvedTemplateId = '';
async function createCampaign(e: Env, over: Record<string, unknown> = {}): Promise<Campaign> {
  const { campaign } = fixtureCampaign({ offerCount: 2, brochure: 'none' });
  const fresh = new Date().toISOString();
  const offers = campaign.offers.map((o) => ({ ...o, validUntil: '2099-12-31', source: { ...o.source, fetchedAt: fresh } }));
  const draft = { name: campaign.name, useCase: campaign.useCase, subject: campaign.subject, intro: campaign.intro, layout: 'auto', offers, sender: campaign.sender, recipient: { firstName: 'Priya' }, templateId: approvedTemplateId, ...over };
  const res = await postJson('/api/campaigns', draft, e);
  expect(res.status).toBe(201);
  return ((await res.json()) as { campaign: Campaign }).campaign;
}

let placeholderCampaign: Campaign;
beforeAll(async () => {
  // Before compliance has published anything, a campaign gets the placeholder wording (no approver).
  placeholderCampaign = await createCampaign(sam, { templateId: undefined });
  const emma = as(EMMA);
  const t = await postJson('/api/templates', { name: 'Send tests', complianceBlocks: fixtureTemplate.complianceBlocks, footer: fixtureTemplate.footer }, emma);
  approvedTemplateId = ((await t.json()) as { template: { id: string } }).template.id;
  const pub = await app.request(`/api/templates/${approvedTemplateId}/publish`, { method: 'POST', headers: { 'sec-fetch-site': 'same-origin' } }, emma);
  expect(pub.status).toBe(200);
});

describe('Connect Outlook', () => {
  it('is unavailable until the Send app is set up, and for anyone outside DreamLease', async () => {
    const off = (await (await app.request('/api/mail/status', {}, as(SAM, { MAIL_CLIENT_ID: '' }))).json()) as { available: boolean; reason: string };
    expect(off).toMatchObject({ available: false, reason: 'not_configured' });
    const salsac = (await (await app.request('/api/mail/status', {}, as('adam@salsac.co.uk'))).json()) as { available: boolean; reason: string };
    expect(salsac).toMatchObject({ available: false, reason: 'not_allowed' });
    const bounced = await app.request('/api/mail/connect', {}, as('adam@salsac.co.uk'));
    expect(new URL(bounced.headers.get('location')!).searchParams.get('outlook')).toBe('not_allowed');
  });

  it("sends the browser to Microsoft with PKCE, the tenant's endpoint and a sealed state cookie", async () => {
    const res = await app.request('/api/mail/connect', {}, as('connect.one@dreamlease.co.uk'));
    const to = new URL(res.headers.get('location')!);
    expect(to.origin + to.pathname).toBe('https://login.microsoftonline.com/tenant-123/oauth2/v2.0/authorize');
    expect(to.searchParams.get('redirect_uri')).toBe('https://marketingtools.dreamelectric.uk/api/mail/callback');
    expect(to.searchParams.get('code_challenge_method')).toBe('S256');
    expect(to.searchParams.get('login_hint')).toBe('connect.one@dreamlease.co.uk');
    const cookie = res.headers.get('set-cookie')!;
    expect(cookie).toMatch(/^om_mail_connect=v1\./);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Path=\/api\/mail/);
    expect(cookie).not.toContain(to.searchParams.get('state')!); // the state travels sealed
  });

  it('stores an encrypted permission when the mailbox is their own, and says so', async () => {
    const who = 'connect.two@dreamlease.co.uk';
    expect(await connect(as(who), who)).toBe('connected');
    const row = await env.DB.prepare('select * from mail_connections where email = ?').bind(who).first<{ refresh_token_enc: string; scopes: string }>();
    expect(row!.refresh_token_enc).not.toContain('RT-first');
    expect(await open((await importTokenKey(KEY))!, row!.refresh_token_enc, `mail-connection:${who}`)).toBe('RT-first');
    expect(await open((await importTokenKey(KEY))!, row!.refresh_token_enc, 'mail-connection:someone.else@dreamlease.co.uk')).toBeUndefined();
    const status = (await (await app.request('/api/mail/status', {}, as(who))).json()) as { connected: boolean };
    expect(status.connected).toBe(true);
  });

  it('refuses a Microsoft account that is not the signed-in person (and stores nothing)', async () => {
    const who = 'connect.three@dreamlease.co.uk';
    expect(await connect(as(who), 'somebody.else@dreamlease.co.uk')).toBe('mismatch');
    expect(await env.DB.prepare('select 1 from mail_connections where email = ?').bind(who).first()).toBeNull();
  });

  it('refuses a return with the wrong state, no cookie, or another person\'s cookie; reports a cancel', async () => {
    const who = as('connect.four@dreamlease.co.uk');
    const start = await app.request('/api/mail/connect', {}, who);
    const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
    const cookie = start.headers.get('set-cookie')!.split(';')[0]!;
    const outcome = async (path: string, e: Env, c?: string) => new URL((await app.request(path, c ? { headers: { cookie: c } } : {}, e)).headers.get('location')!).searchParams.get('outlook');
    expect(await outcome(`/api/mail/callback?code=x&state=wrong`, who, cookie)).toBe('failed');
    expect(await outcome(`/api/mail/callback?code=x&state=${state}`, who)).toBe('failed');
    expect(await outcome(`/api/mail/callback?code=x&state=${state}`, as('intruder@dreamlease.co.uk'), cookie)).toBe('failed');
    expect(await outcome(`/api/mail/callback?error=access_denied&state=${state}`, who, cookie)).toBe('cancelled');
  });

  it('sends the local copy back to localhost:5173 when that is the registered address', async () => {
    const res = await app.request('/api/mail/callback?code=x&state=y', {}, as(SAM, { MAIL_REDIRECT_URI: 'http://localhost:5173/api/mail/callback' }));
    expect(res.headers.get('location')).toBe('http://localhost:5173/?outlook=failed');
  });

  it('disconnects', async () => {
    const who = 'connect.five@dreamlease.co.uk';
    expect(await connect(as(who), who)).toBe('connected');
    expect((await postJson('/api/mail/disconnect', {}, as(who))).status).toBe(200);
    expect(await env.DB.prepare('select 1 from mail_connections where email = ?').bind(who).first()).toBeNull();
  });
});

describe('Send', () => {
  it('asks the salesperson to connect Outlook first', async () => {
    const c = await createCampaign(as('not.connected@dreamlease.co.uk'), { sender: { ...fixtureCampaign().campaign.sender, email: 'not.connected@dreamlease.co.uk', mailbox: 'not.connected@dreamlease.co.uk' } });
    const res = await postJson(`/api/campaigns/${c.id}/send`, { to: CUSTOMER }, as('not.connected@dreamlease.co.uk'));
    expect(res.status).toBe(428);
    expect(((await res.json()) as { code: string }).code).toBe('connect');
  });

  it('is not offered when the Send app is not set up', async () => {
    const c = await createCampaign(sam);
    expect((await postJson(`/api/campaigns/${c.id}/send`, { to: CUSTOMER }, as(SAM, { MAIL_TOKEN_KEY: '' }))).status).toBe(503);
  });

  it("sends the email from the salesperson's own mailbox, records it, and stores no customer address", async () => {
    expect(await connect(sam, SAM)).toBe('connected');
    const c = await createCampaign(sam);
    const calls = microsoft();
    const res = await postJson(`/api/campaigns/${c.id}/send`, { to: ` ${CUSTOMER} `, firstName: 'Priya' }, sam);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sentAt: string; sentVia: string; campaign: Campaign };
    expect(body.sentVia).toBe('m365');
    expect(body.campaign).toMatchObject({ status: 'sent', sentVia: 'm365', sentBy: SAM, sentAt: body.sentAt });

    const send = calls.find((x) => x.url.endsWith('/me/sendMail'))!;
    const payload = JSON.parse(send.body);
    expect(payload.saveToSentItems).toBe(true);
    expect(payload.message.toRecipients).toEqual([{ emailAddress: { address: CUSTOMER } }]);
    expect(payload.message.subject).toBe(c.subject);
    expect(payload.message.body.content).toContain('Hi Priya,');
    expect(payload.message.body.content).toContain(`/r/${c.hostedPage.slug}/`); // tracked links that the stored map resolves
    expect(JSON.stringify(payload)).not.toMatch(/"from"/);

    // the rotated refresh token replaced the old one
    const row = await env.DB.prepare('select refresh_token_enc, last_sent_at from mail_connections where email = ?').bind(SAM).first<{ refresh_token_enc: string; last_sent_at: string }>();
    expect(await open((await importTokenKey(KEY))!, row!.refresh_token_enc, `mail-connection:${SAM}`)).toBe('RT-rotated');
    expect(row!.last_sent_at).toBe(body.sentAt);

    // the record: columns and the register's JSON agree; the customer's address is nowhere
    const stored = await env.DB.prepare('select status, sent_at, sent_via, data from campaigns where id = ?').bind(c.id).first<{ status: string; sent_at: string; sent_via: string; data: string }>();
    expect(stored).toMatchObject({ status: 'sent', sent_at: body.sentAt, sent_via: 'm365' });
    const everything = JSON.stringify(await env.DB.prepare('select * from campaigns').all()) + JSON.stringify(await env.DB.prepare('select * from mail_connections').all());
    expect(everything).not.toContain(CUSTOMER);
    const register = (await (await app.request('/api/register', {}, sam)).json()) as { columns: { key: string }[]; rows: Record<string, string>[] };
    expect(register.columns.map((x) => x.key)).toContain('sentBy');
    expect(register.rows.find((r) => r.campaignCode === c.tracking.campaignCode)).toMatchObject({ sentVia: 'm365', sentBy: SAM });

    // once only
    microsoft();
    const again = await postJson(`/api/campaigns/${c.id}/send`, { to: CUSTOMER }, sam);
    expect(again.status).toBe(409);
  });

  it('refuses to send the placeholder wording, saying what to fix, and sends nothing', async () => {
    const calls = microsoft();
    const res = await postJson(`/api/campaigns/${placeholderCampaign.id}/send`, { to: CUSTOMER }, sam);
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string; checks: { id: string; ok: boolean }[] };
    expect(body.checks.find((x) => x.id === 'template')?.ok).toBe(false);
    expect(body.error).toMatch(/Emma must publish the approved wording/);
    expect(calls.filter((x) => x.url.includes('sendMail'))).toHaveLength(0);
    const after = await env.DB.prepare('select status, sent_at from campaigns where id = ?').bind(placeholderCampaign.id).first<{ status: string; sent_at: string | null }>();
    expect(after).toMatchObject({ status: 'draft', sent_at: null });
  });

  it('refuses a bad address or an opted-out customer', async () => {
    const c = await createCampaign(sam);
    microsoft();
    const bad = await postJson(`/api/campaigns/${c.id}/send`, { to: 'priya at example' }, sam);
    expect(bad.status).toBe(422);
    await postJson('/api/suppressions', { email: 'stop.please@example.com' }, sam);
    const opted = await postJson(`/api/campaigns/${c.id}/send`, { to: 'Stop.Please@example.com' }, sam);
    expect(opted.status).toBe(422);
    expect(((await opted.json()) as { error: string }).error).toMatch(/Suppressions list/);
  });

  it("only the campaign's creator can check or send it", async () => {
    const c = await createCampaign(sam);
    expect((await postJson(`/api/campaigns/${c.id}/send`, { to: CUSTOMER }, as('someone.else@dreamlease.co.uk'))).status).toBe(403);
    expect((await postJson(`/api/campaigns/${c.id}/checks`, {}, as('someone.else@dreamlease.co.uk'))).status).toBe(403);
  });

  it('asks to reconnect when Microsoft has ended the connection, forgets it, and leaves the campaign unsent', async () => {
    const who = 'reconnect.me@dreamlease.co.uk';
    const e = as(who);
    expect(await connect(e, who)).toBe('connected');
    const c = await createCampaign(e, { sender: { ...fixtureCampaign().campaign.sender, email: who, mailbox: who } });
    microsoft({ refresh: () => json(400, { error: 'invalid_grant', error_description: 'AADSTS700082: expired due to inactivity' }) });
    const res = await postJson(`/api/campaigns/${c.id}/send`, { to: CUSTOMER }, e);
    expect(res.status).toBe(428);
    expect(((await res.json()) as { code: string }).code).toBe('reconnect');
    expect(await env.DB.prepare('select 1 from mail_connections where email = ?').bind(who).first()).toBeNull();
    const after = await env.DB.prepare('select status, sent_at from campaigns where id = ?').bind(c.id).first<{ status: string; sent_at: string | null }>();
    expect(after).toMatchObject({ status: 'draft', sent_at: null });
  });

  it('asks to reconnect when the stored permission cannot be opened (the key changed)', async () => {
    const who = 'key.changed@dreamlease.co.uk';
    const key = (await importTokenKey(btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))))!;
    await env.DB.prepare('insert into mail_connections (email, refresh_token_enc, scopes, connected_at, updated_at) values (?, ?, ?, ?, ?)')
      .bind(who, await seal(key, 'RT-old', `mail-connection:${who}`), 'Mail.Send', new Date().toISOString(), new Date().toISOString())
      .run();
    const e = as(who);
    const c = await createCampaign(e, { sender: { ...fixtureCampaign().campaign.sender, email: who, mailbox: who } });
    microsoft();
    const res = await postJson(`/api/campaigns/${c.id}/send`, { to: CUSTOMER }, e);
    expect(res.status).toBe(428);
  });

  it('reports a throttle with Retry-After and a refused Send app credential as unavailable', async () => {
    const who = 'throttled@dreamlease.co.uk';
    const e = as(who);
    expect(await connect(e, who)).toBe('connected');
    const c = await createCampaign(e, { sender: { ...fixtureCampaign().campaign.sender, email: who, mailbox: who } });
    microsoft({ me: who, send: () => new Response(JSON.stringify({ error: { code: 'ApplicationThrottled' } }), { status: 429, headers: { 'retry-after': '20' } }) });
    const slow = await postJson(`/api/campaigns/${c.id}/send`, { to: CUSTOMER }, e);
    expect(slow.status).toBe(429);
    expect(slow.headers.get('retry-after')).toBe('20');
    microsoft({ me: who, refresh: () => json(401, { error: 'invalid_client' }) });
    const broken = await postJson(`/api/campaigns/${c.id}/send`, { to: CUSTOMER }, e);
    expect(broken.status).toBe(503);
    expect(((await broken.json()) as { error: string }).error).toMatch(/Copy for Outlook/);
  });

  /** A connected salesperson with a fresh campaign of their own. */
  async function ready(who: string): Promise<{ e: Env; c: Campaign }> {
    const e = as(who);
    expect(await connect(e, who)).toBe('connected');
    const c = await createCampaign(e, { sender: { ...fixtureCampaign().campaign.sender, email: who, mailbox: who } });
    return { e, c };
  }
  const sendCalls = (calls: { url: string }[]) => calls.filter((x) => x.url.endsWith('/me/sendMail')).length;

  it('never sends twice when Microsoft gives no clear answer: it says to check Sent Items and keeps the campaign reserved', async () => {
    const who = 'uncertain@dreamlease.co.uk';
    const { e, c } = await ready(who);
    const calls = microsoft({ me: who, send: () => json(504, { error: { code: 'GatewayTimeout' } }) });
    const first = await postJson(`/api/campaigns/${c.id}/send`, { to: CUSTOMER }, e);
    expect(first.status).toBe(502);
    const body = (await first.json()) as { code: string; error: string };
    expect(body.code).toBe('uncertain');
    expect(body.error).toMatch(/Sent Items/);
    expect(body.error).not.toMatch(/Nothing was sent/);
    const again = await postJson(`/api/campaigns/${c.id}/send`, { to: CUSTOMER }, e);
    expect(again.status).toBe(409);
    expect(sendCalls(calls)).toBe(1);
  });

  it('a failure to record the last-sent time after Microsoft accepted the email does not undo the send', async () => {
    const who = 'bookkeeping@dreamlease.co.uk';
    const { e, c } = await ready(who);
    await env.DB.prepare("create trigger fail_last_sent before update of last_sent_at on mail_connections begin select raise(abort, 'd1 hiccup'); end").run();
    try {
      const calls = microsoft({ me: who });
      expect((await postJson(`/api/campaigns/${c.id}/send`, { to: CUSTOMER }, e)).status).toBe(200);
      expect((await postJson(`/api/campaigns/${c.id}/send`, { to: CUSTOMER }, e)).status).toBe(409);
      expect(sendCalls(calls)).toBe(1);
    } finally {
      await env.DB.prepare('drop trigger fail_last_sent').run();
    }
  });

  it('a failure to record the send in the register still reports it sent, and never lets it be sent again', async () => {
    const who = 'register.hiccup@dreamlease.co.uk';
    const { e, c } = await ready(who);
    await env.DB.prepare("create trigger fail_mark_sent before update of status on campaigns when new.status = 'sent' begin select raise(abort, 'd1 hiccup'); end").run();
    try {
      const calls = microsoft({ me: who });
      const res = await postJson(`/api/campaigns/${c.id}/send`, { to: CUSTOMER }, e);
      expect(res.status).toBe(200);
      expect(((await res.json()) as { recordPending?: boolean }).recordPending).toBe(true);
      expect((await postJson(`/api/campaigns/${c.id}/send`, { to: CUSTOMER }, e)).status).toBe(409);
      expect(sendCalls(calls)).toBe(1);
    } finally {
      await env.DB.prepare('drop trigger fail_mark_sent').run();
    }
  });

  it('a 403 from Microsoft on the send asks to connect again (and nothing was sent)', async () => {
    const who = 'forbidden@dreamlease.co.uk';
    const { e, c } = await ready(who);
    microsoft({ me: who, send: () => json(403, { error: { code: 'ErrorAccessDenied' } }) });
    const res = await postJson(`/api/campaigns/${c.id}/send`, { to: CUSTOMER }, e);
    expect(res.status).toBe(428);
    expect(await env.DB.prepare('select 1 from mail_connections where email = ?').bind(who).first()).toBeNull();
    const after = await env.DB.prepare('select status, sent_at from campaigns where id = ?').bind(c.id).first<{ status: string; sent_at: string | null }>();
    expect(after).toMatchObject({ status: 'draft', sent_at: null });
  });

  it('without sign-in (local development) sends only from a page on this PC, never through a share tunnel', async () => {
    const c = await createCampaign(sam);
    const calls = microsoft();
    expect((await postJson(`/api/campaigns/${c.id}/send`, { to: CUSTOMER }, sam, { origin: 'https://happy-words.trycloudflare.com' })).status).toBe(403);
    expect((await postJson(`/api/campaigns/${c.id}/send`, { to: CUSTOMER }, sam, {})).status).toBe(403);
    expect(sendCalls(calls)).toBe(0);
  });
});

describe('Connect Outlook from another site', () => {
  it('is refused, so a Disconnect stays a Disconnect', async () => {
    const res = await app.request('/api/mail/connect', { headers: { 'sec-fetch-site': 'cross-site' } }, as('cross.site@dreamlease.co.uk'));
    expect(new URL(res.headers.get('location')!).searchParams.get('outlook')).toBe('failed');
    expect(res.headers.get('set-cookie')).toBeNull();
    const own = await app.request('/api/mail/connect', { headers: { 'sec-fetch-site': 'same-origin' } }, as('cross.site@dreamlease.co.uk'));
    expect(new URL(own.headers.get('location')!).hostname).toBe('login.microsoftonline.com');
  });
});

describe('Checks (Copy for Outlook runs them too)', () => {
  it('passes a good campaign without an address, and fails the placeholder', async () => {
    const good = await createCampaign(sam);
    const ok = (await (await postJson(`/api/campaigns/${good.id}/checks`, {}, sam)).json()) as { ok: boolean; checks: { id: string }[] };
    expect(ok.ok).toBe(true);
    expect(ok.checks.map((x) => x.id)).not.toContain('recipient');
    const bad = (await (await postJson(`/api/campaigns/${placeholderCampaign.id}/checks`, {}, sam)).json()) as { ok: boolean };
    expect(bad.ok).toBe(false);
  });
});

describe('daily clean-up', () => {
  it('deletes connections unused for 90 days', async () => {
    const { purgeStaleMailConnections } = await import('../src/mail.js');
    const old = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000).toISOString();
    await env.DB.prepare('insert into mail_connections (email, refresh_token_enc, scopes, connected_at, updated_at) values (?, ?, ?, ?, ?)').bind('old.timer@dreamlease.co.uk', 'v1.x.y', 'Mail.Send', old, old).run();
    expect(await purgeStaleMailConnections(env as Env, new Date())).toBeGreaterThanOrEqual(1);
    expect(await env.DB.prepare('select 1 from mail_connections where email = ?').bind('old.timer@dreamlease.co.uk').first()).toBeNull();
  });
});
