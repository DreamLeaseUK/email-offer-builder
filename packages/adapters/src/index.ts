export * from './types.js';

// url OfferSource (brief §5.3)
export { parseOfferUrl, canonicalOfferUrl, OfferUrlError, SITE_ORIGIN } from './url/normalise.js';
export type { OfferUrl, LeaseConfig, LookupContractType } from './url/normalise.js';
export { parseOfferPage, OfferPageError } from './url/parse-page.js';
export type { PageData, PageStat, HtmlRewriterCtor, HtmlRewriterLike } from './url/parse-page.js';
export { pricingUrl, parsePricingResponse, PricingError, FINANCE_TYPE, PRICING_VERSION } from './url/pricing.js';
export type { PricingResult, PricingOptions, PricedOffer, LeaseOption, PricingUrlOptions } from './url/pricing.js';
export { buildOffer, endOfMonth, mapStats, resolveBadge, OfferBuildError } from './url/build-offer.js';
export type { BuildOfferInput } from './url/build-offer.js';
export { UrlOfferSource, LookupError, LOOKUP_CACHE_TTL_MS } from './url/url-source.js';
export type { LookupInput, LookupResult, LookupCache, ImageStore, HtmlFallback, UrlSourceDeps } from './url/url-source.js';

// Firecrawl (the one metered service)
export { createFirecrawlClient, FirecrawlError } from './firecrawl/client.js';
export type { FirecrawlClient, FirecrawlSearchHit } from './firecrawl/client.js';

// brochures (brief §5.8; discovery = the finder, docs/brochure-finder-brief.md)
export { findBrochure, FINDER_VERSION, docType, publicDocType, editionDate, urlDate, isEnglish, isEuropeanMarket, isRestOfWorld, isOtherMarket, labelledLinks, isOfficialHost, ukMarker, ukPathOnOfficial, isJunkHost, looksLikePdfUrl, modelVariants, modelMatcher, modelHint, namesAnotherModel, pdfUrlsInHtml } from './brochure/finder.js';
export type { FinderDeps, FinderHttp, FinderResult, LabelledLink, RawDocType } from './brochure/finder.js';
export {
  FirecrawlBrochureSource,
  acceptSearchOutcome,
  acceptEuropeanOffer,
  isEuropeanOffer,
  EUROPEAN_OFFER,
  toSearchRecord,
  retrievePdf,
  manualBrochure,
  ManualBrochureError,
  brochureExpiresAt,
  isBrochureExpired,
  isPdfUrl,
  looksLikePdf,
  toHttps,
  MAX_PDF_BYTES,
} from './brochure/harvest.js';
export type { HarvestDeps, BrochureStore, Downloaded, ManualBrochureInput } from './brochure/harvest.js';
export { ensureBrochure, isEditionTooOld } from './brochure/ensure.js';
export type { BrochureRepo, EnsureResult, EnsureDeps } from './brochure/ensure.js';

// Microsoft 365: send from the salesperson's own mailbox (Phase 1, docs/evolution.md §6)
export { createM365Client, M365Error, M365_SCOPES, isSameMailbox, newPkce, randomToken } from './m365/client.js';
export type { M365Client, M365Config, M365ErrorCode, M365Me, MailMessage, TokenSet } from './m365/client.js';
export { createM365Output } from './m365/output.js';
export type { M365OutputDeps } from './m365/output.js';
