/**
 * Minimal Firecrawl v2 REST client (https://api.firecrawl.dev/v2). Only the three calls the
 * brochure harvest and the HTML fallback need. Every call reports the credits it cost so the
 * harvest can stop at its cap (brief §5.8: ~15 credits). Firecrawl is the one metered service.
 */

export interface FirecrawlSearchHit {
  url: string;
  title?: string;
  description?: string;
}

export interface FirecrawlClient {
  search(query: string, opts?: { limit?: number; country?: string; location?: string; categories?: ('pdf' | 'github' | 'research')[] }): Promise<{ results: FirecrawlSearchHit[]; creditsUsed: number }>;
  scrape(
    url: string,
    opts?: { formats?: ('markdown' | 'html' | 'rawHtml' | 'links')[]; onlyMainContent?: boolean; pdfMaxPages?: number; waitFor?: number },
  ): Promise<{ markdown?: string; html?: string; rawHtml?: string; links?: string[]; statusCode?: number; totalPages?: number; creditsUsed: number }>;
  map(url: string, opts?: { search?: string; limit?: number }): Promise<{ links: string[]; creditsUsed: number }>;
  /**
   * Fetch a URL's original response body (the `rawBase64` format) and decode it to bytes. Used when a
   * direct Worker download is blocked by the origin's bot protection — Firecrawl's proxies fetch the
   * real file. `ok` is true only when the origin returned a clean (2xx/304) status.
   */
  fetchFile(url: string): Promise<{ bytes: ArrayBuffer; contentType: string | null; ok: boolean; creditsUsed: number }>;
}

export class FirecrawlError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'FirecrawlError';
  }
}

interface SearchBody {
  success?: boolean;
  creditsUsed?: number;
  data?: { web?: { url?: string; title?: string; description?: string }[] };
  error?: string;
}
interface ScrapeBody {
  success?: boolean;
  creditsUsed?: number;
  data?: { markdown?: string; html?: string; rawHtml?: string; links?: string[]; metadata?: { creditsUsed?: number; statusCode?: number; totalPages?: number } };
  error?: string;
}
interface MapBody {
  success?: boolean;
  creditsUsed?: number;
  links?: (string | { url?: string })[];
  error?: string;
}
interface RawBody {
  success?: boolean;
  creditsUsed?: number;
  data?: { rawBase64?: string; metadata?: { statusCode?: number; contentType?: string; creditsUsed?: number } };
  error?: string;
}

/** Decode bare Base64 (Firecrawl's rawBase64) to bytes. Runs in workerd; atob is available there. */
function base64ToBytes(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

export function createFirecrawlClient(apiKey: string, fetchFn: typeof fetch = fetch, base = 'https://api.firecrawl.dev/v2'): FirecrawlClient {
  async function post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetchFn(`${base}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string };
    if (!res.ok || json.success === false) throw new FirecrawlError(json.error ?? `Firecrawl ${path} answered HTTP ${res.status}`, res.status);
    return json as T;
  }

  return {
    async search(query, opts = {}) {
      const body = await post<SearchBody>('/search', {
        query,
        limit: opts.limit ?? 10,
        country: opts.country ?? 'GB',
        location: opts.location ?? 'United Kingdom',
        sources: [{ type: 'web' }],
        ignoreInvalidURLs: true,
        ...(opts.categories ? { categories: opts.categories } : {}),
      });
      const results: FirecrawlSearchHit[] = [];
      for (const r of body.data?.web ?? []) {
        if (!r.url) continue;
        const hit: FirecrawlSearchHit = { url: r.url };
        if (r.title) hit.title = r.title;
        if (r.description) hit.description = r.description;
        results.push(hit);
      }
      return { results, creditsUsed: body.creditsUsed ?? 2 };
    },

    async scrape(url, opts = {}) {
      const req: Record<string, unknown> = { url, formats: opts.formats ?? ['markdown'], onlyMainContent: opts.onlyMainContent ?? false };
      if (opts.pdfMaxPages) req['parsers'] = [{ type: 'pdf', mode: 'fast', maxPages: opts.pdfMaxPages }];
      if (opts.waitFor) req['waitFor'] = opts.waitFor;
      const body = await post<ScrapeBody>('/scrape', req);
      const d = body.data ?? {};
      const out: { markdown?: string; html?: string; rawHtml?: string; links?: string[]; statusCode?: number; totalPages?: number; creditsUsed: number } = { creditsUsed: body.creditsUsed ?? d.metadata?.creditsUsed ?? 1 };
      if (d.metadata?.statusCode !== undefined) out.statusCode = d.metadata.statusCode;
      if (d.metadata?.totalPages !== undefined) out.totalPages = d.metadata.totalPages;
      if (d.markdown !== undefined) out.markdown = d.markdown;
      if (d.html !== undefined) out.html = d.html;
      if (d.rawHtml !== undefined) out.rawHtml = d.rawHtml;
      if (d.links !== undefined) out.links = d.links;
      return out;
    },

    async map(url, opts = {}) {
      const req: Record<string, unknown> = { url, limit: opts.limit ?? 30 };
      if (opts.search) req['search'] = opts.search;
      const body = await post<MapBody>('/map', req);
      const links = (body.links ?? []).map((l) => (typeof l === 'string' ? l : (l.url ?? ''))).filter(Boolean);
      return { links, creditsUsed: body.creditsUsed ?? 1 };
    },

    async fetchFile(url) {
      // rawBase64 must be requested alone; it returns the origin's raw response body.
      const body = await post<RawBody>('/scrape', { url, formats: ['rawBase64'] });
      const meta = body.data?.metadata;
      const status = meta?.statusCode ?? 0;
      const b64 = body.data?.rawBase64 ?? '';
      const ok = b64.length > 0 && ((status >= 200 && status < 300) || status === 304);
      return { bytes: b64 ? base64ToBytes(b64) : new ArrayBuffer(0), contentType: meta?.contentType ?? null, ok, creditsUsed: body.creditsUsed ?? meta?.creditsUsed ?? 2 };
    },
  };
}
