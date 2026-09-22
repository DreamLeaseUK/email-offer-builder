import { describe, expect, it } from 'vitest';
import { carriesEntity, decodeEntities, decodeOfferText } from '../src/index.js';
import type { Offer } from '../src/index.js';
import { offer } from './fixtures.js';

describe('decodeEntities', () => {
  it('decodes numeric entities (hex and decimal) and the named ones a vehicle name can carry', () => {
    expect(decodeEntities('110kW Techno &#x2B; Comfort Range 52kWh 5dr Auto')).toBe('110kW Techno + Comfort Range 52kWh 5dr Auto');
    expect(decodeEntities('Evolution&#43; 52kWh')).toBe('Evolution+ 52kWh');
    expect(decodeEntities('Citro&euml;n &amp; Co &#39;5&#39;')).toBe("Citroën & Co '5'");
  });

  it('leaves an unknown name and an impossible code point as they are', () => {
    expect(decodeEntities('A &bogus; B')).toBe('A &bogus; B');
    expect(decodeEntities('&#xD800;')).toBe('&#xD800;');
  });
});

describe('decodeOfferText', () => {
  const stale: Offer = {
    ...offer,
    vehicle: { ...offer.vehicle, model: '5', derivative: '110kW Techno &#x2B; Comfort Range 52kWh 5dr Auto', stats: [{ label: 'Range', value: '252&nbsp;mi' }] },
    image: { ...offer.image!, alt: 'Renault 5 Techno &#x2B;' },
  };

  it('decodes the vehicle names, the stats and the image alt of an offer saved before a parser fix', () => {
    expect(carriesEntity(stale.vehicle)).toBe(true);
    const clean = decodeOfferText(stale);
    expect(clean.vehicle.derivative).toBe('110kW Techno + Comfort Range 52kWh 5dr Auto');
    expect(clean.vehicle.stats).toEqual([{ label: 'Range', value: '252 mi' }]);
    expect(clean.image?.alt).toBe('Renault 5 Techno +');
    expect(carriesEntity(clean)).toBe(false);
  });

  it('touches nothing else: the offer URL, the pricing and the ids are as they came', () => {
    const clean = decodeOfferText(stale);
    expect(clean.offerUrl).toBe(stale.offerUrl);
    expect(clean.pricing).toEqual(stale.pricing);
    expect(clean.id).toBe(stale.id);
  });

  it('returns a clean offer as it came', () => {
    expect(decodeOfferText(offer)).toBe(offer);
  });
});
