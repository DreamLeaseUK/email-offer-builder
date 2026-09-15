/**
 * Thin client for the Worker API (apps/api). Everything is same-origin: Vite proxies /api, /c, /r,
 * /f, /b and /a to the Worker in dev, and in production the Worker serves the built app too.
 */
import type { Offer, Sender } from '@offer-mailer/schema';

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

async function jsonOrThrow<T>(r: Response): Promise<T> {
  const body = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(body.error ?? `Request failed (${r.status})`);
  return body;
}

const jsonPost = (url: string, data: unknown) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });

export const api = {
  me: () => fetch('/api/me').then((r) => jsonOrThrow<{ email: string; sub: string; publicBaseUrl: string }>(r)),
  lookup: (url: string) => jsonPost('/api/offers/lookup', { url }).then((r) => jsonOrThrow<LookupResponse>(r)),
  preview: (draft: Draft) => jsonPost('/api/campaigns/preview', draft).then((r) => jsonOrThrow<PreviewResponse>(r)),
  create: (draft: Draft) => jsonPost('/api/campaigns', draft).then((r) => jsonOrThrow<CreateResponse>(r)),
};
