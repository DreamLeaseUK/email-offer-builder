/**
 * Offer model — brief §5.1, §5.8, §5.9.
 * This is the shared contract. Source adapters produce these objects, render() consumes them,
 * the web app edits them. Change the brief before changing this file.
 */
import { z } from 'zod';

// ---------- enums ----------

export const ContractType = z.enum(['personal', 'business', 'salary_sacrifice']);
export type ContractType = z.infer<typeof ContractType>;

export const OfferSourceKind = z.enum(['manual', 'url', 'feed', 'monday', 'ai']);
export const StockStatus = z.enum(['in_stock', 'factory_order', 'limited']);
export const CtaKind = z.enum(['view_offer', 'email', 'call', 'whatsapp', 'book', 'link']);
export type CtaKind = z.infer<typeof CtaKind>;
/** Contact methods a rep can surface as secondary links in their signature (§7.1). */
export const ContactMethod = z.enum(['call', 'whatsapp', 'email', 'book']);
export type ContactMethod = z.infer<typeof ContactMethod>;

export const CampaignUseCase = z.enum(['follow_up', 'offer_pack', 'renewal']);
export const CampaignStatus = z.enum(['draft', 'rendered', 'sent', 'archived']);
export const SentVia = z.enum(['graph_draft', 'clipboard', 'hosted_only']);

export const TemplateLayout = z.enum(['single', 'stack', 'grid2', 'grid3']);
export type TemplateLayout = z.infer<typeof TemplateLayout>;
export const TemplateStatus = z.enum(['draft', 'approved', 'retired']);

/** pdf: our hosted copy. web: the manufacturer's own UK web brochure / price guide page. gated: a request-a-brochure form. */
export const BrochureKind = z.enum(['pdf', 'gated', 'web']);
/** What the document is, kept apart from how it is delivered (kind) so a price guide is never labelled a brochure. */
export const BrochureDocumentType = z.enum(['brochure', 'price_spec_guide']);
export type BrochureDocumentType = z.infer<typeof BrochureDocumentType>;
/** Outcome of an automatic brochure search. Only verified_pdf and verified_web_brochure attach by themselves. */
export const BrochureFinderStatus = z.enum(['verified_pdf', 'verified_web_brochure', 'official_page_only', 'brochure_request', 'not_verified', 'search_failed']);
export type BrochureFinderStatus = z.infer<typeof BrochureFinderStatus>;
export const BrochureSourceKind = z.enum(['harvest', 'manual']);
export const BrochureStatus = z.enum(['current', 'superseded']);
export const UkVerifiedBy = z.enum(['domain', 'content', 'user']);

// ---------- primitives ----------

const isoDateTime = z.iso.datetime({ offset: true });
const isoDate = z.iso.date();
const httpsUrl = z.url({ protocol: /^https$/ });
const uuid = z.uuid();
const email = z.email();
/** E.164, e.g. +447700900123 */
const e164 = z.string().regex(/^\+[1-9]\d{6,14}$/, 'E.164 phone number required');

// ---------- CTA (§5.9) ----------

export const Cta = z
  .object({
    kind: CtaKind,
    /** Overrides the kind's default label. Rep-authored copy: recorded in the promotions register. */
    label: z.string().trim().min(1).max(30).optional(),
    /** 'link' only. */
    url: httpsUrl.optional(),
  })
  .refine((c) => c.kind !== 'link' || !!c.url, { message: "cta.url is required when kind is 'link'", path: ['url'] });
export type Cta = z.infer<typeof Cta>;

export const CTA_DEFAULT_LABELS: Record<Exclude<CtaKind, 'link'>, string> = {
  view_offer: 'View this offer',
  email: 'Email me about this',
  call: 'Call me on {phone}',
  whatsapp: 'WhatsApp me',
  book: 'Book a time to talk',
};

/** Fixed labels for the signature's secondary contact links (not rep-renamable; the primary button is). */
export const SECONDARY_CONTACT_LABELS: Record<ContactMethod, string> = {
  call: 'Call',
  whatsapp: 'WhatsApp',
  email: 'Email',
  book: 'Book a call',
};

// ---------- Offer (§5.1) ----------

export const VehicleStat = z.object({ label: z.string().min(1), value: z.string().min(1) });

