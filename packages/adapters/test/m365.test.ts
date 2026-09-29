/**
 * Contract tests for the Microsoft 365 adapter, against a stand-in for Microsoft's sign-in and Graph endpoints.
 * They pin what we send (tenant endpoints, PKCE, the five scopes, no `from`, saveToSentItems) and how each of
 * Microsoft's answers maps to what the tool can do about it.
 */
import { describe, expect, it } from 'vitest';
import type { Campaign, Rendered, Sender } from '@offer-mailer/schema';
import { M365Error, M365_SCOPES, createM365Client, createM365Output, isSameMailbox, newPkce } from '../src/index.js';

const CFG = { tenantId: 'tenant-123', clientId: 'client-abc', clientSecret: 's3cret', redirectUri: 'https://marketingtools.dreamelectric.uk/api/mail/callback' };

type Call = { url: string; init: RequestInit };
function standIn(respond: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchFn = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    return respond(url, init);
  }) as typeof fetch;
  return { calls, fetchFn };
}
const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const form = (init: RequestInit) => new URLSearchParams(String(init.body));

async function rejects(p: Promise<unknown>): Promise<M365Error> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(M365Error);
    return e as M365Error;
  }
  throw new Error('expected an M365Error');
}

describe('PKCE', () => {
  it('makes a verifier and its S256 challenge', async () => {
    const { verifier, challenge } = await newPkce();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    const expected = btoa(String.fromCharCode(...digest)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(challenge).toBe(expected);
  });
});

describe('authorizeUrl', () => {
  it("uses the tenant's endpoint, the code flow in the query string, PKCE and exactly the five permissions", () => {
    const u = new URL(createM365Client(CFG).authorizeUrl({ state: 'st', codeChallenge: 'ch', loginHint: 'matt.wilson@dreamlease.co.uk' }));
    expect(u.origin + u.pathname).toBe('https://login.microsoftonline.com/tenant-123/oauth2/v2.0/authorize');
    const q = Object.fromEntries(u.searchParams);
    expect(q).toMatchObject({ client_id: 'client-abc', response_type: 'code', response_mode: 'query', redirect_uri: CFG.redirectUri, state: 'st', code_challenge: 'ch', code_challenge_method: 'S256', login_hint: 'matt.wilson@dreamlease.co.uk' });
    expect(q.scope!.split(' ').sort()).toEqual([...M365_SCOPES].sort());
    expect(q.scope).not.toMatch(/Mail\.Send\.Shared|Mail\.Read|\.default/);
  });
});

describe('tokens', () => {
  it('redeems a code with the verifier and the same redirect address', async () => {
    const { calls, fetchFn } = standIn(() => json(200, { access_token: 'AT', refresh_token: 'RT', expires_in: 3599, scope: 'Mail.Send User.Read' }));
    const t = await createM365Client(CFG, fetchFn).redeemCode('the-code', 'the-verifier');
    expect(t).toEqual({ accessToken: 'AT', refreshToken: 'RT', expiresIn: 3599, scope: 'Mail.Send User.Read' });
    expect(calls[0]!.url).toBe('https://login.microsoftonline.com/tenant-123/oauth2/v2.0/token');
    expect(Object.fromEntries(form(calls[0]!.init))).toMatchObject({ grant_type: 'authorization_code', code: 'the-code', code_verifier: 'the-verifier', redirect_uri: CFG.redirectUri, client_id: 'client-abc', client_secret: 's3cret' });
  });

  it('refreshes and returns the rotated refresh token; keeps the old one if Microsoft sends none', async () => {
    const rotating = standIn(() => json(200, { access_token: 'AT2', refresh_token: 'RT2', expires_in: 3600 }));
    expect((await createM365Client(CFG, rotating.fetchFn).refresh('RT1')).refreshToken).toBe('RT2');
    expect(Object.fromEntries(form(rotating.calls[0]!.init))).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'RT1' });
    const same = standIn(() => json(200, { access_token: 'AT2', expires_in: 3600 }));
    expect((await createM365Client(CFG, same.fetchFn).refresh('RT1')).refreshToken).toBe('RT1');
  });

  it('refuses a first connection that grants no refresh token (offline_access missing)', async () => {
    const { fetchFn } = standIn(() => json(200, { access_token: 'AT', expires_in: 3600 }));
    expect((await rejects(createM365Client(CFG, fetchFn).redeemCode('c', 'v'))).detail).toBe('no_refresh_token');
  });

  it.each([
    [400, { error: 'invalid_grant', error_description: 'AADSTS700082: The refresh token has expired due to inactivity. Trace ID: x' }, 'reconnect', 'AADSTS700082'],
    [400, { error: 'interaction_required' }, 'reconnect', 'interaction_required'],
    [401, { error: 'invalid_client', error_description: 'AADSTS7000222: The provided client secret keys are expired.' }, 'app_credential', 'AADSTS7000222'],
    [429, { error: 'temporarily_unavailable' }, 'throttled', 'temporarily_unavailable'],
    [503, {}, 'unavailable', 'http_503'],
    [400, { error: 'invalid_request' }, 'rejected', 'invalid_request'],
  ])('maps a %s %j to %s', async (status, body, code, detail) => {
    const { fetchFn } = standIn(() => json(status, body, status === 429 ? { 'retry-after': '30' } : {}));
    const e = await rejects(createM365Client(CFG, fetchFn).refresh('RT'));
    expect(e.code).toBe(code);
    expect(e.detail).toBe(detail);
    expect(e.message).not.toMatch(/Trace ID|RT|s3cret/);
    if (status === 429) expect(e.retryAfterSeconds).toBe(30);
  });

  it('treats a network failure as unavailable', async () => {
    const { fetchFn } = standIn(() => {
      throw new TypeError('network down');
    });
    expect((await rejects(createM365Client(CFG, fetchFn).refresh('RT'))).code).toBe('unavailable');
  });
});

