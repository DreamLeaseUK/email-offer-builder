/**
 * The pre-send checks, rule by rule, with every outside answer faked (the clock, the website, the stored files, the
 * suppression list). The route-level tests (send.test.ts) prove they are wired to the real ones.
 */
import { describe, expect, it } from 'vitest';
import { render } from '@offer-mailer/render';
import { fixtureBrochureGated, fixtureBrochurePdf, fixtureCampaign, fixtureTemplate } from '@offer-mailer/render/fixtures';
import type { Brochure, Campaign, Offer, Template } from '@offer-mailer/schema';
import type { Check, PreSendDeps, PreSendInput } from '../src/presend.js';
import { allPassed, isPriced, runPreSendChecks, storedKeyOf } from '../src/presend.js';

const NOW = new Date('2026-10-01T09:00:00Z');
const EMMA = 'emma@dreamlease.co.uk';
const approved: Template = { ...fixtureTemplate, approvedBy: EMMA, status: 'approved' };

function input(over: Partial<PreSendInput> = {}, campaignOver: Partial<Campaign> = {}, offerOver: Partial<Offer> = {}): PreSendInput {
  const { campaign: base } = fixtureCampaign({ offerCount: 2, brochure: 'none' });
  const campaign: Campaign = { ...base, offers: base.offers.map((o) => ({ ...o, validUntil: '2026-10-31', source: { ...o.source, fetchedAt: '2026-10-01T08:00:00Z' }, ...offerOver })), ...campaignOver };
  // The email itself comes from the unmodified fixture: most rules read the campaign, not the HTML.
  const rendered = render({ ...base, offers: base.offers.map((o) => ({ ...o, validUntil: '2026-10-31' })) }, approved, { publicBaseUrl: 'https://offers.dreamlease.co.uk', brochures: {} });
  return { campaign, template: approved, rendered, brochures: {}, storedLinkIds: Object.keys(rendered.links), ...over };
}

function deps(over: Partial<PreSendDeps> = {}): PreSendDeps & { rechecked: string[] } {
  const rechecked: string[] = [];
  return {
    now: NOW,
    approvers: new Set([EMMA]),
    maxEmailBytes: 90 * 1024,
    offerCheckedMs: 24 * 60 * 60 * 1000,
    pricingVersion: 2,
    recheckOffer: async (o) => {
      rechecked.push(o.id);
      return { ok: true, monthly: o.pricing.monthly };
    },
    storedFileExists: async () => true,
    linkGone: async () => false,
    isSuppressed: async () => false,
    rechecked,
    ...over,
  };
}

const failed = (checks: Check[]) => Object.fromEntries(checks.filter((c) => !c.ok).map((c) => [c.id, c.problems]));

