/**
 * Turns the campaign's Offers into the flat strings the card markup needs. All formatting decisions
 * live here; the card functions only place strings.
 */
import { CTA_DEFAULT_LABELS, availableCtaKinds } from '@offer-mailer/schema';
import type { Brochure, Campaign, Offer, Sender } from '@offer-mailer/schema';
import { gbp, gbpPence, kMiles, longDate, number, shortDate } from './format.js';
import { Links, withUtm } from './links.js';

export class RenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RenderError';
  }
}

export interface Stat {
  label: string;
  value: string;
}

export interface CardVM {
  id: string;
  alt: string;
  make: string;
  model: string;
  derivative: string;
  hot?: string;
  /** excluding hot */
  badges: string[];
  isSalsac: boolean;
  price: string;
  vatLabel: string;
  net20?: string;
  net40?: string;
  grossLine?: string;
  specLine: string;
  specShort: string;
  stats: Stat[];
  imageUrl: string;
  cta: { href: string; label: string };
  /** Present when the CTA is not view_offer: the offer page must stay one click away. */
  viewHref?: string;
  /** label for hero/stack/grid2, shortLabel for grid3; iconUrl is the 14px glyph on our origin. */
  brochure?: { href: string; label: string; shortLabel: string; alt: string; kind: 'pdf' | 'gated'; iconUrl: string };
  smallPrint: string;
  validityLine: string;
  validUntil: string;
}

export interface VmOptions {
  publicBaseUrl: string;
  brochures: Record<string, Brochure>;
  links: Links;
}

/** DreamLease's standard PCH processing fee (£, inc VAT). Must match the compliance block wording. */
const PCH_PROCESSING_FEE = 299.99;

