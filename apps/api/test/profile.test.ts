/**
 * Salesperson portrait: upload -> persist on the senders record -> inject into the signature of every email ->
 * clear. Runs inside workerd with real local D1, R2 and the Images binding.
 */
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { fixtureCampaign } from '@offer-mailer/render/fixtures';
import app from '../src/index.js';
import type { Env } from '../src/env.js';
import { SAME_ORIGIN } from './same-origin.js';

const USER = 'matt.wilson@dreamlease.co.uk';
const authed = (over: Partial<Env> = {}): Env => ({ ...env, DEV_USER_EMAIL: USER, ...over }) as Env;
const { DEV_USER_EMAIL: _dev, ...anonRest } = env as Env;
const anon = anonRest as Env;

/** 1x1 PNG. */
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
const photoForm = (bytes: Uint8Array, type = 'image/png'): FormData => {
  const fd = new FormData();
  fd.set('photo', new File([bytes], 'me.png', { type }));
  return fd;
};

/** A valid draft whose user sender is the signed-in salesperson (so the injected headshot keys to them). */
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
    sender: { ...campaign.sender, email: USER, mailbox: USER },
    recipient: campaign.recipient,
    ...over,
  };
}
const createCampaign = (e = authed()) => app.request('/api/campaigns', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(draft()) }, e);

describe('salesperson portrait', () => {
  it('needs a login', async () => {
    expect((await app.request('/api/me/photo', { method: 'POST', headers: SAME_ORIGIN, body: photoForm(PNG) }, anon)).status).toBe(503);
  });

  it('rejects a non-image upload', async () => {
    const bad = new FormData();
    bad.set('photo', new File([new TextEncoder().encode('not an image at all')], 'x.png', { type: 'image/png' }));
    expect((await app.request('/api/me/photo', { method: 'POST', headers: SAME_ORIGIN, body: bad }, authed())).status).toBe(422);
  });

  it('uploads a portrait, persists it on /me, injects it into the signature, and clears it', async () => {
    const up = await app.request('/api/me/photo', { method: 'POST', headers: SAME_ORIGIN, body: photoForm(PNG) }, authed());
    expect(up.status).toBe(200);
    const { headshotUrl } = (await up.json()) as { headshotUrl: string };
    expect(headshotUrl).toMatch(/\/f\/headshots\/[a-f0-9]{64}\.jpg$/);

    // GET /me returns the saved photo
    const me = (await (await app.request('/api/me', {}, authed())).json()) as { headshotUrl: string | null };
    expect(me.headshotUrl).toBe(headshotUrl);

    // the stored headshot serves as a JPEG
    const served = await app.request(new URL(headshotUrl).pathname, {}, env);
    expect(served.status).toBe(200);
    expect(served.headers.get('content-type')).toBe('image/jpeg');

    // a created campaign's signature uses the saved photo, and the client-supplied placeholder is stripped
    const created = (await (await createCampaign()).json()) as { html: string };
    expect(created.html).toContain(headshotUrl);
    expect(created.html).not.toContain('headshot-placeholder');

    // delete clears it, and later emails have no headshot
    expect((await app.request('/api/me/photo', { method: 'DELETE', headers: SAME_ORIGIN }, authed())).status).toBe(200);
    const me2 = (await (await app.request('/api/me', {}, authed())).json()) as { headshotUrl: string | null };
    expect(me2.headshotUrl).toBeNull();
    const after = (await (await createCampaign()).json()) as { html: string };
    expect(after.html).not.toContain('/f/headshots/');
  });
});

describe('salesperson contact details', () => {
  const post = (body: unknown) => app.request('/api/me/sender', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, authed());

  it('saves the salesperson contact details, returns them on /me, and preserves the photo', async () => {
    await app.request('/api/me/photo', { method: 'POST', headers: SAME_ORIGIN, body: photoForm(PNG) }, authed());
    const details = { displayName: 'Matt Wilson', jobTitle: 'Account Manager', phone: '01234 567890', whatsapp: '+447700900123', bookingUrl: 'https://outlook.office365.com/book/dl/', secondaryContacts: ['whatsapp', 'book'] };
    expect((await post(details)).status).toBe(200);
    const me = (await (await app.request('/api/me', {}, authed())).json()) as { savedSender: typeof details | null; headshotUrl: string | null };
    expect(me.savedSender).toEqual(details);
    expect(me.headshotUrl).toMatch(/\/f\/headshots\//); // saving details left the photo alone
  });

  it('prunes a chosen secondary method whose field is absent', async () => {
    const details = { displayName: 'Matt Wilson', phone: '01234 567890', secondaryContacts: ['call', 'book', 'email'] };
    expect((await post(details)).status).toBe(200);
    const me = (await (await app.request('/api/me', {}, authed())).json()) as { savedSender: { secondaryContacts: string[] } | null };
    // call (has phone) and email (always) survive; book has no booking link, so it is dropped
    expect(me.savedSender?.secondaryContacts).toEqual(['call', 'email']);
  });

  it('rejects invalid details (WhatsApp must be a real phone number)', async () => {
    expect((await post({ displayName: 'X', whatsapp: 'not a number' })).status).toBe(422);
  });
});
