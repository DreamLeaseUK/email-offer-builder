import type { Offer } from '@offer-mailer/schema';

/**
 * The caption under a price on the tool's offer cards (Compose and the Library): the words the email prints for the
 * same offer (`vatLabel` in packages/render/src/viewmodel.ts), so a BCH price reads "ex VAT" in the tool as it does
 * in the email (Matt, 21 Oct 2026: the cards fell back to the design system's "per month inc. VAT" for every offer).
 */
export const priceCaption = (o: Offer): string => (o.pricing.vat === 'ex' ? 'per month ex VAT' : 'per month inc VAT');
