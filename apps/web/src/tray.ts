import type { Offer } from '@offer-mailer/schema';
import type { Item, PricingOptions } from './api';

/**
 * The Compose tray's rows (0.7.11, 20 Oct 2026). A row is found by its own `key`, made when the car enters the tray and
 * kept through every re-price, never by its position: a brochure search takes 10–60 seconds, and a car removed
 * meanwhile shifted the next one into its place, so the brochure found for one model could land on another car. Nor by
 * the offer id: the same URL looked up twice within a day shares one (the lookup cache), and a new term or mileage
 * brings a new one. The key lives in this browser only (the tray and its saved draft) and is never sent to the API.
 */
export const trayItem = (x: Omit<Item, 'key'>): Item => ({ ...x, key: crypto.randomUUID() });

/** The tray with one row changed by `f`, found by its key. The same array when that row has gone or nothing changed. */
export function updateRow(items: Item[], key: string, f: (x: Item) => Item): Item[] {
  let changed = false;
  const next = items.map((x) => {
    if (x.key !== key) return x;
    const y = f(x);
    if (y !== x) changed = true;
    return y;
  });
  return changed ? next : items;
}

/**
 * A row looked up again for a new term, mileage or initial payment: the same car at a new price. A live lookup never
 * carries a brochure, so until 0.7.11 the attached brochure silently fell off the card. Now, while the make and model
 * are unchanged, the row keeps its brochure as it is NOW (the record and the offer's { brochureId, include }) and a
 * search that found nothing (0.7.10).
 */
export function relooked(x: Item, offer: Offer, options: PricingOptions): Item {
  if (x.offer.vehicle.make !== offer.vehicle.make || x.offer.vehicle.model !== offer.vehicle.model) return { key: x.key, offer, options };
  const kept = x.offer.brochure ? { ...offer, brochure: x.offer.brochure } : offer;
  return {
    key: x.key,
    offer: kept,
    options,
    ...(x.brochure ? { brochure: x.brochure } : {}),
    ...(x.noBrochureFound && !kept.brochure ? { noBrochureFound: true } : {}),
  };
}
