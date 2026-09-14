import { describe, expect, it, vi } from 'vitest';
import { findCapIdLeak } from '@offer-mailer/schema';
import type { OfferImage } from '@offer-mailer/schema';
import { LookupError, OfferUrlError, UrlOfferSource } from '../src/index.js';
import type { LookupCache, LookupResult } from '../src/index.js';
import { BY, KNOWN_BADGES, NOW, Rewriter, fixture } from './helpers.js';

const PAGE = 'https://www.dreamlease.co.uk/offers/personal/byd-seal-390kw-excellence-83kwh-awd-102n/?initialRental=12&contractLength=48&annualMileage=6000&includeMaintenance=false';

const image: OfferImage = { key: `vehicles/${'a'.repeat(64)}.jpg`, url: `https://offers.dreamlease.co.uk/i/vehicles/${'a'.repeat(64)}.jpg`, alt: 'BYD Seal', width: 1200, height: 900 };

function fakeFetch(opts: { pageStatus?: number; pricingStatus?: number } = {}): typeof fetch {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes('/api/carresults/GetOfferDropdownsForCar')) {
      return new Response(opts.pricingStatus && opts.pricingStatus !== 200 ? 'nope' : fixture('pricing-personal.json'), { status: opts.pricingStatus ?? 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.startsWith('https://www.dreamlease.co.uk/offers/')) {
      return new Response(opts.pageStatus && opts.pageStatus !== 200 ? 'blocked' : fixture('offer-page-personal.html'), { status: opts.pageStatus ?? 200, headers: { 'content-type': 'text/html' } });
    }
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
}

function memoryCache(): LookupCache & { store: Map<string, LookupResult> } {
  const store = new Map<string, LookupResult>();
  return {
    store,
    get: async (k) => store.get(k),
    set: async (k, v) => {
      store.set(k, v);
    },
  };
}

const source = (over: Partial<ConstructorParameters<typeof UrlOfferSource>[0]> = {}) =>
  new UrlOfferSource({ fetch: fakeFetch(), HTMLRewriter: Rewriter, knownBadges: KNOWN_BADGES, now: () => NOW, newId: () => 'd6f2a1c4-2b7e-4c1f-9a3d-5e6f7a8b9c0d', ...over });

describe('UrlOfferSource', () => {
  it('fetches, parses, prices, stores the image and returns a validated offer with chip options', async () => {
    const store = vi.fn(async () => image);
    const r = await source({ images: { store } }).lookupFull({ url: PAGE, createdBy: BY });
    expect(r.cached).toBe(false);
    expect(r.offer.vehicle.model).toBe('Seal');
    expect(r.offer.pricing.monthly).toBe(347.8);
    expect(r.offer.image).toEqual(image);
    expect(r.options.contractLength.map((o) => o.value)).toContain(36);
    expect(r.warnings).toEqual([]);
    expect(store).toHaveBeenCalledWith('https://images.example.invalid/vehicle.webp?viewPoint=1', 'BYD Seal');
  });

  it('never lets the site image URL or a CAP ID into the result', async () => {
    const r = await source({ images: { store: async () => image } }).lookupFull({ url: PAGE, createdBy: BY });
    expect(findCapIdLeak(r)).toBeNull();
    expect(JSON.stringify(r)).not.toMatch(/images\.example\.invalid|000000/);
  });

  it('warns instead of failing when the image cannot be stored', async () => {
    const r = await source({ images: { store: async () => undefined } }).lookupFull({ url: PAGE, createdBy: BY });
    expect(r.offer.image).toBeUndefined();
    expect(r.warnings[0]).toMatch(/image/);
    const r2 = await source({
      images: {
        store: async () => {
          throw new Error('boom');
        },
      },
    }).lookupFull({ url: PAGE, createdBy: BY });
    expect(r2.warnings[0]).toMatch(/image/);
  });

  it('serves the second lookup from the cache, stamped with the new requester', async () => {
    const cache = memoryCache();
    const fetch = fakeFetch();
    const s = new UrlOfferSource({ fetch, HTMLRewriter: Rewriter, knownBadges: KNOWN_BADGES, cache, now: () => NOW });
    const first = await s.lookupFull({ url: PAGE, createdBy: BY });
    expect(first.cached).toBe(false);
    expect(cache.store.size).toBe(1);
    const second = await s.lookupFull({ url: `${PAGE}&utm_source=email`, createdBy: 'matt.wilson@dreamlease.co.uk' });
    expect(second.cached).toBe(true);
    expect(second.offer.id).toBe(first.offer.id);
    expect(second.offer.createdBy).toBe('matt.wilson@dreamlease.co.uk');
    expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  });

  it('falls back to the alternative fetcher when the direct fetch is refused', async () => {
    const fetchHtml = vi.fn(async () => fixture('offer-page-personal.html'));
    const r = await source({ fetch: fakeFetch({ pageStatus: 403 }), fallback: { fetchHtml } }).lookupFull({ url: PAGE, createdBy: BY });
    expect(fetchHtml).toHaveBeenCalledTimes(1);
    expect(r.offer.vehicle.make).toBe('BYD');
  });

  it('fails clearly when the page or the pricing service cannot be read', async () => {
    await expect(source({ fetch: fakeFetch({ pageStatus: 503 }) }).lookupFull({ url: PAGE, createdBy: BY })).rejects.toThrow(LookupError);
    await expect(source({ fetch: fakeFetch({ pricingStatus: 500 }) }).lookupFull({ url: PAGE, createdBy: BY })).rejects.toThrow(/pricing service/);
  });

  it('rejects URLs that are not offer pages before touching the network', async () => {
    const fetch = fakeFetch();
    await expect(source({ fetch }).lookup({ url: 'https://www.dreamlease.co.uk/hubs/in-stock/', createdBy: BY })).rejects.toThrow(OfferUrlError);
    expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });
});
