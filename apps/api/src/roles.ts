/**
 * Authorization roles (stage one): master **admin** vs **salesperson**.
 *
 * Authentication is Cloudflare Access / Entra (see middleware/access.ts) — that says *who* you are.
 * This says *what you may do*. The master-admin allowlist is deploy-time config (config/admins.json),
 * optionally extended at runtime by the ADMIN_EMAILS env var (comma-separated) so ops can change admins
 * without a code change. Emails are matched case-insensitively.
 *
 * The approver role is parked: a master admin authors AND approves templates (rule 3's approved-gate
 * still holds — the admin is the one who flips a template to `approved`).
 */
import type { MiddlewareHandler } from 'hono';
import adminsConfig from '../../../config/admins.json' with { type: 'json' };
import type { AppEnv, Env } from './env.js';

export type Role = 'salesperson' | 'admin';

const CONFIG_ADMINS = (adminsConfig.admins ?? []).map((e) => e.trim().toLowerCase()).filter(Boolean);

/** The full master-admin set: the config allowlist plus any ADMIN_EMAILS override. */
export function adminEmails(env: Pick<Env, 'ADMIN_EMAILS'>): Set<string> {
  const extra = (env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return new Set([...CONFIG_ADMINS, ...extra]);
}

export function isAdmin(env: Pick<Env, 'ADMIN_EMAILS'>, email: string): boolean {
  return adminEmails(env).has(email.trim().toLowerCase());
}

export function roleFor(env: Pick<Env, 'ADMIN_EMAILS'>, email: string): Role {
  return isAdmin(env, email) ? 'admin' : 'salesperson';
}

/** Gate admin-only routes: 403 unless the signed-in user is a master admin. Runs after requireAccess. */
export const requireAdmin = (): MiddlewareHandler<AppEnv> => async (c, next) => {
  if (!isAdmin(c.env, c.get('user').email)) return c.json({ error: 'Admin access required' }, 403);
  return next();
};
