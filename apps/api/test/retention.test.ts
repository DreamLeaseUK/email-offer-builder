/**
 * Retention / housekeeping. Runs inside workerd with real local D1 + R2. Safe by default: the lookup
 * cache is always purged; campaigns only when RETENTION_CAMPAIGN_DAYS is set.
 */
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { fixtureCampaign } from '@offer-mailer/render/fixtures';
import app from '../src/index.js';
import type { Env } from '../src/env.js';
import { hostedKey } from '../src/hosted.js';
import { runRetention } from '../src/retention.js';

const USER = 'matt.wilson@dreamlease.co.uk';
const authed = (over: Partial<Env> = {}): Env => ({ ...env, DEV_USER_EMAIL: USER, ...over }) as Env;
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

function draft() {
  const { campaign } = fixtureCampaign({ offerCount: 2, brochure: 'none' });
  return { name: campaign.name, useCase: campaign.useCase, subject: campaign.subject, preheader: campaign.preheader, intro: campaign.intro, layout: 'grid2', offers: campaign.offers, sender: campaign.sender, recipient: campaign.recipient };
}
const create = async () => {
  const res = await app.request('/api/campaigns', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(draft()) }, authed());
  return (await res.json()) as { campaign: { id: string; hostedPage: { slug: string } } };
};

describe('retention', () => {
  it('always purges the stale lookup cache but keeps fresh entries', async () => {
    await env.DB.prepare('INSERT OR REPLACE INTO lookup_cache (url_key, fetched_at, data) VALUES (?,?,?)').bind('stale-key', daysAgo(5), '{}').run();
    await env.DB.prepare('INSERT OR REPLACE INTO lookup_cache (url_key, fetched_at, data) VALUES (?,?,?)').bind('fresh-key', daysAgo(0), '{}').run();

    const res = await runRetention(authed(), new Date());
    expect(res.cacheDeleted).toBeGreaterThanOrEqual(1);
    expect(await env.DB.prepare('SELECT url_key FROM lookup_cache WHERE url_key=?').bind('stale-key').first()).toBeNull();
    expect(await env.DB.prepare('SELECT url_key FROM lookup_cache WHERE url_key=?').bind('fresh-key').first()).toBeTruthy();
  });

  it('keeps campaigns with no policy, and purges old ones (with clicks + hosted page) when a policy is set', async () => {
    const { campaign } = await create();
    const { id, hostedPage } = campaign;
    // log a real click, and confirm the hosted page exists
    await app.request(`/r/${hostedPage.slug}/o1-cta`, { headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } }, env);
    expect(await env.HOSTED.get(hostedKey(hostedPage.slug))).toBeTruthy();
    // backdate it well past any policy
    await env.DB.prepare('UPDATE campaigns SET created_at=? WHERE id=?').bind(daysAgo(400), id).run();

    // no policy -> the record is kept
    const noPolicy = await runRetention(authed(), new Date());
    expect(noPolicy.campaignsDeleted).toBe(0);
    expect(await env.DB.prepare('SELECT id FROM campaigns WHERE id=?').bind(id).first()).toBeTruthy();

    // 30-day policy -> the 400-day-old campaign and its click + hosted page are purged
    const purged = await runRetention(authed({ RETENTION_CAMPAIGN_DAYS: '30' }), new Date());
    expect(purged.campaignsDeleted).toBeGreaterThanOrEqual(1);
    expect(await env.DB.prepare('SELECT id FROM campaigns WHERE id=?').bind(id).first()).toBeNull();
    expect(await env.DB.prepare('SELECT id FROM clicks WHERE campaign_id=?').bind(id).first()).toBeNull();
    expect(await env.HOSTED.get(hostedKey(hostedPage.slug))).toBeNull();
  });
});
