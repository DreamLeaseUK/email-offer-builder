/**
 * Brochure finder — replaces the static manufacturer allowlist (docs/brochure-finder-brief.md, revised 17–18 Sept 2026).
 *
 * No per-brand configuration. The official UK site is discovered from the search results (the registrable
 * label IS the brand), the finder opens that site's brochure / downloads / price pages and reads each link's
 * own text, and nothing becomes attachable until the document itself has been read and passes the checks:
 * make and model in the text, UK evidence, not euro-only, an established document type, and an edition date
 * inside the age limit. A rejected or unreachable search attaches nothing and says why.
 *
 *   verified_pdf           a current official UK PDF (the caller still has to retrieve the bytes)
 *   verified_web_brochure  the manufacturer's own web brochure, linked from its UK site
 *   official_page_only     an official page that holds the document, but the asset is protected or is a price page
 *   brochure_request       the official site only offers a request-a-brochure form
 *   not_verified           searched properly, nothing passed
 *   search_failed          the search itself did not complete; never cached as a negative
 *
 * Two tiers (Matt, 21 Sept 2026). The target is the UK edition. When nothing UK verifies, the fallback is the
 * manufacturer's own EUROPEAN brochure, as long as it is in English: same official source, same model, type
 * and age checks, but the UK evidence is replaced by "the document or its address says Europe" plus a language
 * check. It comes back as verified_pdf / verified_web_brochure with market 'eu' and the flag european_edition,
 * so the salesperson and the email can say what it is. A European price & spec guide is never used (not the UK's
 * prices or trims), and the rest of the world (US, Australia, Asia…) is never a source.
 *
 * finder-1.4 (Matt, 21 Sept 2026: "you are not leveraging Firecrawl capability to its optimum"). Discovery was
 * doing the judging: documents were thrown away on their title, file name or score before anything had looked at
 * the page a person would use. Now: SEARCH discovers, MAP finds the model's page and the site's brochure pages,
 * the model's page is OPERATED first (operate.ts: rendered links, pressed controls, the files they fetch), the
 * page a document came from is carried as evidence (a file reached from the model's page need not name the
 * model), and the strict checks run only once a document is in hand. A search that never reached a page of the
 * official site is a discovery miss, not "no brochure", and is not remembered.
 *
 * Pure: Firecrawl and plain HTTP are injected. Proven against 32 hand-checked models before it was ported.
 */
import { BROCHURE_MAX_AGE_MONTHS, BROCHURE_MAX_AGE_MONTHS_OFFICIAL } from '@offer-mailer/schema';
import type { BrochureCandidateTrace, BrochureDocumentType, BrochureFinderStatus, BrochureMarket, Vehicle } from '@offer-mailer/schema';
import type { FirecrawlClient, FirecrawlSearchHit } from '../firecrawl/client.js';
import { OPERATE_ACTIONS, parseOperated } from './operate.js';
import type { OperatedPage } from './operate.js';

/** Bumped when the rules change: a remembered "nothing found" from an older version is searched again. */
export const FINDER_VERSION = 'finder-1.4';

/** A plain GET that follows redirects. Resolves undefined when the request could not be made at all. */
export type FinderHttp = (url: string) => Promise<{ status: number; contentType: string; finalUrl: string; /** The Last-Modified header, when the server sends one. */ lastModified?: string; text(): Promise<string> } | undefined>;

export interface FinderDeps {
  firecrawl: FirecrawlClient;
  http: FinderHttp;
  now?: () => Date;
  /** Firecrawl credits per search before the finder stops opening things. */
  creditCap?: number;
}

export interface FinderResult {
  status: BrochureFinderStatus;
  documentType?: BrochureDocumentType | 'brochure_request_form';
  /** Set when something verified: uk, or eu for the European English-language fallback. */
  market?: BrochureMarket;
  /** What the outcome points at: the PDF, the web brochure, the official page, or the request form. */
  url?: string;
  assetUrl?: string;
  assetRetrievable?: boolean;
  /** The page a document link was found on. */
  fromPage?: string;
  editionDate?: string;
  reason?: string;
  flags: string[];
  officialSite?: string;
  officialWhy?: string[];
  /** False when no page of the official site was ever opened: a discovery miss, not "no brochure". */
  exhausted?: boolean;
  queries: string[];
  pagesOpened: string[];
  candidates: BrochureCandidateTrace[];
  credits: number;
  durationMs: number;
}

// ---------- vocabulary ----------

/** Aggregators, document-sharing sites and marketplaces: never a source, whatever they host. */
const JUNK_HOSTS = ['scribd.com', 'carwow.co.uk', 'autocatalogarchive.com', 'auto-brochures.com', 'motaclarity.co.uk', 'pentagon-group.co.uk', 'yumpu.com', 'issuu.com', 'slideshare.net', 'manualslib.com', 'brochureshub.com', 'ebay.co.uk', 'device.report', 'carmans.net', 'pdfcoffee.com', 'sgcarmart.com', 'youtube.com', 'linkedin.com', 'facebook.com'];
/** Markets outside Europe: never a source, whatever the language. */
const REST_OF_WORLD = /(\.co\.za|\.com\.au|\.com\.my|\.co\.nz|\.in(\/|$)|\/(za|au|nz|my|us|sg|ae|mo|id)(\/|$)|en_us|en_mo|[-_](au|nz|za|sg|th|us)[-_./]|anz\.|australia|new[-_]?zealand|south[-_]?africa|singapore|malaysia|[-_/](usa|canada|india|china|japan|korea|thailand|mexico|brazil|uae|apac|latam|mena)[-_./])/i;
/** European markets other than the UK: the fallback tier, and only in English. Ireland is the likeliest source. */
const EUROPE = /(\.ie(\/|$)|\/(ie|eu|fr|de|europe|en[-_]eu)(\/|$)|[-_](eu|europe|ie)[-_./])/i;
const EUROPEAN_COUNTRIES = new Set(['at', 'be', 'bg', 'ch', 'cy', 'cz', 'de', 'dk', 'ee', 'es', 'eu', 'fi', 'fr', 'gr', 'hr', 'hu', 'ie', 'is', 'it', 'li', 'lt', 'lu', 'lv', 'mt', 'nl', 'no', 'pl', 'pt', 'ro', 'se', 'si', 'sk']);
const OLD = /histor|archive|used-cars|\/used\//i;
/** The country of every locale path segment that is not the UK's: /de_de/ → de, /en_us/ → us. */
const localeCountries = (u: string): string[] => [...u.toLowerCase().matchAll(/\/([a-z]{2})[_-]([a-z]{2})(?=\/|$)/g)].map((m) => m[2] ?? '').filter((c) => c !== 'gb' && c !== 'uk');
export const isRestOfWorld = (u: string): boolean => REST_OF_WORLD.test(u) || localeCountries(u).some((c) => !EUROPEAN_COUNTRIES.has(c));
export const isEuropeanMarket = (u: string): boolean => !isRestOfWorld(u) && (EUROPE.test(u) || localeCountries(u).some((c) => EUROPEAN_COUNTRIES.has(c)));
/** Not the UK's: either of the above. A European URL is kept for the fallback tier; the rest of the world is dropped. */
export const isOtherMarket = (u: string): boolean => isRestOfWorld(u) || isEuropeanMarket(u);
/** The fallback's own search, run only when the first searches turned up no European document at all. Ireland is the likeliest English-language source. */
const EUROPEAN_QUERY = (make: string, model: string): string => `${make} ${model} brochure Ireland Europe`;
/** Sales flows that sit on pricing pages but are not documents. */
const NOT_A_DOCUMENT = /configur|build[-_ ]?(and|&)?[-_ ]?price|build[-_ ]your|finance[-_ ]calc|test[-_ ]drive|find[-_ ]a[-_ ](dealer|retailer)|offers?\b/i;
/** Request / contact destinations: never a brochure. A brochure request needs this AND the word brochure. */
const REQUESTY = /request|enquir|call[-_ ]?(me[-_ ]?)?back|appointment|contact|book[-_ ]a|keep[-_ ]me|order[-_ ]a[-_ ]brochure|brochure[-_ ]order/i;

// ---------- small pure helpers (exported for tests) ----------

