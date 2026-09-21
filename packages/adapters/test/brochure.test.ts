import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { Brochure, BrochureSearch } from '@offer-mailer/schema';
import type { Brochure as BrochureT, BrochureSearch as BrochureSearchT } from '@offer-mailer/schema';
import {
  FINDER_VERSION,
  FirecrawlBrochureSource,
  ManualBrochureError,
  acceptSearchOutcome,
  brochureExpiresAt,
  docType,
  editionDate,
  ensureBrochure,
  findBrochure,
  isBrochureExpired,
  isEditionTooOld,
  isEnglish,
  isEuropeanMarket,
  isOfficialHost,
  isRestOfWorld,
  labelledLinks,
  manualBrochure,
  modelHint,
  modelMatcher,
  modelVariants,
  pdfUrlsInHtml,
  ukMarker,
  ukPathOnOfficial,
  urlDate,
} from '../src/index.js';
import type { BrochureRepo, BrochureStore, Downloaded, FinderHttp, FirecrawlClient } from '../src/index.js';
import { BY, NOW, pdfBytes } from './helpers.js';

// ---------- the finder's rules ----------

describe('finder rules', () => {
  it('recognises the official site from the brand in the host, and refuses dealers, press and vans sites', () => {
    for (const [url, make] of [
      ['https://www.kia.com/uk/new-cars/ev2/', 'Kia'], ['https://xpengcars.co.uk/models/g6/', 'XPENG'], ['https://omodaauto.co.uk/downloads/', 'Omoda'],
      ['https://www.cupraofficial.co.uk/cars/born', 'Cupra'], ['https://www.mercedes-benz.co.uk/passengercars/', 'Mercedes-Benz'], ['https://media-assets.mazda.eu/raw/upload/mazdauk/x.pdf', 'Mazda'],
      ['https://cdn.group.renault.com/ren/gb/brochures/r5.pdf', 'Renault'], ['https://www.volkswagen.co.uk/en/new/id4.html', 'Volkswagen'],
    ] as const) expect(isOfficialHost(url, make), url).toBe(true);
    for (const [url, make] of [
      ['https://www.berrycroydonbmw.co.uk/cars/i4/', 'BMW'], ['https://www.kiapressoffice.com/models/ev2', 'Kia'], ['https://www.volkswagen-vans.co.uk/en/download-a-brochure.html', 'Volkswagen'],
      ['https://uat.bmw-birdautomotive.in/x.pdf', 'BMW'], ['http://www.bmw-brochure-downloads.co.uk/BMW_i4_Pricing.pdf', 'BMW'], ['https://autocatalogarchive.com/Kia-EV2.pdf', 'Kia'],
    ] as const) expect(isOfficialHost(url, make), url).toBe(false);
  });

  it('counts a loose UK path marker only on the official host', () => {
    expect(ukMarker('https://www.kia.com/content/dam/kwcms/kme/uk/en/ev2.pdf')).toBe(true);
    expect(ukMarker('https://www.kia.com/eu/new-cars/ev2/')).toBe(false);
    expect(ukPathOnOfficial('https://www.byd.com/material/byd-site/byd-uk/specifications/SEAL.pdf', 'BYD')).toBe(true);
    expect(ukPathOnOfficial('https://random-dealer.com/byd-uk/SEAL.pdf', 'BYD')).toBe(false);
  });

  it('types a document from its own words, and drops anything that is not sales literature', () => {
    expect(docType('Download brochure')).toBe('brochure');
    expect(docType('IONIQ_5_Tech_and_Spec_Guidepdf')).toBe('spec');
    expect(docType('New e-C3 price and specification guide')).toBe('price-guide');
    expect(docType('View pricelist')).toBe('price-guide');
    for (const t of ['View Manual', 'ORA Service Warranty 2025', 'Getting started leaflet', 'Qashqai accessories brochure', 'MG ZS Hybrid Press Pack', 'Modern Slavery Statement']) expect(docType(t), t).toBe('manual');
    expect(docType('Build and price')).toBe('unknown');
  });

  it('takes the newest of the text date and the URL date', () => {
    const now = new Date('2026-09-18T00:00:00Z');
    // MG: a January 2026 file that quotes June 2025 in a footnote
    expect(editionDate('WLTP figures correct as of June 2025', 'https://www.mg.co.uk/sites/default/files/2026-01/MG_ZS_Range_Brochure_Jan_2026.pdf', now)?.date.toISOString().slice(0, 7)).toBe('2026-01');
    // Ford: a stale file name on a reissued document
    expect(editionDate('Effective from 4 August 2026', 'https://www.ford.co.uk/price-list/PL-en_gb-puma-october-2025.pdf', now)?.date.toISOString().slice(0, 10)).toBe('2026-08-04');
    expect(editionDate('no dates here', 'https://example.com/a.pdf', now)).toBeUndefined();
  });

  it("keeps a link's own text apart from its neighbours", () => {
    const md = '- [Brochure](https://dmassets.hyundai.com/IONIQ_5_Brochurepdf)\n- [Tech and Spec Guide](https://dmassets.hyundai.com/IONIQ_5_Tech_and_Spec_Guidepdf)';
    const links = labelledLinks(md, 'https://www.hyundai.com/uk/en/models/ioniq5/downloads.html');
    expect(links.map((l) => l.own)).toEqual(['Brochure', 'Tech and Spec Guide']);
    expect(docType(links[1]?.own ?? '')).toBe('spec');
  });

  it('decides what is worth opening more loosely than it judges the document: a numeric model may stand alone or behind the make’s initial', () => {
    // Renault files the Renault 4 brochure as "R4-eBrochure.pdf", under a title that never names the car
    const r4 = 'https://cdn.group.renault.com/ren/gb/transversal-assets/brochures/car-ebrochures/R4-eBrochure.pdf.asset.pdf/e75ad659a3.pdf';
    expect(modelMatcher('Renault', '4')(r4)).toBe(false);
    expect(modelHint('Renault', '4')(`[PDF] 1 July 2026 - Renault Group ${r4}`)).toBe(true);
    expect(modelHint('Peugeot', '208')('https://www.peugeot.co.uk/content/dam/peugeot/uk/brochures/208-brochure.pdf')).toBe(true);
    // but never another model's number, a year, or a number buried in a word
    expect(modelHint('Renault', '4')('https://cdn.group.renault.com/ren/gb/brochures/Renault-5-eBrochure.pdf.asset.pdf/01b54430c6.pdf')).toBe(false);
    expect(modelHint('Renault', '5')('https://cdn.group.renault.com/ren/gb/brochures/clio-brochure-2025.pdf')).toBe(false);
    expect(modelHint('Renault', '4')('https://cdn.group.renault.com/ren/gb/brochures/e75ad654a3.pdf')).toBe(false);
    // a named model is the strict matcher, unchanged
    expect(modelHint('Kia', 'EV3')('ev3-brochure.pdf')).toBe(true);
    expect(modelHint('Kia', 'EV3')('ev6-brochure.pdf')).toBe(false);
  });

  it('finds the PDFs a page offers through a button: addresses that only its embedded data carries, slashes escaped', () => {
    const html = '<button><span>Download Geely EX2 Brochure</span></button><script>{"file":{"value":{"src":"\\u002F-\\u002Fmedia\\u002Fportal-site\\u002Ffile\\u002Fgeely-ex2\\u002Fgeely_ex2_brochure.pdf"}},"other":"https:\\/\\/cdn.example.com\\/a\\/spec-sheet.pdf?v=2","img":"/x/photo.png"}</script><a href="/docs/warranty.pdf">w</a>';
    expect(pdfUrlsInHtml(html, 'https://www.geelyauto.co.uk/models/geely-ex2')).toEqual([
      'https://www.geelyauto.co.uk/-/media/portal-site/file/geely-ex2/geely_ex2_brochure.pdf',
      'https://cdn.example.com/a/spec-sheet.pdf',
      'https://www.geelyauto.co.uk/docs/warranty.pdf',
    ]);
    expect(pdfUrlsInHtml('no documents here', 'https://example.com/')).toEqual([]);
  });

  it('tells a European market (the fallback tier) from the rest of the world (never a source)', () => {
    for (const u of ['https://www.polestar.com/dato-assets/11286/1775572382-fleet_polestar-2_brochure_my27_eu_260402.pdf', 'https://www.kia.com/eu/new-cars/ev2/', 'https://www.volkswagen.ie/brochures/id4.pdf', 'https://www.bmw.com/de_de/i4.pdf', 'https://www.kia.com/ie/ev3-brochure.pdf']) {
      expect(isEuropeanMarket(u), u).toBe(true);
      expect(isRestOfWorld(u), u).toBe(false);
    }
    for (const u of ['https://www.polestar.com/dato-assets/11286/1725628156-general_polestar-2_brochure_my25_australia_240905.pdf', 'https://www.kia.com/au/ev3.pdf', 'https://www.bmw.com/en_us/i4.pdf', 'https://www.byd.com/sg/seal.pdf', 'https://www.mg.co.nz/zs.pdf']) {
      expect(isRestOfWorld(u), u).toBe(true);
      expect(isEuropeanMarket(u), u).toBe(false);
    }
    for (const u of ['https://www.kia.com/content/dam/kwcms/kme/uk/en/ev2.pdf', 'https://media-assets.mazda.eu/raw/upload/mazdauk/x.pdf', 'https://www.mg.co.uk/sites/default/files/2026-01/MG_ZS.pdf']) expect(isEuropeanMarket(u) || isRestOfWorld(u), u).toBe(false);
    expect(isOfficialHost('https://www.volkswagen.ie/brochures/id4.pdf', 'Volkswagen')).toBe(true);
  });

  it('reads a CMS file name for its date: an upload timestamp in front, a compact edition date in the name', () => {
    const now = new Date('2026-09-18T00:00:00Z');
    const day = (u: string) => urlDate(u, now)?.toISOString().slice(0, 10);
    expect(day('https://www.polestar.com/dato-assets/11286/1775572382-fleet_polestar-2_brochure_my27_eu_260402.pdf')).toBe('2026-04-07');
    expect(day('https://www.polestar.com/dato-assets/11286/1772703091-polestar-4_brochure_fleet_my26_202509.pdf')).toBe('2026-03-05');
    expect(day('https://example.com/files/ev3_brochure_240905.pdf')).toBe('2024-09-05');
    expect(day('https://example.com/files/ev3_brochure_20260115.pdf')).toBe('2026-01-15');
    // not dates: a model number, a date far in the future, a long serial
    expect(day('https://example.com/files/peugeot-2008-brochure.pdf')).toBeUndefined();
    expect(day('https://example.com/files/brochure_301231.pdf')).toBeUndefined();
    expect(day('https://example.com/files/brochure_20250704101255.pdf')).toBeUndefined();
    // the text said July 2024 in a footnote; the file is from April 2026: the newest wins
    expect(editionDate('Figures correct as of July 2024.', 'https://www.polestar.com/dato-assets/11286/1775572382-fleet_polestar-2_brochure_my27_eu_260402.pdf', now)).toMatchObject({ from: 'url' });
  });

  it('recognises English running text, and refuses German, French, a bilingual page and a bare table', () => {
    const en = 'The Polestar 2 is an electric performance fastback. It is designed for the way you drive, with a range of up to 659 km and the power that you would expect from a car of this kind. Your car will be ready for you when you are, and all of its software is kept up to date over the air. This brochure is for the European market and the specification may vary from one country to the next. ';
    const de = 'Der Polestar 2 ist ein elektrisches Fastback mit hoher Leistung. Er ist für die Art und Weise entwickelt, wie Sie fahren, mit einer Reichweite von bis zu 659 km und der Leistung, die Sie von einem Fahrzeug dieser Klasse erwarten. Ihr Fahrzeug ist bereit, wenn Sie es sind, und die Software wird über das Internet auf dem neuesten Stand gehalten. Die Ausstattung kann sich von Land zu Land unterscheiden und wird nicht in allen Märkten angeboten. ';
    const fr = 'La Polestar 2 est une berline électrique performante. Elle est conçue pour votre façon de conduire, avec une autonomie qui peut aller au-delà de 659 km et la puissance que vous attendez pour une voiture de ce type. Votre voiture est prête quand vous êtes prêt, et les logiciels sont mis à jour à distance. Les équipements varient selon les pays et ne sont pas proposés dans tous les marchés. ';
    expect(isEnglish(en)).toBe(true);
    expect(isEnglish(de)).toBe(false);
    expect(isEnglish(fr)).toBe(false);
    expect(isEnglish(en + de)).toBe(false);
    expect(isEnglish('Polestar 2 82 kWh 659 km 310 kW 4.5 s 205 km/h WLTP 14.8 kWh/100 km')).toBe(false);
  });

  it('does not let a short or numeric model name match everything', () => {
    expect(modelMatcher('Renault', '5')('Renault-5-eBrochure.pdf')).toBe(true);
    expect(modelMatcher('Renault', '5')('Clio 5 door brochure')).toBe(false);
    expect(modelMatcher('MG', 'ZS')('MG_ZS_Range_Brochure')).toBe(true);
    expect(modelMatcher('MG', 'ZS')('mg-hs-plug-in')).toBe(false);
    expect(modelVariants('E-3008')).toEqual(['E-3008', '3008']);
    expect(modelVariants('Q4 e-tron')).toEqual(['Q4 e-tron', 'Q4']);
    expect(modelVariants('Frontera')).toEqual(['Frontera']);
  });
});