describe('Graph', () => {
  it('reads whose mailbox the token belongs to', async () => {
    const { calls, fetchFn } = standIn(() => json(200, { mail: 'Matt.Wilson@dreamlease.co.uk', userPrincipalName: 'matt.wilson@dreamlease.co.uk', displayName: 'Matt Wilson' }));
    const me = await createM365Client(CFG, fetchFn).me('AT');
    expect(me.mail).toBe('Matt.Wilson@dreamlease.co.uk');
    expect(calls[0]!.url).toBe('https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName,displayName');
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer AT');
  });

  it('sends as the token\'s own user: no `from`, saved to Sent Items, one HTML body', async () => {
    const { calls, fetchFn } = standIn(() => new Response(null, { status: 202 }));
    await createM365Client(CFG, fetchFn).sendMail('AT', { subject: 'Your offers', html: '<p>Hi</p>', to: [{ address: 'customer@example.com' }] });
    expect(calls[0]!.url).toBe('https://graph.microsoft.com/v1.0/me/sendMail');
    expect(calls[0]!.init.method).toBe('POST');
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body).toEqual({ message: { subject: 'Your offers', body: { contentType: 'HTML', content: '<p>Hi</p>' }, toRecipients: [{ emailAddress: { address: 'customer@example.com' } }] }, saveToSentItems: true });
    expect(JSON.stringify(body)).not.toMatch(/"from"|"sender"/);
  });

  it.each([
    [401, 'InvalidAuthenticationToken', 'reconnect'],
    [403, 'ErrorAccessDenied', 'reconnect'],
    [400, 'ErrorInvalidRecipients', 'rejected'],
    [429, 'ApplicationThrottled', 'throttled'],
    [503, 'ServiceUnavailable', 'uncertain'], // the send itself failed on Microsoft's side: it may have gone
  ])('maps a Graph %s (%s) on sendMail to %s', async (status, graphCode, code) => {
    const { fetchFn } = standIn(() => json(status, { error: { code: graphCode, message: 'm' } }));
    const e = await rejects(createM365Client(CFG, fetchFn).sendMail('AT', { subject: 's', html: 'h', to: [{ address: 'a@b.co' }] }));
    expect(e.code).toBe(code);
    expect(e.detail).toBe(graphCode);
  });

  it('does not treat a 200 as accepted (sendMail answers 202): the outcome is uncertain', async () => {
    const { fetchFn } = standIn(() => json(200, {}));
    const e = await rejects(createM365Client(CFG, fetchFn).sendMail('AT', { subject: 's', html: 'h', to: [{ address: 'a@b.co' }] }));
    expect(e.code).toBe('uncertain');
    expect(e.detail).toBe('http_200');
  });

  it('calls a lost answer to the send uncertain (it may have gone), but a lost answer to /me just unavailable', async () => {
    const { fetchFn } = standIn(() => {
      throw new TypeError('connection reset');
    });
    const client = createM365Client(CFG, fetchFn);
    expect((await rejects(client.sendMail('AT', { subject: 's', html: 'h', to: [{ address: 'a@b.co' }] }))).code).toBe('uncertain');
    expect((await rejects(client.me('AT'))).code).toBe('unavailable');
  });
});

