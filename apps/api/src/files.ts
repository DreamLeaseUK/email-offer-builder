/**
 * Stored files — brief §5.3 step 4 and §5.8 step 4.
 *
 * Vehicle images: the site's image is fetched, resized to 1200px wide, encoded as JPEG on white with
 * the Images binding, and stored in R2 under vehicles/<sha256-of-our-bytes>.jpg. Only our URL is
 * persisted. The source URL (which carries a CAP ID) is used for the fetch and nothing else; it is
 * never logged, never stored, never part of a key.
 *
 * Brochures: PDFs downloaded by the Worker are stored under brochures/<sha256>.pdf.
 *
 * Both are served from /f/<key> with immutable caching; the content-addressed key makes that safe.
 */
import type { OfferImage } from '@offer-mailer/schema';
import { MAX_PDF_BYTES } from '@offer-mailer/adapters';
import type { BrochureStore, Downloaded, ImageStore } from '@offer-mailer/adapters';
import { Hono } from 'hono';
import type { AppEnv, Env } from './env.js';

export const IMAGE_WIDTH = 1200;
export const IMAGE_QUALITY = 82;
const UA = 'DreamLease-OfferMailer/1.0 (+https://mailer.dreamlease.co.uk)';

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const fileUrl = (env: Pick<Env, 'PUBLIC_BASE_URL'>, key: string): string => `${env.PUBLIC_BASE_URL.replace(/\/$/, '')}/f/${key}`;

// ---------- vehicle images ----------

export function vehicleImageStore(env: Env): ImageStore {
  return {
    async store(sourceUrl, alt): Promise<OfferImage | undefined> {
      const transform = env.TRANSFORM;
      if (!transform) return undefined;
      const res = await fetch(sourceUrl, { headers: { accept: 'image/*', 'user-agent': UA } });
      if (!res.ok || !res.body) return undefined;
      const out = await transform
        .input(res.body)
        .transform({ width: IMAGE_WIDTH, background: '#FFFFFF' })
        .output({ format: 'image/jpeg', quality: IMAGE_QUALITY });
      const bytes = await out.response().arrayBuffer();
      if (bytes.byteLength === 0) return undefined;
      const info = await transform.info(new Blob([bytes]).stream());
      if (!('width' in info) || !info.width || !info.height) return undefined;
      const key = `vehicles/${await sha256Hex(bytes)}.jpg`;
      if (!(await env.IMAGES.head(key))) {
        await env.IMAGES.put(key, bytes, { httpMetadata: { contentType: 'image/jpeg', cacheControl: 'public, max-age=31536000, immutable' } });
      }
      return { key, url: fileUrl(env, key), alt, width: info.width, height: info.height };
    },
  };
}

// ---------- brochure PDFs ----------

export function brochureStore(env: Env): BrochureStore {
  return {
    async putPdf(bytes) {
      const sha256 = await sha256Hex(bytes);
      const key = `brochures/${sha256}.pdf`;
      if (!(await env.BROCHURES.head(key))) {
        await env.BROCHURES.put(key, bytes, { httpMetadata: { contentType: 'application/pdf', cacheControl: 'public, max-age=31536000, immutable' } });
      }
      return { key, url: fileUrl(env, key), sizeBytes: bytes.byteLength, sha256 };
    },
  };
}

/** Direct download by the Worker (no Firecrawl credits), capped at 40 MB. */
export async function downloadFile(url: string): Promise<Downloaded> {
  const res = await fetch(url, { headers: { accept: 'application/pdf,*/*', 'user-agent': UA }, redirect: 'follow' });
  if (!res.ok) return { bytes: new ArrayBuffer(0), contentType: null };
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > MAX_PDF_BYTES) return { bytes: new ArrayBuffer(0), contentType: res.headers.get('content-type') };
  const bytes = await res.arrayBuffer();
  return { bytes, contentType: res.headers.get('content-type') };
}

// ---------- serving ----------

export const files = new Hono<AppEnv>();

files.get('/f/vehicles/:file', async (c) => {
  const file = c.req.param('file');
  if (!/^[a-f0-9]{64}\.jpg$/.test(file)) return c.text('Not found', 404);
  const obj = await c.env.IMAGES.get(`vehicles/${file}`);
  if (!obj) return c.text('Not found', 404);
  return new Response(obj.body, { headers: { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=31536000, immutable', etag: obj.httpEtag } });
});

files.get('/f/brochures/:file', async (c) => {
  const file = c.req.param('file');
  if (!/^[a-f0-9]{64}\.pdf$/.test(file)) return c.text('Not found', 404);
  const obj = await c.env.BROCHURES.get(`brochures/${file}`);
  if (!obj) return c.text('Not found', 404);
  return new Response(obj.body, { headers: { 'content-type': 'application/pdf', 'content-disposition': 'inline; filename="brochure.pdf"', 'cache-control': 'public, max-age=31536000, immutable', etag: obj.httpEtag } });
});
