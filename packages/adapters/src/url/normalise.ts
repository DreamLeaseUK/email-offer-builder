/**
 * Offer URL validation and normalisation — brief §5.3 step 1.
 * A rep pastes any dreamlease.co.uk offer URL; we keep the contract type, the vehicle slug and the
 * lease configuration, and drop everything else (tracking parameters, fragments, the derived
 * `offer=` code). The canonical form is the cache key and the base of the rendered offer link.
 */
import type { ContractType } from '@offer-mailer/schema';

export const SITE_ORIGIN = 'https://www.dreamlease.co.uk';
const HOSTS = new Set(['www.dreamlease.co.uk', 'dreamlease.co.uk']);

export type LookupContractType = Exclude<ContractType, 'salary_sacrifice'>;

/** Lease configuration as carried in the query string. All optional: the site fills in defaults. */
export interface LeaseConfig {
  initialRental?: number;
  contractLength?: number;
  annualMileage?: number;
  includeMaintenance?: boolean;
}

export interface OfferUrl {
  contractType: LookupContractType;
  slug: string;
  config: LeaseConfig;
  /** https://www.dreamlease.co.uk/offers/<type>/<slug>/?initialRental=..&contractLength=..&annualMileage=..&includeMaintenance=.. */
  canonical: string;
}

export class OfferUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OfferUrlError';
  }
}

const positiveInt = (raw: string | null): number | undefined => {
  if (raw === null || raw.trim() === '') return undefined;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : undefined;
};

/** Build the canonical URL for a contract type, slug and configuration. */
export function canonicalOfferUrl(contractType: LookupContractType, slug: string, config: LeaseConfig, offerCode?: string): string {
  const u = new URL(`${SITE_ORIGIN}/offers/${contractType}/${slug}/`);
  if (offerCode) u.searchParams.set('offer', offerCode);
  if (config.initialRental !== undefined) u.searchParams.set('initialRental', String(config.initialRental));
  if (config.contractLength !== undefined) u.searchParams.set('contractLength', String(config.contractLength));
  if (config.annualMileage !== undefined) u.searchParams.set('annualMileage', String(config.annualMileage));
  if (config.includeMaintenance !== undefined) u.searchParams.set('includeMaintenance', String(config.includeMaintenance));
  return u.toString();
}

/**
 * Validate and normalise a pasted URL. Throws OfferUrlError with a message the UI can show.
 * The `offer=p-12-48-6000-n` code is read as a fallback for the configuration when the explicit
 * parameters are missing (the homepage links carry only the code).
 */
export function parseOfferUrl(input: string): OfferUrl {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    throw new OfferUrlError('That is not a web address.');
  }
  if (!HOSTS.has(u.hostname.toLowerCase())) throw new OfferUrlError('Only dreamlease.co.uk offer pages can be looked up.');
  const m = u.pathname.match(/^\/offers\/(personal|business)\/([a-z0-9][a-z0-9-]*)\/?$/i);
  if (!m) throw new OfferUrlError('That is not an offer page. It should look like dreamlease.co.uk/offers/personal/<vehicle>/.');
  const contractType = m[1]!.toLowerCase() as LookupContractType;
  const slug = m[2]!.toLowerCase();

  const q = u.searchParams;
  const code = (q.get('offer') ?? '').match(/^([pb])-(\d+)-(\d+)-(\d+)-([a-z])$/i);
  const config: LeaseConfig = {};
  const initialRental = positiveInt(q.get('initialRental')) ?? (code ? Number(code[2]) : undefined);
  const contractLength = positiveInt(q.get('contractLength')) ?? (code ? Number(code[3]) : undefined);
  const annualMileage = positiveInt(q.get('annualMileage')) ?? (code ? Number(code[4]) : undefined);
  if (initialRental !== undefined) config.initialRental = initialRental;
  if (contractLength !== undefined) config.contractLength = contractLength;
  if (annualMileage !== undefined) config.annualMileage = annualMileage;
  const maint = q.get('includeMaintenance');
  if (maint === 'true' || maint === 'false') config.includeMaintenance = maint === 'true';

  return { contractType, slug, config, canonical: canonicalOfferUrl(contractType, slug, config) };
}