// ---------- replayed searches ----------
// Real Firecrawl responses recorded on 17–18 Sept 2026 while the finder was proven against hand-checked
// manufacturer sites. Zero credits: the client below answers from test/fixtures/finder.

interface Recorded {
  path: string;
  body: { query?: string; url?: string; categories?: string[]; parsers?: unknown[] };
  response: { data?: { web?: { url: string; title?: string; description?: string }[]; markdown?: string; rawHtml?: string; metadata?: { statusCode?: number; totalPages?: number } } };
}
const FIXTURE_DIR = new URL('./fixtures/finder/', import.meta.url);
const recorded: Recorded[] = readdirSync(FIXTURE_DIR).map((f) => JSON.parse(readFileSync(new URL(f, FIXTURE_DIR), 'utf8')) as Recorded);

function replayClient(): FirecrawlClient {
  return {
    async search(q, opts) {
      const hit = recorded.find((r) => r.path === '/search' && r.body.query === q && !!r.body.categories === !!opts?.categories);
      if (!hit) throw new Error(`no recorded search for: ${q}`);      return { results: (hit.response.data?.web ?? []).map((w) => ({ url: w.url, ...(w.title ? { title: w.title } : {}) })), creditsUsed: 2 };
    },
    async scrape(url, opts) {
      const hit = recorded.find((r) => r.path === '/scrape' && r.body.url === url && !!r.body.parsers === !!opts?.pdfMaxPages);
      if (!hit) throw new Error(`no recorded scrape for: ${url}`);      const d = hit.response.data ?? {};
      return { ...(d.markdown !== undefined ? { markdown: d.markdown } : {}), ...(d.rawHtml !== undefined ? { rawHtml: d.rawHtml } : {}), ...(d.metadata?.statusCode ? { statusCode: d.metadata.statusCode } : {}), ...(d.metadata?.totalPages ? { totalPages: d.metadata.totalPages } : {}), creditsUsed: opts?.pdfMaxPages ? 4 : 1 };
    },
    async map() {
      return { links: [], creditsUsed: 1 };
    },
    async fetchFile() {
      return { bytes: new ArrayBuffer(0), contentType: null, ok: false, creditsUsed: 2 };
    },
  };
}

