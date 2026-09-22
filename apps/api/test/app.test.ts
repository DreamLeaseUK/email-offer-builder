import { describe, expect, it } from 'vitest';
import app from '../src/index.js';
import type { Env } from '../src/env.js';
import { hostedExpiresAt, hostedKey } from '../src/hosted.js';
import { fixtureCampaign } from '@offer-mailer/render/fixtures';

/** Minimal in-memory R2 for the hosted route. */
function fakeBucket(objects: Record<string, { body: string; expiresAt?: string }>): R2Bucket {
  return {
    async get(key: string) {
      const o = objects[key];
      if (!o) return null;
      return { body: o.body, customMetadata: o.expiresAt ? { expiresAt: o.expiresAt } : {} } as unknown as R2ObjectBody;
    },
    async put(key: string, body: string, opts?: { customMetadata?: Record<string, string> }) {
      objects[key] = { body, ...(opts?.customMetadata?.expiresAt ? { expiresAt: opts.customMetadata.expiresAt } : {}) };
      return null;
    },
  } as unknown as R2Bucket;
}

const baseEnv = {
  ACCESS_TEAM_DOMAIN: '',
  ACCESS_AUD: '',
  PUBLIC_BASE_URL: 'https://offers.dreamlease.co.uk',
  TOOL_BASE_URL: 'https://mailer.dreamlease.co.uk',
  APP_VERSION: 'test',
} as unknown as Env;

describe('health', () => {
  it('answers without any bindings', async () => {
    const res = await app.request('/health', {}, baseEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; db: string };
    expect(body.ok).toBe(true);
    expect(body.db).toBe('unbound');
  });
});

describe('Access middleware', () => {
  it('fails closed when Access is not configured and no dev user is set', async () => {
    const res = await app.request('/api/me', {}, baseEnv);
    expect(res.status).toBe(503);
  });

  it('accepts DEV_USER_EMAIL only while ACCESS_AUD is empty', async () => {
    const dev = { ...baseEnv, DEV_USER_EMAIL: 'matt.wilson@dreamlease.co.uk' };
    const res = await app.request('/api/me', {}, dev);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ email: 'matt.wilson@dreamlease.co.uk', sub: 'dev', role: 'admin', publicBaseUrl: 'https://offers.dreamlease.co.uk', headshotUrl: null, savedSender: null });
  });

  it('ignores DEV_USER_EMAIL once ACCESS_AUD is set', async () => {
    const prod = { ...baseEnv, ACCESS_TEAM_DOMAIN: 'dreamlease.cloudflareaccess.com', ACCESS_AUD: 'aud', DEV_USER_EMAIL: 'x@dreamlease.co.uk' };
    const res = await app.request('/api/me', {}, prod);
    expect(res.status).toBe(401);
  });
});

describe('roles', () => {
  const roleOf = async (env: Env) => ((await (await app.request('/api/me', {}, env)).json()) as { role: string }).role;

  it('marks a configured admin as admin and everyone else a salesperson', async () => {
    expect(await roleOf({ ...baseEnv, DEV_USER_EMAIL: 'matt.wilson@dreamlease.co.uk' })).toBe('admin');
    expect(await roleOf({ ...baseEnv, DEV_USER_EMAIL: 'sam.carter@dreamlease.co.uk' })).toBe('salesperson');
  });

  it('honours the ADMIN_EMAILS env override, case-insensitively', async () => {
    const env = { ...baseEnv, DEV_USER_EMAIL: 'Sam.Carter@dreamlease.co.uk', ADMIN_EMAILS: 'other@x.com, sam.carter@dreamlease.co.uk' } as unknown as Env;
    expect(await roleOf(env)).toBe('admin');
  });
});

describe('hosted pages', () => {
  const slug = 'k3J9xQ2mZp8LwN4vR7tY';

  it('404s for an unknown slug and for a malformed one', async () => {
    const env = { ...baseEnv, HOSTED: fakeBucket({}) };
    expect((await app.request(`/c/${slug}`, {}, env)).status).toBe(404);
    expect((await app.request('/c/short', {}, env)).status).toBe(404);
  });

  it('serves a live page with noindex and no caching', async () => {
    const env = { ...baseEnv, HOSTED: fakeBucket({ [hostedKey(slug)]: { body: '<p>offers</p>', expiresAt: '2999-01-01T00:00:00.000Z' } }) };
    const res = await app.request(`/c/${slug}`, {}, env);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('<p>offers</p>');
    expect(res.headers.get('x-robots-tag')).toMatch(/noindex/);
    expect(res.headers.get('cache-control')).toMatch(/no-cache/);
  });

  it('returns 410 once the earliest offer validity has passed', async () => {
    const env = { ...baseEnv, HOSTED: fakeBucket({ [hostedKey(slug)]: { body: '<p>old</p>', expiresAt: '2020-01-01T00:00:00.000Z' } }) };
    const res = await app.request(`/c/${slug}`, {}, env);
    expect(res.status).toBe(410);
    expect(await res.text()).toMatch(/expired/);
  });

  it('expires at the end of the earliest validUntil', () => {
    const { campaign } = fixtureCampaign({ offerCount: 3 });
    expect(hostedExpiresAt(campaign)).toBe('2026-09-30T23:59:59.999Z');
  });
});

describe('dev preview', () => {
  const env = { ...baseEnv, DEV_USER_EMAIL: 'matt.wilson@dreamlease.co.uk', HOSTED: fakeBucket({}) };

  it('renders a fixture and can publish its hosted page', async () => {
    const res = await app.request('/api/dev/preview?layout=stack&count=4&cta=book&brochure=pdf&publish=1', {}, env);
    expect(res.status).toBe(200);
    expect(await res.text()).toMatch(/Book a time to talk/);
    const hostedRes = await app.request('/c/k3J9xQ2mZp8LwN4vR7tY', {}, env);
    expect(hostedRes.status).toBe(200);
    expect(await hostedRes.text()).not.toMatch(/View these offers online/);
  });

  it('serves an eml download', async () => {
    const res = await app.request('/api/dev/preview?format=eml', {}, env);
    expect(res.headers.get('content-type')).toBe('message/rfc822');
    expect(await res.text()).toMatch(/^X-Unsent: 1/);
  });
});
