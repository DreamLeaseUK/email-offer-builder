import { describe, expect, it, vi } from 'vitest';
import { Brochure } from '@offer-mailer/schema';
import type { Brochure as BrochureT } from '@offer-mailer/schema';
import {
  BrochureNotFoundError,
  FirecrawlBrochureSource,
  ManualBrochureError,
  brochureExpiresAt,
  ensureBrochure,
  entryUrl,
  isBrochureExpired,
  manualBrochure,
  manufacturerEntry,
  matchAllowlist,
  ukContentCheck,
} from '../src/index.js';
import type { BrochureRepo, BrochureStore, Downloaded, FirecrawlClient } from '../src/index.js';
import { ALLOWLIST, BY, NOW, pdfBytes } from './helpers.js';

// ---------- allowlist ----------

describe('allowlist', () => {
  it('matches hosts, subdomains and path prefixes, and rejects everything else', () => {
    expect(matchAllowlist('https://www.kia.co.uk/brochures/ev3.pdf', ALLOWLIST)?.entry).toBe('kia.co.uk');
    expect(matchAllowlist('https://cdn.kia.co.uk/x.pdf', ALLOWLIST)?.entry).toBe('kia.co.uk');
    expect(matchAllowlist('https://www.kia.de/brochures/ev3.pdf', ALLOWLIST)).toBeNull();
    expect(matchAllowlist('https://www.volvocars.com/uk/brochures/', ALLOWLIST)?.entry).toBe('volvocars.com/uk');
    expect(matchAllowlist('https://www.volvocars.com/de/brochures/', ALLOWLIST)).toBeNull();
    // Global domain (kia.com): UK content matches by a /uk path segment; other regions do not.
    expect(matchAllowlist('https://www.kia.com/content/dam/kwcms/kme/uk/en/ev2-brochure.pdf', ALLOWLIST)?.entry).toBe('kia.com');
    expect(matchAllowlist('https://www.kia.com/eu/new-cars/ev2/', ALLOWLIST)).toBeNull();
    expect(matchAllowlist('https://www.kia.com/us/vehicles/', ALLOWLIST)).toBeNull();
    expect(matchAllowlist('https://notkia.co.uk/x.pdf', ALLOWLIST)).toBeNull();
    expect(matchAllowlist('ftp://www.kia.co.uk/x.pdf', ALLOWLIST)).toBeNull();
    expect(matchAllowlist('garbage', ALLOWLIST)).toBeNull();
  });

  it('finds the manufacturer entry for a make, including aliases', () => {
    expect(manufacturerEntry('Kia', ALLOWLIST)).toBe('kia.co.uk');
    expect(manufacturerEntry('Cupra', ALLOWLIST)).toBe('cupraofficial.co.uk');
    expect(manufacturerEntry('Land Rover', ALLOWLIST)).toBe('landrover.co.uk');
    expect(manufacturerEntry('Mercedes-Benz', ALLOWLIST)).toBe('mercedes-benz.co.uk');
    expect(manufacturerEntry('Volvo', ALLOWLIST)).toBe('volvocars.com/uk');
    expect(manufacturerEntry('Wuling', ALLOWLIST)).toBeUndefined();
    expect(entryUrl('volvocars.com/uk')).toBe('https://www.volvocars.com/uk/');
    expect(entryUrl('kia.co.uk')).toBe('https://www.kia.co.uk/');
  });
});

// ---------- harvest ----------

interface Calls {
  search: string[];
  scrape: string[];
  map: string[];
  downloads: string[];
  fetchFile: string[];
}

function mockFirecrawl(
  plan: { search?: { url: string }[]; links?: Record<string, string[]>; map?: string[]; pdfText?: string; searchCredits?: number; filePdf?: boolean; fileOk?: boolean },
  calls: Calls,
): FirecrawlClient {
  return {
    async search(q) {
      calls.search.push(q);
      return { results: plan.search ?? [], creditsUsed: plan.searchCredits ?? 2 };
    },
    async scrape(url, opts) {
      calls.scrape.push(url);
      if (opts?.pdfMaxPages) return { markdown: plan.pdfText ?? 'Prices from £29,995 OTR', creditsUsed: 2 };
      return { links: plan.links?.[url] ?? [], creditsUsed: 1 };
    },
    async map(url) {
      calls.map.push(url);
      return { links: plan.map ?? [], creditsUsed: 1 };
    },
    async fetchFile(url) {
      calls.fetchFile.push(url);
      const bytes = plan.filePdf ? pdfBytes() : (new TextEncoder().encode('<html>blocked</html>').buffer as ArrayBuffer);
      return { bytes, contentType: plan.filePdf ? 'application/pdf' : 'text/html', ok: plan.fileOk ?? true, creditsUsed: 2 };
    },
  };
}

