/**
 * Thin client for the Worker API (apps/api). Everything is same-origin: Vite proxies /api, /c, /r,
 * /f, /b and /a to the Worker in dev, and in production the Worker serves the built app too.
 */
import type { Brochure, Campaign, ComplianceBlock, ContractType, Offer, Sender, Template } from '@offer-mailer/schema';

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

export type LayoutChoice = 'auto' | 'single' | 'stack' | 'grid2' | 'grid3';
export type UseCase = 'follow_up' | 'offer_pack' | 'renewal';
/** The audience / lease product. Drives the compliance block, terms and (for salsac) the pricing shape. */
export type Audience = 'personal' | 'business' | 'salary_sacrifice';
/** A contact method the rep can surface as a secondary link in their signature. */
export type ContactMethod = 'call' | 'whatsapp' | 'email' | 'book';
/** The signed-in user's role. Master admins get the template admin; everyone else is a salesperson. */
export type Role = 'salesperson' | 'admin';

/** The rep's saved, editable sender contact details (the photo persists separately). */
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
  brochure: Brochure;
  /** stored: unexpired copy; fresh: harvested now; stale: expired copy kept after a failed harvest. */
  state: 'stored' | 'fresh' | 'stale';
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
  /** Save the rep's contact details so they prefill next time. */
  saveSender: (details: SavedSender) => jsonPost('/api/me/sender', details).then((r) => jsonOrThrow<{ ok: boolean; savedSender: SavedSender }>(r)),
  /** Upload the rep's portrait; returns the stored (square) headshot URL. */
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
  /** Attach a brochure for a vehicle: stored copy, or a Firecrawl harvest. Throws on 404/503 (offer the manual path). */
  ensureBrochure: (make: string, model: string) => jsonPost('/api/brochures/ensure', { make, model }).then((r) => jsonOrThrow<EnsureBrochureResponse>(r)),
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
  saveOffer: (offer: Offer) => jsonPost('/api/offers/library', { offer }).then((r) => jsonOrThrow<{ offer: Offer }>(r)),
  listLibrary: () => fetch('/api/offers/library').then((r) => jsonOrThrow<{ offers: Offer[] }>(r)),
  deleteLibraryOffer: (id: string) => fetch(`/api/offers/library/${id}`, { method: 'DELETE' }).then((r) => jsonOrThrow<{ ok: boolean }>(r)),
  register: () => fetch('/api/register').then((r) => jsonOrThrow<RegisterData>(r)),
  // ---- template admin (master admin only) ----
  listTemplates: () => fetch('/api/templates').then((r) => jsonOrThrow<{ templates: Template[] }>(r)),
  createTemplate: (body: TemplateInput) => jsonPost('/api/templates', body).then((r) => jsonOrThrow<{ template: Template }>(r)),
  updateTemplate: (id: string, body: Partial<TemplateInput>) =>
    fetch(`/api/templates/${id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => jsonOrThrow<{ template: Template }>(r)),
  publishTemplate: (id: string) => jsonPost(`/api/templates/${id}/publish`, {}).then((r) => jsonOrThrow<{ template: Template }>(r)),
  retireTemplate: (id: string) => jsonPost(`/api/templates/${id}/retire`, {}).then((r) => jsonOrThrow<{ template: Template }>(r)),
};
