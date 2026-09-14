import { describe, expect, it } from 'vitest';
import { Offer, findCapIdLeak } from '@offer-mailer/schema';
import { OfferBuildError, buildOffer, endOfMonth, mapStats, parseOfferPage, parseOfferUrl, parsePricingResponse, resolveBadge } from '../src/index.js';
import type { PricingResult } from '../src/index.js';
import { BY, KNOWN_BADGES, NOW, Rewriter, fixture, fixtureJson } from './helpers.js';

const ID = 'd6f2a1c4-2b7e-4c1f-9a3d-5e6f7a8b9c0d';
const personalUrl = parseOfferUrl('https://www.dreamlease.co.uk/offers/personal/byd-seal-390kw-excellence-83kwh-awd-102n/?initialRental=12&contractLength=48&annualMileage=6000&includeMaintenance=false');
const businessUrl = parseOfferUrl('https://www.dreamlease.co.uk/offers/business/byd-seal-390kw-excellence-83kwh-awd-102n/?initialRental=12&contractLength=48&annualMileage=6000');

const build = async (opts: { page?: string; pricing?: string; url?: typeof personalUrl; mutate?: (p: PricingResult) => void } = {}) => {
  const page = await parseOfferPage(fixture(opts.page ?? 'offer-page-personal.html'), Rewriter);
  const pricing = parsePricingResponse(fixtureJson(opts.pricing ?? 'pricing-personal.json'));
  opts.mutate?.(pricing);
  return buildOffer({ url: opts.url ?? personalUrl, page, pricing, now: NOW, createdBy: BY, id: ID, knownBadges: KNOWN_BADGES });
};

describe('buildOffer', () => {
  it('assembles a valid personal offer with derived initial payment, badges, stats and link', async () => {
    const offer = await build();
    expect(Offer.parse(offer)).toEqual(offer);
    expect(offer.vehicle).toMatchObject({ make: 'BYD', model: 'Seal', derivative: '390kW Excellence AWD 83kWh 4dr Auto', bodyStyle: 'Saloon', fuelType: 'Electric', transmission: 'Automatic' });
    expect(offer.pricing).toEqual({ monthly: 347.8, vat: 'inc', initialPayment: 4173.6, initialMonths: 12, termMonths: 48, annualMileage: 6000, processingFee: 299.99, maintenance: false });
    expect(offer.hotBadge).toBe('Special offer');
    expect(offer.badges).toEqual([]);
    expect(offer.stock).toBeUndefined();
    expect(offer.vehicle.stats).toEqual([
      { label: 'Range', value: '323 mi' },
      { label: '0–62', value: '3.8s' },
      { label: 'Battery', value: '82.5 kWh' },
      { label: 'Warranty', value: '8 yrs' },
      { label: 'Power', value: '530 bhp' },
    ]);
    expect(offer.offerUrl).toBe('https://www.dreamlease.co.uk/offers/personal/byd-seal-390kw-excellence-83kwh-awd-102n/?offer=p-12-48-6000-n&initialRental=12&contractLength=48&annualMileage=6000&includeMaintenance=false');
    expect(offer.validUntil).toBe('2026-09-30');
    expect(offer.source).toEqual({ kind: 'url', ref: personalUrl.canonical, fetchedAt: NOW.toISOString() });
    expect(offer.createdBy).toBe(BY);
    expect(offer.image).toBeUndefined();
  });

  it('never carries a CAP ID, the site image URL or platform identifiers', async () => {
    const offer = await build();
    expect(findCapIdLeak(offer)).toBeNull();
    expect(JSON.stringify(offer)).not.toMatch(/000000|images\.example|rateBook|nodeId|564851/);
  });

  it('prices a business offer ex VAT with the business fee', async () => {
    const offer = await build({ url: businessUrl, pricing: 'pricing-business.json' });
    expect(offer.contractType).toBe('business');
    expect(offer.pricing).toMatchObject({ monthly: 289.83, vat: 'ex', initialPayment: 3477.96, processingFee: 249.99 });
    expect(offer.offerUrl).toMatch(/\/offers\/business\/.*offer=b-12-48-6000-n/);
  });

  it('adds maintenance to the monthly and initial payment when it is included', async () => {
    const offer = await build({
      url: businessUrl,
      pricing: 'pricing-business.json',
      mutate: (p) => {
        p.offer!.includesMaintenance = true;
        p.offer!.monthlyService = 32.52;
      },
    });
    expect(offer.pricing.monthly).toBe(322.35);
    expect(offer.pricing.initialPayment).toBe(3868.2);
    expect(offer.pricing.maintenance).toBe(true);
    expect(offer.offerUrl).toMatch(/includeMaintenance=true/);
  });

  it('turns site flags and tags into badges from the fixed list only', async () => {
    const offer = await build({
      page: 'offer-page-suv-petrol.html',
      mutate: (p) => {
        p.offer!.isInStock = true;
        p.offer!.specialOffer = false;
      },
    });
    expect(offer.hotBadge).toBeUndefined();
    expect(offer.badges).toEqual(['In stock', 'Limited numbers']);
    expect(offer.stock).toBe('in_stock');
    expect(offer.vehicle.stats?.slice(0, 2)).toEqual([
      { label: 'MPG', value: '48.8 mpg' },
      { label: 'CO2', value: '131 g/km' },
    ]);
  });

  it('marks limited stock without an in-stock flag', async () => {
    const offer = await build({ page: 'offer-page-suv-petrol.html' });
    expect(offer.stock).toBe('limited');
    expect(offer.badges).toEqual(['Limited numbers']);
  });

  it('refuses price-on-application and unpriced configurations', async () => {
    await expect(build({ mutate: (p) => (p.offer!.poa = true) })).rejects.toThrow(OfferBuildError);
    await expect(build({ pricing: 'pricing-no-offer.json' })).rejects.toThrow(/adjusted/);
  });
});

describe('helpers', () => {
  it('endOfMonth works in UK time', () => {
    expect(endOfMonth(new Date('2026-09-14T09:00:00Z'))).toBe('2026-09-30');
    expect(endOfMonth(new Date('2026-09-30T23:30:00Z'))).toBe('2026-10-31'); // already 1 October in London
    expect(endOfMonth(new Date('2026-02-01T00:00:00Z'))).toBe('2026-02-28');
  });

  it('resolveBadge maps site wording onto the fixed list and rejects anything else', () => {
    expect(resolveBadge('Limited Stock', KNOWN_BADGES)).toBe('Limited numbers');
    expect(resolveBadge('special offer', KNOWN_BADGES)).toBe('Special offer');
    expect(resolveBadge('DreamLease Exclusive', KNOWN_BADGES)).toBe('DreamLease exclusive!');
    expect(resolveBadge('Pre-registered', KNOWN_BADGES)).toBeUndefined();
    expect(resolveBadge('Includes metallic paint', KNOWN_BADGES)).toBeUndefined();
  });

  it('mapStats keeps unknown stats after the known ones and caps at eight', () => {
    const stats = mapStats([
      { value: '5', unit: 'seats', label: 'Seats' },
      { value: '3.8', unit: 'secs', label: '0 to 62 mph' },
      { value: '323', unit: 'mi', label: 'Combined range' },
    ]);
    expect(stats).toEqual([
      { label: 'Range', value: '323 mi' },
      { label: '0–62', value: '3.8s' },
      { label: 'Seats', value: '5 seats' },
    ]);
  });
});