const noHttp: FinderHttp = async () => undefined;
const REPLAY_NOW = new Date('2026-09-18T09:00:00.000Z');
const replay = (make: string, model: string, http: FinderHttp = noHttp) => findBrochure({ make, model }, { firecrawl: replayClient(), http, now: () => REPLAY_NOW });

describe('findBrochure (replayed against recorded manufacturer sites)', () => {
  it('Kia EV2: takes the official UK brochure PDF from a global domain', async () => {
    const r = await replay('Kia', 'EV2');
    expect(r).toMatchObject({ status: 'verified_pdf', documentType: 'brochure', officialSite: 'kia.com' });
    expect(r.url).toContain('/uk/en/');
    expect(r.url).toContain('ev2-brochure.pdf');
    expect(r.editionDate).toMatch(/^2026-/);
  });

  it('XPENG G6: prefers the newest edition', async () => {
    expect((await replay('XPENG', 'G6')).url).toContain('August-2026');
  });

  it('Hyundai Ioniq 5: picks the brochure, not the spec guide next to it', async () => {
    const r = await replay('Hyundai', 'Ioniq 5');
    expect(r).toMatchObject({ status: 'verified_pdf', documentType: 'brochure' });
    expect(r.url).toContain('IONIQ_5_Brochure');
  });

  it('MG ZS: a January 2026 brochure is not rejected for quoting June 2025', async () => {
    const r = await replay('MG', 'ZS');
    expect(r.status).toBe('verified_pdf');
    expect(r.url).toContain('MG_ZS_Range_Brochure_Jan_2026.pdf');
  });

  it('Citroën ë-C3: the full model name wins over the C3 guide, and a price guide is typed as one', async () => {
    const r = await replay('Citroen', 'e-C3');
    expect(r).toMatchObject({ status: 'verified_pdf', documentType: 'price_spec_guide' });
    expect(r.url).toContain('New-e-C3-price-and-specification-guide.pdf');
  });

  it('BYD Seal: finds the UK leaflet on the model page; "/byd-uk/" counts as UK on the official host', async () => {
    const r = await replay('BYD', 'Seal');
    expect(r).toMatchObject({ status: 'verified_pdf', documentType: 'price_spec_guide' });
    expect(r.url).toContain('byd-uk');
    expect(r.candidates.filter((c) => c.status === 'rejected').some((c) => /another market/.test(c.reasons.join()))).toBe(true);
  });

  it('Jaecoo 7: attaches the web brochure its downloads page links, never the owner manuals beside it', async () => {
    const r = await replay('Jaecoo', '7');
    expect(r).toMatchObject({ status: 'verified_web_brochure', documentType: 'brochure', url: 'https://omoda.foleon.com/brochure/omodajaecoo-7/' });
    expect(r.candidates.every((c) => !/cworigin/.test(c.url) || c.status !== 'accepted')).toBe(true);
  });

  it('VW ID.4: rejects the 2021 used-car guide on the official UK domain, and "Request an appointment" is not a brochure request', async () => {
    const r = await replay('Volkswagen', 'ID.4');
    expect(r.status).toBe('not_verified');
    expect(r.url).toBeUndefined();
    const old = r.candidates.find((c) => c.url.includes('id4-brochure-pricelist-april-21.pdf'));
    expect(old?.status).toBe('rejected');
    expect(old?.reasons.join()).toMatch(/archived or used-car/);
  });

  it('Audi Q4 e-tron: a configurator or a call-back form is never a document, and Audi Ireland’s price guides are not a fallback', async () => {
    const r = await replay('Audi', 'Q4 e-tron');
    expect(r.status).toBe('not_verified');
    // the fallback opens the official Irish documents (recorded 21 Sept 2026): euro price lists, so never used
    const irish = r.candidates.filter((c) => c.url.includes('/country/ie/'));
    expect(irish.length).toBeGreaterThan(0);
    for (const c of irish) expect(c.reasons.join(), c.url).toMatch(/European price & spec guide is never used|older than/);
  });

  it('Denza Z9 GT: no official UK document means nothing is attached, aggregator copies included', async () => {
    const r = await replay('Denza', 'Z9 GT');
    expect(r.status).toBe('not_verified');
    expect(r.candidates.find((c) => c.url.includes('autocatalogarchive'))?.reasons.join()).toMatch(/aggregator/);
  });

  it('Volvo EX30: a pricelists hub page is never attached by itself', async () => {
    const r = await replay('Volvo', 'EX30');
    expect(['official_page_only', 'not_verified']).toContain(r.status);
    expect(r.status).not.toBe('verified_web_brochure');
  });

  it('Leapmotor C10: a document whose storage refuses everyone is official_page_only, not a download', async () => {
    const wrapped = 'https://leapmotor-website-prod.s3.eu-central-1.amazonaws.com/public/en-cms/1782890463953C10_Q3.pdf';
    const http: FinderHttp = async (url) => ({ status: 200, contentType: 'text/html;charset=utf-8', finalUrl: url, text: async () => `<script>{"url":"${wrapped}"}</script>` });
    const r = await replay('Leapmotor', 'C10', http);
    expect(r).toMatchObject({ status: 'official_page_only', documentType: 'price_spec_guide', assetRetrievable: false, url: 'https://www.leapmotor.net/uk/price-guides' });
  });

  it('Polestar 2 (recorded 21 Sept 2026): no UK brochure exists, so the current European fleet brochure in English is attached as one', async () => {
    const r = await findBrochure({ make: 'Polestar', model: '2' }, { firecrawl: replayClient(), http: noHttp, now: () => new Date('2026-09-21T09:00:00.000Z') });
    expect(r).toMatchObject({ status: 'verified_pdf', market: 'eu', documentType: 'brochure', officialSite: 'polestar.com', editionDate: '2026-04-07' });
    expect(r.url).toContain('fleet_polestar-2_brochure_my27_eu_260402.pdf');
    expect(r.flags).toContain('european_edition');
    // the file quotes July 2024 in a footnote: the date in its name is the newer one and wins
    expect(r.candidates[0]?.evidence).toMatchObject({ market: 'eu', english: true, dateFrom: 'url' });
    expect(r.candidates.find((c) => c.url.includes('australia'))?.reasons).toEqual(['another market’s URL']);
  });

  it('Renault 4 (recorded 21 Sept 2026): opens "R4-eBrochure.pdf" although neither its title nor its address says "Renault 4"', async () => {
    const r = await findBrochure({ make: 'Renault', model: '4' }, { firecrawl: replayClient(), http: noHttp, now: () => new Date('2026-09-21T11:00:00.000Z') });
    expect(r).toMatchObject({ status: 'verified_pdf', market: 'uk', documentType: 'brochure', officialSite: 'renault.co.uk', editionDate: '2026-07-01' });
    expect(r.url).toContain('/ren/gb/transversal-assets/brochures/car-ebrochures/R4-eBrochure.pdf');
    // the Renault 5 brochure beside it is never mistaken for it, and never opened
    expect(r.candidates.find((c) => c.url.includes('Renault-5-eBrochure'))?.status).not.toBe('accepted');
    expect(r.pagesOpened).toEqual(['https://www.renault.co.uk/brochures.html']);
  });

  it('Geely EX2 (recorded 21 Sept 2026): the UK page offers the brochure through a button, so it is read from the page’s own data', async () => {
    const r = await findBrochure({ make: 'Geely', model: 'EX2' }, { firecrawl: replayClient(), http: noHttp, now: () => new Date('2026-09-21T11:30:00.000Z') });
    expect(r).toMatchObject({ status: 'verified_pdf', market: 'uk', documentType: 'brochure', officialSite: 'geelyauto.co.uk', fromPage: 'https://www.geelyauto.co.uk/models/geely-ex2' });
    expect(r.url).toBe('https://www.geelyauto.co.uk/-/media/portal-site/file/geely-ex2/geely_ex2_brochure.pdf');
    expect(r.candidates[0]).toMatchObject({ via: 'model-page', status: 'accepted', evidence: { linkedFromOfficial: true, ukDomainOrPath: true } });
    // the brochure is preferred to the spec sheet offered beside it, and another market's copy on a CDN is never opened
    expect(r.candidates.find((c) => c.url.includes('spec-sheet'))?.status).not.toBe('accepted');
    expect(r.candidates.find((c) => c.url.includes('datocms-assets.com'))?.status).not.toBe('accepted');
  });

  it('reports a failed search as search_failed, never as "not found"', async () => {
    const broken: FirecrawlClient = { ...replayClient(), search: async () => { throw new Error('Firecrawl /search answered HTTP 502'); } };
    const r = await findBrochure({ make: 'Kia', model: 'EV2' }, { firecrawl: broken, http: noHttp, now: () => REPLAY_NOW });
    expect(r.status).toBe('search_failed');
    expect(r.reason).toMatch(/could not be completed/);
  });
});

