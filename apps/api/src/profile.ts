/**
 * The signed-in rep's profile. Persists their sender record (in the `senders` table, keyed by email)
 * so their portrait photo is remembered and shows in the signature of every email they build.
 *
 *   GET    /api/me            the user + publicBaseUrl + their saved headshotUrl (null if none)
 *   POST   /api/me/photo      upload a portrait (multipart `photo` or raw body) -> square headshot in R2
 *   DELETE /api/me/photo      clear the saved portrait
 *
 * The photo is injected into the campaign sender server-side at assemble (see campaigns.ts), so a rep
 * cannot be spoofed with someone else's headshot and it applies to every email without re-uploading.
 */
import { ContactMethod, Sender, assertNoCapId, availableSecondaryContacts } from '@offer-mailer/schema';
import type { ContactMethod as ContactMethodT, Sender as SenderT } from '@offer-mailer/schema';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from './db/index.js';
import { senders as sendersTable } from './db/schema.js';
import type { AppEnv, Env } from './env.js';
import { storeHeadshot } from './files.js';
import { roleFor } from './roles.js';

const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

/** A minimal valid Sender to seed a rep's record when they upload a photo before anything else. */
const baseSender = (email: string): SenderT => ({ kind: 'user', displayName: email.split('@')[0] || email, email, mailbox: email });

/** JPEG / PNG / WebP by magic bytes; CDNs and pickers lie about content types. */
function looksLikeImage(bytes: ArrayBuffer): boolean {
  const b = new Uint8Array(bytes.slice(0, 12));
  const jpeg = b[0] === 0xff && b[1] === 0xd8;
  const png = b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  const webp = b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50;
  return jpeg || png || webp;
}

export function sendersRepo(env: Env) {
  const d = db(env.DB);
  return {
    async get(email: string): Promise<SenderT | undefined> {
      const row = await d.select().from(sendersTable).where(eq(sendersTable.id, email)).get();
      return row ? Sender.parse(row.data) : undefined;
    },
    async save(sender: SenderT): Promise<void> {
      assertNoCapId(sender, 'sender');
      const now = new Date().toISOString();
      await d
        .insert(sendersTable)
        .values({ id: sender.email, kind: sender.kind, updatedAt: now, data: sender })
        .onConflictDoUpdate({ target: sendersTable.id, set: { kind: sender.kind, updatedAt: now, data: sender } })
        .run();
    },
  };
}

export const profileApi = new Hono<AppEnv>();

// The web app uses publicBaseUrl to rewrite our-origin asset/link URLs to same-origin for display.
/** The rep-editable contact fields (everything on the sender except identity and the photo). */
const savedSenderView = (s: SenderT) => ({ displayName: s.displayName, jobTitle: s.jobTitle ?? '', phone: s.phone ?? '', whatsapp: s.whatsapp ?? '', bookingUrl: s.bookingUrl ?? '', secondaryContacts: s.secondaryContacts ?? [] });

profileApi.get('/me', async (c) => {
  const user = c.get('user');
  let saved: SenderT | undefined;
  try {
    if (c.env.DB) saved = await sendersRepo(c.env).get(user.email);
  } catch {
    // No DB / lookup failed — /me still works, just without the saved profile.
  }
  return c.json({
    ...user,
    role: roleFor(c.env, user.email),
    publicBaseUrl: c.env.PUBLIC_BASE_URL,
    headshotUrl: saved?.headshotUrl ?? null,
    savedSender: saved ? savedSenderView(saved) : null,
  });
});

/** Save the rep's contact details so they prefill next time; the saved photo (if any) is preserved. */
profileApi.post('/me/sender', async (c) => {
  const user = c.get('user');
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
  const repo = sendersRepo(c.env);
  const existing = await repo.get(user.email);

  const next: SenderT = { kind: 'user', email: user.email, mailbox: user.email, displayName: str(body.displayName) || existing?.displayName || baseSender(user.email).displayName };
  if (existing?.headshotUrl) next.headshotUrl = existing.headshotUrl;
  const jobTitle = str(body.jobTitle);
  if (jobTitle) next.jobTitle = jobTitle;
  const phone = str(body.phone);
  if (phone) next.phone = phone;
  const whatsapp = str(body.whatsapp);
  if (whatsapp) next.whatsapp = whatsapp;
  const bookingUrl = str(body.bookingUrl);
  if (bookingUrl) next.bookingUrl = bookingUrl;

  // Secondary contact links: keep only valid, deduped methods whose underlying field is now present.
  const valid = new Set<string>(ContactMethod.options);
  const requested = Array.isArray(body.secondaryContacts) ? (body.secondaryContacts.filter((m) => typeof m === 'string' && valid.has(m)) as ContactMethodT[]) : [];
  const avail = availableSecondaryContacts(next);
  next.secondaryContacts = requested.filter((m, i) => avail.includes(m) && requested.indexOf(m) === i);

  const parsed = Sender.safeParse(next);
  if (!parsed.success) return c.json({ error: `Those details are not valid: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}` }, 422);
  await repo.save(parsed.data);
  return c.json({ ok: true, savedSender: savedSenderView(parsed.data) });
});

profileApi.post('/me/photo', async (c) => {
  const user = c.get('user');
  const contentType = c.req.header('content-type') ?? '';
  let bytes: ArrayBuffer | undefined;
  if (contentType.includes('multipart/form-data')) {
    const form = await c.req.formData();
    const file = form.get('photo');
    if (file instanceof File) bytes = await file.arrayBuffer();
  } else {
    bytes = await c.req.arrayBuffer();
  }
  if (!bytes || bytes.byteLength === 0) return c.json({ error: 'No image was uploaded.' }, 400);
  if (bytes.byteLength > MAX_PHOTO_BYTES) return c.json({ error: 'That image is over 10 MB.' }, 413);
  if (!looksLikeImage(bytes)) return c.json({ error: 'That file is not a JPEG, PNG or WebP image.' }, 422);

  const stored = await storeHeadshot(c.env, bytes);
  if (!stored) return c.json({ error: 'The image could not be processed.' }, 500);

  const repo = sendersRepo(c.env);
  const existing = await repo.get(user.email);
  await repo.save({ ...(existing ?? baseSender(user.email)), headshotUrl: stored.url });
  return c.json({ headshotUrl: stored.url });
});

profileApi.delete('/me/photo', async (c) => {
  const user = c.get('user');
  const repo = sendersRepo(c.env);
  const existing = await repo.get(user.email);
  if (existing?.headshotUrl) {
    const { headshotUrl: _drop, ...rest } = existing;
    await repo.save(rest as SenderT);
  }
  return c.json({ ok: true });
});