const store: BrochureStore = {
  async putPdf(bytes) {
    return { key: `brochures/${'c'.repeat(64)}.pdf`, url: `https://offers.dreamlease.co.uk/b/${'c'.repeat(64)}`, sizeBytes: bytes.byteLength, sha256: 'c'.repeat(64) };
  },
};

/** mode: 'ok' → a PDF; 'html' → non-PDF content; 'blocked' → no bytes (a 403/failed fetch). */
const download = (calls: Calls, mode: 'ok' | 'html' | 'blocked' = 'ok') => async (url: string): Promise<Downloaded> => {
  calls.downloads.push(url);
  if (mode === 'blocked') return { bytes: new ArrayBuffer(0), contentType: null };
  if (mode === 'html') return { bytes: new TextEncoder().encode('<html>').buffer as ArrayBuffer, contentType: 'text/html' };
  return { bytes: pdfBytes(), contentType: 'application/pdf' };
};

const harvester = (plan: Parameters<typeof mockFirecrawl>[0], calls: Calls, extra: { creditCap?: number; downloadOk?: boolean; blocked?: boolean } = {}) =>
  new FirecrawlBrochureSource({
    firecrawl: mockFirecrawl(plan, calls),
    allowlist: ALLOWLIST,
    download: download(calls, extra.blocked ? 'blocked' : extra.downloadOk === false ? 'html' : 'ok'),
    store,
    createdBy: BY,
    now: () => NOW,
    newId: () => 'b0000000-0000-4000-8000-000000000009',
    ...(extra.creditCap ? { creditCap: extra.creditCap } : {}),
  });

const newCalls = (): Calls => ({ search: [], scrape: [], map: [], downloads: [], fetchFile: [] });

