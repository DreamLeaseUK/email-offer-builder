/**
 * Keeping the tool usable after a long gap (Matt, 20 Oct 2026: left overnight, it had to be refreshed by hand).
 *
 * The tool sits behind Cloudflare Access. Its sign-in lasts a fixed time (24 hours, docs/it-runbook-sign-in.md) and
 * activity does not extend it, so a "keep-alive" would not help. Once it has run out, Access answers our API calls
 * with a redirect to its sign-in page instead of letting them through, and only a page load signs the person in
 * again (Microsoft usually does it without asking). So:
 *  - every API call is made with `redirect: 'manual'` (apiFetch in api.ts), and a sign-in redirect or a 401 becomes
 *    a clear "your sign-in has expired" bar with a Reload button (App.tsx) instead of a vague failed request;
 *  - coming back to the tool after a long gap, it checks the sign-in quietly and reloads itself if it has run out.
 *    Compose keeps its draft in the browser, so nothing typed there is lost. A screen with unsaved work held only in
 *    memory (the Templates editor) calls holdAutoReload, and then the bar shows instead. A guard stops reload loops.
 * The decisions themselves are in session-rules.ts.
 */
import { cameBackAfterIdle, onExpired, signedOut } from './session-rules';

export { signedOut };

export const SESSION_EXPIRED_EVENT = 'dl-session-expired';
const RELOAD_GUARD_KEY = 'dl-session-reload-at';

export class SessionExpiredError extends Error {
  constructor() {
    super('Your sign-in has expired. Reload the page to sign in again.');
    this.name = 'SessionExpiredError';
  }
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

let holds = 0;
/** A screen with unsaved work held only in memory turns this on while that work is open, and off after. */
export function holdAutoReload(on: boolean): void {
  holds = Math.max(0, holds + (on ? 1 : -1));
}

function lastReloadAt(): number | null {
  try {
    return Number(sessionStorage.getItem(RELOAD_GUARD_KEY)) || null;
  } catch {
    return null;
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
  const idle = cameBackAfterIdle(lastActive, now);
  lastActive = now;
  if (!idle || checking) return;
  checking = true;
  try {
    if ((await checkSession()) !== 'expired') return;
    const at = Date.now();
    if (onExpired({ now: at, lastReloadAt: lastReloadAt(), held: holds > 0 }) === 'show-bar') {
      announceSignedOut();
      return;
    }
    markReload(at);
    window.location.reload();
  } finally {
    checking = false;
  }
}

function onActivity(): void {
  if (cameBackAfterIdle(lastActive, Date.now())) void onReturn();
  else lastActive = Date.now();
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void onReturn();
});
window.addEventListener('focus', () => void onReturn());
window.addEventListener('pointerdown', onActivity, { passive: true, capture: true });
window.addEventListener('keydown', onActivity, { passive: true, capture: true });
