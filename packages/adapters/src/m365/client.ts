/**
 * Microsoft 365 adapter (Phase 1, docs/evolution.md §6): send from the salesperson's OWN mailbox through Microsoft
 * Graph, with the delegated permissions of the second Entra app, "DreamLease Offer Mailer - Send"
 * (docs/it-runbook-sign-in.md Part D): Mail.Send, offline_access, User.Read, openid, email.
 *
 * The Worker is a confidential client (Web platform, client secret): authorization code with PKCE, the code returned
 * in the query string (a form_post would be a cross-site POST, which the API's CSRF guard refuses), and the tenant's
 * own endpoints (a single-tenant app cannot use /common). sendMail never sets `from`, so Graph can only send as the
 * person whose token it holds. I/O is injected (fetch), so the contract tests run against a stand-in for Microsoft.
 * Nothing here logs; an error carries Microsoft's error code, never a token, a secret or a message body.
 */

/** Exactly the delegated permissions IT grants in runbook D6 (Graph's own scopes are fully qualified). */
export const M365_SCOPES = ['openid', 'email', 'offline_access', 'https://graph.microsoft.com/User.Read', 'https://graph.microsoft.com/Mail.Send'] as const;

const LOGIN = 'https://login.microsoftonline.com';
const GRAPH = 'https://graph.microsoft.com/v1.0';

export interface M365Config {
  /** Directory (tenant) ID of the DreamLease Entra tenant. */
  tenantId: string;
  /** Application (client) ID of the Send app. */
  clientId: string;
  clientSecret: string;
  /** Exactly as registered in runbook D4. Configured, never derived from the request (the dev proxy rewrites Host). */
  redirectUri: string;
}

/**
 * What went wrong, in terms the tool can act on:
 *  reconnect       the salesperson must connect Outlook again (expired, revoked or refused permission)
 *  app_credential  the Send app's own credential is wrong or expired: nobody can send until IT renews it
 *  throttled       Microsoft asked us to slow down (retryAfterSeconds when it says how long)
 *  rejected        Microsoft refused this request (e.g. an invalid recipient, a mailbox without Exchange)
 *  unavailable     Microsoft could not be reached or failed (before anything was sent)
 *  uncertain       the send itself got no clear answer (network error, 5xx, not 202): the email MAY have gone, so it
 *                  must never be retried automatically; the salesperson checks their Sent Items
 */
export type M365ErrorCode = 'reconnect' | 'app_credential' | 'throttled' | 'rejected' | 'unavailable' | 'uncertain';

export class M365Error extends Error {
  constructor(
    readonly code: M365ErrorCode,
    message: string,
    /** Microsoft's own code (e.g. invalid_grant, AADSTS700082, ErrorInvalidRecipients): safe to show and log. */
    readonly detail?: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'M365Error';
  }
}

export interface TokenSet {
  accessToken: string;
  /** Microsoft rotates it on every use: always store the one returned. */
  refreshToken: string;
  expiresIn: number;
  scope: string;
}

export interface M365Me {
  mail: string | null;
  userPrincipalName: string;
  displayName?: string;
}

export interface MailMessage {
  subject: string;
  html: string;
  to: { address: string; name?: string }[];
}

export interface M365Client {
  authorizeUrl(p: { state: string; codeChallenge: string; loginHint?: string }): string;
  redeemCode(code: string, codeVerifier: string): Promise<TokenSet>;
  refresh(refreshToken: string): Promise<TokenSet>;
  me(accessToken: string): Promise<M365Me>;
  /** Resolves when Microsoft has ACCEPTED the message (HTTP 202). It is then in the sender's Sent Items. */
  sendMail(accessToken: string, message: MailMessage): Promise<void>;
}

// ---------- PKCE ----------

const b64url = (bytes: Uint8Array): string => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/** A random URL-safe string of `bytes` bytes of entropy (state, PKCE verifier). */
export function randomToken(bytes = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** PKCE (RFC 7636, S256): the verifier stays with us, the challenge goes to Microsoft. */
export async function newPkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = randomToken(32);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: b64url(new Uint8Array(digest)) };
}

// ---------- the client ----------

/** Microsoft's AADSTS code, if the description carries one (the rest of the description can carry trace ids). */
const aadsts = (description: unknown): string | undefined => (typeof description === 'string' ? /AADSTS\d+/.exec(description)?.[0] : undefined);

const retryAfter = (res: Response): number | undefined => {
  const v = Number(res.headers.get('retry-after'));
  return Number.isFinite(v) && v > 0 ? v : undefined;
};

