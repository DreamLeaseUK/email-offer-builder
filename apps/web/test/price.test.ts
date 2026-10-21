import { describe, expect, it } from 'vitest';
import type { Offer } from '@offer-mailer/schema';
import { priceCaption } from '../src/price';

const offer = (vat: 'inc' | 'ex'): Offer => ({ pricing: { vat } }) as unknown as Offer;

describe('the price caption on the tool’s offer cards (Matt, 21 Oct 2026)', () => {
  it('says ex VAT for a BCH price and inc VAT for a PCH one, in the email’s words', () => {
    expect(priceCaption(offer('ex'))).toBe('per month ex VAT');
    expect(priceCaption(offer('inc'))).toBe('per month inc VAT');
  });
});