// ---------- the Firecrawl source: retrieval and records ----------

const store: BrochureStore = {
  async putPdf(bytes) {
    return { key: `brochures/${'c'.repeat(64)}.pdf`, url: `https://offers.dreamlease.co.uk/f/brochures/${'c'.repeat(64)}.pdf`, sizeBytes: bytes.byteLength, sha256: 'c'.repeat(64) };
  },
};

const PDF_URL = 'https://www.kia.com/content/dam/kwcms/kme/uk/en/assets/ev3-brochure-june-2026.pdf';
const PDF_TEXT = `The Kia EV3. ${'Specification and equipment. '.repeat(10)} Prices from £32,995 OTR. UK specification shown. Kia UK Limited. June 2026.`;

function scriptedClient(o: { fileOk?: boolean } = {}): FirecrawlClient & { fetched: string[] } {
  const fetched: string[] = [];
  return {
    fetched,
    async search(_q, opts) {
      return { results: opts?.categories ? [{ url: PDF_URL, title: '[PDF] The Kia EV3 brochure' }] : [{ url: 'https://www.kia.com/uk/new-cars/ev3/', title: 'Kia EV3 | Kia UK' }], creditsUsed: 2 };
    },
    async scrape(url, opts) {
      return opts?.pdfMaxPages ? { markdown: PDF_TEXT, totalPages: 28, creditsUsed: 4 } : { markdown: `# ${url}`, statusCode: 200, creditsUsed: 1 };
    },
    async map() {
      return { links: [], creditsUsed: 1 };
    },
    async fetchFile(url) {
      fetched.push(url);
      return { bytes: o.fileOk ? pdfBytes() : new ArrayBuffer(0), contentType: o.fileOk ? 'application/pdf' : null, ok: !!o.fileOk, creditsUsed: 2 };
    },
  };
}

