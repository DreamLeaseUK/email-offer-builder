/**
 * Adapter interfaces — brief §5.2.
 * Rule: no adapter imports another adapter. Each one depends on @offer-mailer/schema only.
 *
 * Stage one implements OfferSource: manual, url.
 * Stage one implements BrochureSource: firecrawl, manual.
 * OfferOutput: m365 (Phase 1, 29 Sept 2026: sent from the salesperson's own mailbox). Copy for Outlook is browser
 * code (the clipboard), not an adapter; the Graph draft was never built (removed 24 Sept 2026).
 * The hosted page is not an output adapter; every render writes it (§5.4).
 * Stubs with typed interfaces (no logic): feed, monday, ai, mautic (build step 8).
 */
import type { Brochure, BrochureSearch, Campaign, Offer, Rendered, Sender, Vehicle } from '@offer-mailer/schema';

export interface OfferSource<Input = unknown> {
  readonly kind: 'manual' | 'url' | 'feed' | 'monday' | 'ai';
  lookup(input: Input): Promise<Offer>;
}

/** What a search produced: a brochure when something verified, and always the record of what was checked. */
export interface BrochureFindOutcome {
  brochure?: Brochure;
  search: BrochureSearch;
}

export interface BrochureSource {
  readonly kind: 'firecrawl' | 'manual';
  find(vehicle: Pick<Vehicle, 'make' | 'model'>): Promise<BrochureFindOutcome>;
}

export interface DeliveryResult {
  kind: OfferOutput['kind'];
  /** A reference the output gives back, if any (Graph sendMail gives none). */
  ref?: string;
  /** Something the UI can open, if any. */
  openUrl?: string;
  /** When the output accepted the email (for m365: Microsoft's 202, not delivery to the customer's inbox). */
  deliveredAt: string;
}

export interface DeliveryInput {
  rendered: Rendered;
  campaign: Campaign;
  sender: Sender;
  /** The one customer this email goes to. Used for the send only, never stored (the campaign carries no recipient). */
  to?: { address: string; name?: string };
}

export interface OfferOutput {
  readonly kind: 'm365' | 'clipboard' | 'mautic' | 'monday';
  deliver(input: DeliveryInput): Promise<DeliveryResult>;
}
