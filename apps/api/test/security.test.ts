/**
 * Security hardening (24 Sept 2026, ported from the house template): the cross-site request forgery guard, and error
 * logs that never carry personal data, CAP IDs or query values.
 */
import { createExecutionContext, createScheduledController, env, waitOnExecutionContext } from 'cloudflare:test';
import { DrizzleQueryError } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import app from '../src/index.js';
import type { Env } from '../src/env.js';
import { safeErrorLine } from '../src/safe-log.js';
import { SAME_ORIGIN } from './same-origin.js';

const USER = 'matt.wilson@dreamlease.co.uk';
const authed = (over: Partial<Env> = {}): Env => ({ ...env, DEV_USER_EMAIL: USER, ...over }) as Env;
/** What a browser sends when another website's page makes the request. */
const CROSS_SITE = { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' };

/** A D1 binding whose every query fails, as when a table is missing. */
function failingD1(): D1Database {
  const fail = () => Promise.reject(new Error('D1_ERROR: no such table: senders: SQLITE_ERROR'));
  const stmt = { bind: () => stmt, run: fail, all: fail, raw: fail, first: fail };
  return { prepare: () => stmt, batch: fail, exec: fail } as unknown as D1Database;
}

afterEach(() => vi.restoreAllMocks());

describe('cross-site request forgery guard', () => {
  it("refuses another website's form post, upload or delete, even when a salesperson is signed in", async () => {
    const form = new FormData();
    form.append('photo', new File([new Uint8Array([1, 2, 3])], 'x.png', { type: 'image/png' }));
    const attempts = [
      app.request('/api/me/sender', { method: 'POST', headers: { ...CROSS_SITE, 'content-type': 'text/plain' }, body: '{"displayName":"Forged"}' }, authed()),
      app.request('/api/me/photo', { method: 'POST', headers: CROSS_SITE, body: form }, authed()),
      app.request('/api/me/photo', { method: 'DELETE', headers: CROSS_SITE }, authed()),
    ];
    for (const res of await Promise.all(attempts)) {
      expect(res.status).toBe(403);
      expect(((await res.json()) as { error: string }).error).toBeTruthy();
    }
  });

  it('lets the tool itself through', async () => {
    expect((await app.request('/api/me/photo', { method: 'DELETE', headers: SAME_ORIGIN }, authed())).status).toBe(200);
  });

  it('leaves reads and the public pages alone', async () => {
    expect((await app.request('/api/me', { headers: CROSS_SITE }, authed())).status).toBe(200);
    expect((await app.request('/health', { headers: CROSS_SITE }, authed())).status).toBe(200);
  });
});

describe('error logs', () => {
  it('keep the database reason but drop the query values', () => {
    const err = new DrizzleQueryError('select * from "senders" where "email" = ?', [USER], new Error('D1_ERROR: no such table: senders'));
    expect(err.message).toContain(USER); // what used to be logged
    const line = safeErrorLine(err);
    expect(line).toContain('no such table: senders');
    expect(line).not.toContain(USER);
  });

  it('log a failed request without the salesperson or what they sent', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const body = JSON.stringify({ displayName: 'Private Person', phone: '07700 900123' });
    const res = await app.request('/api/me/sender', { method: 'POST', headers: { 'content-type': 'application/json' }, body }, authed({ DB: failingD1() }));
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: string }).error).toBe('Internal error');
    const text = logged.mock.calls.flat().join(' ');
    expect(text).toContain('no such table');
    for (const secret of [USER, 'Private Person', '07700 900123']) expect(text).not.toContain(secret);
  });

  it('log a failed daily job without values', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const ctx = createExecutionContext();
    app.scheduled(createScheduledController({ scheduledTime: Date.now(), cron: '0 3 * * *' }), authed({ DB: failingD1() }), ctx);
    await waitOnExecutionContext(ctx);
    const text = logged.mock.calls.flat().join(' ');
    expect(text).toContain('failed');
    expect(text).not.toContain(USER);
    expect(text).not.toMatch(/params:/);
  });
});
