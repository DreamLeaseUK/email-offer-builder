/**
 * The decisions behind session.ts, kept free of the browser so they can be unit-tested (test/session-rules.test.ts).
 */

/** Away this long, the tool checks the sign-in when the person comes back. */
export const IDLE_MS = 15 * 60 * 1000;
/** No second automatic reload within this time; the "expired" bar shows instead. */
export const RELOAD_GUARD_MS = 2 * 60 * 1000;

/**
 * True when a response came from Cloudflare Access's sign-in rather than from our API. With `redirect: 'manual'`
 * the browser hands back an opaque redirect instead of following it to another site (which would fail as a
 * cross-site request). Our API answers 401 only when there is no signed-in user (middleware/access.ts).
 */
export function signedOut(r: Pick<Response, 'type' | 'status'>): boolean {
  return r.type === 'opaqueredirect' || r.status === 401;
}

/** Whether the tool was away long enough to check the sign-in on return. */
export function cameBackAfterIdle(lastActive: number, now: number): boolean {
  return now - lastActive >= IDLE_MS;
}

/**
 * What to do once the sign-in has run out on return: reload, unless a reload already happened within the guard
 * time (a loop) or a screen holds unsaved work only in memory; then show the bar and let the person choose.
 */
export function onExpired(opts: { now: number; lastReloadAt: number | null; held: boolean }): 'reload' | 'show-bar' {
  if (opts.held) return 'show-bar';
  if (opts.lastReloadAt !== null && opts.lastReloadAt > 0 && opts.now - opts.lastReloadAt < RELOAD_GUARD_MS) return 'show-bar';
  return 'reload';
}
