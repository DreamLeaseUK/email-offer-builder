/**
 * "Include brochure" flow — brief §5.8 steps 1 and 2. One current brochure per vehicleKey, shared by
 * every offer for that model. A stored, unexpired copy is attached with no crawl. An expired copy
 * triggers a harvest; the old copy stays served (and stays on every campaign that used it) until a
 * new one verifies, and if the harvest fails the old copy is returned flagged stale.
 */
import { vehicleKey } from '@offer-mailer/schema';
import type { Brochure, Vehicle } from '@offer-mailer/schema';
import type { BrochureSource } from '../types.js';
import { isBrochureExpired } from './harvest.js';

export interface BrochureRepo {
  /** The brochure with status 'current' for this vehicleKey, if any. */
  findCurrent(vehicleKey: string): Promise<Brochure | undefined>;
  save(brochure: Brochure): Promise<void>;
  markSuperseded(id: string): Promise<void>;
}

export interface EnsureResult {
  brochure: Brochure;
  /** stored: unexpired copy used as is; fresh: harvested now; stale: expired copy kept after a failed harvest. */
  state: 'stored' | 'fresh' | 'stale';
  /** Why the harvest failed, when state is 'stale'. */
  error?: string;
}

export interface EnsureDeps {
  repo: BrochureRepo;
  harvester: BrochureSource;
  now?: () => Date;
}

/** Returns undefined when there is no stored copy and the harvest found nothing (the UI then offers upload / paste). */
export async function ensureBrochure(vehicle: Pick<Vehicle, 'make' | 'model'>, deps: EnsureDeps): Promise<EnsureResult | undefined> {
  const now = deps.now?.() ?? new Date();
  const key = vehicleKey(vehicle);
  const current = await deps.repo.findCurrent(key);
  if (current && !isBrochureExpired(current, now)) return { brochure: current, state: 'stored' };

  try {
    const fresh = await deps.harvester.harvest(vehicle);
    await deps.repo.save(fresh);
    if (current) await deps.repo.markSuperseded(current.id);
    return { brochure: fresh, state: 'fresh' };
  } catch (err) {
    if (current) return { brochure: current, state: 'stale', error: err instanceof Error ? err.message : String(err) };
    return undefined;
  }
}
