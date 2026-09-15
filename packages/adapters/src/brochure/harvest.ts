/**
 * Brochure harvest — brief §5.8 steps 3 to 5. Cheapest step first, stop as soon as a PDF is found:
 *   1. Firecrawl search "<make> <model> brochure pdf" (UK), keep allowlisted hosts, prefer a .pdf
 *   2. else scrape the best allowlisted page and take its first PDF link
 *   3. else map the manufacturer's UK domain for "brochure" and repeat
 *   4. an allowlisted brochure page with no PDF is a `gated` brochure, not a failure
 * Hard cap of ~15 credits per harvest. PDFs are downloaded directly by the Worker (no credits),
 * checked (application/pdf, ≤ 40 MB) and stored under brochures/<sha256>.pdf. UK verification is by
 * domain, upgraded to `content` when a cheap look at the first two pages shows £ or OTR and no €.
 */
import { BROCHURE_TTL_DAYS, vehicleKey } from '@offer-mailer/schema';
import type { Brochure, Vehicle } from '@offer-mailer/schema';
import type { FirecrawlClient } from '../firecrawl/client.js';
import type { BrochureSource } from '../types.js';
import { entryUrl, isAllowlisted, manufacturerEntry, matchAllowlist } from './allowlist.js';

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
  /** config/manufacturer-uk-domains.json */
  allowlist: string[];
  download(url: string): Promise<Downloaded>;
  store: BrochureStore;
  createdBy: string;
  now?: () => Date;
  newId?: () => string;
  /** Credits per harvest before giving up. */
  creditCap?: number;
}

export class BrochureNotFoundError extends Error {
  constructor(
    message: string,
    readonly creditsUsed: number,
  ) {
    super(message);
    this.name = 'BrochureNotFoundError';
  }
}

export const isPdfUrl = (url: string): boolean => {
  try {
    return /\.pdf$/i.test(new URL(url).pathname);
  } catch {
    return false;
  }
};

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

/** £ or OTR present, no €: a UK brochure. */
export function ukContentCheck(text: string): boolean {
  return (text.includes('£') || /\bOTR\b/.test(text)) && !text.includes('€');
}

export class FirecrawlBrochureSource implements BrochureSource {
  readonly kind = 'firecrawl' as const;

  constructor(private readonly d: HarvestDeps) {}

