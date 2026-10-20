import { describe, expect, it } from 'vitest';
import { cameBackAfterIdle, IDLE_MS, onExpired, RELOAD_GUARD_MS, signedOut } from '../src/session-rules';

describe('session rules (the tool left open overnight, Matt 20 Oct 2026)', () => {
  it('treats only a sign-in redirect or a 401 as signed out', () => {
    expect(signedOut({ type: 'opaqueredirect', status: 0 })).toBe(true);
    expect(signedOut({ type: 'basic', status: 401 })).toBe(true);
    for (const status of [200, 403, 404, 409, 422, 500, 502]) expect(signedOut({ type: 'basic', status })).toBe(false);
  });

  it('checks the sign-in only after the person has been away for the idle time', () => {
    const now = 10 * IDLE_MS;
    expect(cameBackAfterIdle(now - IDLE_MS + 1, now)).toBe(false);
    expect(cameBackAfterIdle(now - IDLE_MS, now)).toBe(true);
  });

  it('reloads once, then shows the bar instead of reloading in a loop', () => {
    const now = 100 * RELOAD_GUARD_MS;
    expect(onExpired({ now, lastReloadAt: null, held: false })).toBe('reload');
    expect(onExpired({ now, lastReloadAt: now - RELOAD_GUARD_MS + 1, held: false })).toBe('show-bar');
    expect(onExpired({ now, lastReloadAt: now - RELOAD_GUARD_MS, held: false })).toBe('reload');
  });

  it('never reloads over unsaved work a screen is holding in memory', () => {
    expect(onExpired({ now: 1, lastReloadAt: null, held: true })).toBe('show-bar');
  });
});
