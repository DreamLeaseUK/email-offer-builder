/**
 * Brochure sources — brief §5.8, discovery redesigned 17–18 Sept 2026 (docs/brochure-finder-brief.md).
 *
 * FirecrawlBrochureSource runs the finder (finder.ts) and turns its outcome into something the tool can use:
 *   verified_pdf           → the bytes are retrieved (direct, then Firecrawl rawBase64 past bot protection),
 *                            checked (%PDF, ≤ 40 MB) and stored under brochures/<sha256>.pdf → a `pdf` brochure.
 *                            If the manufacturer's storage refuses the file outright, the outcome is downgraded
 *                            to official_page_only: we never work around a download protection.
 *   verified_web_brochure  → a `web` brochure that links the manufacturer's own page.
 *   anything else          → no brochure. The search record says what was checked and why nothing attached.
 * official_page_only and brochure_request are never attached automatically; the rep can accept them in one
 * click (acceptSearchOutcome). The manual path (upload / paste) always works.
 */
import { BROCHURE_TTL_DAYS, vehicleKey } from '@offer-mailer/schema';
import type { Brochure, BrochureSearch, Vehicle } from '@offer-mailer/schema';
import type { FirecrawlClient } from '../firecrawl/client.js';
import type { BrochureFindOutcome, BrochureSource } from '../types.js';
import { FINDER_VERSION, findBrochure } from './finder.js';
import type { FinderHttp, FinderResult } from './finder.js';

export const MAX_PDF_BYTES = 40 * 1024 * 1024;

export interface Downloaded {
  bytes: ArrayBuffer;
  contentType: string | null;
}

export interface BrochureStore {
  /** Stores the PDF under brochures/<sha256>.pdf (idempotent) and returns the file record. */
  putPdf(bytes: ArrayBuffer): Promise<NonNullable<Brochure['file']>>;
}

export interface HarvestDeps {
  firecrawl: FirecrawlClient;
  /** Plain GET used to probe pages and resolve "download" links. */
  http: FinderHttp;
  download(url: string): Promise<Downloaded>;
  store: BrochureStore;
  createdBy: string;
  now?: () => Date;
  newId?: () => string;
  /** Credits per search before giving up. */
  creditCap?: number;
}

export const isPdfUrl = (url: string): boolean => {
  try {
    return /\.pdf$/i.test(new URL(url).pathname);
  } catch {
    return false;
  }
};

