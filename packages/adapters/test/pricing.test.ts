import { describe, expect, it } from 'vitest';
import { PricingError, parsePricingResponse, pricingUrl } from '../src/index.js';
import { fixtureJson } from './helpers.js';

const slugs = { manufacturer: 'byd', model: 'seal', bodyStyle: 'saloon', derivative: '390kw-excellence-awd-83kwh-4dr-auto' };

describe('pricingUrl', () => {
  it('builds the site endpoint with the configuration and finance type', () => {
    const u = new URL(pricingUrl(slugs, 'business', { initialRental: 12, contractLength: 48, annualMileage: 6000, includeMaintenance: true }));
    expect(u.pathname).toBe('/api/carresults/GetOfferDropdownsForCar');
    expect(u.searchParams.get('derivativeSlug')).toBe('390kw-excellence-awd-83kwh-4dr-auto');
    expect(u.searchParams.get('financeType')).toBe('Business Contract Hire');
    expect(u.searchParams.get('isBusiness')).toBe('true');
    expect(u.searchParams.get('includeMaintenance')).toBe('true');
    expect(u.searchParams.get('contractLength')).toBe('48');
  });

  it('uses the van endpoint for vans and empty strings for missing configuration', () => {
    const u = new URL(pricingUrl(slugs, 'personal', {}, true));
    expect(u.pathname).toBe('/api/vanresults/GetOfferDropdownsForCar');
    expect(u.searchParams.get('initialRental')).toBe('');
    expect(u.searchParams.get('includeMaintenance')).toBe('false');
  });
});

describe('parsePricingResponse', () => {
  it('maps a personal offer and its option lists', () => {
    const r = parsePricingResponse(fixtureJson('pricing-personal.json'));
    expect(r.offer).toMatchObject({ monthly: 347.8, monthlyService: 0, initialRental: 12, contractLength: 48, annualMileage: 6000, includesMaintenance: false, specialOffer: true, isInStock: false, preRegistered: false, processingFee: 299.99, offerCode: 'p-12-48-6000-n', poa: false, pricingUnavailable: false, financeType: 'Personal Contract Hire' });
    expect(r.options.initialRental.map((o) => o.value)).toEqual([1, 3, 6, 9, 12]);
    expect(r.options.contractLength.map((o) => o.value)).toEqual([12, 18, 24, 36, 48, 60]);
    expect(r.options.annualMileage.map((o) => o.value)).toEqual([5000, 6000, 8000, 10000, 12000, 15000, 20000]);
    expect(r.options.annualMileage[2]?.title).toBe('8,000 miles');
    expect(r.options.maintenanceAvailable).toBe(true);
    expect(r.message).toBe('');
  });

  it('maps a business offer with its ex-VAT price and fee', () => {
    const r = parsePricingResponse(fixtureJson('pricing-business.json'));
    expect(r.offer?.monthly).toBe(289.83);
    expect(r.offer?.processingFee).toBe(249.99);
    expect(r.offer?.financeType).toBe('Business Contract Hire');
    expect(r.offer?.offerCode).toBe('b-12-48-6000-n');
  });

  it('keeps nothing but the mapped fields (no rate book identifiers, node ids or raw objects)', () => {
    const json = JSON.stringify(parsePricingResponse(fixtureJson('pricing-personal.json')));
    expect(json).not.toMatch(/rateBook|nodeId|000000|outrightPurchase|dealer|funder/);
  });

  it('returns no offer with the site message when the configuration cannot be priced', () => {
    const r = parsePricingResponse(fixtureJson('pricing-no-offer.json'));
    expect(r.offer).toBeUndefined();
    expect(r.message).toMatch(/adjusted/);
    expect(r.options.contractLength).toEqual([]);
  });

  it('rejects an unexpected shape', () => {
    expect(() => parsePricingResponse({ offer: { monthlyFinancePrice: 'lots' } })).toThrow(PricingError);
  });
});
