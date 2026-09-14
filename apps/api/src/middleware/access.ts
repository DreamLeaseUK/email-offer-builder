/**
 * Cloudflare Access middleware — brief §5.7.
 * Access (Entra ID as IdP) sits in front of mailer.dreamlease.co.uk and stamps every request with a
 * Cf-Access-Jwt-Assertion header. We verify it against the team's JWKS and the app's AUD tag, and the
 * email claim becomes `createdBy` everywhere.
 *
 * Local dev: with ACCESS_AUD empty, DEV_USER_EMAIL from .dev.vars is accepted. With ACCESS_AUD set,
 * that bypass is inert, so a misconfigured production deploy fails closed (503), never open.
 */
import type { MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { AppEnv } from '../env.js';

type Jwks = ReturnType<typeof createRemoteJWKSet>;
const jwksByIssuer = new Map<string, Jwks>();

function jwksFor(issuer: string): Jwks {
  let jwks = jwksByIssuer.get(issuer);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
    jwksByIssuer.set(issuer, jwks);
  }
  return jwks;
}

export const requireAccess = (): MiddlewareHandler<AppEnv> => async (c, next) => {
  const { ACCESS_TEAM_DOMAIN, ACCESS_AUD, DEV_USER_EMAIL } = c.env;

  if (!ACCESS_AUD) {
    if (DEV_USER_EMAIL) {
      c.set('user', { email: DEV_USER_EMAIL, sub: 'dev' });
      return next();
    }
    return c.json({ error: 'Access is not configured' }, 503);
  }
  if (!ACCESS_TEAM_DOMAIN) return c.json({ error: 'Access is not configured' }, 503);

  const token = c.req.header('Cf-Access-Jwt-Assertion') ?? getCookie(c, 'CF_Authorization');
  if (!token) return c.json({ error: 'Unauthorised' }, 401);

  const issuer = `https://${ACCESS_TEAM_DOMAIN}`;
  try {
    const { payload } = await jwtVerify(token, jwksFor(issuer), { issuer, audience: ACCESS_AUD });
    const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : undefined;
    if (!email) return c.json({ error: 'Unauthorised' }, 401);
    c.set('user', { email, sub: String(payload.sub ?? '') });
    return next();
  } catch {
    return c.json({ error: 'Unauthorised' }, 401);
  }
};
