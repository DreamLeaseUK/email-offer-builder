/**
 * Hosted campaign pages — brief §5.4. Every render writes `c/<slug>.html` to the HOSTED bucket with
 * the campaign's expiry in custom metadata; this route serves it with no login. The archived HTML
 * stays in R2 after expiry (promotions record), the page just stops showing it.
 */
import type { Campaign } from '@offer-mailer/schema';
import { Hono } from 'hono';
import type { AppEnv } from './env.js';
import { logHit } from './tracking.js';

export const hostedKey = (slug: string): string => `c/${slug}.html`;

/** Hosted page expires at the end (UTC) of the earliest validUntil among the campaign's offers. */
export function hostedExpiresAt(campaign: Campaign): string {
  const earliest = campaign.offers.map((o) => o.validUntil).sort()[0]!;
  return `${earliest}T23:59:59.999Z`;
}

export async function writeHostedPage(bucket: R2Bucket, campaign: Campaign, hostedHtml: string): Promise<void> {
  await bucket.put(hostedKey(campaign.hostedPage.slug), hostedHtml, {
    httpMetadata: { contentType: 'text/html; charset=utf-8' },
    customMetadata: { campaignId: campaign.id, expiresAt: hostedExpiresAt(campaign) },
  });
}

const page = (title: string, body: string) =>
  `<!DOCTYPE html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>${title} · DreamLease</title><style>body{margin:0;background:#EDEDEF;font-family:Arial,'Helvetica Neue',Helvetica,sans-serif;color:#787580}.box{max-width:520px;margin:64px auto;background:#fff;border:1px solid #E1E0E4;border-radius:16px;padding:32px 28px}h1{margin:0 0 12px;font-size:22px;color:#000}a{color:#E30613}</style></head><body><div class="box"><h1>${title}</h1><p style="margin:0 0 18px;font-size:16px;line-height:26px">${body}</p><p style="margin:0;font-size:14px"><a href="https://www.dreamlease.co.uk/">See current offers on dreamlease.co.uk</a></p></div></body></html>`;

export const hosted = new Hono<AppEnv>();

hosted.get('/c/:slug', async (c) => {
  const slug = c.req.param('slug');
  if (!/^[A-Za-z0-9_-]{16,}$/.test(slug)) return c.html(page('Page not found', 'That link doesn\'t look right.'), 404);
  const obj = await c.env.HOSTED.get(hostedKey(slug));
  if (!obj) return c.html(page('Page not found', 'These offers aren\'t available at this address.'), 404);
  const expiresAt = obj.customMetadata?.expiresAt;
  if (expiresAt && new Date(expiresAt).getTime() < Date.now()) {
    return c.html(page('These offers have expired', 'The prices in this email were valid until the date shown on each offer. Reply to the email that brought you here and we\'ll send current figures.'), 410);
  }
  const campaignId = obj.customMetadata?.campaignId;
  if (campaignId) await logHit(c.env, campaignId, 'view', 'view', c.req.header('user-agent') ?? '');
  return new Response(obj.body, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'private, no-cache', 'x-robots-tag': 'noindex, nofollow' },
  });
});
