/**
 * Offer library CRUD inside workerd with real local D1.
 */
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { findCapIdLeak } from '@offer-mailer/schema';
import type { Offer } from '@offer-mailer/schema';
import { fixtureCampaign } from '@offer-mailer/render/fixtures';
import app from '../src/index.js';
import type { Env } from '../src/env.js';

const USER = 'matt.wilson@dreamlease.co.uk';
const authed = (over: Partial<Env> = {}): Env => ({ ...env, DEV_USER_EMAIL: USER, ...over }) as Env;
const { DEV_USER_EMAIL: _dev, ...anonRest } = env as Env;
const anon = anonRest as Env;

const anOffer = (): Offer => fixtureCampaign({ offerCount: 1 }).campaign.offers[0]!;
const save = (offer: unknown, e: Env) => app.request('/api/offers/library', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ offer }) }, e);

describe('offer library', () => {
  it('needs a login', async () => {
    expect((await save(anOffer(), anon)).status).toBe(503);
  });

  it('saves stamped with the caller, lists it, and deletes it', async () => {
    const o = anOffer();
    const res = await save(o, authed());
    expect(res.status).toBe(201);
    const saved = ((await res.json()) as { offer: Offer }).offer;
    expect(saved.createdBy).toBe(USER); // stamped, not trusting the fixture's sam.carter
    expect(findCapIdLeak(saved)).toBeNull();

    const list = (await (await app.request('/api/offers/library', {}, authed())).json()) as { offers: Offer[] };
    expect(list.offers.some((x) => x.id === o.id)).toBe(true);

    expect((await app.request(`/api/offers/library/${o.id}`, { method: 'DELETE' }, authed())).status).toBe(200);
    const after = (await (await app.request('/api/offers/library', {}, authed())).json()) as { offers: Offer[] };
    expect(after.offers.some((x) => x.id === o.id)).toBe(false);
  });

  it('rejects an invalid offer', async () => {
    expect((await save({ not: 'an offer' }, authed())).status).toBe(422);
  });

  it('never hands on the site’s HTML entity: decoded when saved, and when a row stored earlier is listed', async () => {
    const ENTITY = '110kW Techno &#x2B; Comfort Range 52kWh 5dr Auto';
    const CLEAN = '110kW Techno + Comfort Range 52kWh 5dr Auto';
    const withEntity = (id: string): Offer => ({ ...anOffer(), id, vehicle: { ...anOffer().vehicle, derivative: ENTITY } });

    // saved now (an offer still open in Compose from before the parser fix)
    const res = await save(withEntity('0e000000-0000-4000-8000-000000000001'), authed());
    expect(res.status).toBe(201);
    expect(((await res.json()) as { offer: Offer }).offer.vehicle.derivative).toBe(CLEAN);

    // stored before the fix: the row itself still carries the entity (Matt's Renault 5, 21 Sept 2026)
    const old = { ...withEntity('0e000000-0000-4000-8000-000000000002'), createdBy: USER };
    await env.DB.prepare('insert into offers (id, vehicle_key, contract_type, valid_until, created_by, created_at, updated_at, data) values (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(old.id, 'renault/5', old.contractType, old.validUntil, USER, old.createdAt, old.updatedAt, JSON.stringify(old))
      .run();

    const list = (await (await app.request('/api/offers/library', {}, authed())).json()) as { offers: Offer[] };
    const mine = list.offers.filter((x) => x.id.startsWith('0e000000-'));
    expect(mine).toHaveLength(2);
    for (const o of mine) expect(o.vehicle.derivative).toBe(CLEAN);
  });
});