describe('runPreSendChecks', () => {
  it('passes a good email, and skips the recipient check when no address is given (Copy for Outlook)', async () => {
    const checks = await runPreSendChecks(input(), deps());
    expect(failed(checks)).toEqual({});
    expect(allPassed(checks)).toBe(true);
    expect(checks.map((c) => c.id)).not.toContain('recipient');
  });

  it('blocks the placeholder wording (no approver), and wording approved by someone who is not compliance', async () => {
    const { approvedBy: _none, ...placeholder } = approved;
    expect(failed(await runPreSendChecks(input({ template: placeholder }), deps())).template?.[0]).toMatch(/not approved \(the placeholder\)/);
    expect(failed(await runPreSendChecks(input({ template: { ...approved, approvedBy: 'matt.wilson@dreamlease.co.uk' } }), deps())).template).toHaveLength(1);
    expect(failed(await runPreSendChecks(input({ template: { ...approved, approvedBy: 'EMMA@dreamlease.co.uk' } }), deps())).template).toBeUndefined();
  });

  it('blocks retired or missing wording, and says why an email could not be built', async () => {
    expect(failed(await runPreSendChecks(input({ template: { ...approved, status: 'retired' } }), deps())).template?.[0]).toMatch(/retired/);
    expect(failed(await runPreSendChecks(input({ template: undefined }), deps())).template?.[0]).toMatch(/no longer exists/);
    expect(failed(await runPreSendChecks(input({ rendered: undefined, renderError: 'template has no compliance block for business' }), deps())).template?.[0]).toMatch(/could not be built: template has no compliance block/);
  });

  it('blocks an unpriced offer, including salary sacrifice without both net figures', async () => {
    const zero = input({}, {}, { pricing: { ...input().campaign.offers[0]!.pricing, monthly: 0 } });
    expect(failed(await runPreSendChecks(zero, deps())).priced).toHaveLength(2);
    const salsac = { ...input().campaign.offers[0]!, contractType: 'salary_sacrifice' as const, pricing: { ...input().campaign.offers[0]!.pricing, salsac: { net20: 120, net40: 0 } } };
    expect(isPriced(salsac)).toBe(false);
    expect(isPriced({ ...salsac, pricing: { ...salsac.pricing, salsac: { net20: 120, net40: 95 } } })).toBe(true);
  });

  it('blocks an offer past its last day (UK date), and allows its last day itself', async () => {
    expect(failed(await runPreSendChecks(input({}, {}, { validUntil: '2026-09-30' }), deps())).valid?.[0]).toMatch(/ended on 30 September 2026/);
    // 23:30 UTC on 30 Sept is already 1 Oct in London
    expect(failed(await runPreSendChecks(input({}, {}, { validUntil: '2026-09-30' }), deps({ now: new Date('2026-09-30T23:30:00Z') }))).valid).toHaveLength(2);
    expect(failed(await runPreSendChecks(input({}, {}, { validUntil: '2026-10-01' }), deps())).valid).toBeUndefined();
  });

  it('counts a look-up in the last 24 hours as checked, and looks older offers up again', async () => {
    const fresh = deps();
    await runPreSendChecks(input(), fresh);
    expect(fresh.rechecked).toEqual([]);
    const stale = deps();
    await runPreSendChecks(input({}, {}, { source: { kind: 'url', fetchedAt: '2026-09-29T08:00:00Z' } }), stale);
    expect(stale.rechecked).toHaveLength(2);
  });

  // 6 Oct 2026: before PRICING_VERSION 2 the website priced a special offer at its ordinary, higher price (or POA). A
  // price looked up that way an hour ago is still looked up again, so the corrected price blocks the old one.
  it('looks up again an offer priced the old way, however recent, and blocks the old price', async () => {
    const recentOldWay = { source: { kind: 'url' as const, fetchedAt: '2026-10-01T08:00:00Z' } };
    const looked: string[] = [];
    const d = deps({ recheckOffer: async (o) => (looked.push(o.id), { ok: true, monthly: o.pricing.monthly - 100 }) });
    const live = failed(await runPreSendChecks(input({}, {}, recentOldWay), d)).live;
    expect(looked).toHaveLength(2);
    expect(live?.[0]).toMatch(/now £289 a month, not £389/);
    // a hand-entered offer has no website price to look up again
    const manual = deps();
    await runPreSendChecks(input({}, {}, { source: { kind: 'manual', fetchedAt: '2026-10-01T08:00:00Z' } }), manual);
    expect(manual.rechecked).toEqual([]);
  });

  it('blocks an offer that has ended on the website, could not be checked, or has changed price', async () => {
    const old = { source: { kind: 'url' as const, fetchedAt: '2026-09-20T08:00:00Z' } };
    expect(failed(await runPreSendChecks(input({}, {}, old), deps({ recheckOffer: async () => ({ ok: false, problem: 'the offer has ended on the website.' }) }))).live?.[0]).toMatch(/BYD Seal: the offer has ended/);
    const moved = failed(await runPreSendChecks(input({}, {}, old), deps({ recheckOffer: async (o) => ({ ok: true, monthly: o.pricing.monthly + 20 }) }))).live;
    expect(moved?.[0]).toMatch(/now £409 a month, not £389/);
    // salary sacrifice prices are entered by hand: a change in the website's personal price is not theirs to compare
    const ss = input({}, {}, { ...old, contractType: 'salary_sacrifice', pricing: { ...input().campaign.offers[0]!.pricing, salsac: { net20: 200, net40: 150 } } });
    expect(failed(await runPreSendChecks(ss, deps({ recheckOffer: async () => ({ ok: true, monthly: 999 }) }))).live).toBeUndefined();
  });

  it('blocks a missing picture, photo or brochure, and a brochure page that has gone', async () => {
    const withImage = input({}, {}, { image: { key: `vehicles/${'a'.repeat(64)}.jpg`, url: `https://offers.dreamlease.co.uk/f/vehicles/${'a'.repeat(64)}.jpg`, alt: 'car', width: 1200, height: 900 } });
    expect(failed(await runPreSendChecks(withImage, deps({ storedFileExists: async () => false }))).assets).toHaveLength(2);

    const headshot = input({}, { sender: { ...input().campaign.sender, headshotUrl: 'https://offers.dreamlease.co.uk/f/headshots/abc.jpg' } });
    const seen: string[] = [];
    const r = failed(await runPreSendChecks(headshot, deps({ storedFileExists: async (k) => (seen.push(k), false) })));
    expect(seen).toContain('headshots/abc.jpg');
    expect(r.assets?.[0]).toMatch(/photo is missing/);

    const pdf: Brochure = fixtureBrochurePdf;
    const gated: Brochure = fixtureBrochureGated;
    const withPdf = input({ brochures: { [pdf.id]: pdf } }, {}, { brochure: { brochureId: pdf.id, include: true } });
    expect(failed(await runPreSendChecks(withPdf, deps({ storedFileExists: async (k) => !k.startsWith('brochures/') }))).assets).toHaveLength(2);
    const withGated = input({ brochures: { [gated.id]: gated } }, {}, { brochure: { brochureId: gated.id, include: true } });
    expect(failed(await runPreSendChecks(withGated, deps({ linkGone: async () => true }))).assets?.[0]).toMatch(/no longer opens/);
    const gone = input({ brochures: {} }, {}, { brochure: { brochureId: gated.id, include: true } });
    expect(failed(await runPreSendChecks(gone, deps())).assets?.[0]).toMatch(/no longer exists/);
    const off = input({ brochures: {} }, {}, { brochure: { brochureId: gated.id, include: false } });
    expect(failed(await runPreSendChecks(off, deps())).assets).toBeUndefined();
  });

  it('blocks tracked links the stored link map cannot resolve', async () => {
    expect(failed(await runPreSendChecks(input({ storedLinkIds: [] }), deps())).links?.[0]).toMatch(/would not open/);
  });

  it('blocks an email too big to arrive whole, and one carrying a CAP ID', async () => {
    expect(failed(await runPreSendChecks(input(), deps({ maxEmailBytes: 1000 }))).size?.[0]).toMatch(/the limit is 1 KB/);
    const i = input();
    const leaky = { ...i, rendered: { ...i.rendered!, html: `${i.rendered!.html}<img src="https://images.motorleaseplatform.com/cvd/?capId=12345">` } };
    expect(failed(await runPreSendChecks(leaky, deps())).capid).toHaveLength(1);
  });

  it('checks the customer: a real address, not opted out', async () => {
    expect(failed(await runPreSendChecks(input({ to: 'not an email' }), deps())).recipient?.[0]).toMatch(/Enter the customer/);
    expect(failed(await runPreSendChecks(input({ to: '' }), deps())).recipient).toHaveLength(1);
    expect(failed(await runPreSendChecks(input({ to: ' priya@example.com ' }), deps({ isSuppressed: async (e) => e === 'priya@example.com' }))).recipient?.[0]).toMatch(/Suppressions list/);
    expect(failed(await runPreSendChecks(input({ to: 'priya@example.com' }), deps())).recipient).toBeUndefined();
  });
});

describe('storedKeyOf', () => {
  it('finds our stored file behind a /f/ URL, on any of our hosts', () => {
    expect(storedKeyOf('https://offers.dreamlease.co.uk/f/headshots/abc.jpg')).toBe('headshots/abc.jpg');
    expect(storedKeyOf('https://offer-mailer.matt-wilson-9b8.workers.dev/f/vehicles/x.jpg')).toBe('vehicles/x.jpg');
    expect(storedKeyOf('https://offer-mailer.matt-wilson-9b8.workers.dev/a/headshot-placeholder.png')).toBeUndefined();
    expect(storedKeyOf(undefined)).toBeUndefined();
  });
});