const source = (firecrawl: FirecrawlClient, download: (url: string) => Promise<Downloaded>) =>
  new FirecrawlBrochureSource({ firecrawl, http: noHttp, download, store, createdBy: BY, now: () => NOW, newId: () => 'b0000000-0000-4000-8000-000000000009' });
const directOk = async (): Promise<Downloaded> => ({ bytes: pdfBytes(), contentType: 'application/pdf' });
const directBlocked = async (): Promise<Downloaded> => ({ bytes: new ArrayBuffer(0), contentType: null });

describe('FirecrawlBrochureSource', () => {
  it('stores a verified PDF and records what it is, where it came from and which finder chose it', async () => {
    const fc = scriptedClient();
    const { brochure: b, search } = await source(fc, directOk).find({ make: 'Kia', model: 'EV3' });
    expect(b && Brochure.parse(b)).toEqual(b);
    expect(b).toMatchObject({ kind: 'pdf', source: 'harvest', documentType: 'brochure', sourceUrl: PDF_URL, editionDate: '2026-06-01', vehicleKey: 'kia/ev3', title: 'Kia EV3 brochure (UK)', finder: { status: 'verified_pdf' }, ukVerified: { by: 'content' } });
    expect(b?.file?.key).toMatch(/^brochures\/[a-f0-9]{64}\.pdf$/);
    expect(fc.fetched).toEqual([]); // the direct download worked: no Firecrawl credit spent on the file
    expect(BrochureSearch.parse(search)).toEqual(search);
    expect(search).toMatchObject({ status: 'verified_pdf', assetRetrievable: true, searchedBy: BY });
  });

  it('falls back to Firecrawl when the manufacturer CDN blocks the direct download', async () => {
    const fc = scriptedClient({ fileOk: true });
    const { brochure } = await source(fc, directBlocked).find({ make: 'Kia', model: 'EV3' });
    expect(brochure?.kind).toBe('pdf');
    expect(fc.fetched).toEqual([PDF_URL]);
  });

  it('downgrades to official_page_only when the file cannot be retrieved at all, and attaches nothing', async () => {
    const { brochure, search } = await source(scriptedClient({ fileOk: false }), directBlocked).find({ make: 'Kia', model: 'EV3' });
    expect(brochure).toBeUndefined();
    expect(search).toMatchObject({ status: 'official_page_only', assetRetrievable: false, assetUrl: PDF_URL });
  });

  it('lets the rep accept an official page or a request form, taking the URL from the stored search', async () => {
    const { search } = await source(scriptedClient({ fileOk: false }), directBlocked).find({ make: 'Kia', model: 'EV3' });
    const accepted = acceptSearchOutcome(search, { vehicle: { make: 'Kia', model: 'EV3' }, createdBy: BY, now: () => NOW });
    expect(accepted && Brochure.parse(accepted)).toMatchObject({ kind: 'web', documentType: 'brochure', ukVerified: { by: 'user' }, finder: { status: 'official_page_only' } });
    const form: BrochureSearchT = { ...search, status: 'brochure_request', documentType: 'brochure_request_form', url: 'https://www.bmw.co.uk/en/topics/discover/forms/download-brochure/bmw_4_series_i4_rfi.html' };
    expect(acceptSearchOutcome(form, { vehicle: { make: 'BMW', model: 'i4' }, createdBy: BY })?.kind).toBe('gated');
    expect(acceptSearchOutcome({ ...search, status: 'not_verified' }, { vehicle: { make: 'Kia', model: 'EV3' }, createdBy: BY })).toBeUndefined();
  });
});