export const fold = (s: string | undefined): string => (s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export const norm = (s: string | undefined): string => fold(s).replace(/[^a-z0-9]+/g, '');

const parse = (u: string): URL | undefined => {
  try {
    return new URL(u);
  } catch {
    return undefined;
  }
};
export const hostOf = (u: string): string => parse(u)?.hostname.replace(/^www\./, '') ?? '';
export const isJunkHost = (u: string): boolean => JUNK_HOSTS.some((j) => hostOf(u) === j || hostOf(u).endsWith(`.${j}`));
/** Some manufacturers serve PDFs from URLs that end "…Brochurepdf" with no dot. */
export const looksLikePdfUrl = (u: string): boolean => /\.?pdf$/i.test(parse(u)?.pathname ?? '');

/** A UK host, or a UK path segment. Host-agnostic: used to find the official UK site among search results. */
export function ukMarker(u: string): boolean {
  const x = parse(u);
  return !!x && (/\.uk$/.test(x.hostname) || /(^|\/)(uk|en_gb|en-gb|gb)(\/|$)/i.test(x.pathname));
}

/**
 * Official = the registrable label IS the brand, optionally with a generic suffix (xpengcars, omodaauto,
 * cupraofficial). Dealers (berrycroydonbmw), press sites (kiapressoffice) and vans sites fail this.
 */
const HOST_SUFFIXES = ['cars', 'auto', 'uk', 'gb', 'motors', 'motor', 'carsuk', 'official', 'automobiles', 'motorcars', 'global', 'ev', 'europe'];
const HOST_PREFIXES = ['saic', 'my', 'the'];
export function isOfficialHost(u: string, make: string, model?: string): boolean {
  const label = norm(hostOf(u).replace(/\.(co\.uk|com|net|org|uk|eu|ie)$/, '').split('.').pop());
  const brand = norm(make);
  const aliases = brand === 'volkswagen' ? [brand, 'vw'] : [brand];
  // dsautomobiles, rolls-roycemotorcars, saicmaxus, and a marque that trades under its model (ineosgrenadier)
  const tails = model ? [...HOST_SUFFIXES, norm(model)] : HOST_SUFFIXES;
  return aliases.some((a) => label === a || tails.some((t) => label === a + t) || HOST_PREFIXES.some((p) => label === p + a));
}

/** Looser UK path markers ("/byd-uk/", "/mazdauk/") count only on an official host. */
export function ukPathOnOfficial(u: string, make: string): boolean {
  const x = parse(u);
  return !!x && isOfficialHost(u, make) && (ukMarker(u) || /(^|[/-])uk\//i.test(x.pathname) || /[a-z]uk\//i.test(x.pathname));
}

export type RawDocType = 'brochure' | 'price-guide' | 'spec' | 'manual' | 'unknown';

/** What a link or a document says it is. Anything that is not sales literature comes back 'manual' and is dropped. */
export function docType(text: string): RawDocType {
  const t = fold(text);
  if (/(owner'?s? ?manual|handbook|user manual|view manual|warranty|getting.started|quick.?(start|guide)|rescue sheet|emergency|response sheet|service.?guide|accessor|press.?(pack|kit)|slavery|tax strategy|carbon)/.test(t)) return 'manual';
  if (/(motability|terms|t ?& ?cs?\b|\btcs?\b|tandc|conditions|\boffers?\b|savings|gender|pay gap|accessibility|roadside|insurance|privacy|cookie|policy|home ?charg|charger|finance|complaint|recall|annual report)/.test(t)) return 'manual';
  if (/brochure/.test(t) && !/price/.test(t)) return 'brochure';
  if (/price/.test(t) && /(guide|list|spec)/.test(t)) return 'price-guide';
  if (/(spec|leaflet|technical data)/.test(t)) return 'spec';
  if (/brochure/.test(t)) return 'brochure';
  return 'unknown';
}

export const publicDocType = (dt: RawDocType): BrochureDocumentType | undefined => (dt === 'brochure' ? 'brochure' : dt === 'price-guide' || dt === 'spec' ? 'price_spec_guide' : undefined);

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

function textDate(text: string, now: Date): Date | undefined {
  const found: Date[] = [];
  const t = fold(text);
  for (const m of t.matchAll(/(?:(\d{1,2})(?:st|nd|rd|th)?\s+)?(january|february|march|april|may|june|july|august|september|october|november|december)\s+(20\d{2})/g)) {
    found.push(new Date(Date.UTC(Number(m[3]), MONTHS.indexOf(m[2] ?? ''), Number(m[1] ?? 1))));
  }
  for (const m of t.matchAll(/\b(\d{1,2})[./](\d{1,2})[./](20\d{2})\b/g)) found.push(new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]))));
  const horizon = now.getTime() + 120 * 864e5;
  const ok = found.filter((d) => !Number.isNaN(d.getTime()) && d.getTime() <= horizon && d.getUTCFullYear() >= 2015);
  return ok.length ? new Date(Math.max(...ok.map((d) => d.getTime()))) : undefined;
}

export function urlDate(url: string, now: Date): Date | undefined {
  const u = url.toLowerCase();
  const a = u.match(/\/(20\d{2})[-/](\d{2})\//);
  if (a) return new Date(Date.UTC(Number(a[1]), Number(a[2]) - 1, 1));
  const b = u.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[-_ ]?(20)?(\d{2})(?!\d)/);
  if (b) return new Date(Date.UTC(2000 + Number(b[3]), MONTHS.findIndex((x) => x.startsWith(b[1] ?? '~')), 1));
  // CMS asset names (Polestar's "1775572382-fleet_polestar-2_brochure_my27_eu_260402.pdf"): an upload
  // timestamp in front, and a compact edition date (YYMMDD, YYYYMMDD or YYYYMM) in the name
  const file = (u.split(/[?#]/)[0] ?? '').split('/').pop() ?? '';
  const found: Date[] = [];
  const epoch = file.match(/^(\d{10})(\d{3})?(?!\d)/);
  if (epoch) found.push(new Date(Number(epoch[1]) * 1000));
  for (const m of file.matchAll(/(?<!\d)(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])?(?!\d)/g)) found.push(new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3] ?? 1))));
  for (const m of file.matchAll(/(?<!\d)(\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?!\d)/g)) found.push(new Date(Date.UTC(2000 + Number(m[1]), Number(m[2]) - 1, Number(m[3]))));
  const horizon = now.getTime() + 120 * 864e5;
  const ok = found.filter((d) => !Number.isNaN(d.getTime()) && d.getTime() <= horizon && d.getUTCFullYear() >= 2015);
  return ok.length ? new Date(Math.max(...ok.map((d) => d.getTime()))) : undefined;
}

/**
 * The edition date is the NEWEST of what the text says and what the URL says: manufacturers reuse a file
 * name for a year (Ford's "…october-2025.pdf" was reissued in August 2026) and quote old dates in footnotes
 * (MG's January 2026 brochure mentions June 2025).
 */
export function editionDate(text: string, url: string, now: Date): { date: Date; from: 'text' | 'url' } | undefined {
  const a = textDate(text, now);
  const b = urlDate(url, now);
  if (a && b) return a > b ? { date: a, from: 'text' } : { date: b, from: 'url' };
  return a ? { date: a, from: 'text' } : b ? { date: b, from: 'url' } : undefined;
}

export const monthsOld = (d: Date, now: Date): number => (now.getTime() - d.getTime()) / (30.44 * 864e5);

/**
 * Function words, accents folded. A language is recognised by how much of the text is made of its own small
 * words; English has to be clearly ahead of every other language, so a bilingual brochure does not pass.
 */
