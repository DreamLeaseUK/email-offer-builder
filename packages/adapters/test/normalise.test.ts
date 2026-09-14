import { describe, expect, it } from 'vitest';
import { OfferUrlError, canonicalOfferUrl, parseOfferUrl } from '../src/index.js';

describe('parseOfferUrl', () => {
  it('keeps the contract type, slug and configuration and drops everything else', () => {
    const u = parseOfferUrl('https://www.dreamlease.co.uk/offers/personal/byd-seal-390kw-excellence-83kwh-awd-102n/?offer=p-12-48-6000-n&initialRental=12&contractLength=48&annualMileage=6000&includeMaintenance=false&utm_source=x#top');
    expect(u.contractType).toBe('personal');
    expect(u.slug).toBe('byd-seal-390kw-excellence-83kwh-awd-102n');
    expect(u.config).toEqual({ initialRental: 12, contractLength: 48, annualMileage: 6000, includeMaintenance: false });
    expect(u.canonical).toBe('https://www.dreamlease.co.uk/offers/personal/byd-seal-390kw-excellence-83kwh-awd-102n/?initialRental=12&contractLength=48&annualMileage=6000&includeMaintenance=false');
  });

  it('reads the configuration from the offer code when the explicit parameters are missing', () => {
    const u = parseOfferUrl('https://www.dreamlease.co.uk/offers/business/geely-ex5-160kw-pro-60kwh-5dr-auto-103dlty/?offer=b-9-36-8000-n');
    expect(u.contractType).toBe('business');
    expect(u.config).toEqual({ initialRental: 9, contractLength: 36, annualMileage: 8000 });
  });

  it('accepts a bare page, the apex host and mixed case', () => {
    const u = parseOfferUrl('HTTPS://dreamlease.co.uk/offers/Personal/Kia-EV3-Thing');
    expect(u.canonical).toBe('https://www.dreamlease.co.uk/offers/personal/kia-ev3-thing/');
    expect(u.config).toEqual({});
  });

  it('rejects other hosts, other pages and non-URLs', () => {
    expect(() => parseOfferUrl('https://www.leasing.com/offers/personal/x/')).toThrow(OfferUrlError);
    expect(() => parseOfferUrl('https://www.dreamlease.co.uk/hubs/special-offers/')).toThrow(OfferUrlError);
    expect(() => parseOfferUrl('not a url')).toThrow(OfferUrlError);
  });

  it('builds a canonical URL with the offer code first', () => {
    expect(canonicalOfferUrl('personal', 'byd-seal', { initialRental: 12, contractLength: 48, annualMileage: 6000, includeMaintenance: false }, 'p-12-48-6000-n')).toBe(
      'https://www.dreamlease.co.uk/offers/personal/byd-seal/?offer=p-12-48-6000-n&initialRental=12&contractLength=48&annualMileage=6000&includeMaintenance=false',
    );
  });
});
