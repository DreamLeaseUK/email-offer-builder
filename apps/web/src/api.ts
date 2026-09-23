/**
 * Thin client for the Worker API (apps/api). Everything is same-origin: Vite proxies /api, /c, /r,
 * /f, /b and /a to the Worker in dev, and in production the Worker serves the built app too.
 */
import type { Brochure, BrochureSearch, Campaign, ComplianceBlock, ContractType, LibraryEntry, Offer, Sender, Template } from '@offer-mailer/schema';

/** A shared library shelf (config/library-shelves.json). 'smart' shelves filter live, e.g. price under a cap. */
export interface LibraryShelf {
  name: string;
  kind: 'manual' | 'smart';
  rule?: { maxMonthly?: number };
}

/** The admin-authored parts of a template; identity/version/markupVersion/status are server-owned. */
export interface TemplateInput {
  name: string;
  complianceBlocks: Partial<Record<ContractType, ComplianceBlock>>;
  footer: { optOutLine: string; companyLine: string };
}

export interface LeaseOption {
  title: string;
  value: number;
}
export interface PricingOptions {
  initialRental: LeaseOption[];
  contractLength: LeaseOption[];
  annualMileage: LeaseOption[];
  maintenanceAvailable: boolean;
  hasBusiness: boolean;
  hasPersonal: boolean;
}
export interface LookupResponse {
  offer: Offer;
  options: PricingOptions;
  message: string;
  cached: boolean;
  fetchedAt: string;
  warnings: string[];
}

export type LayoutChoice = 'auto' | 'single' | 'stack';
export type UseCase = 'follow_up' | 'offer_pack' | 'renewal';
/** The audience / lease product. Drives the compliance block, terms and (for salsac) the pricing shape. */
export type Audience = 'personal' | 'business' | 'salary_sacrifice';
export type CtaKindChoice = 'view_offer' | 'email' | 'call' | 'whatsapp' | 'book' | 'link';

/** A campaign's reusable parts, to pre-fill Compose when copying a past campaign (the recipient is never copied). */
export interface ComposeSeed {
  name: string;
  audience: Audience;
  useCase: UseCase;
  subject: string;
  preheader: string;
  intro: string;
  layout: LayoutChoice;
  ctaKind: CtaKindChoice;
  ctaLabel: string;
  sender: { name: string; title: string; phone: string; whatsapp: string; booking: string; secondary: ContactMethod[] };
  /** The campaign's offers; Compose loads them into the tray and re-prices each one live from its source URL. */
  offers: Offer[];
}
/** A contact method the salesperson can surface as a secondary link in their signature. */
export type ContactMethod = 'call' | 'whatsapp' | 'email' | 'book';
/** The signed-in user's role. Master admins get the template admin; everyone else is a salesperson. */
export type Role = 'salesperson' | 'admin';

/** The salesperson's saved, editable sender contact details (the photo persists separately). */
export interface SavedSender {
  displayName: string;
  jobTitle: string;
  phone: string;
  whatsapp: string;
  bookingUrl: string;
  /** Which methods to show as a secondary link row in the signature (a subset of the above + email). */
  secondaryContacts: ContactMethod[];
}

/** An offer in the compose tray; options (the chips) are present for freshly-looked-up offers only. */
export interface Item {
  offer: Offer;
  options?: PricingOptions;
  /** The attached brochure record, kept for display; the offer itself only stores its id + include flag. */
  brochure?: Brochure;
}

export interface EnsureBrochureResponse {
  /** Absent when nothing attached (state 'none'): `search` then says what was checked and why. */
  brochure?: Brochure;
  /** stored: unexpired copy; fresh: found now; stale: expired copy kept after a search found nothing; none: nothing attached. */
  state: 'stored' | 'fresh' | 'stale' | 'none';
  search?: BrochureSearch;
  /** `search` is a remembered result (re-run after 7 days), not one run just now. */
  remembered?: boolean;
  error?: string;
  warning?: string;
}

export interface Draft {
  name: string;
  useCase: UseCase;
  subject: string;
  preheader?: string;
  intro: string;
  layout: LayoutChoice;
  offers: Offer[];
  sender: Sender;
  recipient?: { firstName?: string; email?: string };
}

export interface PreviewResponse {
  html: string;
  hostedHtml: string;
  layout: string;
}
export interface CreateResponse {
  campaign: { id: string; hostedPage: { slug: string; url: string } };
  hostedUrl: string;
  layout: string;
  html: string;
  text: string;
}

