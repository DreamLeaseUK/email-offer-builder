export * from './types.js';

// url OfferSource (brief §5.3)
export { parseOfferUrl, canonicalOfferUrl, OfferUrlError, SITE_ORIGIN } from './url/normalise.js';
export type { OfferUrl, LeaseConfig, LookupContractType } from './url/normalise.js';
export { parseOfferPage, OfferPageError } from './url/parse-page.js';
export type { PageData, PageStat, HtmlRewriterCtor, HtmlRewriterLike } from './url/parse-page.js';
export { pricingUrl, parsePricingResponse, PricingError, FINANCE_TYPE } from './url/pricing.js';
export type { PricingResult, PricingOptions, PricedOffer, LeaseOption } from './url/pricing.js';
export { buildOffer, endOfMonth, mapStats, resolveBadge, OfferBuildError } from './url/build-offer.js';
export type { BuildOfferInput } from './url/build-offer.js';
export { UrlOfferSource, LookupError, LOOKUP_CACHE_TTL_MS } from './url/url-source.js';
export type { LookupInput, LookupResult, LookupCache, ImageStore, HtmlFallback, UrlSourceDeps } from './url/url-source.js';

// Firecrawl (the one metered service)
export { createFirecrawlClient, FirecrawlError } from './firecrawl/client.js';
export type { FirecrawlClient, FirecrawlSearchHit } from './firecrawl/client.js';

// brochures (brief §5.8)
export { matchAllowlist, isAllowlisted, manufacturerEntry, entryUrl } from './brochure/allowlist.js';
export type { AllowlistMatch } from './brochure/allowlist.js';
export {
  FirecrawlBrochureSource,
  BrochureNotFoundError,
  manualBrochure,
  ManualBrochureError,
  brochureExpiresAt,
  isBrochureExpired,
  isPdfUrl,
  looksLikePdf,
  ukContentCheck,
  MAX_PDF_BYTES,
} from './brochure/harvest.js';
export type { HarvestDeps, BrochureStore, Downloaded, ManualBrochureInput } from './brochure/harvest.js';
export { ensureBrochure } from './brochure/ensure.js';
export type { BrochureRepo, EnsureResult, EnsureDeps } from './brochure/ensure.js';