export function createM365Client(cfg: M365Config, fetchFn: typeof fetch = fetch): M365Client {
  const tokenUrl = `${LOGIN}/${encodeURIComponent(cfg.tenantId)}/oauth2/v2.0/token`;
  const scope = M365_SCOPES.join(' ');

  async function token(params: Record<string, string>, previousRefresh?: string): Promise<TokenSet> {
    let res: Response;
    try {
      res = await fetchFn(tokenUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, scope, ...params }).toString(),
      });
    } catch {
      throw new M365Error('unavailable', 'Microsoft sign-in could not be reached.');
    }
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.ok && typeof body.access_token === 'string') {
      const refreshToken = typeof body.refresh_token === 'string' ? body.refresh_token : previousRefresh;
      if (!refreshToken) throw new M365Error('rejected', 'Microsoft did not grant lasting access (offline_access is missing from the Send app).', 'no_refresh_token');
      return { accessToken: body.access_token, refreshToken, expiresIn: Number(body.expires_in) || 3600, scope: typeof body.scope === 'string' ? body.scope : '' };
    }
    const error = typeof body.error === 'string' ? body.error : `http_${res.status}`;
    const detail = aadsts(body.error_description) ?? error;
    if (res.status === 429) throw new M365Error('throttled', 'Microsoft asked us to slow down.', detail, retryAfter(res));
    if (res.status >= 500) throw new M365Error('unavailable', 'Microsoft sign-in failed.', detail);
    if (error === 'invalid_client' || error === 'unauthorized_client') throw new M365Error('app_credential', "The Send app's credential was refused.", detail);
    if (error === 'invalid_grant' || error === 'interaction_required' || error === 'consent_required' || error === 'login_required') {
      throw new M365Error('reconnect', 'Microsoft needs you to connect Outlook again.', detail);
    }
    throw new M365Error('rejected', 'Microsoft refused the sign-in.', detail);
  }

  /** `sends`: this request delivers an email, so an unclear answer means it may have gone (uncertain), not "not sent". */
  async function graph(path: string, accessToken: string, init: RequestInit = {}, sends = false): Promise<Response> {
    let res: Response;
    try {
      res = await fetchFn(`${GRAPH}${path}`, { ...init, headers: { ...(init.headers as Record<string, string>), authorization: `Bearer ${accessToken}`, accept: 'application/json' } });
    } catch {
      throw new M365Error(sends ? 'uncertain' : 'unavailable', 'Microsoft 365 could not be reached.');
    }
    if (res.ok) return res;
    const body = (await res.json().catch(() => ({}))) as { error?: { code?: unknown } };
    const detail = typeof body.error?.code === 'string' ? body.error.code : `http_${res.status}`;
    // 401: the token is no good. 403: permission withdrawn, a Conditional Access step-up, or no mailbox: a fresh
    // Connect Outlook either fixes it or shows Microsoft's own reason.
    if (res.status === 401 || res.status === 403) throw new M365Error('reconnect', 'Microsoft needs you to connect Outlook again.', detail);
    if (res.status === 429) throw new M365Error('throttled', 'Microsoft asked us to slow down.', detail, retryAfter(res));
    if (res.status >= 500) throw new M365Error(sends ? 'uncertain' : 'unavailable', 'Microsoft 365 failed.', detail);
    throw new M365Error('rejected', 'Microsoft 365 refused the request.', detail);
  }

  return {
    authorizeUrl({ state, codeChallenge, loginHint }) {
      const q = new URLSearchParams({
        client_id: cfg.clientId,
        response_type: 'code',
        redirect_uri: cfg.redirectUri,
        response_mode: 'query',
        scope,
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        ...(loginHint ? { login_hint: loginHint } : {}),
      });
      return `${LOGIN}/${encodeURIComponent(cfg.tenantId)}/oauth2/v2.0/authorize?${q.toString()}`;
    },
    redeemCode: (code, codeVerifier) => token({ grant_type: 'authorization_code', code, redirect_uri: cfg.redirectUri, code_verifier: codeVerifier }),
    refresh: (refreshToken) => token({ grant_type: 'refresh_token', refresh_token: refreshToken }, refreshToken),
    async me(accessToken) {
      const res = await graph('/me?$select=mail,userPrincipalName,displayName', accessToken);
      const b = (await res.json()) as Partial<M365Me>;
      if (typeof b.userPrincipalName !== 'string') throw new M365Error('rejected', 'Microsoft 365 did not say whose mailbox this is.', 'no_upn');
      return { mail: typeof b.mail === 'string' ? b.mail : null, userPrincipalName: b.userPrincipalName, ...(typeof b.displayName === 'string' ? { displayName: b.displayName } : {}) };
    },
    async sendMail(accessToken, m) {
      // No `from`: Graph sends as the token's own user, the only mailbox delegated Mail.Send allows.
      const message = {
        subject: m.subject,
        body: { contentType: 'HTML', content: m.html },
        toRecipients: m.to.map((r) => ({ emailAddress: { address: r.address, ...(r.name ? { name: r.name } : {}) } })),
      };
      const res = await graph(
        '/me/sendMail',
        accessToken,
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message, saveToSentItems: true }) },
        true,
      );
      if (res.status !== 202) throw new M365Error('uncertain', `Microsoft 365 answered ${res.status} instead of accepting the email.`, `http_${res.status}`);
    },
  };
}

/** Does this Microsoft 365 account belong to the signed-in person? Case-insensitive, on the mail or sign-in address. */
export function isSameMailbox(me: M365Me, email: string): boolean {
  const want = email.trim().toLowerCase();
  return [me.mail, me.userPrincipalName].some((a) => typeof a === 'string' && a.trim().toLowerCase() === want);
}
