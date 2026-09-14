/**
 * The `url` OfferSource — brief §5.3. Pure orchestration with injected I/O so it runs the same in
 * the Worker and under vitest:
 *   1. validate and normalise the URL
 *   2. serve from the 24-hour cache when possible (parsed result only, never HTML)
 *   3. fetch the page directly; fall back to Firecrawl when the direct fetch fails
 *   4. parse identity with HTMLRewriter; price the configuration via the site's JSON endpoint
 *   5. hand the site's image URL to the image pipeline, keep only our R2 copy
 *   6. build and validate the Offer, guard it against CAP ID leaks, cache it
 */
import { assertNoCapId } from '@offer-mailer/schema';
import type { Offer, OfferImage } from '@offer-mailer/schema';
import type { OfferSource } from '../types.js';
import { buildOffer } from './build-offer.js';
import { parseOfferUrl } from './normalise.js';
import { parseOfferPage } from './parse-page.js';
import type { HtmlRewriterCtor } from './parse-page.js';
import { parsePricingResponse, pricingUrl } from './pricing.js';
import type { PricingOptions } from './pricing.js';

export interface LookupInput {
  url: string;
  createdBy: string;
}

export interface LookupResult {
  offer: Offer;
  /** Chips for the tool: the configurations the site prices for this vehicle. */
  options: PricingOptions;
  /** The site's note when it adjusted the requested configuration, else empty. */
  message: string;
  cached: boolean;
  fetchedAt: string;
  /** Non-fatal problems, e.g. the image could not be stored. */
  warnings: string[];
}

export interface LookupCache {
  get(key: string): Promise<LookupResult | undefined>;
  set(key: string, value: LookupResult): Promise<void>;
}

/** Fetches the site's image, transforms it and stores it under vehicles/<sha256>.jpg. Returns our copy only. */
export interface ImageStore {
  store(sourceUrl: string, alt: string): Promise<OfferImage | undefined>;
}

/** Firecrawl (or anything else) that can fetch the page's raw HTML when a direct fetch fails. */
export interface HtmlFallback {
  fetchHtml(url: string): Promise<string>;
}

export interface UrlSourceDeps {
  fetch: typeof fetch;
  HTMLRewriter: HtmlRewriterCtor;
  knownBadges: string[];
  cache?: LookupCache;
  images?: ImageStore;
  fallback?: HtmlFallback;
  now?: () => Date;
  newId?: () => string;
  userAgent?: string;
  siteOrigin?: string;
}

export class LookupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LookupError';
  }
}

export const LOOKUP_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_UA = 'DreamLease-OfferMailer/1.0 (+https://mailer.dreamlease.co.uk)';

export class UrlOfferSource implements OfferSource<LookupInput> {
  readonly kind = 'url' as const;

  constructor(private readonly d: UrlSourceDeps) {}

  async lookup(input: LookupInput): Promise<Offer> {
    return (await this.lookupFull(input)).offer;
  }

  async lookupFull(input: LookupInput): Promise<LookupResult> {
    const url = parseOfferUrl(input.url);
    const now = this.d.now?.() ?? new Date();

    const hit = await this.d.cache?.get(url.canonical);
    if (hit) {
      return { ...hit, offer: { ...hit.offer, createdBy: input.createdBy }, cached: true };
    }

    const html = await this.fetchHtml(url.canonical);
    const page = await parseOfferPage(html, this.d.HTMLRewriter);

    const config = { ...page.defaults, ...url.config };
    const pricing = await this.fetchPricing(pricingUrl(page.slugs, url.contractType, config, page.isVan, this.d.siteOrigin));

    const warnings: string[] = [];
    let image: OfferImage | undefined;
    const source = pricing.offer?.imageOverrideUrl ?? page.imageSourceUrl;
    if (source && this.d.images) {
      try {
        image = await this.d.images.store(source, `${page.make} ${page.model}`);
        if (!image) warnings.push('The vehicle image could not be stored; add one by hand.');
      } catch {
        warnings.push('The vehicle image could not be stored; add one by hand.');
      }
    } else if (!source) {
      warnings.push('The page has no vehicle image; add one by hand.');
    }

    const offer = buildOffer({
      url,
      page,
      pricing,
      ...(image ? { image } : {}),
      now,
      createdBy: input.createdBy,
      id: this.d.newId?.() ?? crypto.randomUUID(),
      knownBadges: this.d.knownBadges,
    });

    const result: LookupResult = { offer, options: pricing.options, message: pricing.message, cached: false, fetchedAt: now.toISOString(), warnings };
    assertNoCapId(result, 'lookup result');
    await this.d.cache?.set(url.canonical, result);
    return result;
  }

  private async fetchHtml(url: string): Promise<string> {
    let status = 0;
    try {
      const res = await this.d.fetch(url, { headers: { 'user-agent': this.d.userAgent ?? DEFAULT_UA, accept: 'text/html' }, redirect: 'follow' });
      status = res.status;
      if (res.ok) {
        const html = await res.text();
        if (html.includes('window.motorleaseInit')) return html;
      }
    } catch {
      /* fall through to the fallback */
    }
    if (this.d.fallback) {
      const html = await this.d.fallback.fetchHtml(url);
      if (html.includes('window.motorleaseInit')) return html;
      throw new LookupError('The offer page could not be read, even through the fallback fetcher.');
    }
    throw new LookupError(status ? `The offer page could not be fetched (HTTP ${status}).` : 'The offer page could not be fetched.');
  }

  private async fetchPricing(url: string) {
    let res: Response;
    try {
      res = await this.d.fetch(url, { headers: { 'user-agent': this.d.userAgent ?? DEFAULT_UA, accept: 'application/json' } });
    } catch {
      throw new LookupError('The pricing service could not be reached.');
    }
    if (!res.ok) throw new LookupError(`The pricing service answered HTTP ${res.status}.`);
    return parsePricingResponse(await res.json());
  }
}
