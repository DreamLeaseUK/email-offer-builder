/**
 * Click and hosted-view logging — brief §5.6. No IP and no full user agent are stored, only a coarse
 * class. Link scanners (Safe Links, Proofpoint, Mimecast, and link-preview bots) pre-fetch every URL
 * in inbound mail; they are logged with uaClass 'scanner' so stats can exclude them, the same way the
 * redirect still fires so a real click is never lost.
 */
import { db } from './db/index.js';
import { clicks } from './db/schema.js';
import type { Env } from './env.js';

export type UaClass = 'desktop' | 'mobile' | 'scanner' | 'other';
export type HitKind = 'click' | 'view';

const SCANNERS: RegExp[] = [
  /proofpoint/i,
  /mimecast/i,
  /barracuda/i,
  /symantec/i,
  /messagelabs/i,
  /safelinks/i,
  /urldefense/i,
  /fireeye/i,
  /forcepoint/i,
  /microsoft[- ]?office/i,
  /googleimageproxy/i,
  /yahoomailproxy/i,
  /bitdefender/i,
  /cloudmark/i,
  /fortinet/i,
  /skypeuripreview/i,
  /slackbot|slack-imgproxy/i,
  /whatsapp/i,
  /telegrambot/i,
  /facebookexternalhit/i,
  /\bbot\b|crawler|spider|preview/i,
];

/** Coarse class only. A missing UA is 'other', not attributed to a device. */
export function classifyUa(ua: string): UaClass {
  const s = ua.trim();
  if (!s) return 'other';
  if (SCANNERS.some((re) => re.test(s))) return 'scanner';
  if (/mobile|android|iphone|ipad|ipod/i.test(s)) return 'mobile';
  if (/windows|macintosh|mac os x|x11|linux|cros/i.test(s)) return 'desktop';
  return 'other';
}

/** Best-effort: a logging failure must never break a redirect or a page serve. */
export async function logHit(env: Env, campaignId: string, linkId: string, kind: HitKind, ua: string): Promise<void> {
  try {
    await db(env.DB)
      .insert(clicks)
      .values({ campaignId, linkId, kind, uaClass: classifyUa(ua), ts: new Date().toISOString() })
      .run();
  } catch {
    /* logging is not allowed to fail the request */
  }
}
