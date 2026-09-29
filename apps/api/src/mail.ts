/**
 * Connect Outlook (Phase 1, docs/evolution.md §6): each salesperson gives the tool permission, once, to send from
 * their own mailbox, through the Send app (docs/it-runbook-sign-in.md Part D).
 *
 *   GET  /api/mail/status      is sending set up, may this person send, are they connected
 *   GET  /api/mail/connect     a browser navigation: off to Microsoft's sign-in (PKCE, state in a sealed cookie)
 *   GET  /api/mail/callback    Microsoft sends the browser back here with a code; we keep the encrypted permission
 *   POST /api/mail/disconnect  forget this person's permission
 *
 * Rules (CLAUDE.md rule 4 as built): the permission is stored only for the Access-verified user, only after
 * Microsoft confirms the mailbox is theirs, and is only ever used as them. The callback is under /api, so Access and
 * the signed-in identity apply to it too. Nothing here logs a token, a code or an address.
 */
import { M365Error, createM365Client, createM365Output, isSameMailbox, newPkce, randomToken } from '@offer-mailer/adapters';
import type { DeliveryInput, M365Client, M365ErrorCode } from '@offer-mailer/adapters';
import { eq, lt } from 'drizzle-orm';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import mailConfig from '../../../config/mail.json' with { type: 'json' };
import { db } from './db/index.js';
import { mailConnections } from './db/schema.js';
import type { AppEnv, Env } from './env.js';
import { importTokenKey, open, seal } from './mail-crypto.js';

export const MAIL_RULES = {
  sendingDomains: mailConfig.sendingDomains.map((d) => d.toLowerCase()),
  maxEmailBytes: mailConfig.maxEmailKb * 1024,
  offerCheckedMs: mailConfig.offerCheckedHours * 60 * 60 * 1000,
};

const STATE_COOKIE = 'om_mail_connect';
const STATE_TTL_S = 600;
const norm = (email: string): string => email.trim().toLowerCase();
const tokenPurpose = (email: string) => `mail-connection:${norm(email)}`;
const STATE_PURPOSE = 'mail-connect-state';

/** May this person send from the tool at all? (config/mail.json; Matt, 29 Sept 2026: DreamLease staff only for now.) */
export function maySend(email: string): boolean {
  const domain = norm(email).split('@')[1] ?? '';
  return MAIL_RULES.sendingDomains.includes(domain);
}

type Ready = { client: M365Client; key: CryptoKey; redirectUri: string };

/** The Send app's settings, or undefined until all five are set (then the tool offers Copy for Outlook only). */
export async function mailSetup(env: Env, fetchFn: typeof fetch = fetch): Promise<Ready | undefined> {
  const { MAIL_TENANT_ID, MAIL_CLIENT_ID, MAIL_CLIENT_SECRET, MAIL_REDIRECT_URI, MAIL_TOKEN_KEY } = env;
  if (!MAIL_TENANT_ID || !MAIL_CLIENT_ID || !MAIL_CLIENT_SECRET || !MAIL_REDIRECT_URI) return undefined;
  const key = await importTokenKey(MAIL_TOKEN_KEY);
  if (!key) return undefined;
  const cfg = { tenantId: MAIL_TENANT_ID, clientId: MAIL_CLIENT_ID, clientSecret: MAIL_CLIENT_SECRET, redirectUri: MAIL_REDIRECT_URI };
  return { client: createM365Client(cfg, fetchFn), key, redirectUri: MAIL_REDIRECT_URI };
}

export function mailConnectionsRepo(env: Env) {
  const d = db(env.DB);
  return {
    get: (email: string) => d.select().from(mailConnections).where(eq(mailConnections.email, norm(email))).get(),
    async save(email: string, refreshTokenEnc: string, scopes: string): Promise<void> {
      const now = new Date().toISOString();
      await d
        .insert(mailConnections)
        .values({ email: norm(email), refreshTokenEnc, scopes, connectedAt: now, updatedAt: now })
        .onConflictDoUpdate({ target: mailConnections.email, set: { refreshTokenEnc, scopes, connectedAt: now, updatedAt: now } })
        .run();
    },
    /** Microsoft rotated the refresh token: keep the new one. */
    async rotate(email: string, refreshTokenEnc: string): Promise<void> {
      await d.update(mailConnections).set({ refreshTokenEnc, updatedAt: new Date().toISOString() }).where(eq(mailConnections.email, norm(email))).run();
    },
    async sent(email: string, at: string): Promise<void> {
      await d.update(mailConnections).set({ lastSentAt: at }).where(eq(mailConnections.email, norm(email))).run();
    },
    async remove(email: string): Promise<void> {
      await d.delete(mailConnections).where(eq(mailConnections.email, norm(email))).run();
    },
  };
}