// ---------- the European English-language fallback (21 Sept 2026) ----------
// Scripted from the real Polestar 2 search of 21 Sept 2026: the UK site links no brochure, and the only current
// document on polestar.com is the European fleet brochure, which quotes July 2024 in a footnote.

const EU_PDF = 'https://www.polestar.com/dato-assets/11286/1775572382-fleet_polestar-2_brochure_my27_eu_260402.pdf';
const AU_PDF = 'https://www.polestar.com/dato-assets/11286/1725628156-general_polestar-2_brochure_my25_australia_240905.pdf';
const PROSE = 'It is designed for the way that you drive, with the power that you would expect from a car of this kind, and all of its software is kept up to date over the air. Your car will be ready for you when you are. The specification that is shown in this brochure may vary from one market to the next, and not all of the options are offered with every version. ';
const EU_TEXT = `Polestar 2. The electric performance fastback. ${PROSE.repeat(2)} Range of up to 659 km (WLTP). Figures correct as of July 2024.`;
const DE_PROSE = 'Er ist für die Art und Weise entwickelt, wie Sie fahren, mit der Leistung, die Sie von einem Fahrzeug dieser Klasse erwarten, und die Software wird über das Internet auf dem neuesten Stand gehalten. Die Ausstattung kann sich von Land zu Land unterscheiden und wird nicht in allen Märkten angeboten. ';
const DE_TEXT = `Polestar 2. Das elektrische Fastback. ${DE_PROSE.repeat(2)} Reichweite bis zu 659 km (WLTP).`;

function fallbackClient(pdfs: { url: string; title?: string; text: string }[], make = 'Polestar', page = 'https://www.polestar.com/uk/polestar-2/'): FirecrawlClient & { read: string[] } {
  const read: string[] = [];
  return {
    read,
    async search(_q, opts) {
      return { results: opts?.categories ? pdfs.map((p) => ({ url: p.url, title: p.title ?? '[PDF] brochure' })) : [{ url: page, title: `${make} UK` }], creditsUsed: 2 };
    },
    async scrape(url, opts) {
      if (!opts?.pdfMaxPages) return { markdown: '# The model page links no documents', statusCode: 200, creditsUsed: 1 };
      read.push(url);
      return { markdown: pdfs.find((p) => p.url === url)?.text ?? '', totalPages: 51, creditsUsed: 4 };
    },
    async map() {
      return { links: [], creditsUsed: 1 };
    },
    async fetchFile() {
      return { bytes: pdfBytes(), contentType: 'application/pdf', ok: true, creditsUsed: 2 };
    },
  };
}
const find = (fc: FirecrawlClient, make = 'Polestar', model = '2') => findBrochure({ make, model }, { firecrawl: fc, http: noHttp, now: () => REPLAY_NOW });

describe('findBrochure: a document seen twice', () => {
  it('keeps "linked from the official site" when the search had already turned the same file up on a CDN host', async () => {
    const cdn = 'https://assets.ctfassets.net/abc123/ev3-brochure-june-2026.pdf';
    const page = 'https://www.kia.com/uk/new-cars/ev3/brochure/';
    const fc: FirecrawlClient = {
      async search(_q, opts) {
        return { results: opts?.categories ? [{ url: cdn, title: '[PDF] The Kia EV3' }] : [{ url: page, title: 'Kia EV3 brochure | Kia UK' }], creditsUsed: 2 };
      },
      async scrape(_url, opts) {
        return opts?.pdfMaxPages ? { markdown: PDF_TEXT, totalPages: 28, creditsUsed: 4 } : { markdown: `# Brochures\n- [Download the EV3 brochure](${cdn})`, statusCode: 200, creditsUsed: 1 };
      },
      async map() {
        return { links: [], creditsUsed: 1 };
      },
      async fetchFile() {
        return { bytes: new ArrayBuffer(0), contentType: null, ok: false, creditsUsed: 2 };
      },
    };
    const r = await findBrochure({ make: 'Kia', model: 'EV3' }, { firecrawl: fc, http: noHttp, now: () => REPLAY_NOW });
    expect(r).toMatchObject({ status: 'verified_pdf', market: 'uk', url: cdn, fromPage: page });
    expect(r.candidates[0]).toMatchObject({ via: 'official-page', status: 'accepted', linkText: 'Download the EV3 brochure' });
  });
});

