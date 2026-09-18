/**
 * "Include brochure" flow — brief §5.8 steps 1 and 2. One current brochure per vehicleKey, shared by every
 * offer and every rep for that model.
 *
 *   stored   an unexpired copy whose edition is still inside the age limit: attached with no search.
 *   fresh    found just now.
 *   stale    the 90-day copy expired and the new search found nothing: the old copy stays (it stays served
 *            on every campaign that used it), flagged so the rep can replace it.
 *   none     nothing attachable. `search` says what was checked; the rep uploads, pastes, accepts an official
 *            page, or sends without.
 *
 * A search that found nothing is remembered for 7 days so the same model is not searched on every click; a
 * search that FAILED (Firecrawl error, every document unreachable) is never remembered.
 */
import { BROCHURE_MAX_AGE_MONTHS, BROCHURE_NEGATIVE_TTL_DAYS, vehicleKey } from '@offer-mailer/schema';
import type { Brochure, BrochureSearch, Vehicle } from '@offer-mailer/schema';
import type { BrochureSource } from '../types.js';
import { isBrochureExpired } from './harvest.js';

export interface BrochureRepo {
  /** The brochure with status 'current' for this vehicleKey, if any. */
  findCurrent(vehicleKey: string): Promise<Brochure | undefined>;
  save(brochure: Brochure): Promise<void>;
  markSuperseded(id: string): Promise<void>;
  /** The most recent completed search for this vehicleKey. */
  findSearch(vehicleKey: string): Promise<BrochureSearch | undefined>;
  saveSearch(search: BrochureSearch): Promise<void>;
}

export interface EnsureResult {
  brochure?: Brochure;
  state: 'stored' | 'fresh' | 'stale' | 'none';
  /** The search behind this answer, when there was one. */
  search?: BrochureSearch;
  /** True when `search` is a remembered result rather than one run just now. */
  remembered?: boolean;
  /** Why the copy is stale, when state is 'stale'. */
  error?: string;
}

export interface EnsureDeps {
  repo: BrochureRepo;
  harvester: BrochureSource;
  now?: () => Date;
  /** Search again even if a stored copy or a remembered negative exists. */
  force?: boolean;
}

/** A finder-chosen document is re-checked against the age limit every time it is attached, not only when found. */
export function isEditionTooOld(b: Pick<Brochure, 'editionDate' | 'documentType' | 'kind'>, now: Date): boolean {
  if (!b.editionDate || b.kind !== 'pdf') return false;
  const months = (now.getTime() - new Date(`${b.editionDate}T00:00:00Z`).getTime()) / (30.44 * 864e5);
  return months > BROCHURE_MAX_AGE_MONTHS[b.documentType ?? 'brochure'];
}

export async function ensureBrochure(vehicle: Pick<Vehicle, 'make' | 'model'>, deps: EnsureDeps): Promise<EnsureResult> {
  const now = deps.now?.() ?? new Date();
  const key = vehicleKey(vehicle);
  const current = await deps.repo.findCurrent(key);
  const tooOld = !!current && isEditionTooOld(current, now);
  if (current && !deps.force && !tooOld && !isBrochureExpired(current, now)) return { brochure: current, state: 'stored' };

  if (!current && !deps.force) {
    const last = await deps.repo.findSearch(key);
    const ageDays = last ? (now.getTime() - new Date(last.searchedAt).getTime()) / 864e5 : Infinity;
    if (last && last.status !== 'search_failed' && ageDays < BROCHURE_NEGATIVE_TTL_DAYS) return { state: 'none', search: last, remembered: true };
  }

  const found = await deps.harvester.find(vehicle);
  if (found.search.status !== 'search_failed') await deps.repo.saveSearch(found.search);
  if (found.brochure) {
    await deps.repo.save(found.brochure);
    if (current) await deps.repo.markSuperseded(current.id);
    return { brochure: found.brochure, state: 'fresh', search: found.search };
  }
  // an out-of-date edition is not sent again; a merely expired copy is kept, flagged
  if (current && !tooOld && !deps.force) return { brochure: current, state: 'stale', search: found.search, error: found.search.reason ?? 'the new search found nothing' };
  if (current && deps.force && !tooOld) return { brochure: current, state: 'stored', search: found.search };
  return { state: 'none', search: found.search };
}
