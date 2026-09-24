/**
 * Suppression register (build step 7) — the opt-out list. A recipient who replies "stop" is recorded
 * here so the team doesn't email them again. Kept deliberately simple (lowest friction = least perceived
 * compliance risk): plain-text emails behind Access, a clear lawful basis (held to honour the opt-out),
 * viewable and auditable in the tool + CSV export. Removal (re-permitting contact) is admin-only.
 *
 * Delivery is manual (Copy-for-Outlook → Outlook), so the tool can't block the actual send; this is a
 * register staff add to, view, and check against — not a send gate.
 *
 *   POST   /api/suppressions          add an opt-out { email, note? }   (any signed-in salesperson)
 *   GET    /api/suppressions          the register, newest first
 *   POST   /api/suppressions/check    { email } -> { suppressed }       (email in the body, not the URL)
 *   POST   /api/suppressions/remove   { email }                          (admin only)
 */
import { desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { db } from './db/index.js';
import { suppressions as suppressionsTable } from './db/schema.js';
import type { AppEnv, Env } from './env.js';
import { requireAdmin } from './roles.js';

/** Normalise for storage and matching — case- and whitespace-insensitive. */
const norm = (email: string): string => email.trim().toLowerCase();

export function suppressionsRepo(env: Env) {
  const d = db(env.DB);
  return {
    async add(email: string, addedBy: string, note?: string): Promise<void> {
      const now = new Date().toISOString();
      await d
        .insert(suppressionsTable)
        .values({ email: norm(email), addedBy, addedAt: now, note: note ?? null })
        .onConflictDoUpdate({ target: suppressionsTable.email, set: { addedBy, addedAt: now, note: note ?? null } })
        .run();
    },
    async remove(email: string): Promise<void> {
      await d.delete(suppressionsTable).where(eq(suppressionsTable.email, norm(email))).run();
    },
    async list(): Promise<{ email: string; addedBy: string; addedAt: string; note: string | null }[]> {
      return d.select().from(suppressionsTable).orderBy(desc(suppressionsTable.addedAt)).all();
    },
    async isSuppressed(email: string): Promise<boolean> {
      const row = await d.select({ email: suppressionsTable.email }).from(suppressionsTable).where(eq(suppressionsTable.email, norm(email))).get();
      return !!row;
    },
  };
}

const trimmedEmail = z.preprocess((v) => (typeof v === 'string' ? v.trim() : v), z.email());
/** POST /suppressions body. Exported so the OpenAPI document (openapi.ts) describes the real schema. */
export const SuppressionAdd = z.object({ email: trimmedEmail, note: z.string().max(200).optional() });
/** POST /suppressions/check and /suppressions/remove body. */
export const SuppressionEmail = z.object({ email: z.string() });

export const suppressionsApi = new Hono<AppEnv>();

suppressionsApi.post('/suppressions', async (c) => {
  const body = SuppressionAdd.safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) return c.json({ error: 'A valid email address is required.' }, 422);
  await suppressionsRepo(c.env).add(body.data.email, c.get('user').email, body.data.note?.trim() || undefined);
  return c.json({ ok: true }, 201);
});

suppressionsApi.get('/suppressions', async (c) => c.json({ suppressions: await suppressionsRepo(c.env).list() }));

const csvCell = (v: string): string => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
suppressionsApi.get('/suppressions.csv', async (c) => {
  const rows = await suppressionsRepo(c.env).list();
  const header = ['Email', 'Added by', 'Added at', 'Note'].map(csvCell).join(',');
  const body = rows.map((r) => [r.email, r.addedBy, r.addedAt, r.note ?? ''].map(csvCell).join(',')).join('\r\n');
  return new Response([header, body].filter(Boolean).join('\r\n') + '\r\n', {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="dreamlease-suppression-list.csv"' },
  });
});

suppressionsApi.post('/suppressions/check', async (c) => {
  const body = SuppressionEmail.safeParse(await c.req.json().catch(() => ({})));
  if (!body.success || !body.data.email.trim()) return c.json({ suppressed: false });
  return c.json({ suppressed: await suppressionsRepo(c.env).isSuppressed(body.data.email) });
});

suppressionsApi.post('/suppressions/remove', requireAdmin(), async (c) => {
  const body = SuppressionEmail.safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) return c.json({ error: 'An email is required.' }, 422);
  await suppressionsRepo(c.env).remove(body.data.email);
  return c.json({ ok: true });
});