/** Microsoft refuses a refresh token unused for 90 days, so a connection untouched that long is dead: delete it (daily Cron). */
export const STALE_CONNECTION_DAYS = 90;
export async function purgeStaleMailConnections(env: Env, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - STALE_CONNECTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const res = await db(env.DB).delete(mailConnections).where(lt(mailConnections.updatedAt, cutoff)).run();
  return res.meta.changes ?? 0;
}

/** Where the browser goes after connecting: the web app on the same origin as the registered return address. */
function backToApp(env: Env, redirectUri: string | undefined, outcome: string): string {
  let origin = env.TOOL_BASE_URL.replace(/\/$/, '');
  try {
    if (redirectUri) origin = new URL(redirectUri).origin;
  } catch {
    /* keep the tool's own address */
  }
  const path = origin === env.TOOL_BASE_URL.replace(/\/$/, '') ? '/app/' : '/';
  return `${origin}${path}?outlook=${outcome}`;
}

/**
 * Why a send did not complete, for the route to turn into a response. `mayHaveSent` is true when Microsoft may already
 * have the email (no clear answer to the send itself): the campaign must then stay reserved, never be sent again
 * automatically, and the salesperson checks their Sent Items.
 */
export class OutlookUnavailable extends Error {
  constructor(
    readonly code: 'not_configured' | 'not_allowed' | 'connect' | M365ErrorCode,
    message: string,
    readonly retryAfterSeconds?: number,
    readonly mayHaveSent = false,
  ) {
    super(message);
  }
}

const M365_WORDS: Record<M365ErrorCode, string> = {
  reconnect: 'Microsoft needs you to connect Outlook again (step 3). Nothing was sent.',
  app_credential: 'Sending from the tool is not working at the moment (the Send app needs attention from IT). Nothing was sent. Use Copy for Outlook for now, and tell Matt.',
  throttled: 'Microsoft asked us to slow down. Nothing was sent. Try again in a minute.',
  rejected: 'Microsoft refused this email. Nothing was sent. Check the address; if it happens again, tell Matt.',
  unavailable: 'Microsoft 365 could not be reached. Nothing was sent. Try again in a minute.',
  uncertain: 'Microsoft did not confirm the send, so it may or may not have gone. Look in your Outlook Sent Items before doing anything else. If it is not there, create the campaign again and send that.',
};

/**
 * Send one rendered email as `email` from their own mailbox: open their stored permission, renew it with Microsoft
 * (keeping the rotated token), confirm again that the mailbox is theirs, then hand it to the m365 output adapter.
 * Throws OutlookUnavailable with a message for the salesperson; a permission Microsoft no longer honours is deleted,
 * so the screen shows Connect Outlook again.
 */
export async function sendAs(env: Env, email: string, delivery: DeliveryInput, fetchFn: typeof fetch = fetch): Promise<{ deliveredAt: string }> {
  const setup = await mailSetup(env, fetchFn);
  if (!setup) throw new OutlookUnavailable('not_configured', 'Sending from the tool is not set up yet. Use Copy for Outlook.');
  if (!maySend(email)) throw new OutlookUnavailable('not_allowed', 'Sending from the tool is not available for your account yet. Use Copy for Outlook.');
  const repo = mailConnectionsRepo(env);
  const row = await repo.get(email);
  if (!row) throw new OutlookUnavailable('connect', 'Connect Outlook first (step 3), then press Send.');
  const refreshToken = await open(setup.key, row.refreshTokenEnc, tokenPurpose(row.email));
  if (!refreshToken) {
    await repo.remove(email);
    throw new OutlookUnavailable('reconnect', M365_WORDS.reconnect);
  }
  const refused = async (err: M365Error): Promise<never> => {
    if (err.code === 'reconnect') await repo.remove(email);
    throw new OutlookUnavailable(err.code, M365_WORDS[err.code], err.retryAfterSeconds, err.code === 'uncertain');
  };

  // Before the send: anything that fails here means nothing was sent.
  let accessToken: string;
  try {
    const tokens = await setup.client.refresh(refreshToken);
    if (tokens.refreshToken !== refreshToken) await repo.rotate(email, await seal(setup.key, tokens.refreshToken, tokenPurpose(row.email)));
    const me = await setup.client.me(tokens.accessToken);
    if (!isSameMailbox(me, email)) {
      await repo.remove(email);
      throw new OutlookUnavailable('reconnect', 'The connected Outlook is not your own mailbox. Connect Outlook again, signed in as yourself. Nothing was sent.');
    }
    accessToken = tokens.accessToken;
  } catch (err) {
    if (err instanceof M365Error) return refused(err);
    throw err;
  }

  // The send. From here an error without a clear "not sent" answer may mean the email went.
  let deliveredAt: string;
  try {
    ({ deliveredAt } = await createM365Output({ client: setup.client, accessToken }).deliver(delivery));
  } catch (err) {
    if (err instanceof M365Error) return refused(err);
    throw new OutlookUnavailable('uncertain', M365_WORDS.uncertain, undefined, true);
  }

  // Accepted. Bookkeeping must never undo a send: the last-sent time is informational only.
  try {
    await repo.sent(email, deliveredAt);
  } catch {
    /* the email has gone; a missing last-sent time changes nothing */
  }
  return { deliveredAt };
}

