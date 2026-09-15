/**
 * Turn page data plus a priced configuration into an Offer (brief §5.1). Every field the schema
 * has is derived here; nothing from the site that is not in the schema survives (no rate book ids,
 * no node ids, no image URLs). The result is validated with the Offer schema before it leaves.
 */
import { Offer } from '@offer-mailer/schema';
import type { Offer as OfferT, OfferImage } from '@offer-mailer/schema';
import { canonicalOfferUrl } from './normalise.js';
import type { OfferUrl } from './normalise.js';
import type { PageData, PageStat } from './parse-page.js';
import type { PricingResult } from './pricing.js';

export class OfferBuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OfferBuildError';
  }
}

export interface BuildOfferInput {
  url: OfferUrl;
  page: PageData;
  pricing: PricingResult;
  image?: OfferImage;
  now: Date;
  createdBy: string;
  id: string;
  /** config/badges.json: the only labels a badge may carry. */
  knownBadges: string[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Last day of the current month in the UK, as YYYY-MM-DD (brief §5.1: validUntil defaults to it). */
export function endOfMonth(now: Date, timeZone = 'Europe/London'): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit' }).formatToParts(now);
  const y = Number(parts.find((p) => p.type === 'year')?.value);
  const m = Number(parts.find((p) => p.type === 'month')?.value);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
}

// ---------- stats ----------

/**
 * Site label -> card label and value formatting. Order here is the display priority: the card shows
 * the first four. EV pages carry range, 0–62, battery, warranty and power (no MPG or CO2), so an EV
 * shows Range, 0–62, Battery, Warranty; a petrol or diesel page shows MPG, CO2, 0–62, Power.
 */
const STAT_MAP: { site: string; label: string; format: (s: PageStat) => string }[] = [
  { site: 'fuel efficiency', label: 'MPG', format: (s) => `${s.value} ${s.unit}`.trim() },
  { site: 'co2 emissions', label: 'CO2', format: (s) => `${s.value} ${s.unit}`.trim() },
  { site: 'combined range', label: 'Range', format: (s) => `${s.value} ${s.unit}`.trim() },
  { site: '0 to 62 mph', label: '0–62', format: (s) => (s.unit === 'secs' || s.unit === 's' ? `${s.value}s` : `${s.value} ${s.unit}`.trim()) },
  { site: 'battery capacity', label: 'Battery', format: (s) => `${s.value} ${s.unit}`.trim() },
  { site: 'battery warranty', label: 'Warranty', format: (s) => `${s.value} ${s.unit}`.trim() },
  { site: 'engine power', label: 'Power', format: (s) => `${s.value} ${s.unit}`.trim() },
];

export function mapStats(stats: PageStat[]): { label: string; value: string }[] {
  const known: { rank: number; label: string; value: string }[] = [];
  const rest: { label: string; value: string }[] = [];
  for (const s of stats) {
    const idx = STAT_MAP.findIndex((m) => m.site === s.label.toLowerCase());
    if (idx >= 0) known.push({ rank: idx, label: STAT_MAP[idx]!.label, value: STAT_MAP[idx]!.format(s) });
    else rest.push({ label: s.label, value: `${s.value} ${s.unit}`.trim() });
  }
  known.sort((a, b) => a.rank - b.rank);
  return [...known.map(({ label, value }) => ({ label, value })), ...rest].filter((s) => s.value).slice(0, 8);
}

// ---------- badges ----------

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
/** Site wording -> our fixed list, when they differ. Keys and values are normalised forms. */
const BADGE_ALIASES: Record<string, string> = {
  limitedstock: 'limitednumbers',
  limitedavailability: 'limitednumbers',
  exclusive: 'dreamleaseexclusive',
  dreamleaseexclusiveoffer: 'dreamleaseexclusive',
};

/** Resolve a site label to a badge from the fixed list, or undefined when no badge matches. */
export function resolveBadge(siteLabel: string, knownBadges: string[]): string | undefined {
  const n = norm(siteLabel);
  const target = BADGE_ALIASES[n] ?? n;
  return knownBadges.find((b) => norm(b) === target);
}

// ---------- offer ----------

export function buildOffer(i: BuildOfferInput): OfferT {
  const priced = i.pricing.offer;
  if (!priced) throw new OfferBuildError(i.pricing.message || 'The site has no price for that vehicle and configuration.');
  if (priced.poa || priced.pricingUnavailable) throw new OfferBuildError('That offer is price on application; enter the figures by hand.');
  const initialMonths = priced.initialRental;
  if (![1, 3, 6, 9, 12].includes(initialMonths)) throw new OfferBuildError(`Unexpected initial payment of ${initialMonths} months.`);

  const monthly = round2(priced.includesMaintenance ? priced.monthly + priced.monthlyService : priced.monthly);
  const contractType = i.url.contractType;

  const hot = priced.specialOffer ? resolveBadge('Special offer', i.knownBadges) : undefined;
  const badges: string[] = [];
  const push = (label: string | undefined) => {
    if (label && label !== hot && !badges.includes(label)) badges.push(label);
  };
  if (priced.isInStock) push(resolveBadge('In stock', i.knownBadges));
  for (const t of i.page.tags) push(resolveBadge(t, i.knownBadges));

  const limited = i.page.tags.some((t) => /limited/i.test(t));
  const stock: OfferT['stock'] | undefined = priced.isInStock ? 'in_stock' : limited ? 'limited' : undefined;

  const nowIso = i.now.toISOString();
  const offer: OfferT = {
    id: i.id,
    source: { kind: 'url', ref: i.url.canonical, fetchedAt: nowIso },
    vehicle: {
      make: i.page.make,
      model: i.page.model,
      derivative: i.page.derivative,
      stats: mapStats(i.page.stats),
    },
    contractType,
    pricing: {
      monthly,
      vat: contractType === 'business' ? 'ex' : 'inc',
      initialPayment: round2(initialMonths * monthly),
      initialMonths: initialMonths as 1 | 3 | 6 | 9 | 12,
      termMonths: priced.contractLength,
      annualMileage: priced.annualMileage,
      maintenance: priced.includesMaintenance,
    },
    badges: badges.slice(0, 3),
    offerUrl: canonicalOfferUrl(
      i.url.path,
      { initialRental: priced.initialRental, contractLength: priced.contractLength, annualMileage: priced.annualMileage, includeMaintenance: priced.includesMaintenance },
      priced.offerCode,
    ),
    validUntil: endOfMonth(i.now),
    createdBy: i.createdBy,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  if (i.page.bodyStyle) offer.vehicle.bodyStyle = i.page.bodyStyle;
  if (i.page.fuelType) offer.vehicle.fuelType = i.page.fuelType;
  if (i.page.transmission) offer.vehicle.transmission = i.page.transmission;
  if (priced.processingFee > 0) offer.pricing.processingFee = priced.processingFee;
  if (hot) offer.hotBadge = hot;
  if (stock) offer.stock = stock;
  if (i.image) offer.image = i.image;

  const parsed = Offer.safeParse(offer);
  if (!parsed.success) throw new OfferBuildError(`The parsed offer failed validation: ${parsed.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ')}`);
  return parsed.data;
}