export interface RegisterColumn {
  key: string;
  label: string;
}
export interface RegisterData {
  columns: RegisterColumn[];
  rows: Record<string, string>[];
}

export interface CampaignStats {
  clicks: number;
  views: number;
  byLink: { linkId: string; count: number }[];
  scannerHits: number;
  firstActivity: string | null;
  lastActivity: string | null;
  lastClick: string | null;
  lastView: string | null;
}

async function jsonOrThrow<T>(r: Response): Promise<T> {
  const body = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(body.error ?? `Request failed (${r.status})`);
  return body;
}

const jsonPost = (url: string, data: unknown) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });

export const api = {
  me: () => fetch('/api/me').then((r) => jsonOrThrow<{ email: string; sub: string; role: Role; publicBaseUrl: string; headshotUrl: string | null; savedSender: SavedSender | null }>(r)),
  /** Save the salesperson's contact details so they prefill next time. */
  saveSender: (details: SavedSender) => jsonPost('/api/me/sender', details).then((r) => jsonOrThrow<{ ok: boolean; savedSender: SavedSender }>(r)),
  /** Upload the salesperson's portrait; returns the stored (square) headshot URL. */
  uploadPhoto: (file: File) => {
    const fd = new FormData();
    fd.set('photo', file);
    return fetch('/api/me/photo', { method: 'POST', body: fd }).then((r) => jsonOrThrow<{ headshotUrl: string }>(r));
  },
  deletePhoto: () => fetch('/api/me/photo', { method: 'DELETE' }).then((r) => jsonOrThrow<{ ok: boolean }>(r)),
  lookup: (url: string) => jsonPost('/api/offers/lookup', { url }).then((r) => jsonOrThrow<LookupResponse>(r)),
  preview: (draft: Draft) => jsonPost('/api/campaigns/preview', draft).then((r) => jsonOrThrow<PreviewResponse>(r)),
  create: (draft: Draft) => jsonPost('/api/campaigns', draft).then((r) => jsonOrThrow<CreateResponse>(r)),
  listCampaigns: () => fetch('/api/campaigns').then((r) => jsonOrThrow<{ campaigns: Campaign[] }>(r)),
  stats: (id: string) => fetch(`/api/campaigns/${id}/stats`).then((r) => jsonOrThrow<CampaignStats>(r)),
  /** Attach a brochure for a vehicle: the stored copy, or a search. Throws only when search is not configured (503). */
  ensureBrochure: (make: string, model: string, force = false) => jsonPost('/api/brochures/ensure', { make, model, ...(force ? { force: true } : {}) }).then((r) => jsonOrThrow<EnsureBrochureResponse>(r)),
  /** The stored current brochure for a vehicle, WITHOUT triggering a search (404 → null). Used to re-attach on copy. */
  currentBrochure: (make: string, model: string): Promise<Brochure | null> =>
    fetch(`/api/brochures/current?make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}`).then(async (r) => {
      if (!r.ok) return null;
      const body = (await r.json().catch(() => ({}))) as { brochure?: Brochure | null };
      return body.brochure ?? null;
    }),
  /** The salesperson accepts the official page / request form the finder found but would not attach by itself. */
  acceptBrochure: (make: string, model: string) => jsonPost('/api/brochures/accept', { make, model }).then((r) => jsonOrThrow<{ brochure: Brochure; state: string }>(r)),
  /** The manual path: a pasted PDF/brochure-page link, or an uploaded PDF (multipart). */
  manualBrochure: (make: string, model: string, opts: { url?: string; file?: File }) => {
    if (opts.file) {
      const fd = new FormData();
      fd.set('make', make);
      fd.set('model', model);
      fd.set('pdf', opts.file);
      if (opts.url) fd.set('url', opts.url);
      return fetch('/api/brochures/manual', { method: 'POST', body: fd }).then((r) => jsonOrThrow<{ brochure: Brochure; state: string }>(r));
    }
    return jsonPost('/api/brochures/manual', { make, model, url: opts.url }).then((r) => jsonOrThrow<{ brochure: Brochure; state: string }>(r));
  },
  // ---- offer library (the curated repository) ----
  saveOffer: (offer: Offer) => jsonPost('/api/offers/library', { offer }).then((r) => jsonOrThrow<{ entry: LibraryEntry; offer: Offer }>(r)),
  libraryShelves: () => fetch('/api/library/shelves').then((r) => jsonOrThrow<{ shelves: LibraryShelf[] }>(r)),
  listLibrary: (p: { scope?: 'personal' | 'shared'; category?: string; q?: string; maxMonthly?: number } = {}) => {
    const qs = new URLSearchParams();
    if (p.scope) qs.set('scope', p.scope);
    if (p.category) qs.set('category', p.category);
    if (p.q) qs.set('q', p.q);
    if (p.maxMonthly) qs.set('maxMonthly', String(p.maxMonthly));
    const s = qs.toString();
    return fetch(`/api/offers/library${s ? `?${s}` : ''}`).then((r) => jsonOrThrow<{ entries: LibraryEntry[]; offers: Offer[] }>(r));
  },
  listArchivedLibrary: (scope: 'personal' | 'shared' = 'personal') => fetch(`/api/offers/library/archived?scope=${scope}`).then((r) => jsonOrThrow<{ entries: LibraryEntry[] }>(r)),
  /** Re-fetch the live price from the source. On a dead URL the Worker answers 409; the caller shows the flag. */
  repriceLibrary: (id: string): Promise<{ ok: true; entry: LibraryEntry; offer: Offer; brochure?: Brochure; message: string } | { ok: false; error: string; entry?: LibraryEntry }> =>
    jsonPost(`/api/offers/library/${id}/reprice`, {}).then(async (r) => {
      const body = (await r.json().catch(() => ({}))) as { entry?: LibraryEntry; offer?: Offer; brochure?: Brochure; message?: string; error?: string };
      return r.ok && body.offer ? { ok: true as const, entry: body.entry!, offer: body.offer, ...(body.brochure ? { brochure: body.brochure } : {}), message: body.message ?? '' } : { ok: false as const, error: body.error ?? `Re-pricing failed (HTTP ${r.status}).`, ...(body.entry ? { entry: body.entry } : {}) };
    }),
  archiveLibrary: (id: string) => jsonPost(`/api/offers/library/${id}/archive`, {}).then((r) => jsonOrThrow<{ entry: LibraryEntry }>(r)),
  unarchiveLibrary: (id: string) => jsonPost(`/api/offers/library/${id}/unarchive`, {}).then((r) => jsonOrThrow<{ entry: LibraryEntry }>(r)),
  promoteLibrary: (id: string, category: string) => jsonPost(`/api/offers/library/${id}/promote`, { category }).then((r) => jsonOrThrow<{ entry: LibraryEntry }>(r)),
  deleteLibraryOffer: (id: string) => fetch(`/api/offers/library/${id}`, { method: 'DELETE' }).then((r) => jsonOrThrow<{ ok: boolean }>(r)),
  register: () => fetch('/api/register').then((r) => jsonOrThrow<RegisterData>(r)),
  // ---- template admin (master admin only) ----
  listTemplates: () => fetch('/api/templates').then((r) => jsonOrThrow<{ templates: Template[] }>(r)),
  createTemplate: (body: TemplateInput) => jsonPost('/api/templates', body).then((r) => jsonOrThrow<{ template: Template }>(r)),
  updateTemplate: (id: string, body: Partial<TemplateInput>) =>
    fetch(`/api/templates/${id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => jsonOrThrow<{ template: Template }>(r)),
  publishTemplate: (id: string) => jsonPost(`/api/templates/${id}/publish`, {}).then((r) => jsonOrThrow<{ template: Template }>(r)),
  retireTemplate: (id: string) => jsonPost(`/api/templates/${id}/retire`, {}).then((r) => jsonOrThrow<{ template: Template }>(r)),
  // ---- suppression register (opt-out list) ----
  listSuppressions: () => fetch('/api/suppressions').then((r) => jsonOrThrow<{ suppressions: Suppression[] }>(r)),
  addSuppression: (email: string, note?: string) => jsonPost('/api/suppressions', { email, note }).then((r) => jsonOrThrow<{ ok: boolean }>(r)),
  checkSuppression: (email: string) => jsonPost('/api/suppressions/check', { email }).then((r) => jsonOrThrow<{ suppressed: boolean }>(r)),
  removeSuppression: (email: string) => jsonPost('/api/suppressions/remove', { email }).then((r) => jsonOrThrow<{ ok: boolean }>(r)),
};

export interface Suppression {
  email: string;
  addedBy: string;
  addedAt: string;
  note: string | null;
}
