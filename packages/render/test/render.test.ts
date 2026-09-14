import { describe, expect, it } from 'vitest';
import { Rendered, findCapIdLeak } from '@offer-mailer/schema';
import type { TemplateLayout } from '@offer-mailer/schema';
import { render, resolveLayout, TemplateNotApprovedError, RenderError } from '../src/index.js';
import { fixtureCampaign, fixtureTemplate } from '../src/fixtures/index.js';

const BASE = 'https://offers.dreamlease.co.uk';
const r = (o: Parameters<typeof fixtureCampaign>[0] = {}) => {
  const { campaign, brochures } = fixtureCampaign(o);
  return { campaign, out: render(campaign, fixtureTemplate, { publicBaseUrl: BASE, brochures }) };
};

describe('layout resolution', () => {
  it('auto picks single / grid2 / stack by count and never grid3', () => {
    expect(resolveLayout('auto', 1)).toBe('single');
    expect(resolveLayout('auto', 2)).toBe('grid2');
    expect(resolveLayout('auto', 3)).toBe('stack');
    expect(resolveLayout('auto', 4)).toBe('grid2');
    expect(resolveLayout('auto', 6)).toBe('grid2');
    expect(resolveLayout('grid3', 5)).toBe('grid3');
  });
});

describe('render()', () => {
  it('returns a valid Rendered object', () => {
    const { out } = r();
    expect(Rendered.parse(out)).toEqual(out);
    expect(out.layout).toBe('stack');
  });

  it('refuses a template that is not approved', () => {
    const { campaign } = fixtureCampaign();
    expect(() => render(campaign, { ...fixtureTemplate, status: 'draft' }, { publicBaseUrl: BASE })).toThrow(TemplateNotApprovedError);
  });

  it('refuses offers whose contract type disagrees with the compliance variant', () => {
    const { campaign } = fixtureCampaign({ contractType: 'business' });
    campaign.compliance.variant = 'personal';
    expect(() => render(campaign, fixtureTemplate, { publicBaseUrl: BASE })).toThrow(RenderError);
  });

  it('renders every layout for every contract type without a CAP ID or unsupported CSS', () => {
    const layouts: TemplateLayout[] = ['single', 'stack', 'grid2', 'grid3'];
    for (const contractType of ['personal', 'business', 'salary_sacrifice'] as const) {
      for (const layout of layouts) {
        const { out } = r({ layout, contractType, offerCount: layout === 'single' ? 1 : 4, brochure: 'pdf', cta: { kind: 'book' } });
        expect(findCapIdLeak(out)).toBeNull();
        for (const html of [out.html, out.hostedHtml]) {
          expect(html).not.toMatch(/aspect-ratio/);
          expect(html).not.toMatch(/display:\s*(flex|grid)/);
          expect(html).not.toMatch(/@import|fonts\.googleapis|@font-face/);
          expect(html).not.toMatch(/margin:\s*-\d/);
          expect(html).not.toMatch(/<image-slot|position:relative/);
        }
      }
    }
  });

  it('gives every image width, height and alt', () => {
    const { out } = r({ layout: 'stack', offerCount: 2 });
    const imgs = out.html.match(/<img [^>]+>/g) ?? [];
    expect(imgs.length).toBeGreaterThan(0);
    for (const tag of imgs) {
      expect(tag).toMatch(/ width="\d+"/);
      expect(tag).toMatch(/ height="\d+"/);
      expect(tag).toMatch(/ alt="[^"]+"/);
    }
  });

  it('routes every http link through the redirect and leaves mailto/tel direct', () => {
    const { out } = r({ cta: { kind: 'call' }, offerCount: 2 });
    const hrefs = [...out.html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!);
    for (const href of hrefs) {
      if (/^(mailto|tel):/.test(href)) continue;
      expect(href.startsWith(`${BASE}/r/k3J9xQ2mZp8LwN4vR7tY/`)).toBe(true);
    }
    expect(hrefs.some((h) => h.startsWith('tel:01234567890'))).toBe(true);
    expect(out.links['o1-view']).toMatch(/utm_source=offer_mailer/);
    expect(out.links['o1-view']).toMatch(/utm_campaign=C-2026-0001/);
    expect(out.links['hosted']).toBe('https://offers.dreamlease.co.uk/c/k3J9xQ2mZp8LwN4vR7tY');
  });

  it('adds the "View this offer" text link only when the CTA is not view_offer', () => {
    expect(r({ offerCount: 1 }).out.html).not.toMatch(/>View this offer<\/a><\/p>/);
    const booked = r({ offerCount: 1, cta: { kind: 'book', label: 'Book a chat with Sam' } }).out;
    expect(booked.html).toMatch(/>Book a chat with Sam</);
    expect(booked.html).toMatch(/>View this offer<\/a><\/p>/);
    expect(booked.links['o1-cta']).toBe('https://outlook.office.com/book/DreamLease@dreamlease.co.uk/');
  });

  it('rejects a CTA the sender cannot support', () => {
    const { campaign } = fixtureCampaign({ sender: 'shared', cta: { kind: 'whatsapp' } });
    expect(() => render(campaign, fixtureTemplate, { publicBaseUrl: BASE })).toThrow(/whatsapp/);
  });

  it('renders brochure links for pdf and gated with the small-print sentence', () => {
    const pdf = r({ offerCount: 1, brochure: 'pdf' }).out;
    expect(pdf.html).toMatch(/Download brochure \(PDF\)/);
    expect(pdf.html).toMatch(/Brochure figures are the manufacturer&#39;s/);
    expect(pdf.links['o1-brochure']).toBe(`${BASE}/b/b0000000-0000-4000-8000-000000000001`);
    const gated = r({ offerCount: 1, brochure: 'gated' }).out;
    expect(gated.html).toMatch(/Request a brochure/);
    expect(r({ offerCount: 1 }).out.html).not.toMatch(/brochure/i);
  });

  it('locks the compliance block and footer lines into every variant', () => {
    for (const contractType of ['personal', 'business', 'salary_sacrifice'] as const) {
      const { out } = r({ contractType });
      const block = fixtureTemplate.complianceBlocks[contractType]!;
      expect(out.html).toContain(block.title.toUpperCase());
      expect(out.html).toContain('credit broker, not a lender');
      expect(out.html).toContain('Reply to this email and tell us');
      expect(out.text).toContain(block.title.toUpperCase());
    }
  });

  it('shows both net figures and the illustrative note for salary sacrifice', () => {
    const { out } = r({ contractType: 'salary_sacrifice', layout: 'single', offerCount: 1 });
    expect(out.html).toMatch(/20% taxpayer/);
    expect(out.html).toMatch(/40% taxpayer/);
    expect(out.html).toMatch(/Net figures are illustrative/);
    expect(out.html).not.toMatch(/per month inc VAT/);
  });

  it('escapes rep-authored text', () => {
    const { campaign, brochures } = fixtureCampaign({ offerCount: 1 });
    campaign.intro = 'Hi <script>alert(1)</script> & "friends"';
    const out = render(campaign, fixtureTemplate, { publicBaseUrl: BASE, brochures });
    expect(out.html).not.toContain('<script>');
    expect(out.html).toContain('&lt;script&gt;');
  });

  it('uses no Outlook ghost tables inside the body, only the outer 640 wrapper', () => {
    for (const layout of ['stack', 'grid2', 'grid3'] as const) {
      const html = r({ layout, offerCount: 4 }).out.html;
      expect(html.match(/<!--\[if mso\]><table/g)?.length).toBe(1);
      expect(html).not.toMatch(/<!--\[if mso\]><tr>/);
    }
  });

  it('keeps the container fluid for phones and fixed for Outlook desktop', () => {
    const { out } = r({ layout: 'grid2', offerCount: 4 });
    expect(out.html).toMatch(/width="100%" style="margin:0 auto;[^"]*max-width:640px/);
    expect(out.html).toMatch(/<!--\[if mso\]><table[^>]*width="640"><tr><td><!\[endif\]-->/);
    expect(out.html).not.toMatch(/mso-padding-alt/);
    expect(out.html).not.toMatch(/text-transform/);
  });

  it('caps badges per card size and keeps them in one row', () => {
    const { campaign, brochures } = fixtureCampaign({ layout: 'grid3', offerCount: 1 });
    campaign.offers[0]!.badges = ['In stock', 'Special offer', 'Price drop'];
    const compact = render(campaign, fixtureTemplate, { publicBaseUrl: BASE, brochures }).html;
    expect(compact.match(/background:#FF8811/g)?.length).toBe(1);
    campaign.layout = 'single';
    const hero = render(campaign, fixtureTemplate, { publicBaseUrl: BASE, brochures }).html;
    expect(hero.match(/background:#FF8811/g)?.length).toBe(3);
  });

  it('omits the "View these offers online" link from the hosted page', () => {
    const { out } = r();
    expect(out.html).toContain('View these offers online');
    expect(out.hostedHtml).not.toContain('View these offers online');
    expect(out.hostedHtml).toContain('noindex');
  });

  it('is deterministic', () => {
    expect(r().out).toEqual(r().out);
  });

  it('matches the snapshot for the default fixture', () => {
    expect(r({ layout: 'single', offerCount: 1, brochure: 'pdf', cta: { kind: 'call' } }).out.html).toMatchSnapshot();
  });
});
