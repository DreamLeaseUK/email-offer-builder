import { describe, expect, it } from 'vitest';
import { Rendered, findCapIdLeak } from '@offer-mailer/schema';
import type { Brochure, TemplateLayout } from '@offer-mailer/schema';
import { render, resolveLayout, TemplateNotApprovedError, RenderError, MARKUP_VERSION } from '../src/index.js';
import { fixtureCampaign, fixtureTemplate } from '../src/fixtures/index.js';

const BASE = 'https://offers.dreamlease.co.uk';
const r = (o: Parameters<typeof fixtureCampaign>[0] = {}) => {
  const { campaign, brochures } = fixtureCampaign(o);
  return { campaign, out: render(campaign, fixtureTemplate, { publicBaseUrl: BASE, brochures }) };
};

describe('layout resolution', () => {
  it('auto is one offer per row: the hero for one, stacked rows for two or more, never a grid', () => {
    expect(resolveLayout('auto', 1)).toBe('single');
    for (const n of [2, 3, 4, 6]) expect(resolveLayout('auto', n)).toBe('stack');
    // a campaign that names a grid still renders as one (stored campaigns), but the tool no longer offers them
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

  it('renders the chosen secondary contact links in the signature, in the rep’s order', () => {
    const { campaign, brochures } = fixtureCampaign({ offerCount: 1, layout: 'single' });
    campaign.sender = { ...campaign.sender, secondaryContacts: ['whatsapp', 'call', 'book'] };
    const out = render(campaign, fixtureTemplate, { publicBaseUrl: BASE, brochures });
    const at = ['>WhatsApp</a>', '>Call</a>', '>Book a call</a>'].map((t) => out.html.indexOf(t));
    expect(at.every((i) => i > 0)).toBe(true);
    expect(at[0]! < at[1]! && at[1]! < at[2]!).toBe(true); // rep's chosen order preserved
    expect(out.links['sig-whatsapp']).toBe('https://wa.me/447700900123'); // http link is redirect-tracked
    expect(out.links['sig-book']).toBe('https://outlook.office.com/book/DreamLease@dreamlease.co.uk/');
    expect(out.html).toMatch(/href="tel:01234567890"/); // tel stays direct
    expect(out.links['sig-call']).toBeUndefined();
  });

  it('skips a chosen secondary method whose sender field is missing', () => {
    const { campaign, brochures } = fixtureCampaign({ offerCount: 1, layout: 'single' });
    campaign.sender = { ...campaign.sender, phone: undefined, secondaryContacts: ['call', 'whatsapp'] };
    const out = render(campaign, fixtureTemplate, { publicBaseUrl: BASE, brochures });
    expect(out.html).not.toContain('>Call</a>');
    expect(out.html).toContain('>WhatsApp</a>');
  });

  it('adds no secondary contact row by default (keeps the reference signature)', () => {
    expect(r({ offerCount: 1, layout: 'single' }).out.html).not.toContain('>WhatsApp</a>');
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

  it('matches the cards in a row: one reserves the badge row, brochure row and extra text lines its row-mate has', () => {
    const { campaign, brochures } = fixtureCampaign({ offerCount: 2, layout: 'grid2', brochure: 'pdf' });
    const like = render(campaign, fixtureTemplate, { publicBaseUrl: BASE, brochures }).html;
    const [a, b] = campaign.offers;
    if (!a || !b) throw new Error('fixture has two offers');
    // make the second card unlike the first: no badge, no brochure, and a model name that wraps
    b.badges = [];
    delete b.hotBadge;
    delete b.brochure;
    a.vehicle.model = 'Q4 e-tron Sportback quattro';
    const out = render(campaign, fixtureTemplate, { publicBaseUrl: BASE, brochures }).html;
    const cards = out.split('class="card-cell"').slice(1);
    expect(cards).toHaveLength(2);
    const [first, second] = cards as [string, string];
    // the badge-less card holds the badge row open with an empty pill of the same box (no orange, no text)
    expect(first).toContain('background-color:#FF8811');
    expect(second).not.toContain('background-color:#FF8811');
    expect(second).toContain('<td width="100" style="width:100px; padding:3px 10px; font-size:11px; line-height:14px; mso-line-height-rule:exactly;">&nbsp;</td>');
    // it holds the brochure link row open too (8px margin + 16px line), and its one-line model takes two lines' height
    expect(second).toContain('<td height="24" style="font-size:0; line-height:0; height:24px;">&nbsp;</td>');
    expect(second).toMatch(/font-weight:bold; color:#000000; min-height:52px;/);
    expect(first).not.toMatch(/color:#000000; min-height/);
    // like-for-like cards reserve nothing: the markup is exactly the reference's
    expect(like).not.toMatch(/min-height:52px|height="24"/);
  });

  it('matches rows, not the whole email: an odd card out on its own row reserves nothing', () => {
    const { campaign, brochures } = fixtureCampaign({ offerCount: 3, layout: 'grid2' });
    campaign.offers.forEach((o, i) => { if (i < 2) { o.badges = []; delete o.hotBadge; } });
    const cards = render(campaign, fixtureTemplate, { publicBaseUrl: BASE, brochures }).html.split('class="card-cell"').slice(1);
    // row one has no badges at all, row two is a single card: nobody reserves anything
    for (const c of cards.slice(0, 2)) expect(c).not.toContain('<td width="100" style="width:100px; padding:3px 10px;');
    expect(cards[2]).toContain('background-color:#FF8811');
  });

  it('tells the recipient when the brochure is the manufacturer’s European edition, and only then', () => {
    const european = (layout: 'single' | 'grid3') => {
      const { campaign, brochures } = fixtureCampaign({ offerCount: layout === 'grid3' ? 3 : 1, layout, brochure: 'pdf' });
      const id = Object.keys(brochures)[0]!;
      return render(campaign, fixtureTemplate, { publicBaseUrl: BASE, brochures: { [id]: { ...brochures[id]!, market: 'eu' } } });
    };
    const card = european('single');
    expect(card.html).toContain('may differ from this offer. This is the manufacturer&#39;s European brochure; specification, equipment and prices may differ from UK models.');
    expect(card.text).toContain("This is the manufacturer's European brochure; specification, equipment and prices may differ from UK models.");
    expect(card.html).toContain('Download brochure (PDF)'); // the link itself is unchanged
    // grid3 has one shared footnote for every card
    expect(european('grid3').html).toContain('Where a brochure is the manufacturer&#39;s European edition, specification, equipment and prices may differ from UK models.');
    // a UK brochure (market absent or 'uk') says nothing of the kind
    expect(r({ offerCount: 1, brochure: 'pdf' }).out.html).not.toMatch(/European/);
    expect(r({ offerCount: 3, layout: 'grid3', brochure: 'pdf' }).out.html).not.toMatch(/European/);
  });

  it("labels a web brochure and a price & spec guide as what they are, in the reference's external-link construction", () => {
    const withBrochure = (patch: Partial<Brochure>, layout: 'single' | 'grid3' = 'single') => {
      const { campaign, brochures } = fixtureCampaign({ offerCount: layout === 'grid3' ? 3 : 1, layout, brochure: 'gated' });
      const id = Object.keys(brochures)[0]!;
      return render(campaign, fixtureTemplate, { publicBaseUrl: BASE, brochures: { [id]: { ...brochures[id]!, ...patch } } });
    };
    const web = withBrochure({ kind: 'web', documentType: 'brochure' });
    expect(web.html).toContain('>View brochure</a>');
    expect(web.html).toContain('icon-external-2x.png');
    expect(web.html).not.toMatch(/Request a brochure|Download brochure/);
    expect(web.text).toContain('View brochure: ');

    const guidePage = withBrochure({ kind: 'web', documentType: 'price_spec_guide' });
    expect(guidePage.html).toContain('>View price &amp; spec guide</a>');
    expect(withBrochure({ kind: 'web', documentType: 'price_spec_guide' }, 'grid3').html).toContain('>Price &amp; spec guide</a>');

    const { campaign, brochures } = fixtureCampaign({ offerCount: 1, brochure: 'pdf' });
    const id = Object.keys(brochures)[0]!;
    const guidePdf = render(campaign, fixtureTemplate, { publicBaseUrl: BASE, brochures: { [id]: { ...brochures[id]!, documentType: 'price_spec_guide' } } });
    expect(guidePdf.html).toContain('>Download price &amp; spec guide (PDF)</a>');
    expect(guidePdf.html).toContain('icon-doc-2x.png');
    // the structure is the gated / pdf construction: only the words differ
    const strip = (h: string) => h.replace(/>[^<]+</g, '><');
    expect(strip(web.html)).toBe(strip(withBrochure({}).html));
  });

  it('shows the same, even number of stat tiles on every card in a multi-offer email', () => {
    const { campaign, brochures } = fixtureCampaign({ offerCount: 2, layout: 'grid2' });
    campaign.offers[1]!.vehicle.stats = campaign.offers[1]!.vehicle.stats!.slice(0, 2); // one card exposes only two
    const out = render(campaign, fixtureTemplate, { publicBaseUrl: BASE, brochures });
    // both cards drop to two tiles (no lonely tile), so the 3rd/4th stats disappear from BOTH
    expect(out.html).not.toContain('BATTERY');
    expect(out.html).not.toContain('WARRANTY');
    expect(out.html).toContain('RANGE');
  });

  it('keeps an odd stat count on a single hero (rendered in one row)', () => {
    const { campaign, brochures } = fixtureCampaign({ offerCount: 1, layout: 'single' });
    campaign.offers[0]!.vehicle.stats = campaign.offers[0]!.vehicle.stats!.slice(0, 3);
    expect(render(campaign, fixtureTemplate, { publicBaseUrl: BASE, brochures }).html).toContain('BATTERY');
  });

  it('shows the standard £299.99 processing fee on every PCH card, even when the offer carried none', () => {
    const personal = fixtureCampaign({ offerCount: 1, contractType: 'personal' });
    delete personal.campaign.offers[0]!.pricing.processingFee; // the site returned no fee for this one
    expect(render(personal.campaign, fixtureTemplate, { publicBaseUrl: BASE, brochures: personal.brochures }).html).toMatch(/Processing fee £299\.99 inc VAT/);

    // BCH keeps whatever its pricing carried (here: none) — the PCH rule does not force it (first stage)
    const business = fixtureCampaign({ offerCount: 1, contractType: 'business' });
    delete business.campaign.offers[0]!.pricing.processingFee;
    expect(render(business.campaign, fixtureTemplate, { publicBaseUrl: BASE, brochures: business.brochures }).html).not.toMatch(/Processing fee/);
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

  // The v5 reference markup's non-negotiables (docs/status: 14 Sept, "Offer Mailer implementation notes").
  it('wraps every card group in a ghost table with one ghost td per card, in rows', () => {
    const ghostCells = (html: string, width: number) => html.match(new RegExp(`<!--\\[if mso\\]>[^<]*(?:<[^!][^<]*)*?<td width="${width}" valign="top"><!\\[endif\\]-->`, 'g'))?.length ?? 0;
    const grid4 = r({ layout: 'grid2', offerCount: 4 }).out.html;
    expect(ghostCells(grid4, 288)).toBe(4);
    expect(grid4.match(/<!--\[if mso\]><\/td><\/tr><tr><td width="288" valign="top"><!\[endif\]-->/g)?.length).toBe(1); // two rows
    const grid3 = r({ layout: 'grid3', offerCount: 6 }).out.html;
    expect(ghostCells(grid3, 192)).toBe(6);
    expect(grid3.match(/<!--\[if mso\]><\/td><\/tr><tr><td width="192" valign="top"><!\[endif\]-->/g)?.length).toBe(1);
    const odd = r({ layout: 'grid2', offerCount: 3 }).out.html;
    expect(ghostCells(odd, 288)).toBe(3);
    const stack = r({ layout: 'stack', offerCount: 3 }).out.html;
    expect(ghostCells(stack, 250)).toBe(3);
    expect(ghostCells(stack, 300)).toBe(3);
    const hero = r({ layout: 'single', offerCount: 1, brochure: 'pdf' }).out.html;
    expect(hero).toMatch(/<!--\[if mso\]><table[^>]*><tr><td valign="middle"><!\[endif\]-->/);
  });

  it('builds buttons with td padding, a block anchor and mso-padding-alt, and no VML', () => {
    for (const layout of ['single', 'stack', 'grid2', 'grid3'] as const) {
      const html = r({ layout, offerCount: layout === 'single' ? 1 : 3 }).out.html;
      const buttons = html.match(/<td align="center" style="background-color:#31BD51;[^"]*">/g) ?? [];
      expect(buttons.length).toBe(layout === 'single' ? 1 : 3);
      for (const b of buttons) expect(b).toMatch(/mso-padding-alt:0/);
      expect(html.match(/<a href="[^"]+" style="display:block;[^"]*color:#FFFFFF; text-decoration:none;" class="lock-white">/g)?.length).toBe(buttons.length);
      expect(html).not.toMatch(/v:roundrect/);
    }
  });

  it('fixes the image sizes and pill widths the reference specifies, inside a fluid wrapper that tops out at 600px', () => {
    expect(r({ layout: 'single', offerCount: 1 }).out.html).toMatch(/<img [^>]*width="550" height="413"/);
    expect(r({ layout: 'stack', offerCount: 2 }).out.html).toMatch(/<img [^>]*width="218" height="164"/);
    expect(r({ layout: 'grid2', offerCount: 2 }).out.html).toMatch(/<img [^>]*width="262" height="197"/);
    expect(r({ layout: 'grid3', offerCount: 3 }).out.html).toMatch(/<img [^>]*width="166" height="125"/);
    expect(r({ layout: 'single', offerCount: 1 }).out.html).toMatch(/<td width="126" align="center" class="lock-white" style="width:126px;/);
    expect(r({ layout: 'grid2', offerCount: 2 }).out.html).toMatch(/<td width="100" align="center" class="lock-white" style="width:100px;/);
    const html = r().out.html;
    // fluid, not fixed: Outlook mobile shrank a fixed 600px layout to fit instead of reflowing it (21 Sept 2026)
    expect(html).toMatch(/width="100%" class="wrapper lock-bg" style="width:100%; max-width:600px;/);
    expect(html).toMatch(/<!--\[if mso\]>\s*<table[^>]*width="600" align="center"><tr><td>/);
    expect(html).toMatch(/<img [^>]*width="56" height="56"/); // headshot
  });

  it('forces light mode and keeps the media query as an enhancement', () => {
    const html = r({ layout: 'grid3', offerCount: 3 }).out.html;
    expect(html).toMatch(/<meta name="color-scheme" content="light only" \/>/);
    expect(html).toMatch(/\[data-ogsc\] \.lock-red/);
    for (const cls of ['lock-bg', 'lock-tint', 'lock-ink', 'lock-body', 'lock-red', 'lock-white']) expect(html).toContain(`class="${cls}`);
    expect(html).toMatch(/@media only screen and \(max-width: 480px\)/);
    expect(html).toMatch(/class="card-cell" style="display:inline-block; width:100%; max-width:192px;/);
    expect(html).not.toMatch(/margin:\s*-/);
    // spacers are cells, never margins (grid3's full-width pill needs none; grid2's floated pills do)
    expect(r({ layout: 'grid2', offerCount: 2 }).out.html).toMatch(/<td height="8" style="font-size:0; line-height:0; height:8px;">&nbsp;<\/td>/);
  });

  it('bumps MARKUP_VERSION to the v5 generation and refuses a template pinned to v1', () => {
    expect(MARKUP_VERSION).toBe(2);
    const { campaign } = fixtureCampaign();
    expect(() => render(campaign, { ...fixtureTemplate, markupVersion: 1 }, { publicBaseUrl: BASE })).toThrow(/markup v1/);
  });

  it("reflows on a phone without the media query: only classic Outlook's ghost table is 600px wide", () => {
    const { out } = r({ layout: 'grid2', offerCount: 4 });
    expect(out.html.match(/width="600"/g)?.length).toBe(1); // the [if mso] ghost wrapper only
    // the stacked row's image column is its desktop width beside the details and the full card width once wrapped
    const stacked = r({ layout: 'stack', offerCount: 2 }).out.html;
    expect(stacked).toContain('display:inline-block; width:calc((480px - 100%) * 480); min-width:250px; max-width:100%; vertical-align:top;');
    expect(stacked).toMatch(/<img [^>]*width="218" height="164"[^>]*style="display:block; border:0; width:100%; max-width:100%; height:auto;/);
    expect(out.html).toMatch(/\.wrapper \{ width: 100% !important; \}/);
    expect(out.html).toMatch(/\.card-cell \{ max-width: 100% !important; width: 100% !important; \}/);
    expect(out.html).toMatch(/\.stack-col \{ max-width: 100% !important; width: 100% !important; \}/);
    expect(out.html).toMatch(/\.fluid-img \{ width: 100% !important; height: auto !important; max-width: 100% !important; \}/);
  });

  it('caps badges at one per multi-offer card and up to three on the single hero, hot badge first', () => {
    const { campaign, brochures } = fixtureCampaign({ layout: 'grid3', offerCount: 1 });
    campaign.offers[0]!.badges = ['In stock', 'Special offer', 'Price drop'];
    campaign.offers[0]!.hotBadge = 'DreamLease exclusive!';
    const pills = (html: string) => html.match(/background-color:#FF8811/g)?.length ?? 0;
    const compact = render(campaign, fixtureTemplate, { publicBaseUrl: BASE, brochures }).html;
    expect(pills(compact)).toBe(1);
    expect(compact).toMatch(/<td align="center" class="lock-white" style="background-color:#FF8811;[^"]*">DreamLease exclusive!<\/td>/);
    campaign.layout = 'single';
    const hero = render(campaign, fixtureTemplate, { publicBaseUrl: BASE, brochures }).html;
    expect(pills(hero)).toBe(3);
    expect(hero.indexOf('DreamLease exclusive!')).toBeLessThan(hero.indexOf('>In stock<'));
    // inline-block pills, never floated: a float's clearing spacer did not survive the Outlook paste (21 Sept 2026)
    expect(hero.match(/<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="display:inline-block; vertical-align:top; margin:0 6px 8px 0;">/g)?.length).toBe(3);
    expect(hero).not.toContain('align="left"');
    campaign.layout = 'stack';
    expect(pills(render(campaign, fixtureTemplate, { publicBaseUrl: BASE, brochures }).html)).toBe(1);
    campaign.layout = 'grid2';
    expect(pills(render(campaign, fixtureTemplate, { publicBaseUrl: BASE, brochures }).html)).toBe(1);
  });

  it('omits the "View these offers online" link from the hosted page', () => {
    const { out } = r();
    expect(out.html).toContain('View these offers online');
    expect(out.hostedHtml).not.toContain('View these offers online');
    expect(out.hostedHtml).toContain('noindex');
  });

  it('greets the recipient in the email but never on the public hosted page', () => {
    const { out } = r(); // the fixture recipient is "Priya"
    expect(out.html).toContain('Hi Priya,');
    expect(out.text).toContain('Hi Priya,');
    expect(out.hostedHtml).not.toContain('Hi Priya,');
  });

  it('is deterministic', () => {
    expect(r().out).toEqual(r().out);
  });

  it('matches the snapshot for the default fixture', () => {
    expect(r({ layout: 'single', offerCount: 1, brochure: 'pdf', cta: { kind: 'call' } }).out.html).toMatchSnapshot();
  });
});