describe('FirecrawlBrochureSource', () => {
  it('takes a direct PDF from an allowlisted UK host and ignores a German one', async () => {
    const calls = newCalls();
    const b = await harvester({ search: [{ url: 'https://www.kia.de/brochures/ev3.pdf' }, { url: 'https://www.kia.co.uk/content/dam/ev3-brochure.pdf' }] }, calls).harvest({ make: 'Kia', model: 'EV3' });
    expect(Brochure.parse(b)).toEqual(b);
    expect(b.kind).toBe('pdf');
    expect(b.sourceUrl).toBe('https://www.kia.co.uk/content/dam/ev3-brochure.pdf');
    expect(b.file?.key).toMatch(/^brochures\/[a-f0-9]{64}\.pdf$/);
    expect(b.ukVerified).toEqual({ by: 'content', note: 'kia.co.uk, £ pricing on the first pages' });
    expect(b.vehicleKey).toBe('kia/ev3');
    expect(b.status).toBe('current');
    expect(b.expiresAt).toBe('2026-12-13T09:00:00.000Z');
    expect(calls.downloads).toEqual(['https://www.kia.co.uk/content/dam/ev3-brochure.pdf']);
  });

  it('scrapes a brochure page for its first PDF link and records the domain check only when the content check fails', async () => {
    const calls = newCalls();
    const page = 'https://www.hyundai.co.uk/brochures';
    const b = await harvester({ search: [{ url: page }], links: { [page]: ['https://www.hyundai.co.uk/terms', 'https://assets.hyundai.co.uk/kona-brochure.pdf'] }, pdfText: 'Preise ab €30.000' }, calls).harvest({ make: 'Hyundai', model: 'Kona Electric' });
    expect(b.kind).toBe('pdf');
    expect(b.sourceUrl).toBe('https://assets.hyundai.co.uk/kona-brochure.pdf');
    expect(b.ukVerified.by).toBe('domain');
    expect(calls.scrape[0]).toBe(page);
  });

  it('records a UK request page with no PDF as gated', async () => {
    const calls = newCalls();
    const page = 'https://www.byd.com/uk/brochure-request';
    const b = await harvester({ search: [{ url: page }], links: { [page]: ['https://www.byd.com/uk/privacy'] } }, calls).harvest({ make: 'BYD', model: 'Seal' });
    expect(b.kind).toBe('gated');
    expect(b.file).toBeUndefined();
    expect(b.sourceUrl).toBe(page);
    expect(b.ukVerified.by).toBe('domain');
    expect(Brochure.parse(b)).toEqual(b);
  });

  it('stores a gated page found over http as https (schema is https-only; would 500 on load otherwise)', async () => {
    const calls = newCalls();
    const page = 'http://www.kia.co.uk/request-a-brochure';
    const b = await harvester({ search: [{ url: page }], links: { [page]: ['http://www.kia.co.uk/privacy'] } }, calls).harvest({ make: 'Kia', model: 'EV2' });
    expect(b.kind).toBe('gated');
    expect(b.sourceUrl).toBe('https://www.kia.co.uk/request-a-brochure');
    expect(Brochure.parse(b)).toEqual(b); // https passes the httpsUrl schema
  });

  it('maps the manufacturer site when search finds nothing useful', async () => {
    const calls = newCalls();
    const b = await harvester({ search: [{ url: 'https://www.carwow.co.uk/kia-ev3-brochure.pdf' }], map: ['https://www.kia.co.uk/about', 'https://www.kia.co.uk/brochures/ev3.pdf'] }, calls).harvest({ make: 'Kia', model: 'EV3' });
    expect(b.kind).toBe('pdf');
    expect(calls.map).toEqual(['https://www.kia.co.uk/']);
    expect(calls.downloads).toEqual(['https://www.kia.co.uk/brochures/ev3.pdf']);
  });

  it('gives up cleanly when nothing allowlisted turns up, reporting the credits spent', async () => {
    const calls = newCalls();
    await expect(harvester({ search: [{ url: 'https://www.parkers.co.uk/x.pdf' }] }, calls).harvest({ make: 'Wuling', model: 'Bingo' })).rejects.toThrow(BrochureNotFoundError);
  });

  it('skips a link that does not download as a PDF', async () => {
    const calls = newCalls();
    await expect(harvester({ search: [{ url: 'https://www.kia.co.uk/not-really.pdf' }] }, calls, { downloadOk: false }).harvest({ make: 'Kia', model: 'EV3' })).rejects.toThrow(BrochureNotFoundError);
    expect(calls.fetchFile).toEqual([]); // non-PDF content (not a block) does not trigger the Firecrawl fetch
  });

  it('falls back to a Firecrawl rawBase64 fetch when the direct download is blocked (a CDN 403)', async () => {
    const calls = newCalls();
    const pdf = 'https://www.kia.co.uk/content/dam/ev3-brochure.pdf';
    const b = await harvester({ search: [{ url: pdf }], filePdf: true }, calls, { blocked: true }).harvest({ make: 'Kia', model: 'EV3' });
    expect(b.kind).toBe('pdf');
    expect(b.sourceUrl).toBe(pdf);
    expect(b.file?.sizeBytes).toBeGreaterThan(0);
    expect(calls.downloads).toEqual([pdf]); // direct is tried first
    expect(calls.fetchFile).toEqual([pdf]); // then Firecrawl fetches the bytes
  });

  it('does not spend a Firecrawl credit when the direct download succeeds', async () => {
    const calls = newCalls();
    await harvester({ search: [{ url: 'https://www.kia.co.uk/ev3.pdf' }], filePdf: true }, calls).harvest({ make: 'Kia', model: 'EV3' });
    expect(calls.fetchFile).toEqual([]);
  });

  it('stops spending once the credit cap is reached', async () => {
    const calls = newCalls();
    const page = 'https://www.kia.co.uk/brochures';
    await expect(harvester({ search: [{ url: page }], searchCredits: 15, links: { [page]: ['https://www.kia.co.uk/ev3.pdf'] } }, calls, { creditCap: 15 }).harvest({ make: 'Kia', model: 'EV3' })).rejects.toThrow(BrochureNotFoundError);
    expect(calls.scrape).toEqual([]);
    expect(calls.map).toEqual([]);
  });
});

// ---------- manual ----------

describe('manualBrochure', () => {
  const calls = newCalls();
  const base = { vehicle: { make: 'Kia', model: 'EV3' }, createdBy: BY, download: download(calls), store, now: () => NOW, newId: () => 'b0000000-0000-4000-8000-000000000010' };

  it('stores a PDF link as pdf and a page link as gated', async () => {
    const pdf = await manualBrochure({ ...base, url: 'https://www.kia.co.uk/ev3.pdf' });
    expect(pdf).toMatchObject({ kind: 'pdf', source: 'manual', ukVerified: { by: 'user' } });
    expect(pdf.file?.sizeBytes).toBeGreaterThan(0);
    const gated = await manualBrochure({ ...base, url: 'https://www.kia.co.uk/request-a-brochure' });
    expect(gated.kind).toBe('gated');
    expect(Brochure.parse(gated)).toEqual(gated);
  });

  it('stores an uploaded PDF and rejects non-PDF uploads and http links', async () => {
    const up = await manualBrochure({ ...base, pdf: { bytes: pdfBytes(), contentType: 'application/pdf' } });
    expect(up.kind).toBe('pdf');
    await expect(manualBrochure({ ...base, pdf: { bytes: new TextEncoder().encode('hello').buffer as ArrayBuffer, contentType: 'text/plain' } })).rejects.toThrow(ManualBrochureError);
    await expect(manualBrochure({ ...base, url: 'http://www.kia.co.uk/ev3.pdf' })).rejects.toThrow(ManualBrochureError);
    await expect(manualBrochure({ ...base })).rejects.toThrow(ManualBrochureError);
  });
});