export const Vehicle = z.object({
  make: z.string().min(1),
  model: z.string().min(1),
  derivative: z.string().min(1),
  bodyStyle: z.string().optional(),
  fuelType: z.string().optional(),
  transmission: z.string().optional(),
  /** Up to four are rendered. */
  stats: z.array(VehicleStat).max(8).optional(),
});
export type Vehicle = z.infer<typeof Vehicle>;

/** Our R2 copy only. Never a source URL. */
export const OfferImage = z.object({
  key: z.string().regex(/^vehicles\/[a-f0-9]{64}\.jpg$/, 'image key must be vehicles/<sha256>.jpg'),
  url: httpsUrl,
  alt: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export type OfferImage = z.infer<typeof OfferImage>;

export const SalsacPricing = z.object({
  net20: z.number().nonnegative(),
  net40: z.number().nonnegative(),
  gross: z.number().nonnegative().optional(),
  employerName: z.string().optional(),
});

export const Pricing = z.object({
  /** £ per month */
  monthly: z.number().nonnegative(),
  /** personal = inc, business = ex */
  vat: z.enum(['inc', 'ex']),
  /** £ */
  initialPayment: z.number().nonnegative(),
  initialMonths: z.union([z.literal(1), z.literal(3), z.literal(6), z.literal(9), z.literal(12)]),
  termMonths: z.number().int().min(12).max(60),
  annualMileage: z.number().int().positive(),
  /** £ inc VAT, from the site, shown in small print */
  processingFee: z.number().nonnegative().optional(),
  maintenance: z.boolean(),
  /** Salary sacrifice only; entered by hand in stage one. */
  salsac: SalsacPricing.optional(),
});

export const OfferSource = z.object({
  kind: OfferSourceKind,
  ref: z.string().optional(),
  fetchedAt: isoDateTime.optional(),
});

export const Offer = z.object({
  id: uuid,
  source: OfferSource,
  vehicle: Vehicle,
  image: OfferImage.optional(),
  contractType: ContractType,
  pricing: Pricing,
  /** From the fixed badge list (config/badges.json), never free text. */
  badges: z.array(z.string().min(1).max(30)).max(3),
  /** One only, from the same list, always shown first. */
  hotBadge: z.string().min(1).max(30).optional(),
  stock: StockStatus.optional(),
  deliveryNote: z.string().max(60).optional(),
  /** dreamlease.co.uk page for the offer; UTMs are added at render. */
  offerUrl: z.url({ protocol: /^https$/, hostname: /^www\.dreamlease\.co\.uk$/ }),
  /** Defaults to { kind: 'view_offer' } at render. */
  cta: Cta.optional(),
  /** Required. The library greys out expired offers; the hosted page expires with it. */
  validUntil: isoDate,
  /** §5.8. include = the rep's toggle. */
  brochure: z.object({ brochureId: uuid, include: z.boolean() }).optional(),
  /** Internal, never rendered. */
  notes: z.string().optional(),
  createdBy: email,
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type Offer = z.infer<typeof Offer>;

/** normalised "make/model" key shared by every offer for that model. */
export function vehicleKey(v: Pick<Vehicle, 'make' | 'model'>): string {
  const norm = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${norm(v.make)}/${norm(v.model)}`;
}

// ---------- Brochure (§5.8) ----------

export const Brochure = z
  .object({
    id: uuid,
    vehicleKey: z.string().regex(/^[a-z0-9-]+\/[a-z0-9-]+$/),
    title: z.string().min(1),
    kind: BrochureKind,
    /** Our R2 copy, immutable; pdf only. */
    file: z
      .object({
        key: z.string().regex(/^brochures\/[a-f0-9]{64}\.pdf$/),
        url: httpsUrl,
        sizeBytes: z.number().int().positive(),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .optional(),
    /** Manufacturer UK PDF or page it came from; for gated, the page we link to. */
    sourceUrl: httpsUrl,
    source: BrochureSourceKind,
    ukVerified: z.object({ by: UkVerifiedBy, note: z.string().optional() }),
    /** Absent on records made before the finder: treated as a brochure. */
    documentType: BrochureDocumentType.optional(),
    /** The edition date the finder read from the document (YYYY-MM-DD); re-checked against the age limit on every attach. */
    editionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    /** Set when the finder chose this record: which version, what it concluded, and any flags (e.g. lead_capture_present). */
    finder: z.object({ version: z.string().min(1), status: BrochureFinderStatus, flags: z.array(z.string()).optional() }).optional(),
    fetchedAt: isoDateTime,
    /** fetchedAt + 90 days */
    expiresAt: isoDateTime,
    status: BrochureStatus,
    createdBy: email,
  })
  .refine((b) => b.kind !== 'pdf' || !!b.file, { message: "file is required when kind is 'pdf'", path: ['file'] });
export type Brochure = z.infer<typeof Brochure>;

export const BROCHURE_TTL_DAYS = 90;
/** A search that found nothing is re-run sooner than a found brochure is refreshed. */
export const BROCHURE_NEGATIVE_TTL_DAYS = 7;
/** Oldest acceptable edition, in months: price/spec guides carry prices and go stale faster than brochures. */
export const BROCHURE_MAX_AGE_MONTHS: Record<BrochureDocumentType, number> = { brochure: 12, price_spec_guide: 6 };

// ---------- Brochure search trace ----------

/** One document or page the finder considered, with why it was kept or dropped. Shown to the rep as "what we checked". */
export const BrochureCandidateTrace = z.object({
  url: z.string(),
  via: z.enum(['search', 'site-search', 'official-page', 'model-page']),
  linkText: z.string().optional(),
  fromPage: z.string().optional(),
  docType: z.string(),
  score: z.number(),
  status: z.enum(['accepted', 'rejected', 'fetch_failed', 'is_web_page', 'not_checked']),
  reasons: z.array(z.string()),
  evidence: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});
export type BrochureCandidateTrace = z.infer<typeof BrochureCandidateTrace>;

export const BrochureSearch = z.object({
  vehicleKey: z.string().regex(/^[a-z0-9-]+\/[a-z0-9-]+$/),
  vehicle: z.string().min(1),
  status: BrochureFinderStatus,
  documentType: BrochureDocumentType.or(z.literal('brochure_request_form')).optional(),
  /** The page or document the outcome points at (absent for not_verified / search_failed). */
  url: z.string().optional(),
  assetUrl: z.string().optional(),
  assetRetrievable: z.boolean().optional(),
  reason: z.string().optional(),
  flags: z.array(z.string()),
  officialSite: z.string().optional(),
  queries: z.array(z.string()),
  pagesOpened: z.array(z.string()),
  candidates: z.array(BrochureCandidateTrace),
  credits: z.number(),
  durationMs: z.number(),
  finderVersion: z.string().min(1),
  searchedAt: isoDateTime,
  searchedBy: email,
});
export type BrochureSearch = z.infer<typeof BrochureSearch>;

// ---------- Recipient, Sender ----------

export const RecipientContext = z.object({
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  email: email.optional(),
  company: z.string().optional(),
  currentVehicle: z.string().optional(),
  leaseEndDate: isoDate.optional(),
  requirements: z
    .object({
      budgetMonthly: z.number().nonnegative().optional(),
      fuel: z.array(z.string()).optional(),
      bodyStyle: z.array(z.string()).optional(),
      seats: z.number().int().positive().optional(),
      mileage: z.number().int().positive().optional(),
      notes: z.string().optional(),
    })
    .optional(),
  external: z.array(z.object({ system: z.literal('monday'), boardId: z.string(), itemId: z.string() })).optional(),
});
export type RecipientContext = z.infer<typeof RecipientContext>;

export const Sender = z.object({
  kind: z.enum(['user', 'shared']),
  displayName: z.string().min(1),
  email,
  phone: z.string().min(6).optional(),
  jobTitle: z.string().optional(),
  /** Enables the WhatsApp CTA. */
  whatsapp: e164.optional(),
  /** Microsoft Bookings page. Enables the "Book a call" CTA. */
  bookingUrl: httpsUrl.optional(),
  /** Which contact methods to show as a secondary row of links in the signature. The rep chooses one
   *  primary green button per offer and, separately, any of these to surface here. Render skips a
   *  method whose underlying field is absent. */
  secondaryContacts: z.array(ContactMethod).optional(),
  /** Square headshot, 112px or larger, on our origin. Absent for department senders (brief §7.1). */
  headshotUrl: httpsUrl.optional(),
  /** Graph mailbox to draft into (user's own, or sales@/renewals@). */
  mailbox: email,
});
export type Sender = z.infer<typeof Sender>;

/** Which CTA kinds this sender can support. */
export function availableCtaKinds(s: Sender): CtaKind[] {
  const kinds: CtaKind[] = ['view_offer', 'email', 'link'];
  if (s.phone) kinds.push('call');
  if (s.whatsapp) kinds.push('whatsapp');
  if (s.bookingUrl) kinds.push('book');
  return kinds;
}

/** The secondary-contact methods this sender can actually offer (the field each needs is present).
 *  Email is always available (a sender always has an email); the rest gate on their field. */
export function availableSecondaryContacts(s: Pick<Sender, 'phone' | 'whatsapp' | 'bookingUrl'>): ContactMethod[] {
  const out: ContactMethod[] = ['email'];
  if (s.phone) out.push('call');
  if (s.whatsapp) out.push('whatsapp');
  if (s.bookingUrl) out.push('book');
  return out;
}

// ---------- Campaign ----------

export const Campaign = z.object({
  id: uuid,
  /** Internal label */
  name: z.string().min(1).max(120),
  useCase: CampaignUseCase,
  templateId: uuid,
  templateVersion: z.number().int().positive(),
  /** Rep-authored: recorded in the register. */
  subject: z.string().min(1).max(150),
  preheader: z.string().max(150).optional(),
  /** Rep's personal message, plain text with line breaks. Recorded in the register. */
  intro: z.string().min(1).max(4000),
  /** 'auto' picks single for 1 offer, stack for 3, grid2 otherwise (resolveLayout in packages/render). */
  layout: z.enum(['auto', 'single', 'stack', 'grid2', 'grid3']),
  /** Snapshot copies, not references: what was sent must not change when the library does. */
  offers: z.array(Offer).min(1).max(6),
  recipient: RecipientContext.optional(),
  sender: Sender,
  compliance: z.object({ variant: ContractType, approvedWordingVersion: z.number().int().positive() }),
  /** Slug is generated at campaign creation so render() can embed the URL and stay pure. */
  hostedPage: z.object({ slug: z.string().regex(/^[A-Za-z0-9_-]{16,}$/), url: httpsUrl, enabled: z.boolean() }),
  tracking: z.object({ campaignCode: z.string().min(1), utm: z.record(z.string(), z.string()) }),
  status: CampaignStatus,
  sentAt: isoDateTime.optional(),
  sentVia: SentVia.optional(),
  createdBy: email,
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type Campaign = z.infer<typeof Campaign>;

// ---------- Template ----------

/** Locked, versioned, Emma-approved. Title line plus paragraphs, rendered in the footer panel. */
export const ComplianceBlock = z.object({
  title: z.string().min(1).max(60),
  paragraphs: z.array(z.string().min(1)).min(1),
});
export type ComplianceBlock = z.infer<typeof ComplianceBlock>;

export const Template = z.object({
  id: uuid,
  name: z.string().min(1),
  version: z.number().int().positive(),
  /**
   * Markup generation of packages/render this template was approved against. The markup itself is
   * code (the v4 design translated to template functions); this pins which generation Emma saw.
   */
  markupVersion: z.number().int().positive(),
  /** One block per contract type. Reps cannot edit these. */
  complianceBlocks: z.record(ContractType, ComplianceBlock),
  footer: z.object({
    /** "Don't want offers from DreamLease? Reply to this email and tell us, and we'll stop." */
    optOutLine: z.string().min(1),
    /** Registered company line. */
    companyLine: z.string().min(1),
  }),
  approvedBy: email.optional(),
  approvedAt: isoDateTime.optional(),
  status: TemplateStatus,
});
export type Template = z.infer<typeof Template>;

// ---------- Rendered output (§5.2) ----------

export const Rendered = z.object({
  html: z.string(),
  text: z.string(),
  subject: z.string(),
  hostedHtml: z.string(),
  /** Layout actually used after resolving 'auto'. */
  layout: TemplateLayout,
  /** linkId -> destination. The /r/<slug>/<linkId> redirect resolves against this. */
  links: z.record(z.string(), z.string()),
});
export type Rendered = z.infer<typeof Rendered>;