function ctaFor(offer: Offer, sender: Sender, index: number, links: Links, offerUrlWithUtm: string): CardVM['cta'] {
  const cta = offer.cta ?? { kind: 'view_offer' as const };
  if (!availableCtaKinds(sender).includes(cta.kind)) {
    throw new RenderError(`offer ${index + 1}: CTA kind '${cta.kind}' is not available for sender ${sender.email}`);
  }
  const vehicle = `${offer.vehicle.make} ${offer.vehicle.model}`;
  const subject = encodeURIComponent(`${vehicle} offer`);
  const id = `o${index + 1}-cta`;
  const label = (fallback: string) => cta.label ?? fallback;
  switch (cta.kind) {
    case 'view_offer':
      return { href: links.track(id, offerUrlWithUtm), label: label(CTA_DEFAULT_LABELS.view_offer) };
    case 'email':
      return { href: links.track(id, `mailto:${sender.email}?subject=${subject}`), label: label(CTA_DEFAULT_LABELS.email) };
    case 'call':
      return {
        href: links.track(id, `tel:${(sender.phone ?? '').replace(/\s+/g, '')}`),
        label: label(CTA_DEFAULT_LABELS.call.replace('{phone}', sender.phone ?? '')),
      };
    case 'whatsapp':
      return {
        href: links.track(id, `https://wa.me/${(sender.whatsapp ?? '').replace(/^\+/, '')}?text=${encodeURIComponent(`Hi, I'm interested in the ${vehicle} offer`)}`),
        label: label(CTA_DEFAULT_LABELS.whatsapp),
      };
    case 'book':
      return { href: links.track(id, sender.bookingUrl ?? ''), label: label(CTA_DEFAULT_LABELS.book) };
    case 'link':
      if (!cta.url) throw new RenderError(`offer ${index + 1}: link CTA has no url`);
      if (!cta.label) throw new RenderError(`offer ${index + 1}: link CTA has no label`);
      return { href: links.track(id, cta.url), label: cta.label };
  }
}

export function buildCards(campaign: Campaign, opts: VmOptions): CardVM[] {
  const { links, publicBaseUrl, brochures } = opts;
  return campaign.offers.map((offer, i): CardVM => {
    const n = i + 1;
    const isSalsac = offer.contractType === 'salary_sacrifice';
    if (isSalsac && !offer.pricing.salsac) throw new RenderError(`offer ${n}: salary sacrifice offer has no salsac figures`);

    const utm = {
      utm_source: 'offer_mailer',
      utm_medium: 'email',
      utm_campaign: campaign.tracking.campaignCode,
      utm_content: offer.id,
      ...campaign.tracking.utm,
    };
    const offerUrl = withUtm(offer.offerUrl, utm);
    const cta = ctaFor(offer, campaign.sender, i, links, offerUrl);
    const viewHref = (offer.cta?.kind ?? 'view_offer') === 'view_offer' ? undefined : links.track(`o${n}-view`, offerUrl);

    const p = offer.pricing;
    const term = `${p.termMonths} months`;
    const spec = [term, `${number(p.annualMileage)} miles p.a.`];
    const specShort = [`${p.termMonths} mo`, `${kMiles(p.annualMileage)} miles`];
    if (isSalsac) {
      // Salary sacrifice: no initial payment. The net figure is all-in — it already includes the
      // finance payment, maintenance and insurance (Matt, 15 Sept) — so the card states the cover.
      spec.push('Maintenance & insurance included');
      specShort.push('Maint. & insurance incl.');
    } else {
      spec.push(`${gbp(p.initialPayment)} initial payment`);
      specShort.push(`${gbp(p.initialPayment)} initial`);
    }

    let brochure: CardVM['brochure'];
    if (offer.brochure?.include) {
      const b = brochures[offer.brochure.brochureId];
      if (!b) throw new RenderError(`offer ${n}: brochure ${offer.brochure.brochureId} not supplied to render()`);
      const href = links.track(`o${n}-brochure`, `${publicBaseUrl}/b/${b.id}`);
      brochure =
        b.kind === 'pdf'
          ? { href, label: 'Download brochure (PDF)', shortLabel: 'Brochure (PDF)', alt: 'PDF document', kind: 'pdf', iconUrl: `${publicBaseUrl}/a/icon-doc-2x.png` }
          : { href, label: 'Request a brochure', shortLabel: 'Request brochure', alt: 'Opens manufacturer site', kind: 'gated', iconUrl: `${publicBaseUrl}/a/icon-external-2x.png` };
    }

    const smallPrintParts = [];
    // PCH (personal) orders always carry the standard processing fee — the compliance block states it is
    // "payable on all orders" — so show it on every personal card even when the site returned none. BCH /
    // salary sacrifice keep whatever their pricing carried (first stage; those audiences revisited later).
    const processingFee = offer.contractType === 'personal' ? PCH_PROCESSING_FEE : p.processingFee;
    if (processingFee !== undefined) smallPrintParts.push(`Processing fee ${gbpPence(processingFee)} inc VAT`);
    smallPrintParts.push(`Offer valid until ${longDate(offer.validUntil)}`);
    if (brochure) smallPrintParts.push("Brochure figures are the manufacturer's and may differ from this offer.");

    const vm: CardVM = {
      id: offer.id,
      alt: `${offer.vehicle.make} ${offer.vehicle.model}`,
      make: offer.vehicle.make,
      model: offer.vehicle.model,
      derivative: offer.vehicle.derivative,
      badges: offer.badges.filter((b) => b !== offer.hotBadge).slice(0, 2),
      isSalsac,
      price: gbp(p.monthly),
      vatLabel: p.vat === 'ex' ? 'per month ex VAT' : 'per month inc VAT',
      specLine: spec.join(' · '),
      specShort: specShort.join(' · '),
      stats: (offer.vehicle.stats ?? []).slice(0, 4),
      imageUrl: offer.image?.url ?? `${publicBaseUrl}/a/vehicle-placeholder.png`,
      cta,
      smallPrint: smallPrintParts.join(' · '),
      validityLine: `Valid until ${shortDate(offer.validUntil)}`,
      validUntil: offer.validUntil,
    };
    if (offer.hotBadge) vm.hot = offer.hotBadge;
    if (viewHref) vm.viewHref = viewHref;
    if (brochure) vm.brochure = brochure;
    if (isSalsac && p.salsac) {
      vm.net20 = gbp(p.salsac.net20);
      vm.net40 = gbp(p.salsac.net40);
      vm.grossLine = p.salsac.gross !== undefined ? `${gbp(p.salsac.gross)} per month gross salary sacrifice.` : '';
    }
    return vm;
  });
}
