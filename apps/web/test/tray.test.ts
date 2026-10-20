import { describe, expect, it } from 'vitest';
import type { Brochure, Offer } from '@offer-mailer/schema';
import type { Item, PricingOptions } from '../src/api';
import { relooked, trayItem, updateRow } from '../src/tray';

// Only the fields the tray rules read; the rest of an Offer does not matter here.
const offer = (id: string, make: string, model: string, extra: Partial<Offer> = {}): Offer => ({ id, vehicle: { make, model }, ...extra }) as unknown as Offer;
const brochure = (id: string): Brochure => ({ id }) as unknown as Brochure;
const options = (term: number): PricingOptions => ({ initialRental: [], contractLength: [{ title: `${term}`, value: term }], annualMileage: [], maintenanceAvailable: false, hasBusiness: false, hasPersonal: true });
const attach = (x: Item, b: Brochure): Item => ({ ...x, brochure: b, offer: { ...x.offer, brochure: { brochureId: b.id, include: true } } });

describe('the Compose tray finds a car by its row key (0.7.11, 20 Oct 2026)', () => {
  it('gives each row its own key, even for the same offer twice (a cached lookup shares the offer id)', () => {
    const o = offer('same-id', 'Kia', 'EV3');
    const a = trayItem({ offer: o });
    const b = trayItem({ offer: o });
    expect(a.key).not.toBe(b.key);
  });

  it('lands a late brochure on the car it was searched for when an earlier car was removed meanwhile', () => {
    const [kia, bmw, vw] = [trayItem({ offer: offer('1', 'Kia', 'EV3') }), trayItem({ offer: offer('2', 'BMW', 'i4') }), trayItem({ offer: offer('3', 'VW', 'ID.3') })];
    const searching = bmw.key; // search started on the second car…
    const afterRemove = [kia, bmw, vw].filter((x) => x.key !== kia.key); // …then the first car was removed
    const done = updateRow(afterRemove, searching, (x) => attach(x, brochure('bmw-i4')));
    expect(done.map((x) => [x.offer.vehicle.model, x.offer.brochure?.brochureId])).toEqual([
      ['i4', 'bmw-i4'],
      ['ID.3', undefined],
    ]);
  });

  it('drops a late answer for a car that has itself been removed, and leaves the tray as it was', () => {
    const kia = trayItem({ offer: offer('1', 'Kia', 'EV3') });
    const tray = [kia];
    expect(updateRow(tray, 'removed-row', (x) => attach(x, brochure('b')))).toBe(tray);
  });

  it('leaves the tray as it was when the change is no change (so the created output is not dropped)', () => {
    const tray = [trayItem({ offer: offer('1', 'Kia', 'EV3') })];
    expect(updateRow(tray, tray[0]!.key, (x) => x)).toBe(tray);
  });
});

describe('a new term, mileage or initial payment keeps the car’s brochure (0.7.11)', () => {
  const before = attach(trayItem({ offer: offer('1', 'Kia', 'EV3'), options: options(36) }), brochure('kia-ev3'));

  it('keeps the brochure record, its id and the include choice as they are now, with the new price and options', () => {
    const unticked = { ...before, offer: { ...before.offer, brochure: { brochureId: 'kia-ev3', include: false } } };
    const after = relooked(unticked, offer('2', 'Kia', 'EV3'), options(24));
    expect(after.key).toBe(before.key);
    expect(after.offer.id).toBe('2');
    expect(after.options).toEqual(options(24));
    expect(after.brochure?.id).toBe('kia-ev3');
    expect(after.offer.brochure).toEqual({ brochureId: 'kia-ev3', include: false });
    expect(after.noBrochureFound).toBeUndefined();
  });

  it('keeps a search that found nothing when no brochure is attached (0.7.10)', () => {
    const none = { ...trayItem({ offer: offer('1', 'Kia', 'EV3') }), noBrochureFound: true };
    expect(relooked(none, offer('2', 'Kia', 'EV3'), options(24)).noBrochureFound).toBe(true);
  });

  it('keeps nothing when the lookup came back as a different model', () => {
    const after = relooked({ ...before, noBrochureFound: true }, offer('2', 'Kia', 'EV6'), options(24));
    expect(after.key).toBe(before.key);
    expect(after.brochure).toBeUndefined();
    expect(after.offer.brochure).toBeUndefined();
    expect(after.noBrochureFound).toBeUndefined();
  });
});
