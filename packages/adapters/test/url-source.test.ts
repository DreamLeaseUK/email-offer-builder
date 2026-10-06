import { describe, expect, it, vi } from 'vitest';
import { findCapIdLeak } from '@offer-mailer/schema';
import type { OfferImage } from '@offer-mailer/schema';
import { LookupError, OfferUrlError, PRICING_VERSION, UrlOfferSource } from '../src/index.js';
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

  it("sends the page's special-offer id with the pricing request (the site answers POA without it, 6 Oct 2026)", async () => {
    const fetch = fakeFetch();
    await source({ fetch }).lookupFull({ url: PAGE, createdBy: BY });
    const calls = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => String(c[0]));
    const pricing = calls.find((u) => u.includes('/GetOfferDropdownsForCar'));
    expect(new URL(pricing!).searchParams.get('offerId')).toBe('564851');
  });

  it('stamps the pricing version, and looks again instead of serving a cached result priced the old way', async () => {
    const cache = memoryCache();
    const first = await source({ cache }).lookupFull({ url: PAGE, createdBy: BY });
    expect(first.offer.source.pricingVersion).toBe(PRICING_VERSION);
    expect((await source({ cache }).lookupFull({ url: PAGE, createdBy: BY })).cached).toBe(true);
    // a result cached before 6 Oct 2026 has no version: its price may be the ordinary one, not the special offer's
    const [key, value] = [...cache.store.entries()][0]!;
    const { pricingVersion: _v, ...oldSource } = value.offer.source;
    cache.store.set(key, { ...value, offer: { ...value.offer, source: oldSource } });
    const again = await source({ cache }).lookupFull({ url: PAGE, createdBy: BY });
    expect(again.cached).toBe(false);
    expect(again.offer.source.pricingVersion).toBe(PRICING_VERSION);
  });

  it("warns when the price service disagrees with the price the offer page publishes (the page's lowPrice)", async () => {
    // the fixtures agree (347.80 both): no warning, as the first test shows; a page now publishing 299.00 does not
    const base = fakeFetch();
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const res = await base(input);
      if (!String(input).startsWith('https://www.dreamlease.co.uk/offers/')) return res;
      return new Response((await res.text()).replace('"lowPrice": "347.80"', '"lowPrice": "299.00"'), { status: 200, headers: { 'content-type': 'text/html' } });
    }) as unknown as typeof globalThis.fetch;
    const r = await source({ fetch }).lookupFull({ url: PAGE, createdBy: BY });
    expect(r.offer.pricing.monthly).toBe(347.8);
    expect(r.warnings).toEqual(['The offer page shows £299.00 a month, but the website\'s price service gave £347.80. Check the price on the offer page before you send.']);
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

  it('says an ended offer has gone when the site sends its link to a listing page', async () => {
    // the site's listing page carries window.motorleaseInit settings, but no car
    const listing = '<html><script>window.motorleaseInit = window.motorleaseInit || {}; window.motorleaseInit.specialOfferLabel = "Special offer";</script></html>';
    const redirected = vi.fn(async () => Object.defineProperty(new Response(listing, { status: 200, headers: { 'content-type': 'text/html' } }), 'url', { value: 'https://www.dreamlease.co.uk/volkswagen-car-lease-deals/?x=1' })) as unknown as typeof fetch;
    const fetchHtml = vi.fn(async () => listing);
    const err = await source({ fetch: redirected, fallback: { fetchHtml } }).lookup({ url: PAGE, createdBy: BY }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LookupError);
    expect((err as Error).message).toBe('This offer is no longer on the website: the link now opens https://www.dreamlease.co.uk/volkswagen-car-lease-deals/. It has probably ended. Paste the link of a current offer from dreamlease.co.uk.');
    // the site answered: the fallback fetcher would only be sent to the same listing, so it is not paid for
    expect(fetchHtml).not.toHaveBeenCalled();
    // reached through the fallback (the direct fetch refused), the same answer without the address
    await expect(source({ fetch: fakeFetch({ pageStatus: 403 }), fallback: { fetchHtml } }).lookup({ url: PAGE, createdBy: BY })).rejects.toThrow(/no longer on the website: the link now opens a page with no car on it/);
  });

  it('rejects URLs that are not offer pages before touching the network', async () => {
    const fetch = fakeFetch();
    await expect(source({ fetch }).lookup({ url: 'https://www.dreamlease.co.uk/hubs/in-stock/', createdBy: BY })).rejects.toThrow(OfferUrlError);
    expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });
});