const FUNCTION_WORDS: Record<string, string[]> = {
  en: ['the', 'and', 'of', 'to', 'with', 'for', 'your', 'you', 'that', 'this', 'from', 'are', 'is', 'by', 'as', 'it', 'can', 'more', 'our', 'has', 'have', 'which', 'will', 'its', 'all', 'when', 'not'],
  de: ['der', 'die', 'das', 'und', 'mit', 'fur', 'ist', 'ein', 'eine', 'den', 'von', 'zu', 'auf', 'sie', 'nicht', 'auch', 'sich', 'des', 'dem', 'im', 'oder', 'werden', 'ihr', 'ihre', 'bei', 'wird', 'sind', 'einer', 'uber'],
  fr: ['le', 'la', 'les', 'des', 'du', 'et', 'en', 'un', 'une', 'est', 'pour', 'que', 'qui', 'dans', 'sur', 'avec', 'vous', 'votre', 'au', 'aux', 'par', 'ce', 'pas', 'sont', 'ou'],
  es: ['el', 'la', 'los', 'las', 'de', 'del', 'en', 'un', 'una', 'que', 'es', 'para', 'con', 'por', 'su', 'se', 'al', 'mas', 'como', 'tu', 'sus', 'lo'],
  it: ['il', 'lo', 'la', 'gli', 'le', 'di', 'del', 'della', 'che', 'un', 'una', 'per', 'con', 'non', 'sono', 'piu', 'da', 'al', 'alla', 'dei', 'nel', 'si', 'ed'],
  nl: ['de', 'het', 'een', 'van', 'en', 'met', 'voor', 'op', 'te', 'zijn', 'dat', 'die', 'niet', 'ook', 'uw', 'naar', 'bij', 'door', 'aan', 'om', 'als', 'wordt', 'kan', 'uit'],
  sv: ['och', 'att', 'det', 'som', 'en', 'pa', 'ar', 'av', 'med', 'den', 'till', 'har', 'inte', 'om', 'ett', 'din', 'du', 'kan', 'fran', 'eller'],
  da: ['og', 'det', 'som', 'en', 'pa', 'er', 'af', 'av', 'med', 'den', 'til', 'har', 'ikke', 'om', 'et', 'din', 'du', 'kan', 'fra', 'eller', 'der'],
  pl: ['na', 'do', 'nie', 'sie', 'jest', 'ze', 'oraz', 'dla', 'od', 'po', 'przez', 'jak', 'lub', 'tym', 'ale', 'czy'],
  pt: ['de', 'da', 'dos', 'das', 'que', 'em', 'um', 'uma', 'para', 'com', 'nao', 'por', 'os', 'se', 'mais', 'ao', 'sua', 'seu', 'ou', 'como'],
};
const FUNCTION_WORD_SETS = Object.entries(FUNCTION_WORDS).map(([lang, words]) => [lang, new Set(words)] as const);

/** Is this document's running text English? Needs real prose (60+ words); a bare table of figures is "cannot tell" = no. */
export function isEnglish(text: string): boolean {
  const tokens = fold(text).match(/[a-z]{2,}/g) ?? [];
  if (tokens.length < 60) return false;
  const share = (set: Set<string>) => tokens.filter((t) => set.has(t)).length / tokens.length;
  let en = 0;
  let other = 0;
  for (const [lang, set] of FUNCTION_WORD_SETS) {
    if (lang === 'en') en = share(set);
    else other = Math.max(other, share(set));
  }
  return en >= 0.05 && en >= 2 * other;
}

export interface LabelledLink {
  /** The nearest heading above the link: on a page of many models it says which car a bare "Download" belongs to. */
  heading?: string;
  /** The words between the previous link and this one: what a bare "Download" is a download OF. */
  lead: string;
  url: string;
  /** The link's own text: the only thing a document type is read from. */
  own: string;
  /** The text around it: used only to tell which model a link belongs to. */
  context: string;
}

/** Markdown links, each with its own text kept apart from the surrounding text. */
export function labelledLinks(md: string, baseUrl: string): LabelledLink[] {
  const out: LabelledLink[] = [];
  const parts = md.split('](');
  const clean = (s: string) => s.replace(/!\[[^\]]*$/g, '').replace(/https?:\/\/\S+/g, ' ').replace(/[\\*[\]#>_|]+/g, ' ').replace(/\s+/g, ' ').trim();
  for (let i = 1; i < parts.length; i++) {
    const raw = (parts[i] ?? '').split(')')[0]?.split(' ')[0] ?? '';
    let url: string;
    try {
      url = new URL(raw, baseUrl).href;
    } catch {
      continue;
    }
    if (/\.(png|jpe?g|webp|svg|gif)(\?|$)/i.test(url)) continue;
    const prev = parts[i - 1] ?? '';
    const lb = prev.lastIndexOf('[');
    const own = clean(lb >= 0 ? prev.slice(lb + 1) : prev.replace(/^[^)]*\)/, '')).slice(-120);
    const before = md.slice(0, md.indexOf(prev) + Math.max(lb, 0));
    const heading = [...before.slice(-1500).matchAll(/^#{1,6}\s+(.+)$/gm)].pop()?.[1];
    const lead = clean((lb >= 0 ? prev.slice(0, lb) : '').replace(/^[^)]*\)/, '')).slice(-140);
    out.push({ url, own, context: clean(prev.slice(-300)).slice(-160), lead, ...(heading ? { heading: clean(heading).slice(0, 120) } : {}) });
  }
  return out;
}

/**
 * PDF addresses in a page's raw HTML, including the ones only its embedded data carries. Geely's UK model page
 * offers "Download Geely EX2 Brochure" as a BUTTON, not a link: the markdown has no link to read, and the file's
 * address sits in the page's JSON with its slashes escaped ("\u002F-\u002Fmedia\u002F…brochure.pdf"). A salesperson found
 * it in 30 seconds; the finder, reading links only, saw nothing (Matt, 21 Sept 2026).
 */
