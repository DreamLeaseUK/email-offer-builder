/**
 * Keeping the tool usable after a long gap (Matt, 20 Oct 2026: left overnight, it had to be refreshed by hand).
 *
 * The tool sits behind Cloudflare Access. Its sign-in lasts a fixed time and activity does not extend it, so a
 * "keep-alive" would not help. Once it has run out, Access answers our API calls with a redirect to its sign-in
 * page instead of letting them through, and only a page load signs the person in again (Microsoft usually does it
 * without asking). So:
 *  - every API call is made with `redirect: 'manual'` (api.ts), and a sign-in redirect or a 401 becomes a clear
 *    "your sign-in has expired" bar with a Reload button (App.tsx) instead of a vague failed request;
 *  - coming back to the tool after a long gap, it checks the sign-in quietly and reloads itself if it has run out.
 *    Compose keeps its draft in the browser, so nothing typed is lost. A guard stops it reloading in a loop.
 */

/** Away this long, the tool checks the sign-in when the person comes back. */
const IDLE_MS = 15 * 60 * 1000;
/** No second automatic reload within this time; the bar shows instead. */
const RELOAD_GUARD_MS = 2 * 60 * 1000;
const RELOAD_GUARD_KEY = 'dl-session-reload-at';

export const SESSION_EXPIRED_EVENT = 'dl-session-expired';

export class SessionExpiredError extends Error {
  constructor() {
    super('Your sign-in has expired. Reload the page to sign in again.');
    this.name = 'SessionExpiredError';
  }
}

/**
 * True when a response came from Cloudflare Access's sign-in rather than from our API. With `redirect: 'manual'`
 * the browser hands back an opaque redirect instead of following it to another site (which would fail as a
 * cross-site request). Our API answers 401 only when there is no signed-in user.
 */
export function signedOut(r: Pick<Response, 'type' | 'status'>): boolean {
  return r.type === 'opaqueredirect' || r.status === 401;
}

export function announceSignedOut(): void {
  window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
}

/** Asks our API who is signed in without following a redirect. 'unknown' when the network itself failed. */
export async function checkSession(): Promise<'ok' | 'expired' | 'unknown'> {
  try {
    const r = await fetch('/api/me', { redirect: 'manual', cache: 'no-store' });
    if (signedOut(r)) return 'expired';
    return r.ok ? 'ok' : 'unknown';
  } catch {
    return 'unknown';
  }
}

function reloadedRecently(now: number): boolean {
  try {
    const at = Number(sessionStorage.getItem(RELOAD_GUARD_KEY));
    return at > 0 && now - at < RELOAD_GUARD_MS;
  } catch {
    return false;
  }
}

function markReload(now: number): void {
  try {
    sessionStorage.setItem(RELOAD_GUARD_KEY, String(now));
  } catch {
    /* storage unavailable: the reload still happens, just without the loop guard */
  }
}

let lastActive = Date.now();
let checking = false;

async function onReturn(): Promise<void> {
  const now = Date.now();
  const away = now - lastActive;
  lastActive = now;
  if (away < IDLE_MS || checking) return;
  checking = true;
  try {
    if ((await checkSession()) !== 'expired') return;
    if (reloadedRecently(Date.now())) {
      announceSignedOut();
      return;
    }
    markReload(Date.now());
    window.location.reload();
  } finally {
    checking = false;
  }
}

function onActivity(): void {
  if (Date.now() - lastActive >= IDLE_MS) void onReturn();
  else lastActive = Date.now();
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void onReturn();
});
window.addEventListener('focus', () => void onReturn());
window.addEventListener('pointerdown', onActivity, { passive: true, capture: true });
window.addEventListener('keydown', onActivity, { passive: true, capture: true });
