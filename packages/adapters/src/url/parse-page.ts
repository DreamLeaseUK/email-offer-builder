/**
 * Offer page parser — brief §5.3 step 3, with HTMLRewriter (streaming, cheap on Worker CPU).
 *
 * What the page actually carries (checked against the live site on 14 Sept 2026): the vehicle
 * identity, the four slugs the pricing API needs, the headline stats, the quick-spec line, the
 * processing fees and the default lease configuration are server-rendered. Prices, initial payment
 * and the badge flags are NOT in the HTML; the page's Vue component loads them from
 * /api/carresults/GetOfferDropdownsForCar (see pricing.ts). The parser therefore returns identity
 * and configuration, plus the site's image URL for the image pipeline to consume.
 *
 * `imageSourceUrl` carries a CAP ID. It exists only to be fetched; it must never be persisted,
 * logged or copied into an Offer. The pipeline strips it as soon as the bytes are in hand.
 */
import { decodeEntities } from '@offer-mailer/schema';
import type { LeaseConfig } from './normalise.js';

export interface PageStat {
  value: string;
  unit: string;
  label: string;
}

export interface PageData {
  make: string;
  model: string;
  derivative: string;
  transmission?: string;
  bodyStyle?: string;
  doors?: number;
  /** From the quick-spec line, e.g. "Electric", "Petrol", "Diesel", "Hybrid". */
  fuelType?: string;
  slugs: { manufacturer: string; model: string; bodyStyle: string; derivative: string };
  isBusiness: boolean;
  isVan: boolean;
  /** The site's free-text tags, e.g. "Limited Stock". */
  tags: string[];
  /** The configuration the page would show by default (offerToDisplay_*). */
  defaults: LeaseConfig & { financeType?: string };
  processingFee: { personal?: number; business?: number };
  stats: PageStat[];
  /** Site image URL for viewPoint 1. Fetch it, transform it, forget it. */
  imageSourceUrl?: string;
  /** schema.org lowPrice for the configuration in the URL; a cross-check, not the source of truth. */
  ldPrice?: number;
}

export class OfferPageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OfferPageError';
  }
}

/** The subset of the HTMLRewriter API the parser uses; the Worker passes the global, tests pass the wasm build. */
export interface HtmlRewriterLike {
  on(selector: string, handlers: ElementHandlers): HtmlRewriterLike;
  transform(response: Response): Response;
}
export type HtmlRewriterCtor = new () => HtmlRewriterLike;

interface ElementLike {
  tagName: string;
  getAttribute(name: string): string | null;
}
interface TextLike {
  text: string;
  lastInTextNode: boolean;
}
interface ElementHandlers {
  element?(element: ElementLike): void;
  text?(text: TextLike): void;
}

const FUEL_WORDS = ['electric', 'petrol', 'diesel', 'hybrid', 'plug-in hybrid', 'mild hybrid', 'hydrogen'];

// The site HTML-encodes text even inside its script block ("Techno &#x2B; Comfort Range"): every name, stat and
// spec line read below goes through decodeEntities (packages/schema/src/text.ts, shared with the API).

