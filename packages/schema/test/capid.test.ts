import { describe, expect, it } from 'vitest';
import { CapIdLeakError, assertNoCapId, findCapIdLeak } from '../src/index.js';
import { campaign, offer } from './fixtures.js';

describe('CAP ID guard', () => {
  it('passes clean fixtures', () => {
    expect(findCapIdLeak(offer)).toBeNull();
    expect(findCapIdLeak(campaign)).toBeNull();
    expect(() => assertNoCapId(campaign, 'campaign')).not.toThrow();
  });

  it('catches a source image URL anywhere in the object', () => {
    const leaked = {
      ...offer,
      notes: 'https://images.motorleaseplatform.com/cvd/?isVan=False&capId=12345&viewPoint=1&format=webp',
    };
    expect(findCapIdLeak(leaked)).toMatch(/images\.motorleaseplatform\.com|capId/i);
    expect(() => assertNoCapId(leaked, 'offer')).toThrow(CapIdLeakError);
  });

  it('catches a bare capId field regardless of case', () => {
    expect(findCapIdLeak({ CAPID: 98765 })).not.toBeNull();
    expect(findCapIdLeak({ nested: { capid: '1' } })).not.toBeNull();
  });

  it('checks raw strings too', () => {
    expect(findCapIdLeak('vehicles/abc.jpg')).toBeNull();
    expect(findCapIdLeak('log line capId=1')).not.toBeNull();
  });
});