// ---------- routes ----------

export const mailApi = new Hono<AppEnv>();

mailApi.get('/mail/status', async (c) => {
  const email = c.get('user').email;
  const setup = await mailSetup(c.env);
  const allowed = maySend(email);
  const row = setup && allowed ? await mailConnectionsRepo(c.env).get(email) : undefined;
  return c.json({
    /** Can this person use Connect Outlook and Send at all? */
    available: !!setup && allowed,
    ...(!setup ? { reason: 'not_configured' } : !allowed ? { reason: 'not_allowed' } : {}),
    connected: !!row,
    ...(row ? { connectedAt: row.connectedAt, lastSentAt: row.lastSentAt } : {}),
  });
});

mailApi.get('/mail/connect', async (c) => {
  const email = c.get('user').email;
  // Started from the tool itself (or typed in), never by a link on another site: a Disconnect stays a Disconnect.
  const site = c.req.header('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') return c.redirect(backToApp(c.env, c.env.MAIL_REDIRECT_URI, 'failed'), 302);
  const setup = await mailSetup(c.env);
  if (!setup) return c.redirect(backToApp(c.env, c.env.MAIL_REDIRECT_URI, 'unavailable'), 302);
  if (!maySend(email)) return c.redirect(backToApp(c.env, setup.redirectUri, 'not_allowed'), 302);
  const state = randomToken(24);
  const { verifier, challenge } = await newPkce();
  const payload = JSON.stringify({ state, verifier, email, exp: Date.now() + STATE_TTL_S * 1000 });
  setCookie(c, STATE_COOKIE, await seal(setup.key, payload, STATE_PURPOSE), {
    path: '/api/mail',
    httpOnly: true,
    secure: setup.redirectUri.startsWith('https:'),
    sameSite: 'Lax', // Microsoft's return is a top-level GET navigation: Lax cookies travel with it
    maxAge: STATE_TTL_S,
  });
  return c.redirect(setup.client.authorizeUrl({ state, codeChallenge: challenge, loginHint: email }), 302);
});

async function finishConnect(c: Context<AppEnv>, setup: Ready): Promise<string> {
  const email = c.get('user').email;
  const sealed = getCookie(c, STATE_COOKIE);
  deleteCookie(c, STATE_COOKIE, { path: '/api/mail' });
  const saved = sealed ? await open(setup.key, sealed, STATE_PURPOSE) : undefined;
  const st = saved ? (JSON.parse(saved) as { state: string; verifier: string; email: string; exp: number }) : undefined;
  const q = c.req.query();
  // One sign-in, started by this person in this browser, in the last ten minutes: anything else is refused.
  if (!st || st.exp < Date.now() || st.email !== email || !q.state || q.state !== st.state) return 'failed';
  if (q.error) return q.error === 'access_denied' ? 'cancelled' : 'failed';
  if (!q.code) return 'failed';
  try {
    const tokens = await setup.client.redeemCode(q.code, st.verifier);
    if (!/(^|\s|\/)Mail\.Send(\s|$)/i.test(tokens.scope)) return 'failed';
    const me = await setup.client.me(tokens.accessToken);
    if (!isSameMailbox(me, email)) return 'mismatch';
    await mailConnectionsRepo(c.env).save(email, await seal(setup.key, tokens.refreshToken, tokenPurpose(email)), tokens.scope);
    return 'connected';
  } catch (err) {
    if (err instanceof M365Error) return err.code === 'app_credential' ? 'unavailable' : 'failed';
    throw err;
  }
}

mailApi.get('/mail/callback', async (c) => {
  const setup = await mailSetup(c.env);
  if (!setup) return c.redirect(backToApp(c.env, c.env.MAIL_REDIRECT_URI, 'unavailable'), 302);
  const outcome = await finishConnect(c, setup);
  return c.redirect(backToApp(c.env, setup.redirectUri, outcome), 302);
});

mailApi.post('/mail/disconnect', async (c) => {
  await mailConnectionsRepo(c.env).remove(c.get('user').email);
  return c.json({ connected: false });
});
