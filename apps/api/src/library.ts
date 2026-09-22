/**
 * Offer library — brief §6, §7.2 screen 4. A rep can save a fetched offer and reuse it across
 * campaigns. Saved offers are snapshots (a campaign keeps its own copy when built, so editing or
 * deleting a library offer never changes what was already sent). CAP-ID guarded like everything else.
 *
 *   POST   /api/offers/library { offer }   save (upsert by id), stamped with the caller
 *   GET    /api/offers/library             the caller's saved offers, newest first
 *   DELETE /api/offers/library/:id         remove one of the caller's saved offers
 */
import { Offer, assertNoCapId, decodeOfferText, vehicleKey } from '@offer-mailer/schema';
import type { Offer as OfferT } from '@offer-mailer/schema';
import { and, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from './db/index.js';
import { offers as offersTable } from './db/schema.js';
import type { AppEnv, Env } from './env.js';

function offersRepo(env: Env) {
  const d = db(env.DB);
  return {
    async save(offer: OfferT): Promise<void> {
      assertNoCapId(offer, 'library offer');
      await d
        .insert(offersTable)
        .values({ id: offer.id, vehicleKey: vehicleKey(offer.vehicle), contractType: offer.contractType, validUntil: offer.validUntil, createdBy: offer.createdBy, createdAt: offer.createdAt, updatedAt: offer.updatedAt, data: offer })
        .onConflictDoUpdate({ target: offersTable.id, set: { validUntil: offer.validUntil, updatedAt: offer.updatedAt, data: offer } })
        .run();
    },
    async listByUser(email: string): Promise<OfferT[]> {
      const rows = await d.select({ data: offersTable.data }).from(offersTable).where(eq(offersTable.createdBy, email)).orderBy(desc(offersTable.createdAt)).all();
      // an offer saved before a parser fix may still carry the site's entity ("Techno &#x2B; Comfort"): never hand it on
      return rows.map((r) => decodeOfferText(Offer.parse(r.data)));
    },
    async remove(id: string, email: string): Promise<void> {
      await d.delete(offersTable).where(and(eq(offersTable.id, id), eq(offersTable.createdBy, email))).run();
    },
  };
}

export const libraryApi = new Hono<AppEnv>();

libraryApi.post('/offers/library', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { offer?: unknown };
  const parsed = Offer.safeParse(body.offer);
  if (!parsed.success) return c.json({ error: 'That is not a valid offer.', issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) }, 422);
  // The library is the caller's; stamp ownership and the save time rather than trusting the client.
  const offer: OfferT = { ...decodeOfferText(parsed.data), createdBy: c.get('user').email, updatedAt: new Date().toISOString() };
  await offersRepo(c.env).save(offer);
  return c.json({ offer }, 201);
});

libraryApi.get('/offers/library', async (c) => {
  return c.json({ offers: await offersRepo(c.env).listByUser(c.get('user').email) });
});

libraryApi.delete('/offers/library/:id', async (c) => {
  await offersRepo(c.env).remove(c.req.param('id'), c.get('user').email);
  return c.json({ ok: true });
});
