/**
 * Suppression register (step 7) — plain-text opt-out list behind Access; removal is admin-only.
 * Runs inside workerd with real local D1. matt@ is the configured admin (config/admins.json).
 */
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import app from '../src/index.js';
import type { Env } from '../src/env.js';

const USER = 'matt.wilson@dreamlease.co.uk';
const authed = (over: Partial<Env> = {}): Env => ({ ...env, DEV_USER_EMAIL: USER, ...over }) as Env;
const salesperson = authed({ DEV_USER_EMAIL: 'sam.carter@dreamlease.co.uk' });
const { DEV_USER_EMAIL: _dev, ...anonRest } = env as Env;
const anon = anonRest as Env;

const post = (path: string, body: unknown, e: Env) => app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, e);
const check = async (email: string, e: Env) => ((await (await post('/api/suppressions/check', { email }, e)).json()) as { suppressed: boolean }).suppressed;

describe('suppression register', () => {
  it('needs a login', async () => {
    expect((await post('/api/suppressions', { email: 'x@y.com' }, anon)).status).toBe(503);
  });

  it('adds an opt-out (any salesperson), lists it, and checks case/whitespace-insensitively', async () => {
    expect((await post('/api/suppressions', { email: '  OptOut@Example.com ', note: 'replied stop' }, salesperson)).status).toBe(201);

    const list = (await (await app.request('/api/suppressions', {}, authed())).json()) as { suppressions: { email: string; addedBy: string; note: string | null }[] };
    const row = list.suppressions.find((s) => s.email === 'optout@example.com');
    expect(row).toBeTruthy();
    expect(row?.addedBy).toBe('sam.carter@dreamlease.co.uk');
    expect(row?.note).toBe('replied stop');

    expect(await check('optout@example.com', authed())).toBe(true);
    expect(await check('OPTOUT@EXAMPLE.COM', authed())).toBe(true); // normalised
    expect(await check('someone.else@example.com', authed())).toBe(false);
  });

  it('rejects an invalid email on add', async () => {
    expect((await post('/api/suppressions', { email: 'not-an-email' }, authed())).status).toBe(422);
  });

  it('removes only for an admin, re-permitting the address', async () => {
    await post('/api/suppressions', { email: 'remove-me@example.com' }, authed());
    expect(await check('remove-me@example.com', authed())).toBe(true);

    expect((await post('/api/suppressions/remove', { email: 'remove-me@example.com' }, salesperson)).status).toBe(403); // salesperson blocked
    expect(await check('remove-me@example.com', authed())).toBe(true); // still suppressed

    expect((await post('/api/suppressions/remove', { email: 'remove-me@example.com' }, authed())).status).toBe(200); // admin
    expect(await check('remove-me@example.com', authed())).toBe(false);
  });
});
