/**
 * Retention / housekeeping (PII plan item 3). Runs from the Cron trigger (see wrangler.jsonc) and is
 * unit-testable directly.
 *
 * Safe by default: the only thing purged unconditionally is the 24h lookup cache (pure cache, no value,
 * grows unbounded). The campaign snapshot is the FCA promotion record, so it is purged ONLY when an
 * explicit RETENTION_CAMPAIGN_DAYS policy is set — nothing deletes the compliance record by accident.
 * When set, a purged campaign takes its click log and its hosted page (R2) with it.
 *
 * Not touched: senders (staff business data), suppressions (kept to honour opt-outs), templates
 * (compliance records). Recipient PII is never stored (see campaigns.ts). The offer library is housekept
 * separately from the same Cron (library.ts: recheckLibraryUrls + purgeArchivedLibrary) — its archive is
 * purged after 6 months so the list does not grow without bound.
 */
import type { Env } from './env.js';
import { hostedKey } from './hosted.js';

export interface RetentionResult {
  cacheDeleted: number;
  campaignsDeleted: number;
  clicksDeleted: number;
  hostedDeleted: number;
}

const changes = (r: { meta?: { changes?: number } }): number => r.meta?.changes ?? 0;

export async function runRetention(env: Env, now: Date): Promise<RetentionResult> {
  const DB = env.DB;
  const iso = (days: number): string => new Date(now.getTime() - days * 86_400_000).toISOString();

  // 1. Lookup cache — pure cache; purge anything past the 24h TTL (+ a day of grace).
  const cacheDeleted = changes(await DB.prepare('DELETE FROM lookup_cache WHERE fetched_at < ?').bind(iso(2)).run());

  // 2. Campaigns (FCA promotion record) — only when an explicit retention policy is configured.
  let campaignsDeleted = 0;
  let clicksDeleted = 0;
  let hostedDeleted = 0;
  const days = Number(env.RETENTION_CAMPAIGN_DAYS);
  if (Number.isFinite(days) && days > 0) {
    const cutoff = iso(days);
    const { results } = await DB.prepare('SELECT id, hosted_slug FROM campaigns WHERE created_at < ?').bind(cutoff).all<{ id: string; hosted_slug: string }>();
    for (const row of results) {
      try {
        await env.HOSTED.delete(hostedKey(row.hosted_slug));
        hostedDeleted += 1;
      } catch {
        // hosted page already gone — fine
      }
    }
    if (results.length > 0) {
      clicksDeleted = changes(await DB.prepare('DELETE FROM clicks WHERE campaign_id IN (SELECT id FROM campaigns WHERE created_at < ?)').bind(cutoff).run());
      campaignsDeleted = changes(await DB.prepare('DELETE FROM campaigns WHERE created_at < ?').bind(cutoff).run());
    }
  }

  return { cacheDeleted, campaignsDeleted, clicksDeleted, hostedDeleted };
}
