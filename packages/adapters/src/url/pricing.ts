/**
 * Pricing for a configuration — the same JSON endpoint the offer page's own component calls:
 *   GET /api/carresults/GetOfferDropdownsForCar?manufacturerSlug=..&modelSlug=..&bodyStyleSlug=..
 *       &derivativeSlug=..&initialRental=..&contractLength=..&annualMileage=..&financeType=..
 *       &isBusiness=..&includeMaintenance=..
 * It returns the priced offer for that configuration plus the option lists (initial payment months,
 * term, mileage) that drive the chips in the tool. Deterministic, no Firecrawl, no HTML.
 *
 * The response carries the CAP ID as a bare number inside `rateBookIdentifier`. Nothing from the
 * response is kept except the fields mapped below, and the raw body is never stored.
 */
import { z } from 'zod';
import { SITE_ORIGIN } from './normalise.js';
import type { LeaseConfig, LookupContractType } from './normalise.js';

export interface LeaseOption {
  /** "12 months", "8,000 miles" */
  title: string;
  value: number;
}

export interface PricingOptions {
  initialRental: LeaseOption[];
  contractLength: LeaseOption[];
  annualMileage: LeaseOption[];
  maintenanceAvailable: boolean;
  hasBusiness: boolean;
  hasPersonal: boolean;
}

export interface PricedOffer {
  /** Finance rental per month, before maintenance. */
  monthly: number;
  /** Maintenance per month when the site can price it. */
  monthlyService: number;
  initialRental: number;
  contractLength: number;
  annualMileage: number;
  includesMaintenance: boolean;
  financeType: string;
  specialOffer: boolean;
  isInStock: boolean;
  preRegistered: boolean;
  processingFee: number;
  /** "p-12-48-6000-n": the site's code for this configuration; goes into the offer link. */
  offerCode: string;
  poa: boolean;
  pricingUnavailable: boolean;
  /** Hand-uploaded special-offer image, when the site has one. Fetch it, transform it, forget it. */
  imageOverrideUrl?: string;
}

export interface PricingResult {
  offer?: PricedOffer;
  options: PricingOptions;
  /** e.g. "We've adjusted one or more of the lease options to fit your last selection" */
  message: string;
}

export class PricingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PricingError';
  }
}

const Option = z.object({ title: z.string(), value: z.string() });
const RawOffer = z.object({
  poa: z.boolean().default(false),
  initialRental: Option,
  contractLength: Option,
  annualMileage: Option,
  financeType: Option,
  monthlyFinancePrice: z.number(),
  monthlyServicePrice: z.number().nullable().default(0),
  isInStock: z.boolean().default(false),
  specialOffer: z.boolean().default(false),
  preRegistered: z.boolean().default(false),
  includesMaintenance: z.boolean().default(false),
  offerSlug: z.string(),
  processingFee: z.number().nullable().default(0),
  imageOverrideUrl: z.string().nullable().optional(),
  pricingUnavailable: z.boolean().default(false),
});
const RawResponse = z.object({
  initialRentalOptions: z.array(Option).default([]),
  contractLengthOptions: z.array(Option).default([]),
  annualMileageOptions: z.array(Option).default([]),
  enableMaintenanceCheckbox: z.boolean().default(false),
  hasBusiness: z.boolean().default(false),
  hasPersonal: z.boolean().default(false),
  offer: RawOffer.nullable().optional(),
  message: z.string().nullable().default(''),
});

export const FINANCE_TYPE: Record<LookupContractType, string> = {
  personal: 'Personal Contract Hire',
  business: 'Business Contract Hire',
};

export function pricingUrl(slugs: { manufacturer: string; model: string; bodyStyle: string; derivative: string }, contractType: LookupContractType, config: LeaseConfig, isVan = false, origin = SITE_ORIGIN): string {
  const u = new URL(`${origin}/api/${isVan ? 'vanresults' : 'carresults'}/GetOfferDropdownsForCar`);
  u.searchParams.set('manufacturerSlug', slugs.manufacturer);
  u.searchParams.set('modelSlug', slugs.model);
  u.searchParams.set('bodyStyleSlug', slugs.bodyStyle);
  u.searchParams.set('derivativeSlug', slugs.derivative);
  u.searchParams.set('initialRental', config.initialRental !== undefined ? String(config.initialRental) : '');
  u.searchParams.set('contractLength', config.contractLength !== undefined ? String(config.contractLength) : '');
  u.searchParams.set('annualMileage', config.annualMileage !== undefined ? String(config.annualMileage) : '');
  u.searchParams.set('financeType', FINANCE_TYPE[contractType]);
  u.searchParams.set('isBusiness', String(contractType === 'business'));
  u.searchParams.set('includeMaintenance', String(config.includeMaintenance ?? false));
  return u.toString();
}

const toOptions = (raw: z.infer<typeof Option>[]): LeaseOption[] =>
  raw.map((o) => ({ title: o.title, value: Number(o.value) })).filter((o) => Number.isFinite(o.value));

/** Map the site's response to the narrow shape we keep. Throws PricingError on an unexpected body. */
export function parsePricingResponse(body: unknown): PricingResult {
  const parsed = RawResponse.safeParse(body);
  if (!parsed.success) throw new PricingError('The pricing service answered in a shape we do not understand; the site may have changed.');
  const r = parsed.data;
  const result: PricingResult = {
    options: {
      initialRental: toOptions(r.initialRentalOptions),
      contractLength: toOptions(r.contractLengthOptions),
      annualMileage: toOptions(r.annualMileageOptions),
      maintenanceAvailable: r.enableMaintenanceCheckbox,
      hasBusiness: r.hasBusiness,
      hasPersonal: r.hasPersonal,
    },
    message: r.message ?? '',
  };
  if (r.offer) {
    const o = r.offer;
    const offer: PricedOffer = {
      monthly: o.monthlyFinancePrice,
      monthlyService: o.monthlyServicePrice ?? 0,
      initialRental: Number(o.initialRental.value),
      contractLength: Number(o.contractLength.value),
      annualMileage: Number(o.annualMileage.value),
      includesMaintenance: o.includesMaintenance,
      financeType: o.financeType.value,
      specialOffer: o.specialOffer,
      isInStock: o.isInStock,
      preRegistered: o.preRegistered,
      processingFee: o.processingFee ?? 0,
      offerCode: o.offerSlug,
      poa: o.poa,
      pricingUnavailable: o.pricingUnavailable,
    };
    if (o.imageOverrideUrl) offer.imageOverrideUrl = o.imageOverrideUrl;
    result.offer = offer;
  }
  return result;
}