// ---------- ensure (expiry, stale, superseded) ----------

function memoryRepo(seed: BrochureT[] = []): BrochureRepo & { rows: BrochureT[] } {
  const rows = [...seed];
  return {
    rows,
    findCurrent: async (key) => rows.find((b) => b.vehicleKey === key && b.status === 'current'),
    save: async (b) => {
      rows.push(b);
    },
    markSuperseded: async (id) => {
      const b = rows.find((r) => r.id === id);
      if (b) b.status = 'superseded';
    },
  };
}

const stored = (fetchedAt: string, id = 'b0000000-0000-4000-8000-000000000001'): BrochureT => ({
  id,
  vehicleKey: 'kia/ev3',
  title: 'Kia EV3 brochure (UK)',
  kind: 'pdf',
  file: { key: `brochures/${'a'.repeat(64)}.pdf`, url: 'https://offers.dreamlease.co.uk/b/x', sizeBytes: 100, sha256: 'a'.repeat(64) },
  sourceUrl: 'https://www.kia.co.uk/ev3.pdf',
  source: 'harvest',
  ukVerified: { by: 'domain' },
  fetchedAt,
  expiresAt: brochureExpiresAt(new Date(fetchedAt)),
  status: 'current',
  createdBy: BY,
});

describe('ensureBrochure', () => {
  it('uses a stored, unexpired copy and spends nothing', async () => {
    const repo = memoryRepo([stored('2026-09-01T00:00:00.000Z')]);
    const harvest = vi.fn();
    const r = await ensureBrochure({ make: 'Kia', model: 'EV3' }, { repo, harvester: { kind: 'firecrawl', harvest }, now: () => NOW });
    expect(r?.state).toBe('stored');
    expect(harvest).not.toHaveBeenCalled();
  });

  it('re-harvests after 90 days and supersedes the old copy only once the new one is saved', async () => {
    const old = stored('2026-06-01T00:00:00.000Z');
    expect(isBrochureExpired(old, NOW)).toBe(true);
    const repo = memoryRepo([old]);
    const fresh = stored(NOW.toISOString(), 'b0000000-0000-4000-8000-000000000002');
    const r = await ensureBrochure({ make: 'Kia', model: 'EV3' }, { repo, harvester: { kind: 'firecrawl', harvest: async () => fresh }, now: () => NOW });
    expect(r?.state).toBe('fresh');
    expect(r?.brochure.id).toBe(fresh.id);
    expect(repo.rows.find((b) => b.id === old.id)?.status).toBe('superseded');
    expect(repo.rows.find((b) => b.id === fresh.id)?.status).toBe('current');
  });

  it('keeps the old copy, flagged stale, when the re-harvest fails', async () => {
    const old = stored('2026-06-01T00:00:00.000Z');
    const repo = memoryRepo([old]);
    const r = await ensureBrochure(
      { make: 'Kia', model: 'EV3' },
      {
        repo,
        harvester: {
          kind: 'firecrawl',
          harvest: async () => {
            throw new BrochureNotFoundError('nothing', 15);
          },
        },
        now: () => NOW,
      },
    );
    expect(r?.state).toBe('stale');
    expect(r?.brochure.id).toBe(old.id);
    expect(r?.error).toBe('nothing');
    expect(repo.rows[0]?.status).toBe('current');
  });

  it('returns nothing when there is no copy and the harvest finds nothing', async () => {
    const r = await ensureBrochure(
      { make: 'Kia', model: 'EV3' },
      {
        repo: memoryRepo(),
        harvester: {
          kind: 'firecrawl',
          harvest: async () => {
            throw new BrochureNotFoundError('nothing', 3);
          },
        },
        now: () => NOW,
      },
    );
    expect(r).toBeUndefined();
  });
});

describe('ukContentCheck', () => {
  it('wants sterling or OTR and no euro sign', () => {
    expect(ukContentCheck('From £29,995')).toBe(true);
    expect(ukContentCheck('OTR price list')).toBe(true);
    expect(ukContentCheck('ab €30.000')).toBe(false);
    expect(ukContentCheck('£30,000 or €35,000')).toBe(false);
    expect(ukContentCheck('no prices here')).toBe(false);
  });
});
