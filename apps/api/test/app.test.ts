import { describe, expect, it } from 'vitest';
import app from '../src/index.js';
import type { Env } from '../src/env.js';

const baseEnv = {
  ACCESS_TEAM_DOMAIN: '',
  ACCESS_AUD: '',
  HOSTED_BASE_URL: 'https://offers.dreamlease.co.uk',
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
    expect(await res.json()).toEqual({ email: 'matt.wilson@dreamlease.co.uk', sub: 'dev' });
  });

  it('ignores DEV_USER_EMAIL once ACCESS_AUD is set', async () => {
    const prod = { ...baseEnv, ACCESS_TEAM_DOMAIN: 'dreamlease.cloudflareaccess.com', ACCESS_AUD: 'aud', DEV_USER_EMAIL: 'x@dreamlease.co.uk' };
    const res = await app.request('/api/me', {}, prod);
    expect(res.status).toBe(401);
  });
});

describe('public routes', () => {
  it('reserves hosted, redirect and brochure paths', async () => {
    for (const path of ['/c/abc', '/r/c1/l1', '/b/abc']) {
      const res = await app.request(path, {}, baseEnv);
      expect(res.status).toBe(404);
      expect(res.headers.get('content-type')).toMatch(/text\/plain/);
    }
  });
});
