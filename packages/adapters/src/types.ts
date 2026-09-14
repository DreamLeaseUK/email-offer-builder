/**
 * Adapter interfaces — brief §5.2.
 * Rule: no adapter imports another adapter. Each one depends on @offer-mailer/schema only.
 *
 * Stage one implements OfferSource: manual, url.
 * Stage one implements BrochureSource: firecrawl, manual.
 * Stage one implements OfferOutput: graph_draft, clipboard.
 * The hosted page is not an output adapter; every render writes it (§5.4).
 * Stubs with typed interfaces (no logic): feed, monday, ai, mautic (build step 8).
 */
import type { Brochure, Campaign, Offer, Rendered, Sender, Vehicle } from '@offer-mailer/schema';

export interface OfferSource<Input = unknown> {
  readonly kind: 'manual' | 'url' | 'feed' | 'monday' | 'ai';
  lookup(input: Input): Promise<Offer>;
}

export interface BrochureSource {
  readonly kind: 'firecrawl' | 'manual';
  harvest(vehicle: Pick<Vehicle, 'make' | 'model'>): Promise<Brochure>;
}

export interface DeliveryResult {
  kind: OfferOutput['kind'];
  /** e.g. Graph message id, or the hosted URL for hosted_only */
  ref?: string;
  /** Something the UI can open, e.g. the draft's webLink */
  openUrl?: string;
  deliveredAt: string;
}

export interface OfferOutput {
  readonly kind: 'graph_draft' | 'clipboard' | 'mautic' | 'monday';
  deliver(rendered: Rendered, campaign: Campaign, sender: Sender): Promise<DeliveryResult>;
}