export function pdfUrlsInHtml(html: string, baseUrl: string): string[] {
  const text = html.replace(/\\u002[fF]/g, '/').replace(/\\\//g, '/').replace(/&amp;/g, '&');
  const out = new Set<string>();
  for (const m of text.matchAll(/["'(=]((?:https?:\/\/|\/)[^"'\s<>\\]{1,300}?\.pdf)(?=["'?#)\\]|$)/gi)) {
    try {
      out.add(new URL(m[1] ?? '', baseUrl).href);
    } catch {
      // not an address after all
    }
    if (out.size >= 40) break;
  }
  return [...out];
}

/** Controlled model-name variants: "E-3008" also tries "3008", "Q4 e-tron" also "Q4". The full name always goes first. */
export function modelVariants(model: string): string[] {
  const base = model.replace(/^(all[- ]new|new)\s+/i, '').replace(/^e[- ]/i, '').replace(/\s+(e-tron|electric|hybrid|ev)$/i, '').trim();
  return norm(base) !== norm(model) && norm(base).length >= 2 ? [model, base] : [model];
}

/** Short and numeric model names ("5", "ZS") must not match everything: they need the make beside them or word boundaries. */
export function modelMatcher(make: string, model: string): (s: string) => boolean {
  const nm = norm(model);
  if (/^\d+$/.test(nm)) return (s) => norm(s).includes(norm(make) + nm);
  if (nm.length <= 2) {
    const re = new RegExp(`(^|[^a-z0-9])${fold(model).replace(/[^a-z0-9]+/g, '[^a-z0-9]?')}([^a-z0-9]|$)`);
    return (s) => re.test(fold(s)) || norm(s).includes(norm(make) + nm);
  }
  return (s) => norm(s).includes(nm);
}

/**
 * A looser test, used ONLY to decide what is worth opening: a search title, a link's own text, a file name. On
 * the manufacturer's own site the make goes without saying, so Renault files its Renault 4 brochure as
 * "R4-eBrochure.pdf" and Peugeot its 208 as "208-brochure.pdf"; the strict matcher wants "renault4" and threw
 * the right document away unopened (Matt's Renault 4 search, 21 Sept 2026). For a numeric model the hint also
 * takes the number standing alone, or behind the make's initial. Every other model is the strict matcher.
 * The DOCUMENT is still held to modelMatcher once it has been read, so a wrong guess costs a read, never a
 * wrong attachment.
 */
export function modelHint(make: string, model: string): (s: string) => boolean {
  const strict = modelMatcher(make, model);
  const nm = norm(model);
  if (!/^\d+$/.test(nm)) return strict;
  const alone = new RegExp(`(^|[^a-z0-9])${fold(make).charAt(0)}?${nm}([^a-z0-9]|$)`);
  return (s) => strict(s) || alone.test(fold(s));
}

/**
 * A name that carries the model and then a word that makes it ANOTHER model: Toyota's "c-hr-plus.pdf" is the
 * C-HR+, a different car (the sweep attached it to a C-HR). Body styles with their own brochure count too.
 */
const MODEL_EXTENSIONS = ['plus', 'cross', 'sportback', 'touring', 'tourer', 'estate', 'avant', 'allroad', 'sw', 'van', 'cargo', 'coupe', 'cabrio', 'convertible', 'gran', 'max', 'aircross'];
export function namesAnotherModel(text: string, model: string): boolean {
  const want = fold(model).split(/[^a-z0-9]+/).filter(Boolean);
  if (!want.length) return false;
  // a '+' glued to the end of the model is part of a name ("C-HR+"); a '+' between words is a space in an
  // address ("KONA+Brochure"): Hyundai's brochure was refused as "another model's" until this was told apart
  const tokens = fold(text).replace(/\+(?=[a-z0-9])/g, ' ').replace(/\+/g, ' plus ').split(/[^a-z0-9]+/).filter(Boolean);
  const joined = want.join('');
  for (let i = 0; i < tokens.length; i++) {
    // the model may be written as one token ("chr") or several ("c","hr")
    let j = i;
    let acc = '';
    while (j < tokens.length && acc.length < joined.length) acc += tokens[j++];
    if (acc !== joined) continue;
    const next = tokens[j];
    if (next && MODEL_EXTENSIONS.includes(next) && !want.includes(next)) return true;
  }
  return false;
}

// ---------- the finder ----------

/** What reading a document established, kept so the European fallback can re-judge it without paying to read it twice. */
interface ReadFacts {
  /** Reasons that hold in either tier: the wrong car, not a brochure, too old, undated and unlinked. */
  base: string[];
  /** Past the ordinary age limit, inside the one for what the maker's own site serves today. */
  olderEdition: boolean;
  pub?: BrochureDocumentType;
  date?: string;
  english: boolean;
  euro: boolean;
  dollarOnly: boolean;
  europeWording: boolean;
}

interface Cand extends BrochureCandidateTrace {
  context?: string;
  assetUrl?: string;
  rawType: RawDocType;
  /** The URL itself says a European market (…_eu_…, /ie/, /de_de/): evidence for the fallback, never opened for the UK tier. */
  europeanUrl?: boolean;
  /** Only opened for the fallback tier: a European-market URL, or a result of the fallback's own search. */
  fallbackOnly?: boolean;
  /** The page it was reached from carries a UK marker: evidence of the market in its own right. */
  fromUkPage?: boolean;
  /** Set when accepted: which tier took it. */
  market?: BrochureMarket;
  facts?: ReadFacts;
}

interface WebCand {
  url: string;
  linkText?: string;
  fromPage: string;
  why: string;
}

export async function findBrochure(vehicle: Pick<Vehicle, 'make' | 'model'>, deps: FinderDeps): Promise<FinderResult> {
  const { make, model } = vehicle;
  const now = deps.now?.() ?? new Date();
  const started = Date.now();
  const cap = deps.creditCap ?? 25;
  let credits = 0;
  const afford = (n: number) => credits + n <= cap;
  const out: FinderResult = { status: 'not_verified', flags: [], queries: [], pagesOpened: [], candidates: [], credits: 0, durationMs: 0 };
  const cands: Cand[] = [];
  const variants = modelVariants(model);
  /** Strict: the document's own text, and the text around a link. */
  let modelIn = modelMatcher(make, model);
  /** Loose: what is worth opening (titles, link text, file names). See modelHint. */
  let hintIn = modelHint(make, model);
  let webBrochure: WebCand | undefined;
  let pricePage: WebCand | undefined;
  let requestForm: WebCand | undefined;
  let leadCapture = false;

  const search = async (q: string, opts?: { limit?: number; categories?: 'pdf'[] }): Promise<FirecrawlSearchHit[]> => {
    out.queries.push(opts?.categories ? `${q} [pdf]` : q);
    const r = await deps.firecrawl.search(q, opts);
    credits += r.creditsUsed;
    return r.results;
  };

  const isLinked = (c: Cand) => c.via === 'official-page' || c.via === 'model-page';

  const addCand = (url: string, o: { via: Cand['via']; linkText?: string; context?: string; fromPage?: string; fallbackOnly?: boolean; fromUkPage?: boolean; how?: string; action?: string }) => {
    const seen = cands.find((c) => c.url === url);
    if (seen) {
      if (o.how && !seen.discoveredBy?.includes(o.how)) seen.discoveredBy = [...(seen.discoveredBy ?? []), o.how];
      if (o.action && !seen.action) seen.action = o.action;
      if (o.fromUkPage) seen.fromUkPage = true;
      // the model's own page outranks a general page as the place it was found
      if (o.via === 'model-page' && seen.via === 'official-page') { seen.via = 'model-page'; if (o.fromPage) seen.fromPage = o.fromPage; }
      // Found by the search first, then again ON the official site: "linked from the official pages" is the
      // stronger provenance and must not be lost, or an official brochure on a CDN host is refused as unlinked.
      const linkedNow = o.via === 'official-page' || o.via === 'model-page';
      if (linkedNow && seen.via !== 'official-page' && seen.via !== 'model-page') {
        seen.via = o.via;
        seen.score += 3;
        if (o.fromPage) seen.fromPage = o.fromPage;
        if (o.context) seen.context = o.context;
        const better = docType(`${o.linkText ?? ''} ${url.split('/').pop() ?? ''}`);
        if (seen.rawType === 'unknown' && better !== 'unknown' && better !== 'manual') {
          seen.rawType = better;
          seen.docType = better;
          seen.score += better === 'brochure' ? 3 : 1;
        }
        if (o.linkText) seen.linkText = o.linkText.slice(0, 120);
      }
      return;
    }
    const typeText = o.via === 'search' || o.via === 'site-search' ? `${o.linkText ?? ''} ${url}` : `${o.linkText ?? ''} ${url.split('/').pop() ?? ''}`;
    const rawType = docType(typeText);
    const c: Cand = { url, via: o.via, docType: rawType, rawType, score: 0, status: 'not_checked', reasons: [], discoveredBy: [o.how ?? (o.via === 'search' ? 'search' : o.via)] };
    if (o.action) c.action = o.action;
    if (o.fromUkPage) c.fromUkPage = true;
    if (o.linkText) c.linkText = o.linkText.slice(0, 120);
    if (o.context) c.context = o.context;
    if (o.fromPage) c.fromPage = o.fromPage;
    if (isJunkHost(url)) c.reasons.push('aggregator / document-sharing host');
    else if (isRestOfWorld(url)) c.reasons.push('another market’s URL');
    else if (isEuropeanMarket(url) && !ukMarker(url)) c.europeanUrl = true;
    if (c.europeanUrl || o.fallbackOnly) c.fallbackOnly = true;
    if (OLD.test(url)) c.reasons.push('archived or used-car document');
    if (rawType === 'manual') c.reasons.push('a manual, warranty, accessories or press document, not a brochure');
    if (c.reasons.length) c.status = 'rejected';
    if (isOfficialHost(url, make)) c.score += 3;
    // the market its tier is looking for: UK for the first pass, Europe for the fallback
    if (ukMarker(url) || c.europeanUrl) c.score += 2;
    if (o.via === 'official-page' || o.via === 'model-page') c.score += 3;
    if (o.via === 'model-page') c.score += 2;
    c.score += rawType === 'brochure' ? 3 : rawType === 'price-guide' || rawType === 'spec' ? 1 : 0;
    const ud = urlDate(url, now);
    if (ud) c.score += monthsOld(ud, now) <= 12 ? 1 : -3;
    cands.push(c);
  };

  try {
    // 1. two searches: the open web, and PDFs only
    const [web, pdfs] = await Promise.all([search(`"${make} ${model}" UK official brochure PDF`), search(`${make} ${model} brochure`, { categories: ['pdf'], limit: 8 })]);
    const seen = new Set<string>();
    const hits = [...web, ...pdfs].filter((h) => h.url && !seen.has(h.url) && !!seen.add(h.url));
    const saysUk = (h: FirecrawlSearchHit) => /\bUK\b|United Kingdom|£/.test(`${h.title ?? ''} ${h.description ?? ''}`);
    const officialHit =
      hits.find((h) => isOfficialHost(h.url, make, model) && ukMarker(h.url) && !looksLikePdfUrl(h.url)) ??
      hits.find((h) => isOfficialHost(h.url, make, model) && ukMarker(h.url)) ??
      hits.find((h) => isOfficialHost(h.url, make, model) && !isOtherMarket(h.url) && saysUk(h) && !looksLikePdfUrl(h.url));
    const officialHost = officialHit ? hostOf(officialHit.url) : undefined;
    if (officialHit && officialHost) {
      out.officialSite = officialHost;
      out.officialWhy = ['the host is the make', ukMarker(officialHit.url) ? 'a UK address' : 'the result describes itself as UK'];
    }
    for (const h of hits.filter((x) => looksLikePdfUrl(x.url))) addCand(h.url, { via: 'search', how: 'search', ...(h.title ? { linkText: h.title } : {}) });

    // 2. OPERATE a page of the official site the way a person does (operate.ts): one scrape, one credit. It reads
    //    the rendered links, presses the brochure / download / specification controls and reports the files they
    //    fetch, and the page's own data is searched for PDF addresses as well. On the MODEL's page the page itself
    //    is the evidence that a document is about this car: its file name does not have to say so.
    const operatePage = async (p: { url: string; title?: string }, isModelPage: boolean) => {
      if (!afford(1) || out.pagesOpened.includes(p.url)) return;
      let md: string;
      let rawHtml: string;
      let operated: OperatedPage;
      try {
        const page = await deps.firecrawl.scrape(p.url, { formats: ['markdown', 'rawHtml'], actions: OPERATE_ACTIONS });
        credits += page.creditsUsed;
        md = page.markdown ?? '';
        rawHtml = page.rawHtml ?? '';
        operated = parseOperated(page.actionReturns);
      } catch {
        return;
      }
      out.pagesOpened.push(p.url);
      const via = isModelPage ? ('model-page' as const) : ('official-page' as const);
      const fromUkPage = ukMarker(p.url);
      const hasForm = /(first name|surname|last name)/i.test(md) && /email/i.test(md);
      if (hasForm) leadCapture = true;
      const pageText = `${p.url} ${p.title ?? ''}`;
      const brochurePage = /brochure/i.test(pageText);

      // a. what the rendered page gave up: links, and the files its controls fetched when pressed
      for (const f of operated.finds) {
        const both = `${f.label} ${f.url}`;
        if (OLD.test(both) || REQUESTY.test(f.label)) continue;
        if (!(isModelPage || hintIn(f.label) || hintIn(f.url))) continue;
        const name = (f.url.split('/').pop() ?? '').replace(/\.pdf.*$/i, '').replace(/[-_+.]+/g, ' ');
        const dt = docType(`${f.label} ${name}`);
        if (dt === 'manual') continue;
        // a control labelled "download" on the model page is worth opening even when nothing names its type
        if (dt === 'unknown' && !(isModelPage || brochurePage)) continue;
        addCand(f.url, { via, linkText: f.label || name, fromPage: p.url, fromUkPage, how: f.how === 'press' ? 'pressed control' : 'rendered link', ...(f.how === 'press' && f.label ? { action: `pressed "${f.label}"` } : {}) });
      }
      if (operated.request && /brochure/i.test(operated.request.label)) requestForm ??= { url: operated.request.url, linkText: operated.request.label, fromPage: p.url, why: 'request-a-brochure link' };

      // b. the links in the page's text, each with its own words
      for (const l of labelledLinks(md, p.url)) {
        const both = `${l.own} ${l.url}`;
        if (NOT_A_DOCUMENT.test(both) || OLD.test(both) || l.url.includes('#') || /^(mailto|tel):/.test(l.url)) continue;
        const bare = /^(download|view|open|read|pdf|here|click here|find out more|learn more)?\b.{0,14}$/i.test(l.own.trim());
        // a bare "Download" under "Download Kodiaq brochures": the heading says which car, the lead says what it is
        const aboutModel = isModelPage || hintIn(l.own) || hintIn(l.url) || (bare && l.heading ? modelIn(l.heading) : modelIn(l.context.slice(-80)));
        if (REQUESTY.test(both)) {
          // a brochure request needs BOTH words: "Request an appointment" is nothing
          if (aboutModel && /brochure/i.test(both) && /request|order/i.test(both)) requestForm ??= { url: l.url, linkText: l.own, fromPage: p.url, why: 'request-a-brochure link' };
          continue;
        }
        if (!aboutModel) continue;
        const said = bare ? `${l.lead} ${l.own}` : l.own;
        const dt = docType(`${said} ${l.url.split('/').pop() ?? ''}`);
        if (dt === 'manual') continue;
        const docLike = looksLikePdfUrl(l.url) || /download/i.test(l.own) || /\bpdf\b/i.test(l.lead);
        if (docLike && (dt !== 'unknown' || ((brochurePage || isModelPage) && looksLikePdfUrl(l.url)))) {
          addCand(l.url, { via, linkText: bare ? `${l.lead.slice(-80)} ${l.own}`.trim() : l.own, context: l.context, fromPage: p.url, fromUkPage, how: 'page link' });
          continue;
        }
        if (dt === 'brochure') webBrochure ??= { url: l.url, linkText: l.own, fromPage: p.url, why: 'link text says brochure' };
        else if (dt === 'price-guide') pricePage ??= { url: l.url, linkText: l.own, fromPage: p.url, why: 'link text says price list / guide' };
        else if (brochurePage && !isModelPage && norm(l.own).endsWith(norm(model)) && norm(l.own).length <= norm(model).length + norm(make).length && modelIn(l.url) && hostOf(l.url) !== officialHost) {
          // a bare model-name link counts only on an official brochures page, to an off-site target named for the model
          webBrochure ??= { url: l.url, linkText: l.own, fromPage: p.url, why: 'model-name link on the official brochures page' };
        }
      }

      // c. PDF addresses only the page's own data carries. With no label to go by the file has to say what it is;
      //    away from the model page it has to name the model too (site-wide menus carry every model's files).
      for (const u of pdfUrlsInHtml(rawHtml, p.url)) {
        let name = u.split('/').pop() ?? '';
        try {
          name = decodeURIComponent(name);
        } catch {
          // keep the raw name
        }
        name = name.replace(/\.pdf$/i, '').replace(/[-_+.]+/g, ' ').trim();
        if (NOT_A_DOCUMENT.test(u) || OLD.test(u) || !(hintIn(name) || hintIn(u))) continue;
        const dt = docType(name);
        if (dt === 'manual' || dt === 'unknown') continue;
        addCand(u, { via, linkText: name, fromPage: p.url, fromUkPage, how: 'page data' });
      }
      if (!isModelPage && modelIn(pageText) && /brochure/i.test(pageText) && (hasForm || /request|rfi|form/i.test(p.url))) requestForm ??= { url: p.url, ...(p.title ? { linkText: p.title } : {}), fromPage: p.url, why: 'brochure request page' };
    };

    // 3. understand the official site: MAP it (1 credit) for this model's page and its brochure / download / price
    //    pages, instead of guessing paths. The model's own page is opened FIRST: it is where a person goes.
    if (officialHit && officialHost) {
      const base = new URL(officialHit.url);
      const ukPrefix = base.pathname.match(/^\/(uk|en_gb|en-gb|gb)(?=\/|$)/i)?.[0] ?? '';
      const onSite = (u: string) => hostOf(u) === officialHost && (!ukPrefix || new URL(u).pathname.toLowerCase().startsWith(ukPrefix.toLowerCase()));
      const readable = (u: string, title = '') => onSite(u) && !looksLikePdfUrl(u) && !OLD.test(`${u} ${title}`) && !NOT_A_DOCUMENT.test(u);
      const NOT_THE_MODEL_PAGE = /manual|owner|review|news|press|blog|video|accessor|insurance|finance|charging|warranty|servic|stock|used|approved|compare|faq|contact|dealer|retailer|careers|sitemap|fleet|business|motability|offers?\b|configur|tutorial|concept|histor|heritage|anniversary|gallery|test-drive/i;
      // any spelling of the model the variants allow ("E-208" is also filed under "208")
      const anyHint = (t: string) => variants.some((v) => modelHint(make, v)(t));
      // the model's OWN page, not a trim's or an edition's: its last path segment is the model and little else
      const NOISE = new Set(['new', 'all', 'the', 'electric', 'e', 'tech', 'etech', 'ev', 'hybrid', 'html', 'htm', 'overview', 'index', 'range', 'cars', 'models', 'model', ...fold(make).split(/[^a-z0-9]+/)]);
      const extraWords = (u: string) => {
        const last = fold(new URL(u).pathname.replace(/\/+$/, '').split('/').pop() ?? '').split(/[^a-z0-9]+/).filter(Boolean);
        const want = new Set(variants.flatMap((v) => fold(v).split(/[^a-z0-9]+/)));
        return last.filter((t) => !want.has(t) && !NOISE.has(t)).length;
      };

      let mapped: string[] = [];
      if (afford(1)) {
        try {
          const m = await deps.firecrawl.map(`${base.origin}${ukPrefix}`, { search: `${model} brochure`, limit: 40 });
          credits += m.creditsUsed;
          out.queries.push(`map ${base.origin}${ukPrefix} "${model} brochure"`);
          mapped = m.links.filter((u) => parse(u));
        } catch {
          // a site that cannot be mapped is still searched the old way below
        }
      }
      for (const u of mapped) if (looksLikePdfUrl(u) && (hintIn(u) || /brochure/i.test(u))) addCand(u, { via: 'site-search', how: 'site map' });

      const known: { url: string; title?: string }[] = [...mapped.map((url) => ({ url })), ...hits];
      const modelPages = known
        .filter((h) => readable(h.url, h.title) && anyHint(new URL(h.url).pathname) && !NOT_THE_MODEL_PAGE.test(new URL(h.url).pathname) && !namesAnotherModel(new URL(h.url).pathname, model))
        .sort((a, b) => extraWords(a.url) - extraWords(b.url) || a.url.length - b.url.length);
      const resourcePages = known.filter((h) => readable(h.url, h.title) && /(brochure|download|price|pricelist|resources)/i.test(`${h.url} ${h.title ?? ''}`) && !/news|press|blog|article|stor(y|ies)|offers?\b|finance|motability|fleet|business/i.test(new URL(h.url).pathname));
      const wantBrochure = () => cands.some((c) => c.status !== 'rejected' && !c.fallbackOnly && isLinked(c) && c.rawType === 'brochure');

      if (modelPages[0]) await operatePage(modelPages[0], true);
      // the model's page gave no brochure: its brochure / download / price pages, then the old ways of finding them
      if (!wantBrochure()) {
        const pick = resourcePages.filter((p) => p.url !== modelPages[0]?.url).slice(0, 2);
        let siteHits: FirecrawlSearchHit[] = [];
        if (!pick.length && !mapped.length && afford(2)) {
          // a secondary search that fails never undoes what has been found so far
          siteHits = await search(`site:${officialHost} ${model} brochure`, { limit: 5 }).catch((): FirecrawlSearchHit[] => []);
          for (const h of siteHits) if (looksLikePdfUrl(h.url)) addCand(h.url, { via: 'site-search', how: 'site search', ...(h.title ? { linkText: h.title } : {}) });
          pick.push(...siteHits.filter((h) => readable(h.url, h.title) && /(brochure|download|price)/i.test(`${h.url} ${h.title ?? ''}`)).slice(0, 2));
          const late = siteHits.filter((h) => readable(h.url, h.title) && ukMarker(h.url) && hintIn(h.url) && !NOT_THE_MODEL_PAGE.test(h.url)).sort((a, b) => a.url.length - b.url.length)[0];
          if (late && !modelPages.length) await operatePage(late, true);
        }
        if (!pick.length && !mapped.length) {
          for (const path of ['/brochures/', '/brochures.html', '/downloads/', '/download-a-brochure/', '/brochure/']) {
            const r = await deps.http(`${base.origin}${ukPrefix}${path}`);
            if (r?.status === 200) {
              pick.push({ url: `${base.origin}${ukPrefix}${path}`, title: 'brochures' });
              break;
            }
          }
        }
        for (const p of pick) if (!wantBrochure()) await operatePage(p, false);
      }
    }
    // A search that never reached a page of the official site has not shown that the car has no brochure.
    out.exhausted = out.pagesOpened.length > 0;

    // 4. verify by reading the document. The tier decides which evidence is asked for: 'uk' wants UK evidence;
    //    'eu' (the fallback) wants an English-language brochure that says it is a European edition.
    let verified = 0;
    let fetchFailed = 0;
    /** Why a document that has been read cannot be the European fallback. Empty = it can. */
    const euReasons = (c: Cand, f: ReadFacts): string[] => {
      const why = [...f.base];
      if (f.pub === 'price_spec_guide') why.push('a European price & spec guide is never used: not the UK’s prices or trims');
      if (!f.english) why.push('not in English');
      if (f.dollarOnly) why.push('dollar pricing: not a European edition');
      if (!(c.europeanUrl || f.euro || f.europeWording || isLinked(c))) why.push('nothing says this is a European edition');
      return why;
    };

    // Accepting marks the CANDIDATE only: several may be acceptable while a newer edition is looked for, and the
    // result is written from whichever wins (pdfOutcome).
    const accept = (c: Cand, market: BrochureMarket, _f: ReadFacts) => {
      c.status = 'accepted';
      c.reasons = [];
      c.evidence = { ...(c.evidence ?? {}), market };
      c.market = market;
    };

    /** Opens one candidate and judges it. True when it was accepted. */
    const verify = async (c: Cand, v: string, tier: BrochureMarket): Promise<boolean> => {
      const onOfficial = isOfficialHost(c.url, make);
      const linked = isLinked(c);
      const reject = (why: string) => {
        c.status = 'rejected';
        c.reasons.push(why);
      };
      if (!onOfficial && !linked) { reject('not on the official site and not linked from its UK pages'); return false; }
      if (!linked && !hintIn(`${c.linkText ?? ''} ${c.url}`)) { reject('range-wide or unrelated document: the model is not in its title or URL'); return false; }
      if (namesAnotherModel(`${c.linkText ?? ''} ${c.url.split('/').pop() ?? ''}`, v)) { reject('another model’s document (its name carries the model and then another model’s word)'); return false; }
      // An official host, or a link from the official site, IS the reason to open it. A low score only orders the
      // queue; it never again stops a plausible official document from being read.

      let target = c.url;
      if (!looksLikePdfUrl(c.url)) {
        // a "download" link is not always a file: it may redirect, wrap a PDF, or just be another web page
        const r = await deps.http(c.url);
        if (!r) { c.status = 'fetch_failed'; c.reasons.push('could not reach the link'); fetchFailed++; return false; }
        if (REQUESTY.test(r.finalUrl)) {
          reject('resolves to a request / contact flow, not a document');
          if (/brochure/i.test(`${c.linkText ?? ''} ${r.finalUrl}`) && /request|order/i.test(r.finalUrl)) requestForm ??= { url: c.url, ...(c.linkText ? { linkText: c.linkText } : {}), fromPage: c.fromPage ?? c.url, why: 'download link leads to a request form' };
          return false;
        }
        if (/pdf/i.test(r.contentType)) target = r.finalUrl;
        else if (r.status === 401 || r.status === 403) { c.status = 'fetch_failed'; c.reasons.push(`the site answered ${r.status}`); c.assetUrl = c.url; fetchFailed++; return false; }
        else if (/html/i.test(r.contentType)) {
          const html = await r.text();
          const inner = [...new Set(html.match(/https?:[^"'\s<>\\]+?\.pdf/gi) ?? [])].filter((u) => hintIn(u.split('/').pop() ?? '')).sort((a, b) => a.length - b.length)[0];
          if (inner) target = inner;
          else {
            c.status = 'is_web_page';
            c.reasons.push('the link opens a web page, not a file');
            const w: WebCand = { url: c.url, ...(c.linkText ? { linkText: c.linkText } : {}), fromPage: c.fromPage ?? c.url, why: 'download link opens a web page' };
            if (c.rawType === 'brochure') webBrochure ??= w;
            else if (c.rawType === 'price-guide') pricePage ??= w;
            return false;
          }
        }
      }

      if (target !== c.url && namesAnotherModel(target.split('/').pop() ?? '', v)) { reject(`the link leads to another model’s document (${target.split('/').pop()})`); return false; }
      if (!afford(4)) { c.reasons.push('credit cap reached before this could be read'); return false; }
      verified++;
      let text = '';
      let pages: number | undefined;
      try {
        const doc = await deps.firecrawl.scrape(target, { formats: ['markdown'], pdfMaxPages: 4 });
        credits += doc.creditsUsed;
        text = doc.markdown ?? '';
        pages = doc.totalPages;
      } catch (e) {
        c.status = 'fetch_failed'; c.reasons.push(`could not be read: ${e instanceof Error ? e.message.slice(0, 80) : 'error'}`); c.assetUrl = target; fetchFailed++; return false;
      }
      if (/AccessDenied/.test(text.slice(0, 200)) || (text.length < 200 && c.via !== 'model-page')) { c.status = 'fetch_failed'; c.reasons.push('the site refused to serve the document'); c.assetUrl = target; fetchFailed++; return false; }
      if (text.length < 200) { c.status = 'fetch_failed'; c.reasons.push('found on the model’s own page, but it has no readable text (an image-only file): open it to check'); c.assetUrl = target; if (!c.fromPage) c.fromPage = target; return false; }

      const type = c.rawType === 'unknown' ? docType(text.slice(0, 1500)) : c.rawType;
      const pub = publicDocType(type);
      let d = editionDate(text, target, now);
      let datedByServer = false;
      if (!d && (onOfficial || linked)) {
        // nothing in the text or the address says when: ask the server when the file last changed
        const head = await deps.http(target);
        const lm = head?.lastModified ? new Date(head.lastModified) : undefined;
        if (lm && !Number.isNaN(lm.getTime()) && lm.getTime() <= now.getTime() + 864e5 && lm.getUTCFullYear() >= 2015) {
          d = { date: lm, from: 'url' };
          datedByServer = true;
        }
      }
      const date = d?.date.toISOString().slice(0, 10);
      const uk = {
        ukDomainOrPath: (linked || hintIn(`${c.linkText ?? ''} ${target}`)) && (ukPathOnOfficial(c.url, make) || ukPathOnOfficial(target, make)),
        linkedFromOfficial: linked,
        poundPricing: /£|\bOTR\b|on the road/i.test(text),
        ukWording: /(UK spec|United Kingdom|\bUK\b Limited|\(UK\)|\.co\.uk|UK model|UK customers)/i.test(text),
        // reached from a page of the official UK site: the market is the page's, whatever host the file sits on
        fromUkPage: linked && !!c.fromUkPage,
      };
      const euro = /€|\bEUR\b/.test(text);
      const ukCount = Object.values(uk).filter(Boolean).length;

      const base: string[] = [];
      const makeInText = norm(text).includes(norm(make)) || (norm(make) === 'volkswagen' && /\bvw\b/i.test(text));
      // the model's own page vouches for the model: a brochure that styles the name its own way still counts
      const modelOk = modelIn(text) || (c.via === 'model-page' && makeInText);
      if (!modelOk || !makeInText) base.push('the make and model are not in the document');
      if (!pub) base.push('could not establish that this is a brochure or a price & spec guide');
      // what the manufacturer's own UK site is serving today IS its current edition (schema: …_OFFICIAL)
      const servedByMaker = (onOfficial && (ukMarker(c.url) || ukMarker(target) || !!c.europeanUrl)) || linked;
      const limit = pub ? (servedByMaker ? BROCHURE_MAX_AGE_MONTHS_OFFICIAL : BROCHURE_MAX_AGE_MONTHS)[pub] : 0;
      const age = d ? monthsOld(d.date, now) : 0;
      if (d && pub && age > limit) base.push(`dated ${date}: older than the ${limit}-month limit`);
      const olderEdition = !!(d && pub && age > BROCHURE_MAX_AGE_MONTHS[pub] && age <= limit);
      if (!d && !linked) base.push('no edition date, and not linked from the official UK pages');
      const ukWhy: string[] = [];
      if (euro && !uk.poundPricing) ukWhy.push('euro pricing and no £');
      if (ukCount < 2) ukWhy.push(`not enough UK evidence (${ukCount} signal${ukCount === 1 ? '' : 's'})`);

      const facts: ReadFacts = { base, olderEdition, ...(pub ? { pub } : {}), ...(date ? { date } : {}), english: isEnglish(text), euro, dollarOnly: /\$\s?\d/.test(text) && !uk.poundPricing && !euro, europeWording: /\b(Europe|European|EU)\b/.test(text) };
      c.facts = facts;
      c.docType = type;
      c.assetUrl = target;
      c.evidence = { ...uk, english: facts.english, ...(datedByServer ? { datedBy: 'last-modified header' } : {}), modelNameUsed: v, ...(pages !== undefined ? { pages } : {}), ...(d && date ? { date, dateFrom: d.from } : {}) };

      // a UK document is taken as one whichever tier opened it
      if (!base.length && !ukWhy.length) { accept(c, 'uk', facts); return true; }
      if (tier === 'uk') { c.status = 'rejected'; c.reasons.push(...base, ...ukWhy); return false; }
      const euWhy = euReasons(c, facts);
      if (!euWhy.length) { accept(c, 'eu', facts); return true; }
      c.status = 'rejected';
      c.reasons.push(...euWhy);
      return false;
    };

    /** An acceptable document that lost to a newer edition: it stays in the trace, as what it was. */
    const demote = (loser: Cand, winner: Cand) => {
      loser.status = 'rejected';
      loser.reasons = [`a newer edition was found (${winner.facts?.date ?? 'undated'})`];
    };

    /** The full model name first, then the base name; best-ranked candidates first; stops at `maxReads` documents opened. */
    const runPass = async (tier: BrochureMarket, maxReads: number): Promise<Cand | undefined> => {
      const startedAt = verified;
      let best: Cand | undefined;
      // the UK tier never opens a European-market URL; the fallback opens nothing else
      const inTier = (c: Cand) => (tier === 'eu') === !!c.fallbackOnly;
      for (const v of variants) {
        modelIn = modelMatcher(make, v);
        hintIn = modelHint(make, v);
        if (v !== model) for (const c of cands) if (inTier(c) && c.status === 'rejected' && c.reasons.length === 1 && /model is not in/.test(c.reasons[0] ?? '')) Object.assign(c, { status: 'not_checked', reasons: [] });
        const named = (c: Cand) => (looksLikePdfUrl(c.url) && hintIn(c.url.split('/').pop() ?? '') && !namesAnotherModel(c.url.split('/').pop() ?? '', v) ? 2 : modelIn(`${c.linkText ?? ''} ${c.url}`) ? 1 : 0);
        const kind = (c: Cand) => (c.rawType === 'brochure' ? 1 : 0);
        const ranked = cands.filter((c) => c.status === 'not_checked' && inTier(c)).sort((a, b) => kind(b) - kind(a) || named(b) - named(a) || b.score - a.score || (urlDate(b.url, now)?.getTime() ?? 0) - (urlDate(a.url, now)?.getTime() ?? 0));
        for (const c of ranked) {
          if (verified - startedAt >= maxReads) return best;
          if (!(await verify(c, v, tier))) continue;
          // a current edition ends the search; an older one is kept while a newer is looked for
          if (!c.facts?.olderEdition) { if (best) demote(best, c); return c; }
          if (!best || (c.facts.date ?? '') > (best.facts?.date ?? '')) { if (best) demote(best, c); best = c; } else demote(c, best);
        }
        if (best) return best;
      }
      return best;
    };

    /** The fallback: the manufacturer's European English-language brochure. Only reached when nothing UK verified. */
    const europeanFallback = async (): Promise<Cand | undefined> => {
      // a document already read for the UK tier that failed on UK evidence alone costs nothing to re-judge
      for (const c of cands.filter((x) => x.facts && x.status === 'rejected').sort((a, b) => b.score - a.score)) {
        if (!c.facts) continue;
        const why = euReasons(c, c.facts);
        if (!why.length) { accept(c, 'eu', c.facts); return c; }
        for (const w of why) if (!c.reasons.includes(w)) c.reasons.push(w);
      }
      const opened = verified;
      const hit = await runPass('eu', 2);
      if (hit || verified > opened || !afford(6)) return hit;
      // no European document worth opening turned up (Irish dealers' copies do not count): one search for it.
      // A failure here never undoes the UK result.
      const more = await search(EUROPEAN_QUERY(make, model), { categories: ['pdf'], limit: 8 }).catch((): FirecrawlSearchHit[] => []);
      for (const h of more) if (looksLikePdfUrl(h.url)) addCand(h.url, { via: 'search', fallbackOnly: true, ...(h.title ? { linkText: h.title } : {}) });
      return runPass('eu', 2);
    };

    const pdfOutcome = (c: Cand) => {
      const f = c.facts;
      out.market = c.market ?? 'uk';
      if (f?.pub) out.documentType = f.pub;
      if (f?.date) out.editionDate = f.date;
      if (f?.olderEdition) out.flags.push('older_edition');
      if (out.market === 'eu') {
        out.flags.push('european_edition');
        if (f?.euro) out.flags.push('euro_pricing');
      }
      out.status = 'verified_pdf';
      out.url = c.assetUrl ?? c.url;
      out.assetUrl = out.url;
      if (c.fromPage) out.fromPage = c.fromPage;
      if (leadCapture) out.flags.push('lead_capture_present');
      if (out.market === 'eu') out.reason = 'No UK edition could be verified, so this is the manufacturer’s European English-language brochure.';
    };

    const accepted = await runPass('uk', 4);
    modelIn = modelMatcher(make, model);
    hintIn = modelHint(make, model);

    // 4. the outcome: a UK PDF, then a UK web brochure, then the European fallback, then the things the salesperson can accept
    if (accepted) pdfOutcome(accepted);
    else {
      let webAsEuropean: (() => void) | undefined;
      if (webBrochure && afford(1)) {
        // the target has to be the right model, UK, current, and an actual document
        const w = webBrochure;
        let md = '';
        let live = 0;
        try {
          const pg = await deps.firecrawl.scrape(w.url, { formats: ['markdown'], waitFor: 3000 });
          credits += pg.creditsUsed;
          md = pg.markdown ?? '';
          live = pg.statusCode ?? 200;
        } catch {
          live = 0;
        }
        const wdRaw = textDate(md, now);
        const wd = wdRaw && wdRaw.getTime() <= now.getTime() ? wdRaw : undefined;
        const match = variants.some((v) => modelMatcher(make, v)(md) || modelHint(make, v)(w.url));
        const notUk = 'nothing on the page says UK';
        const bad: string[] = [];
        if (!(live >= 200 && live < 400)) bad.push(`the page returned ${live || 'nothing'}`);
        if (!match) bad.push('the page does not mention the model');
        if (!(/£|\bUK\b|United Kingdom/.test(md) || ukMarker(w.url))) bad.push(notUk);
        if (OLD.test(w.url)) bad.push('an archive page');
        if (NOT_A_DOCUMENT.test(w.url) || REQUESTY.test(`${w.linkText ?? ''} ${w.url}`)) bad.push('a configurator, request or contact flow, not a document');
        const isForm = /\/forms?\d*\.?[a-z]*\/|forms\d*\.|[-_/]rfi\b|rfi\.html|order-a-brochure|request-a-brochure/i.test(w.url) || (/(first name|surname|last name)/i.test(md) && /e-?mail/i.test(md));
        if (isForm) {
          bad.push('a form to fill in, not a brochure to read');
          requestForm ??= { url: w.url, ...(w.linkText ? { linkText: w.linkText } : {}), fromPage: w.fromPage, why: 'the brochure link leads to a request form' };
        }
        if (wd && monthsOld(wd, now) > BROCHURE_MAX_AGE_MONTHS.brochure) bad.push(`the newest date on the page is ${wd.toISOString().slice(0, 10)}`);
        const found = { documentType: /price ?-?list|pricelist|price[-_ ]guide/i.test(`${w.linkText ?? ''} ${w.url}`) ? 'price_spec_guide' : 'brochure', url: w.url, fromPage: w.fromPage, ...(wd ? { editionDate: wd.toISOString().slice(0, 10) } : {}) };
        if (!bad.length) Object.assign(out, { status: 'verified_web_brochure', market: 'uk', reason: w.why, ...found });
        else {
          out.reason = `The web brochure at ${w.url} was rejected: ${bad.join('; ')}.`;
          // everything but "UK" holds, and it is in English: the official site's own web brochure is the fallback
          if (bad.length === 1 && bad[0] === notUk && isEnglish(md)) {
            webAsEuropean = () => {
              Object.assign(out, { status: 'verified_web_brochure', market: 'eu', reason: 'No UK edition could be verified, so this is the manufacturer’s English-language web brochure.', ...found });
              out.flags.push('european_edition');
            };
          }
        }
      }
      if (out.status === 'not_verified') {
        const european = await europeanFallback();
        modelIn = modelMatcher(make, model);
        hintIn = modelHint(make, model);
        if (european) pdfOutcome(european);
        else webAsEuropean?.();
      }
      if (out.status === 'not_verified') {
        const blocked = cands.find((c) => c.status === 'fetch_failed' && c.fromPage && publicDocType(c.rawType));
        const blockedType = blocked ? publicDocType(blocked.rawType) : undefined;
        if (blocked?.fromPage && blockedType) {
          Object.assign(out, { status: 'official_page_only', documentType: blockedType, url: blocked.fromPage, assetUrl: blocked.assetUrl ?? blocked.url, assetRetrievable: false, reason: `The official ${blockedType === 'brochure' ? 'brochure' : 'price & spec guide'} was found, but the manufacturer's site would not release the file (${blocked.reasons.join('; ')}).` });
        } else if (pricePage && !NOT_A_DOCUMENT.test(pricePage.url) && !REQUESTY.test(`${pricePage.linkText ?? ''} ${pricePage.url}`)) {
          // a price page is never attached by itself: it may be a hub for every model (Volvo's /pricelists/)
          Object.assign(out, { status: 'official_page_only', documentType: 'price_spec_guide', url: pricePage.url, fromPage: pricePage.fromPage, reason: 'The official site links a price list page for this model; it is a web page, not a downloadable document.' });
        } else if (requestForm) {
          Object.assign(out, { status: 'brochure_request', documentType: 'brochure_request_form', url: requestForm.url, fromPage: requestForm.fromPage, reason: 'The manufacturer only offers a request-a-brochure form.' });
        } else if (verified > 0 && fetchFailed === verified) {
          Object.assign(out, { status: 'search_failed', reason: 'Every document found failed to open, so no conclusion was made.' });
        } else if (!out.reason) {
          out.reason = cands.length ? 'Documents were found, but none passed the checks.' : officialHost ? 'The official UK site was found, but it links no brochure for this model.' : 'No official UK site or document turned up.';
        }
      }
    }
    // a European-market document that was never needed is still another market's: say so in the trace
    for (const c of cands) if (c.europeanUrl && c.status === 'not_checked') Object.assign(c, { status: 'rejected', reasons: [out.market === 'uk' ? 'another market’s URL (a European edition: not needed, a UK document was found)' : 'another market’s URL (a European edition: not opened)'] });
  } catch (e) {
    Object.assign(out, { status: 'search_failed', reason: `The search could not be completed: ${e instanceof Error ? e.message : 'error'}.` });
  }

  out.candidates = cands
    .map(({ context: _c, assetUrl: _a, rawType: _r, europeanUrl: _e, fallbackOnly: _f, facts: _x, fromUkPage: _u, market: _m, ...c }) => c)
    .sort((a, b) => (a.status === 'accepted' ? -1 : b.status === 'accepted' ? 1 : b.score - a.score))
    .slice(0, 20);
  out.credits = credits;
  out.durationMs = Date.now() - started;
  return out;
}