/** window.motorleaseInit.<key> = <value>; — strings, numbers, booleans. */
function parseInitBlock(js: string): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  const re = /window\.motorleaseInit\.(\w+)\s*=\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|(true|false)|(-?\d+(?:\.\d+)?))\s*;/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(js))) {
    const key = m[1]!;
    if (m[2] !== undefined) out[key] = m[2].replace(/\\(['"\\])/g, '$1');
    else if (m[3] !== undefined) out[key] = m[3].replace(/\\(['"\\])/g, '$1');
    else if (m[4] !== undefined) out[key] = m[4] === 'true';
    else if (m[5] !== undefined) out[key] = Number(m[5]);
  }
  return out;
}

export async function parseOfferPage(html: string, HTMLRewriter: HtmlRewriterCtor): Promise<PageData> {
  const scripts: { type: string | null; text: string }[] = [];
  let current: { type: string | null; text: string } | null = null;
  const stats: PageStat[] = [];
  let stat: PageStat | null = null;
  const quickSpec: string[] = [];
  let quickItem = '';
  let personalFee: number | undefined;
  let businessFee: number | undefined;
  let imageSourceUrl: string | undefined;

  const rewriter = new HTMLRewriter()
    .on('script', {
      element(el) {
        current = { type: el.getAttribute('type'), text: '' };
        scripts.push(current);
      },
      text(t) {
        if (current) current.text += t.text;
        if (t.lastInTextNode) current = null;
      },
    })
    .on('lease-term-config-form', {
      element(el) {
        const p = Number(el.getAttribute('personal-processing-fee'));
        const b = Number(el.getAttribute('business-processing-fee'));
        if (Number.isFinite(p) && p > 0) personalFee = p;
        if (Number.isFinite(b) && b > 0) businessFee = b;
      },
    })
    .on('.key-vehicle-details__item', {
      element() {
        stat = { value: '', unit: '', label: '' };
        stats.push(stat);
      },
    })
    .on('.key-vehicle-details__value', {
      text(t) {
        if (stat) stat.value += t.text;
      },
    })
    .on('.key-vehicle-details__unit', {
      text(t) {
        if (stat) stat.unit += t.text;
      },
    })
    .on('.key-vehicle-details__label', {
      text(t) {
        if (stat) stat.label += t.text;
      },
    })
    .on('.quick-spec__item', {
      element() {
        quickItem = '';
        quickSpec.push('');
      },
      text(t) {
        quickItem += t.text;
        quickSpec[quickSpec.length - 1] = quickItem;
      },
    })
    .on('img.derivative-gallery__img', {
      element(el) {
        const src = el.getAttribute('src');
        if (src && (imageSourceUrl === undefined || /viewPoint=1(?!\d)/i.test(src))) imageSourceUrl = decodeEntities(src);
      },
    });

  // Drain the transformed stream so every handler runs.
  await rewriter.transform(new Response(html)).arrayBuffer();

  const initScript = scripts.find((s) => s.text.includes('window.motorleaseInit.manufacturerSlug'));
  if (!initScript) throw new OfferPageError('This page does not look like a DreamLease offer page (no vehicle data found).');
  const init = parseInitBlock(initScript.text);
  const raw = (k: string): string | undefined => (typeof init[k] === 'string' && (init[k] as string).trim() !== '' ? (init[k] as string).trim() : undefined);
  // what a person reads is decoded; the slugs below go back to the site's API exactly as it wrote them
  const str = (k: string): string | undefined => {
    const v = raw(k);
    return v === undefined ? undefined : decodeEntities(v).replace(/\s+/g, ' ').trim();
  };
  const num = (k: string): number | undefined => {
    const v = init[k];
    const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
    return Number.isFinite(n) ? n : undefined;
  };

  const make = str('manufacturer');
  const model = str('model');
  const derivative = str('derivative');
  const slugs = { manufacturer: raw('manufacturerSlug'), model: raw('modelSlug'), bodyStyle: raw('bodyStyleSlug'), derivative: raw('derivativeSlug') };
  if (!make || !model || !derivative || !slugs.manufacturer || !slugs.model || !slugs.bodyStyle || !slugs.derivative) {
    throw new OfferPageError('The offer page is missing vehicle details; the site may have changed.');
  }

  // The site's JSON-LD is not always valid JSON (an unbalanced brace on 14 Sept 2026), so read the
  // one figure we want with a regex rather than a parser. It is a cross-check, not the source of truth.
  let ldPrice: number | undefined;
  const ld = scripts.find((s) => s.type === 'application/ld+json');
  const lp = ld?.text.match(/"lowPrice"\s*:\s*"?(\d+(?:\.\d+)?)"?/);
  if (lp) ldPrice = Number(lp[1]);

  const cleanStats = stats
    .map((s) => ({ value: decodeEntities(s.value.replace(s.unit, '')).replace(/\s+/g, ' ').trim(), unit: decodeEntities(s.unit).replace(/\s+/g, ' ').trim(), label: decodeEntities(s.label).replace(/\s+/g, ' ').trim() }))
    .filter((s) => s.value && s.label);

  const specItems = quickSpec.map((s) => decodeEntities(s).replace(/\s+/g, ' ').trim()).filter(Boolean);
  const fuelType = specItems.find((s) => FUEL_WORDS.includes(s.toLowerCase()));
  const tags = (str('tags') ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);

  const defaults: PageData['defaults'] = {};
  const dIr = num('offerToDisplay_initialRental');
  const dCl = num('offerToDisplay_contractLength');
  const dAm = num('offerToDisplay_annualMileage');
  const dFt = str('offerToDisplay_financeType');
  if (dIr !== undefined) defaults.initialRental = dIr;
  if (dCl !== undefined) defaults.contractLength = dCl;
  if (dAm !== undefined) defaults.annualMileage = dAm;
  if (typeof init['offerToDisplay_includeMaintenance'] === 'boolean') defaults.includeMaintenance = init['offerToDisplay_includeMaintenance'] as boolean;
  if (dFt) defaults.financeType = dFt;

  const page: PageData = {
    make,
    model,
    derivative,
    slugs: { manufacturer: slugs.manufacturer, model: slugs.model, bodyStyle: slugs.bodyStyle, derivative: slugs.derivative },
    isBusiness: init['isBusiness'] === true,
    isVan: init['isVan'] === true,
    tags,
    defaults,
    processingFee: {},
    stats: cleanStats,
  };
  const transmission = str('transmission');
  const bodyStyle = str('bodystyle');
  const doors = num('doors');
  if (transmission) page.transmission = transmission;
  if (bodyStyle) page.bodyStyle = bodyStyle;
  if (doors !== undefined) page.doors = doors;
  if (fuelType) page.fuelType = fuelType;
  if (personalFee !== undefined) page.processingFee.personal = personalFee;
  if (businessFee !== undefined) page.processingFee.business = businessFee;
  if (imageSourceUrl) page.imageSourceUrl = imageSourceUrl;
  if (ldPrice !== undefined) page.ldPrice = ldPrice;
  return page;
}
