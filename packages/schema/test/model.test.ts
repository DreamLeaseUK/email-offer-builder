import { describe, expect, it } from 'vitest';
import { Campaign, Cta, Offer, Sender, availableCtaKinds, vehicleKey } from '../src/index.js';
import { campaign, offer, sender } from './fixtures.js';

describe('Offer', () => {
  it('accepts a well-formed offer', () => {
    expect(Offer.parse(offer)).toEqual(offer);
  });

  it('requires validUntil', () => {
    const { validUntil: _drop, ...noDate } = offer;
    expect(Offer.safeParse(noDate).success).toBe(false);
  });

  it('allows a manual offer with no image', () => {
    const { image: _drop, ...noImage } = offer;
    expect(Offer.safeParse({ ...noImage, source: { kind: 'manual' } }).success).toBe(true);
  });

  it('rejects an image key that is not our R2 layout', () => {
    const bad = { ...offer, image: { ...offer.image!, key: 'vehicles/kia-ev3.jpg' } };
    expect(Offer.safeParse(bad).success).toBe(false);
  });

  it('rejects an offerUrl off dreamlease.co.uk', () => {
    expect(Offer.safeParse({ ...offer, offerUrl: 'https://example.com/x' }).success).toBe(false);
  });

  it('caps badges at three', () => {
    expect(Offer.safeParse({ ...offer, badges: ['a', 'b', 'c', 'd'] }).success).toBe(false);
  });
});

describe('Cta', () => {
  it("requires url for kind 'link'", () => {
    expect(Cta.safeParse({ kind: 'link' }).success).toBe(false);
    expect(Cta.safeParse({ kind: 'link', url: 'https://www.dreamlease.co.uk/news/' }).success).toBe(true);
  });

  it('caps the label at 30 characters', () => {
    expect(Cta.safeParse({ kind: 'call', label: 'x'.repeat(31) }).success).toBe(false);
    expect(Cta.safeParse({ kind: 'call', label: 'Call Sarah' }).success).toBe(true);
  });
});

describe('Sender', () => {
  it('validates WhatsApp as E.164', () => {
    expect(Sender.safeParse({ ...sender, whatsapp: '07700 900123' }).success).toBe(false);
    expect(Sender.safeParse(sender).success).toBe(true);
  });

  it('offers only the CTA kinds the sender can support', () => {
    expect(availableCtaKinds(sender)).toEqual(['view_offer', 'email', 'link', 'call', 'whatsapp']);
    const { whatsapp: _w, phone: _p, ...bare } = sender;
    expect(availableCtaKinds(bare)).toEqual(['view_offer', 'email', 'link']);
  });
});

describe('Campaign', () => {
  it('accepts a well-formed campaign', () => {
    expect(Campaign.parse(campaign)).toEqual(campaign);
  });

  it('requires between one and six offers', () => {
    expect(Campaign.safeParse({ ...campaign, offers: [] }).success).toBe(false);
    expect(Campaign.safeParse({ ...campaign, offers: Array(7).fill(offer) }).success).toBe(false);
  });

  it('requires a hosted slug at creation', () => {
    const { hostedPage: _drop, ...noSlug } = campaign;
    expect(Campaign.safeParse(noSlug).success).toBe(false);
  });
});

describe('vehicleKey', () => {
  it('normalises make and model', () => {
    expect(vehicleKey({ make: 'Kia', model: 'EV3' })).toBe('kia/ev3');
    expect(vehicleKey({ make: 'Hyundai ', model: 'Kona Electric' })).toBe('hyundai/kona-electric');
  });
});
