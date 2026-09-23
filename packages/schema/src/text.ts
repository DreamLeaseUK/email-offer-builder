/**
 * Text the website hands us. The site HTML-encodes text even inside its script block: a Renault 5
 * "Techno + Comfort Range" arrives as "Techno &#x2B; Comfort Range" and was shown to the customer like that
 * (Matt, 21 Sept 2026). The lookup decodes it, but an offer is a snapshot: one saved in the library, or still
 * open in Compose, from before a parser fix carries the entity into the next email. So the same decoding runs
 * wherever an offer reaches the server (library save and load, campaign preview and create), not only at lookup.
 */
import type { Offer } from './model.js';

/** Every numeric entity, and the named ones a vehicle name or spec can carry; an unknown name is left as it is. */
const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', plus: '+', deg: '°', pound: '£', euro: '€', eacute: 'é', egrave: 'è', euml: 'ë', ecirc: 'ê', aacute: 'á', agrave: 'à', auml: 'ä', ouml: 'ö', uuml: 'ü', scaron: 'š', ccedil: 'ç', ntilde: 'ñ', sup2: '²', frac12: '½', times: '×', reg: '', trade: '' };
const fromCodePoint = (n: number, raw: string): string => (Number.isInteger(n) && n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : raw);
export const decodeEntities = (s: string): string =>
  s
    .replace(/&#x([0-9a-f]{1,6});/gi, (raw, hex: string) => fromCodePoint(parseInt(hex, 16), raw))
    .replace(/&#(\d{1,7});/g, (raw, dec: string) => fromCodePoint(Number(dec), raw))
    .replace(/&([a-z][a-z0-9]{1,9});/gi, (raw, name: string) => NAMED_ENTITIES[name] ?? NAMED_ENTITIES[name.toLowerCase()] ?? raw);

/** True when the value, serialised, still carries something that looks like an HTML entity. */
export const carriesEntity = (value: unknown): boolean => /&(#x?[0-9a-f]{1,7}|[a-z][a-z0-9]{1,9});/i.test(typeof value === 'string' ? value : (JSON.stringify(value) ?? ''));

/**
 * The offer with the site's display text decoded: the vehicle's names and stats, and the image's alt text.
 * Nothing else is touched: the offer URL goes back to the site exactly as written, and notes, badges and the
 * CTA label are ours or the salesperson's. A clean offer is returned as it came.
 */
export function decodeOfferText(offer: Offer): Offer {
  if (!carriesEntity(offer.vehicle) && !carriesEntity(offer.image?.alt)) return offer;
  const v = offer.vehicle;
  const text = (s: string): string => decodeEntities(s).replace(/\s+/g, ' ').trim() || s;
  return {
    ...offer,
    vehicle: {
      ...v,
      make: text(v.make),
      model: text(v.model),
      derivative: text(v.derivative),
      ...(v.bodyStyle !== undefined ? { bodyStyle: text(v.bodyStyle) } : {}),
      ...(v.fuelType !== undefined ? { fuelType: text(v.fuelType) } : {}),
      ...(v.transmission !== undefined ? { transmission: text(v.transmission) } : {}),
      ...(v.stats ? { stats: v.stats.map((s) => ({ label: text(s.label), value: text(s.value) })) } : {}),
    },
    ...(offer.image ? { image: { ...offer.image, alt: text(offer.image.alt) } } : {}),
  };
}