  async harvest(vehicle: Pick<Vehicle, 'make' | 'model'>): Promise<Brochure> {
    const cap = this.d.creditCap ?? 15;
    let credits = 0;
    const spend = (n: number) => {
      credits += n;
    };
    const budgetLeft = (n: number) => credits + n <= cap;
    const key = vehicleKey(vehicle);
    const title = `${vehicle.make} ${vehicle.model} brochure (UK)`;
    let gatedPage: string | undefined;

    const finishPdf = async (pdfUrl: string, viaPage?: string): Promise<Brochure | undefined> => {
      let d = await this.d.download(pdfUrl);
      // A blocked or failed direct download (e.g. a manufacturer CDN 403ing the Worker) yields no bytes.
      // Firecrawl's proxies fetch the original file; rawBase64 returns it. Only spend a credit then.
      if (d.bytes.byteLength === 0 && budgetLeft(2)) {
        try {
          const f = await this.d.firecrawl.fetchFile(pdfUrl);
          spend(f.creditsUsed);
          if (f.ok) d = { bytes: f.bytes, contentType: f.contentType };
        } catch {
          /* keep the empty direct result; this PDF is skipped */
        }
      }
      if (!looksLikePdf(d) || d.bytes.byteLength === 0 || d.bytes.byteLength > MAX_PDF_BYTES) return undefined;
      const file = await this.d.store.putPdf(d.bytes);
      let by: Brochure['ukVerified']['by'] = 'domain';
      let note = matchAllowlist(viaPage ?? pdfUrl, this.d.allowlist)?.entry ?? 'allowlisted host';
      if (budgetLeft(2)) {
        try {
          const peek = await this.d.firecrawl.scrape(pdfUrl, { formats: ['markdown'], pdfMaxPages: 2 });
          spend(peek.creditsUsed);
          if (peek.markdown && ukContentCheck(peek.markdown)) {
            by = 'content';
            note += ', £ pricing on the first pages';
          }
        } catch {
          /* the domain check stands on its own */
        }
      }
      return this.record({ key, title, kind: 'pdf', file, sourceUrl: pdfUrl, by, note });
    };

    // 1. search
    const search = await this.d.firecrawl.search(`${vehicle.make} ${vehicle.model} brochure pdf`, { limit: 10 });
    spend(search.creditsUsed);
    const allowed = search.results.filter((r) => isAllowlisted(r.url, this.d.allowlist));
    for (const hit of allowed.filter((r) => isPdfUrl(r.url))) {
      const b = await finishPdf(hit.url);
      if (b) return b;
    }

    // 2. scrape the best allowlisted page for a PDF link
    const pages = allowed.filter((r) => !isPdfUrl(r.url)).map((r) => r.url);
    for (const pageUrl of pages.slice(0, 2)) {
      if (!budgetLeft(1)) break;
      const found = await this.pdfFromPage(pageUrl, spend);
      if (found) {
        const b = await finishPdf(found, pageUrl);
        if (b) return b;
      } else {
        gatedPage ??= pageUrl;
      }
    }

    // 3. map the manufacturer's UK site
    const entry = manufacturerEntry(vehicle.make, this.d.allowlist);
    if (entry && budgetLeft(1)) {
      const mapped = await this.d.firecrawl.map(entryUrl(entry), { search: 'brochure', limit: 30 });
      spend(mapped.creditsUsed);
      const links = mapped.links.filter((l) => isAllowlisted(l, this.d.allowlist));
      for (const l of links.filter(isPdfUrl)) {
        const b = await finishPdf(l);
        if (b) return b;
      }
      const brochurePages = links.filter((l) => !isPdfUrl(l) && /brochure/i.test(l));
      for (const pageUrl of brochurePages.slice(0, 2)) {
        if (!budgetLeft(1)) break;
        const found = await this.pdfFromPage(pageUrl, spend);
        if (found) {
          const b = await finishPdf(found, pageUrl);
          if (b) return b;
        } else {
          gatedPage ??= pageUrl;
        }
      }
    }

    // 4. a request-a-brochure page is a result in its own right
    if (gatedPage) {
      return this.record({ key, title, kind: 'gated', sourceUrl: gatedPage, by: 'domain', note: matchAllowlist(gatedPage, this.d.allowlist)?.entry ?? 'allowlisted host' });
    }
    throw new BrochureNotFoundError('No UK brochure found on an allowlisted manufacturer site.', credits);
  }

  private async pdfFromPage(pageUrl: string, spend: (n: number) => void): Promise<string | undefined> {
    try {
      const page = await this.d.firecrawl.scrape(pageUrl, { formats: ['links'] });
      spend(page.creditsUsed);
      return (page.links ?? []).find((l) => isPdfUrl(l) && /^https?:/i.test(l));
    } catch {
      return undefined;
    }
  }

  private record(r: { key: string; title: string; kind: 'pdf' | 'gated'; file?: NonNullable<Brochure['file']>; sourceUrl: string; by: Brochure['ukVerified']['by']; note: string }): Brochure {
    const now = this.d.now?.() ?? new Date();
    const b: Brochure = {
      id: this.d.newId?.() ?? crypto.randomUUID(),
      vehicleKey: r.key,
      title: r.title,
      kind: r.kind,
      sourceUrl: r.sourceUrl,
      source: 'harvest',
      ukVerified: { by: r.by, note: r.note },
      fetchedAt: now.toISOString(),
      expiresAt: brochureExpiresAt(now),
      status: 'current',
      createdBy: this.d.createdBy,
    };
    if (r.file) b.file = r.file;
    return b;
  }
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
    const d = await i.download(i.url);
    if (!looksLikePdf(d) || d.bytes.byteLength === 0) throw new ManualBrochureError('That link did not return a PDF.');
    if (d.bytes.byteLength > MAX_PDF_BYTES) throw new ManualBrochureError('That PDF is over 40 MB.');
    const file = await i.store.putPdf(d.bytes);
    return { ...base, kind: 'pdf', file, sourceUrl: i.url };
  }
  return { ...base, kind: 'gated', sourceUrl: i.url };
}