/** Upgrade http -> https: the Brochure schema stores https only, and the recipient link is https too. */
export const toHttps = (url: string): string => url.replace(/^http:\/\//i, 'https://');

export function brochureExpiresAt(fetchedAt: Date): string {
  return new Date(fetchedAt.getTime() + BROCHURE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

export function isBrochureExpired(b: Pick<Brochure, 'expiresAt'>, now: Date): boolean {
  return new Date(b.expiresAt).getTime() <= now.getTime();
}

/** Is this a PDF? Trust the magic bytes over the header; CDNs lie about content types. */
export function looksLikePdf(d: Downloaded): boolean {
  const head = new Uint8Array(d.bytes.slice(0, 5));
  const magic = String.fromCharCode(...head);
  return magic.startsWith('%PDF') || (d.contentType ?? '').toLowerCase().includes('application/pdf');
}

const usablePdf = (d: Downloaded): boolean => d.bytes.byteLength > 0 && d.bytes.byteLength <= MAX_PDF_BYTES && looksLikePdf(d);

/** Direct download first (free); Firecrawl's proxies only when the origin blocks the Worker. */
export async function retrievePdf(url: string, deps: Pick<HarvestDeps, 'download' | 'firecrawl'>): Promise<{ pdf?: Downloaded; credits: number }> {
  const direct = await deps.download(url).catch((): Downloaded => ({ bytes: new ArrayBuffer(0), contentType: null }));
  if (usablePdf(direct)) return { pdf: direct, credits: 0 };
  try {
    const f = await deps.firecrawl.fetchFile(url);
    const d: Downloaded = { bytes: f.bytes, contentType: f.contentType };
    return f.ok && usablePdf(d) ? { pdf: d, credits: f.creditsUsed } : { credits: f.creditsUsed };
  } catch {
    return { credits: 0 };
  }
}

const documentNoun = (t: Brochure['documentType']): string => (t === 'price_spec_guide' ? 'price & spec guide' : 'brochure');

export class FirecrawlBrochureSource implements BrochureSource {
  readonly kind = 'firecrawl' as const;

  constructor(private readonly d: HarvestDeps) {}

  async find(vehicle: Pick<Vehicle, 'make' | 'model'>): Promise<BrochureFindOutcome> {
    const now = this.d.now?.() ?? new Date();
    const r = await findBrochure(vehicle, { firecrawl: this.d.firecrawl, http: this.d.http, now: () => now, ...(this.d.creditCap ? { creditCap: this.d.creditCap } : {}) });
    let brochure: Brochure | undefined;

    if (r.status === 'verified_pdf' && r.url) {
      const got = await retrievePdf(r.url, this.d);
      r.credits += got.credits;
      if (got.pdf) {
        r.assetRetrievable = true;
        const file = await this.d.store.putPdf(got.pdf.bytes);
        brochure = this.record(vehicle, r, now, { kind: 'pdf', file, sourceUrl: r.url });
      } else {
        // the document is real but its storage refuses everyone: point at the page, never around the block
        const noun = documentNoun(r.documentType === 'price_spec_guide' ? 'price_spec_guide' : 'brochure');
        Object.assign(r, { status: 'official_page_only', assetUrl: r.url, url: r.fromPage ?? r.url, assetRetrievable: false, reason: `The official ${noun} was verified, but the manufacturer's site would not release the file.` });
      }
    } else if (r.status === 'verified_web_brochure' && r.url) {
      brochure = this.record(vehicle, r, now, { kind: 'web', sourceUrl: r.url });
    }
    return { ...(brochure ? { brochure } : {}), search: toSearchRecord(vehicle, r, now, this.d.createdBy) };
  }

  private record(vehicle: Pick<Vehicle, 'make' | 'model'>, r: FinderResult, now: Date, x: { kind: 'pdf' | 'web'; file?: NonNullable<Brochure['file']>; sourceUrl: string }): Brochure {
    const documentType = r.documentType === 'price_spec_guide' ? 'price_spec_guide' : 'brochure';
    const evidence = r.candidates.find((c) => c.status === 'accepted')?.evidence;
    const note = [r.officialSite, evidence?.['poundPricing'] ? '£ pricing' : undefined, evidence?.['ukWording'] ? 'UK wording' : undefined, r.editionDate ? `edition ${r.editionDate}` : undefined].filter(Boolean).join(', ');
    const b: Brochure = {
      id: this.d.newId?.() ?? crypto.randomUUID(),
      vehicleKey: vehicleKey(vehicle),
      title: `${vehicle.make} ${vehicle.model} ${documentNoun(documentType)} (UK)`,
      kind: x.kind,
      sourceUrl: toHttps(x.sourceUrl),
      source: 'harvest',
      ukVerified: { by: 'content', ...(note ? { note } : {}) },
      documentType,
      finder: { version: FINDER_VERSION, status: r.status, ...(r.flags.length ? { flags: r.flags } : {}) },
      fetchedAt: now.toISOString(),
      expiresAt: brochureExpiresAt(now),
      status: 'current',
      createdBy: this.d.createdBy,
    };
    if (r.editionDate) b.editionDate = r.editionDate;
    if (x.file) b.file = x.file;
    return b;
  }
}

export function toSearchRecord(vehicle: Pick<Vehicle, 'make' | 'model'>, r: FinderResult, now: Date, searchedBy: string): BrochureSearch {
  const s: BrochureSearch = {
    vehicleKey: vehicleKey(vehicle),
    vehicle: `${vehicle.make} ${vehicle.model}`,
    status: r.status,
    flags: r.flags,
    queries: r.queries,
    pagesOpened: r.pagesOpened,
    candidates: r.candidates,
    credits: r.credits,
    durationMs: r.durationMs,
    finderVersion: FINDER_VERSION,
    searchedAt: now.toISOString(),
    searchedBy,
  };
  if (r.documentType) s.documentType = r.documentType;
  if (r.url) s.url = r.url;
  if (r.assetUrl) s.assetUrl = r.assetUrl;
  if (r.assetRetrievable !== undefined) s.assetRetrievable = r.assetRetrievable;
  if (r.reason) s.reason = r.reason;
  if (r.officialSite) s.officialSite = r.officialSite;
  return s;
}

/**
 * The rep accepts an outcome the finder would not attach by itself: an official page whose document is
 * protected or is a price page (→ `web`), or a request-a-brochure form (→ `gated`). The URL comes from the
 * stored search, never from the browser.
 */
export function acceptSearchOutcome(search: BrochureSearch, o: { vehicle: Pick<Vehicle, 'make' | 'model'>; createdBy: string; now?: () => Date; newId?: () => string }): Brochure | undefined {
  if (!search.url || (search.status !== 'official_page_only' && search.status !== 'brochure_request')) return undefined;
  const now = o.now?.() ?? new Date();
  const isRequest = search.status === 'brochure_request';
  const documentType = search.documentType === 'price_spec_guide' ? 'price_spec_guide' : 'brochure';
  return {
    id: o.newId?.() ?? crypto.randomUUID(),
    vehicleKey: vehicleKey(o.vehicle),
    title: isRequest ? `${o.vehicle.make} ${o.vehicle.model} brochure request (UK)` : `${o.vehicle.make} ${o.vehicle.model} ${documentNoun(documentType)} (UK)`,
    kind: isRequest ? 'gated' : 'web',
    sourceUrl: toHttps(search.url),
    source: 'harvest',
    ukVerified: { by: 'user', note: `accepted by the rep from a ${search.status} search result` },
    ...(isRequest ? {} : { documentType }),
    finder: { version: search.finderVersion, status: search.status, ...(search.flags.length ? { flags: search.flags } : {}) },
    fetchedAt: now.toISOString(),
    expiresAt: brochureExpiresAt(now),
    status: 'current',
    createdBy: o.createdBy,
  };
}

// ---------- manual path (brief §5.8 step 7) ----------

export interface ManualBrochureInput {
  vehicle: Pick<Vehicle, 'make' | 'model'>;
  /** A PDF URL becomes `pdf`; any other page becomes `gated`. */
  url?: string;
  /** An uploaded PDF. */
  pdf?: Downloaded;
  createdBy: string;
  download(url: string): Promise<Downloaded>;
  /** Optional second attempt (Firecrawl rawBase64) when a manufacturer CDN blocks the direct download. */
  fetchFile?: (url: string) => Promise<Downloaded>;
  store: BrochureStore;
  now?: () => Date;
  newId?: () => string;
}

export class ManualBrochureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ManualBrochureError';
  }
}

export async function manualBrochure(i: ManualBrochureInput): Promise<Brochure> {
  const now = i.now?.() ?? new Date();
  const base = {
    id: i.newId?.() ?? crypto.randomUUID(),
    vehicleKey: vehicleKey(i.vehicle),
    title: `${i.vehicle.make} ${i.vehicle.model} brochure (UK)`,
    source: 'manual' as const,
    ukVerified: { by: 'user' as const },
    fetchedAt: now.toISOString(),
    expiresAt: brochureExpiresAt(now),
    status: 'current' as const,
    createdBy: i.createdBy,
  };
  if (i.pdf) {
    if (!looksLikePdf(i.pdf) || i.pdf.bytes.byteLength === 0) throw new ManualBrochureError('That file is not a PDF.');
    if (i.pdf.bytes.byteLength > MAX_PDF_BYTES) throw new ManualBrochureError('That PDF is over 40 MB.');
    const file = await i.store.putPdf(i.pdf.bytes);
    return { ...base, kind: 'pdf', file, sourceUrl: i.url ?? 'https://www.dreamlease.co.uk/' };
  }
  if (!i.url) throw new ManualBrochureError('Give a PDF, a PDF link or a brochure page link.');
  let u: URL;
  try {
    u = new URL(i.url);
  } catch {
    throw new ManualBrochureError('That is not a web address.');
  }
  if (u.protocol !== 'https:') throw new ManualBrochureError('Brochure links must be https.');
  if (isPdfUrl(i.url)) {
    let d = await i.download(i.url);
    const fetchFile = i.fetchFile;
    if ((!looksLikePdf(d) || d.bytes.byteLength === 0) && fetchFile) d = await fetchFile(i.url).catch(() => d);
    if (!looksLikePdf(d) || d.bytes.byteLength === 0) throw new ManualBrochureError('That link did not return a PDF.');
    if (d.bytes.byteLength > MAX_PDF_BYTES) throw new ManualBrochureError('That PDF is over 40 MB.');
    const file = await i.store.putPdf(d.bytes);
    return { ...base, kind: 'pdf', file, sourceUrl: i.url };
  }
  return { ...base, kind: 'gated', sourceUrl: i.url };
}