describe('isSameMailbox', () => {
  it('matches the mail or sign-in address, case-insensitively, and nothing else', () => {
    expect(isSameMailbox({ mail: 'Matt.Wilson@dreamlease.co.uk', userPrincipalName: 'mw@dreamlease.onmicrosoft.com' }, 'matt.wilson@dreamlease.co.uk')).toBe(true);
    expect(isSameMailbox({ mail: null, userPrincipalName: 'emma@dreamlease.co.uk' }, 'EMMA@dreamlease.co.uk')).toBe(true);
    expect(isSameMailbox({ mail: 'richard@dreamlease.co.uk', userPrincipalName: 'richard@dreamlease.co.uk' }, 'matt.wilson@dreamlease.co.uk')).toBe(false);
  });
});

describe('m365 output', () => {
  const rendered: Rendered = { html: '<p>email</p>', text: 'email', subject: 'Offers for you', hostedHtml: '<p>hosted</p>', layout: 'single', links: {} };
  const sender = { kind: 'user', displayName: 'Matt', email: 'matt.wilson@dreamlease.co.uk', mailbox: 'matt.wilson@dreamlease.co.uk' } as Sender;
  const campaign = {} as Campaign;

  it('sends the rendered email to the one recipient and reports when Microsoft accepted it', async () => {
    const { calls, fetchFn } = standIn(() => new Response(null, { status: 202 }));
    const out = createM365Output({ client: createM365Client(CFG, fetchFn), accessToken: 'AT', now: () => new Date('2026-10-01T09:42:00Z') });
    const r = await out.deliver({ rendered, campaign, sender, to: { address: 'customer@example.com' } });
    expect(r).toEqual({ kind: 'm365', deliveredAt: '2026-10-01T09:42:00.000Z' });
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body.message.subject).toBe('Offers for you');
    expect(body.message.body.content).toBe('<p>email</p>');
  });

  it('refuses a shared sender and a missing recipient without calling Microsoft', async () => {
    const { calls, fetchFn } = standIn(() => new Response(null, { status: 202 }));
    const out = createM365Output({ client: createM365Client(CFG, fetchFn), accessToken: 'AT' });
    expect((await rejects(out.deliver({ rendered, campaign, sender: { ...sender, kind: 'shared' }, to: { address: 'c@x.co' } }))).detail).toBe('shared_sender');
    expect((await rejects(out.deliver({ rendered, campaign, sender }))).detail).toBe('no_recipient');
    expect(calls).toHaveLength(0);
  });
});
