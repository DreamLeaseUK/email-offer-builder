/**
 * Authorization: master **admin**, **salesperson**, and the **compliance approver** capability.
 *
 * Authentication is Cloudflare Access / Entra (see middleware/access.ts) — that says *who* you are.
 * This says *what you may do*. Both allowlists are deploy-time config, optionally extended at runtime by an env var
 * (comma-separated) so ops can change them without a code change. Emails are matched case-insensitively.
 *
 *   config/admins.json      (+ ADMIN_EMAILS)       master admins: library curation, suppression removal, and READ
 *                                                   access to the compliance templates.
 *   config/compliance.json  (+ COMPLIANCE_EMAILS)  compliance approvers (Emma, Matt 28 Sept 2026): the only people who
 *                                                   can create, edit, approve (publish) and retire the compliance wording.
 *
 * `role` stays admin | salesperson (what /me has always returned); compliance is a separate capability, so a
 * compliance approver who is not an admin still uses the rest of the tool as a salesperson. Rule 3's approved-gate
 * holds throughout: only an approver flips a template to `approved`, stamped with their own sign-in.
 */
import type { MiddlewareHandler } from 'hono';
import adminsConfig from '../../../config/admins.json' with { type: 'json' };
import complianceConfig from '../../../config/compliance.json' with { type: 'json' };
import type { AppEnv, Env } from './env.js';

export type Role = 'salesperson' | 'admin';

const normalise = (emails: string[]) => emails.map((e) => e.trim().toLowerCase()).filter(Boolean);
const CONFIG_ADMINS = normalise(adminsConfig.admins ?? []);
const CONFIG_APPROVERS = normalise(complianceConfig.approvers ?? []);
const fromEnv = (value: string | undefined) => normalise((value ?? '').split(','));

/** The full master-admin set: the config allowlist plus any ADMIN_EMAILS override. */
export function adminEmails(env: Pick<Env, 'ADMIN_EMAILS'>): Set<string> {
  return new Set([...CONFIG_ADMINS, ...fromEnv(env.ADMIN_EMAILS)]);
}

export function isAdmin(env: Pick<Env, 'ADMIN_EMAILS'>, email: string): boolean {
  return adminEmails(env).has(email.trim().toLowerCase());
}

export function roleFor(env: Pick<Env, 'ADMIN_EMAILS'>, email: string): Role {
  return isAdmin(env, email) ? 'admin' : 'salesperson';
}

/** The compliance approvers: config/compliance.json plus any COMPLIANCE_EMAILS override. */
export function complianceApprovers(env: Pick<Env, 'COMPLIANCE_EMAILS'>): Set<string> {
  return new Set([...CONFIG_APPROVERS, ...fromEnv(env.COMPLIANCE_EMAILS)]);
}

export function isComplianceApprover(env: Pick<Env, 'COMPLIANCE_EMAILS'>, email: string): boolean {
  return complianceApprovers(env).has(email.trim().toLowerCase());
}

/** Gate admin-only routes: 403 unless the signed-in user is a master admin. Runs after requireAccess. */
export const requireAdmin = (): MiddlewareHandler<AppEnv> => async (c, next) => {
  if (!isAdmin(c.env, c.get('user').email)) return c.json({ error: 'Admin access required' }, 403);
  return next();
};

/** Gate changes to the compliance wording: 403 unless the signed-in user is a compliance approver. */
export const requireCompliance = (): MiddlewareHandler<AppEnv> => async (c, next) => {
  if (!isComplianceApprover(c.env, c.get('user').email)) return c.json({ error: 'Only compliance can change the compliance wording' }, 403);
  return next();
};

/** Gate reading the templates: a master admin (to see what is live) or a compliance approver. */
export const requireAdminOrCompliance = (): MiddlewareHandler<AppEnv> => async (c, next) => {
  const email = c.get('user').email;
  if (!isAdmin(c.env, email) && !isComplianceApprover(c.env, email)) return c.json({ error: 'Admin or compliance access required' }, 403);
  return next();
};