describe('findBrochure: the European English-language fallback', () => {
  it('Polestar 2: no UK edition, so the manufacturer’s current European brochure in English is attached and marked as one', async () => {
    const fc = fallbackClient([{ url: AU_PDF, text: EU_TEXT }, { url: EU_PDF, text: EU_TEXT }]);
    const r = await find(fc);
    expect(r).toMatchObject({ status: 'verified_pdf', market: 'eu', documentType: 'brochure', url: EU_PDF, editionDate: '2026-04-07' });
    expect(r.flags).toContain('european_edition');
    expect(r.reason).toMatch(/European English-language brochure/);
    expect(r.candidates[0]).toMatchObject({ url: EU_PDF, status: 'accepted', evidence: { market: 'eu', english: true } });
    // Australia is the rest of the world: dropped on its address, never opened
    expect(r.candidates.find((c) => c.url === AU_PDF)).toMatchObject({ status: 'rejected', reasons: ['another market’s URL'] });
    expect(fc.read).toEqual([EU_PDF]);
  });

  it('the UK edition still wins: a European copy beside it is never opened', async () => {
    const eu = 'https://www.kia.com/content/dam/kwcms/kme/eu/en/assets/ev3-brochure_eu_260601.pdf';
    const fc = fallbackClient([{ url: eu, text: EU_TEXT.replaceAll('Polestar 2', 'Kia EV3') }, { url: PDF_URL, text: PDF_TEXT }], 'Kia', 'https://www.kia.com/uk/new-cars/ev3/');
    const r = await find(fc, 'Kia', 'EV3');
    expect(r).toMatchObject({ status: 'verified_pdf', market: 'uk', url: PDF_URL });
    expect(r.flags).not.toContain('european_edition');
    expect(fc.read).toEqual([PDF_URL]);
    expect(r.candidates.find((c) => c.url === eu)?.reasons.join()).toMatch(/another market’s URL \(a European edition: not needed/);
  });

  it('refuses a European brochure that is not in English', async () => {
    const r = await find(fallbackClient([{ url: EU_PDF, text: DE_TEXT }]));
    expect(r.status).toBe('not_verified');
    expect(r.market).toBeUndefined();
    expect(r.candidates.find((c) => c.url === EU_PDF)?.reasons).toContain('not in English');
  });

  it('never uses a European price & spec guide: not the UK’s prices or trims', async () => {
    const guide = 'https://www.polestar.com/dato-assets/11286/1775572382-polestar-2_price-list_eu_260402.pdf';
    const r = await find(fallbackClient([{ url: guide, title: 'Polestar 2 price list and specification guide', text: `${EU_TEXT} Prices from €49,900.` }]));
    expect(r.status).toBe('not_verified');
    expect(r.candidates.find((c) => c.url === guide)?.reasons.join()).toMatch(/European price & spec guide is never used/);
  });

  it('a document that does not say which market it is for is not passed off as European; one priced in euros is, and is flagged', async () => {
    const plain = 'https://www.polestar.com/dato-assets/11286/1775572382-polestar-2_brochure_my27.pdf';
    const no = await find(fallbackClient([{ url: plain, text: EU_TEXT }]));
    expect(no.status).toBe('not_verified');
    expect(no.candidates.find((c) => c.url === plain)?.reasons).toContain('nothing says this is a European edition');
    expect(no.queries.at(-1)).toMatch(/Ireland Europe \[pdf\]/); // nothing European turned up, so the fallback ran its own search

    const priced = fallbackClient([{ url: plain, text: `${EU_TEXT} From €49,900.` }]);
    const yes = await find(priced);
    expect(yes).toMatchObject({ status: 'verified_pdf', market: 'eu' });
    expect(yes.flags).toEqual(expect.arrayContaining(['european_edition', 'euro_pricing']));
    expect(priced.read).toEqual([plain]); // re-judged from the first reading: the document is never paid for twice
  });

  it('records a European edition as what it is: titled, marked and noted, never "(UK)"', async () => {
    const { brochure: b, search } = await source(fallbackClient([{ url: EU_PDF, text: EU_TEXT }]), directOk).find({ make: 'Polestar', model: '2' });
    expect(b && Brochure.parse(b)).toEqual(b);
    expect(b).toMatchObject({ kind: 'pdf', market: 'eu', title: 'Polestar 2 brochure (European edition)', sourceUrl: EU_PDF, finder: { version: FINDER_VERSION, status: 'verified_pdf', flags: ['european_edition'] } });
    expect(b?.ukVerified.note).toMatch(/European English-language edition: no UK edition verified/);
    expect(BrochureSearch.parse(search)).toEqual(search);
    expect(search.market).toBe('eu');
  });
});

// ---------- manual ----------

describe('manualBrochure', () => {
  const base = { vehicle: { make: 'Kia', model: 'EV3' }, createdBy: BY, download: directOk, store, now: () => NOW, newId: () => 'b0000000-0000-4000-8000-000000000010' };

  it('stores a PDF link as pdf and a page link as gated', async () => {
    const pdf = await manualBrochure({ ...base, url: 'https://www.kia.co.uk/ev3.pdf' });
    expect(pdf).toMatchObject({ kind: 'pdf', source: 'manual', ukVerified: { by: 'user' } });
    expect(pdf.file?.sizeBytes).toBeGreaterThan(0);
    const gated = await manualBrochure({ ...base, url: 'https://www.kia.co.uk/request-a-brochure' });
    expect(gated.kind).toBe('gated');
    expect(Brochure.parse(gated)).toEqual(gated);
  });

  it('stores an uploaded PDF and rejects non-PDF uploads and http links', async () => {
    const up = await manualBrochure({ ...base, pdf: { bytes: pdfBytes(), contentType: 'application/pdf' } });
    expect(up.kind).toBe('pdf');
    await expect(manualBrochure({ ...base, pdf: { bytes: new TextEncoder().encode('hello').buffer as ArrayBuffer, contentType: 'text/plain' } })).rejects.toThrow(ManualBrochureError);
    await expect(manualBrochure({ ...base, url: 'http://www.kia.co.uk/ev3.pdf' })).rejects.toThrow(ManualBrochureError);
    await expect(manualBrochure({ ...base })).rejects.toThrow(ManualBrochureError);
  });

  it('fetches a pasted PDF link through Firecrawl when the manufacturer blocks the direct download', async () => {
    const fetchFile = vi.fn(directOk);
    const b = await manualBrochure({ ...base, download: directBlocked, fetchFile, url: 'https://www.kia.com/uk/ev3.pdf' });
    expect(b.kind).toBe('pdf');
    expect(fetchFile).toHaveBeenCalledOnce();
    await expect(manualBrochure({ ...base, download: directBlocked, url: 'https://www.kia.com/uk/ev3.pdf' })).rejects.toThrow('That link did not return a PDF.');
  });
});

// ---------- ensure (stored, fresh, stale, none, remembered negatives) ----------

function memoryRepo(seed: BrochureT[] = [], searches: BrochureSearchT[] = []): BrochureRepo & { rows: BrochureT[]; searches: BrochureSearchT[] } {
  const rows = [...seed];
  return {
    rows,
    searches,
    findCurrent: async (key) => rows.find((b) => b.vehicleKey === key && b.status === 'current'),
    save: async (b) => {
      rows.push(b);
    },
    markSuperseded: async (id) => {
      const b = rows.find((r) => r.id === id);
      if (b) b.status = 'superseded';
    },
    findSearch: async (key) => searches.filter((s) => s.vehicleKey === key).at(-1),
    saveSearch: async (s) => {
      searches.push(s);
    },
  };
}

const stored = (fetchedAt: string, id = 'b0000000-0000-4000-8000-000000000001', extra: Partial<BrochureT> = {}): BrochureT => ({
  id,
  vehicleKey: 'kia/ev3',
  title: 'Kia EV3 brochure (UK)',
  kind: 'pdf',
  file: { key: `brochures/${'a'.repeat(64)}.pdf`, url: 'https://offers.dreamlease.co.uk/b/x', sizeBytes: 100, sha256: 'a'.repeat(64) },
  sourceUrl: 'https://www.kia.co.uk/ev3.pdf',
  source: 'harvest',
  ukVerified: { by: 'domain' },
  fetchedAt,
  expiresAt: brochureExpiresAt(new Date(fetchedAt)),
  status: 'current',
  createdBy: BY,
  ...extra,
});

const searchRecord = (status: BrochureSearchT['status'], searchedAt = NOW.toISOString(), finderVersion: string = FINDER_VERSION): BrochureSearchT => ({
  vehicleKey: 'kia/ev3', vehicle: 'Kia EV3', status, flags: [], queries: ['q'], pagesOpened: [], candidates: [], credits: 4, durationMs: 900, finderVersion, searchedAt, searchedBy: BY, reason: 'nothing passed',
});

const EV3 = { make: 'Kia', model: 'EV3' };

describe('ensureBrochure', () => {
  it('uses a stored, unexpired copy and spends nothing', async () => {
    const find = vi.fn();
    const r = await ensureBrochure(EV3, { repo: memoryRepo([stored('2026-09-01T00:00:00.000Z')]), harvester: { kind: 'firecrawl', find }, now: () => NOW });
    expect(r.state).toBe('stored');
    expect(find).not.toHaveBeenCalled();
  });

  it('searches again after 90 days and supersedes the old copy only once the new one is saved', async () => {
    const old = stored('2026-06-01T00:00:00.000Z');
    expect(isBrochureExpired(old, NOW)).toBe(true);
    const repo = memoryRepo([old]);
    const fresh = stored(NOW.toISOString(), 'b0000000-0000-4000-8000-000000000002');
    const r = await ensureBrochure(EV3, { repo, harvester: { kind: 'firecrawl', find: async () => ({ brochure: fresh, search: searchRecord('verified_pdf') }) }, now: () => NOW });
    expect(r.state).toBe('fresh');
    expect(r.brochure?.id).toBe(fresh.id);
    expect(repo.rows.find((b) => b.id === old.id)?.status).toBe('superseded');
    expect(repo.searches).toHaveLength(1);
  });

  it('keeps an expired copy, flagged stale, when the new search finds nothing', async () => {
    const old = stored('2026-06-01T00:00:00.000Z');
    const repo = memoryRepo([old]);
    const r = await ensureBrochure(EV3, { repo, harvester: { kind: 'firecrawl', find: async () => ({ search: searchRecord('not_verified') }) }, now: () => NOW });
    expect(r).toMatchObject({ state: 'stale', error: 'nothing passed' });
    expect(r.brochure?.id).toBe(old.id);
    expect(repo.rows[0]?.status).toBe('current');
  });

  it('does not send a document whose edition has aged past the limit since it was found', async () => {
    const aged = stored('2026-08-20T00:00:00.000Z', undefined, { documentType: 'price_spec_guide', editionDate: '2026-02-01' });
    expect(isEditionTooOld(aged, NOW)).toBe(true);
    expect(isEditionTooOld({ ...aged, documentType: 'brochure' }, NOW)).toBe(false);
    const r = await ensureBrochure(EV3, { repo: memoryRepo([aged]), harvester: { kind: 'firecrawl', find: async () => ({ search: searchRecord('not_verified') }) }, now: () => NOW });
    expect(r.state).toBe('none');
    expect(r.brochure).toBeUndefined();
  });

  it('remembers "nothing found" for 7 days, never remembers a failed search, and searches again when forced', async () => {
    const find = vi.fn(async () => ({ search: searchRecord('not_verified') }));
    const repo = memoryRepo();
    expect(await ensureBrochure(EV3, { repo, harvester: { kind: 'firecrawl', find }, now: () => NOW })).toMatchObject({ state: 'none', search: { status: 'not_verified' } });
    expect(await ensureBrochure(EV3, { repo, harvester: { kind: 'firecrawl', find }, now: () => NOW })).toMatchObject({ state: 'none', remembered: true });
    expect(find).toHaveBeenCalledTimes(1);
    await ensureBrochure(EV3, { repo, harvester: { kind: 'firecrawl', find }, now: () => NOW, force: true });
    expect(find).toHaveBeenCalledTimes(2);
    const later = new Date(NOW.getTime() + 8 * 864e5);
    await ensureBrochure(EV3, { repo, harvester: { kind: 'firecrawl', find }, now: () => later });
    expect(find).toHaveBeenCalledTimes(3);

    const failing = vi.fn(async () => ({ search: searchRecord('search_failed') }));
    const repo2 = memoryRepo();
    await ensureBrochure(EV3, { repo: repo2, harvester: { kind: 'firecrawl', find: failing }, now: () => NOW });
    await ensureBrochure(EV3, { repo: repo2, harvester: { kind: 'firecrawl', find: failing }, now: () => NOW });
    expect(failing).toHaveBeenCalledTimes(2);
    expect(repo2.searches).toHaveLength(0);
  });

  it('searches again when the remembered "nothing found" was reached under older rules', async () => {
    const find = vi.fn(async () => ({ search: searchRecord('not_verified') }));
    const repo = memoryRepo([], [searchRecord('not_verified', NOW.toISOString(), 'finder-1.0')]);
    expect(await ensureBrochure(EV3, { repo, harvester: { kind: 'firecrawl', find }, now: () => NOW })).not.toHaveProperty('remembered');
    expect(find).toHaveBeenCalledTimes(1);
  });
});
