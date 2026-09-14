/**
 * Diagnostic: the REAL grid2 and stack cards (badges, VML pills, stats, button, small print) in each
 * candidate construction, labelled. Built for the open issues at the 14 Sept 2026 handover:
 *   1. classic Outlook renders grid2 cards ~318px wide in a wide column (regression)
 *   2. New Outlook desktop, narrow pane: the 284px image does not fill a full-width card
 *   3. New Outlook desktop, narrow pane: the stack layout wraps its image column above the content
 *
 * Output: one .eml per section (grid, image, stack) so each stays under Gmail's ~102 KB clip when it
 * is forwarded to the phone, plus one combined .html for a browser check. Open each .eml in classic
 * Outlook, New Outlook (wide and narrow reading pane) and forward it from New Outlook to the phone.
 * For each row ID note: cards per row, card width, image width, anything broken. Rows that matter on
 * the phone come first in each email, so a clipped forward still shows them.
 *
 *   pnpm --filter @offer-mailer/render exec tsx scripts/diag-card.ts
 *
 * Every variant starts from the real card markup and applies a named transform; a transform that
 * changes nothing throws, so a row can never be mislabelled. Nothing here changes cards.ts.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { halfCard, rowCard } from '../src/cards.js';
import { fixtureCampaign } from '../src/fixtures/index.js';
import { C, FONT, LH } from '../src/html.js';
import { EMAIL_WIDTH, GRID_PAD, ROW_IMG_COL, SIDE } from '../src/layout.js';
import { Links } from '../src/links.js';
import { buildCards } from '../src/viewmodel.js';
import type { CardVM } from '../src/viewmodel.js';

const BASE = 'https://offer-mailer.matt-wilson-9b8.workers.dev';

// ---------- real cards ----------

const { campaign, brochures } = fixtureCampaign({ layout: 'grid2', offerCount: 2, brochure: 'pdf' });
const links = new Links(BASE, campaign.hostedPage.slug);
const [seal, mg4] = buildCards(campaign, { publicBaseUrl: BASE, brochures, links });
if (!seal || !mg4) throw new Error('need two fixture offers');
/** The two longest labels in config/badges.json: ~154px each at 11px, 314px together, in a 246px row. */
const sealLongBadges: CardVM = { ...seal, hot: 'DreamLease exclusive!', badges: ['Home charger included'] };

const pair = (a: CardVM = seal, b: CardVM = mg4) => halfCard(a) + halfCard(b);
const single = () => halfCard(seal);
const stack = () => rowCard(seal);

// ---------- transforms (each must change something) ----------

function must(before: string, after: string, what: string): string {
  if (before === after) throw new Error(`transform "${what}" changed nothing`);
  return after;
}

/** (a) Drop table-layout:fixed from the two card-frame tables. */
const noFixed = (h: string) => must(h, h.replace(/;table-layout:fixed/g, ''), 'noFixed');

/** Remove the invalid negative min-width the current build emits on content-sized pills (badges and buttons). */
const fixNegativeMin = (h: string) => must(h, h.replace(/;min-width:-\d+px/g, ''), 'fixNegativeMin');

/** The likely base for everything else: current markup minus table-layout:fixed, pills tidy. */
const base = (h: string) => fixNegativeMin(noFixed(h));

/** (a') Keep table-layout:fixed for HTML engines but move it into an @media screen rule, which Word skips. */
const FRAME_RE = /(<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%") style="(border-collapse:(?:collapse|separate));table-layout:fixed">/g;
const fixedViaMedia = (h: string) => must(h, h.replace(FRAME_RE, '$1 class="card-frame" style="$2">'), 'fixedViaMedia');

/**
 * (b) Give the orange badge pills a minimum width again (the stack card still uses 104): the VML
 * roundrect gets max(min, estimated) and the HTML cell gets min-width = min - 2*padH.
 */
function badgeMin(h: string, min: number, padH: number): string {
  const out = h
    .replace(/(<v:roundrect [^>]*style="height:\d+px;v-text-anchor:middle;width:)(\d+)(px"[^>]*fillcolor="#FF8811")/g, (_m, a: string, w: string, b: string) => `${a}${Math.max(min, Number(w))}${b}`)
    .replace(/;min-width:-?\d+px/g, `;min-width:${min - 2 * padH}px`);
  return must(h, out, 'badgeMin');
}

const IMG_RE = /<img src="([^"]+)" width="(\d+)" height="(\d+)" alt="([^"]*)" align="center" style="display:block;border:0;width:100%;height:auto;margin:0 auto;border-radius:15px 15px 0 0">/g;

/** Tint the image cell so the cell's extent is visible separately from the image's. */
const tintImageCell = (h: string) => must(h, h.replace(/<td style="padding:0"><img /g, '<td bgcolor="#FFE0E0" style="padding:0;background:#FFE0E0"><img '), 'tintImageCell');

/** (i) Class on the vehicle image so a media query can force width:100% in narrow panes. */
const imgClass = (h: string) => must(h, h.replace(/<img src="/g, '<img class="card-img" src="'), 'imgClass');

/** (ii) Inline !important on the image width/height. */
const imgImportant = (h: string) => must(h, h.replace(/style="display:block;border:0;width:100%;height:auto;/g, 'style="display:block;border:0;width:100% !important;height:auto !important;'), 'imgImportant');

/** (iii) No width attribute at all: CSS width:284px for Word, class + media query for narrow panes. */
const imgNoAttr = (h: string) =>
  must(h, h.replace(IMG_RE, (_m, src: string, w: string, hgt: string, alt: string) => `<img class="card-img" src="${src}" alt="${alt}" align="center" style="display:block;border:0;width:${w}px;height:${hgt}px;max-width:100%;margin:0 auto;border-radius:15px 15px 0 0">`), 'imgNoAttr');

/** (iv) min-width:100% next to width:100%, which beats a pixel width a sanitiser might inject. */
const imgMinWidth = (h: string) => must(h, h.replace(/style="display:block;border:0;width:100%;height:auto;/g, 'style="display:block;border:0;width:100%;min-width:100%;height:auto;'), 'imgMinWidth');

/** (v) Unit unlocked by device width, not pane width, so a narrow desktop pane keeps the 308px unit. */
const unitDeviceQuery = (h: string) => must(h, h.replace(/class="card-cell"/g, 'class="card-dev"'), 'unitDeviceQuery');

/** Stack: a real two-cell table row (image td, content td); phones stack the cells via media query. */
function stackRealRow(h: string): string {
  const parts = h.split('<div class="card-cell"');
  if (parts.length !== 3) throw new Error(`stackRealRow: expected two units, found ${parts.length - 1}`);
  const [prefix, a, b] = parts as [string, string, string];
  const aEnd = a.lastIndexOf('</div>');
  const bEnd = b.indexOf('</div>');
  const aInner = a.slice(a.indexOf('>') + 1, aEnd);
  const bInner = b.slice(b.indexOf('>') + 1, bEnd);
  const rest = b.slice(bEnd + '</div>'.length);
  const row = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse"><tbody><tr><td class="stack-col" width="${ROW_IMG_COL}" valign="top" style="width:${ROW_IMG_COL}px;padding:0;vertical-align:top;font-size:14px">${aInner}</td><td class="stack-col" valign="top" style="padding:0;vertical-align:top;font-size:14px">${bInner}</td></tr></tbody></table>`;
  return must(h, prefix + row + rest, 'stackRealRow');
}

/** Stack: percentage units (42% image, 58% content) so a narrow pane keeps them side by side; phones go 100%. */
function stackPercent(h: string): string {
  const out = h
    .replace(/<div class="card-cell" style="display:inline-block;width:100%;max-width:250px;vertical-align:top">/, '<div class="card-cell stack-pct" style="display:inline-block;width:42%;vertical-align:top">')
    .replace(/<div class="card-cell" style="display:inline-block;width:100%;max-width:340px;vertical-align:top">/, '<div class="card-cell stack-pct" style="display:inline-block;width:58%;vertical-align:top">');
  return must(h, out, 'stackPercent');
}

/** Pixel ruler: Word honours explicit table widths, so the bars say which width a narrow card froze at. */
const ruler = (widths: number[]) =>
  widths
    .map((w) => `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="${w}" style="border-collapse:collapse;width:${w}px"><tbody><tr><td width="${w}" height="16" bgcolor="${C.red}" style="width:${w}px;height:16px;background:${C.red};padding:0 0 0 6px;font-size:10px;line-height:16px;${LH};font-weight:700;color:${C.white}">${w}px</td></tr></tbody></table><table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tbody><tr><td height="4" style="height:4px;font-size:1px;line-height:4px">&nbsp;</td></tr></tbody></table>`)
    .join('');

// ---------- variants ----------

interface Variant {
  id: string;
  note: string;
  html: string;
  css?: string;
  /** stack rows sit in the 24px side padding like the real stack layout; grid rows in the 12px grid padding */
  kind: 'grid' | 'stack';
}

interface Section {
  key: string;
  title: string;
  ask: string;
  variants: Variant[];
}

const MIN = 104; // the stack card's badge minimum; what grid2 used before badges became content-sized
const PADH = 10;
/** Variants that are the current build as is, bugs included. */
const CONTROLS = new Set(['D1', 'S1']);

const sections: Section[] = [
  {
    key: 'grid',
    title: 'Grid width',
    ask: 'Classic Outlook: is each card full width (one per row) or narrow, and if narrow which red bar does it match? New Outlook wide pane: two cards side by side, equal width? New Outlook narrow pane and phone: one card per row, full width? D4 deliberately has two long badges on the first card: say what happens to them. D5 and D6 are controls for classic Outlook only.',
    variants: [
      { id: 'R', kind: 'stack', note: 'Ruler for classic Outlook: three bars of known width to compare a narrow card against', html: ruler([286, 302, 320]) },
      { id: 'D1', kind: 'grid', note: 'Current build (control): table-layout:fixed on the frame, content-sized badges', html: pair() },
      { id: 'D2', kind: 'grid', note: 'No table-layout:fixed, content-sized badges', html: base(pair()) },
      { id: 'D3', kind: 'grid', note: 'table-layout:fixed moved into an @media screen rule (classic Outlook skips it, everything else keeps it)', html: fixedViaMedia(fixNegativeMin(pair())), css: `@media screen{table.card-frame{table-layout:fixed}}` },
      { id: 'D4', kind: 'grid', note: 'D2 with the two longest badges on the first card: what an overflowing badge row does without table-layout:fixed', html: base(pair(sealLongBadges)) },
      { id: 'D5', kind: 'grid', note: 'Control: table-layout:fixed kept, badges back to a 104px minimum (badge row may overflow, as before)', html: badgeMin(single(), MIN, PADH) },
      { id: 'D6', kind: 'grid', note: 'Pre-regression control: no table-layout:fixed, badges at a 104px minimum (badge row may overflow, as before)', html: badgeMin(noFixed(single()), MIN, PADH) },
    ],
  },
  {
    key: 'image',
    title: 'Image width',
    ask: 'One card alone in a row; the image cell is tinted pink so you can see the cell apart from the image. Wide pane: the card is 284px so nothing to see. New Outlook narrow pane and phone: does the image fill the pink cell edge to edge, or sit centred at 284px with pink either side? I6 is different on purpose: in a narrow pane the card should stay 284px wide and centred instead of stretching. Classic Outlook: is the image still 284px (I4 may blow up there; that is the test)?',
    variants: [
      { id: 'I1', kind: 'grid', note: 'Image as now (control): width="284" attribute plus style width:100%', html: tintImageCell(base(single())) },
      { id: 'I2', kind: 'grid', note: 'Image gets class card-img; the phone media query also sets img.card-img{width:100% !important}', html: tintImageCell(imgClass(base(single()))), css: `@media (max-width:480px){img.card-img{width:100% !important;height:auto !important}}` },
      { id: 'I3', kind: 'grid', note: 'Inline width:100% !important;height:auto !important on the image', html: tintImageCell(imgImportant(base(single()))) },
      { id: 'I4', kind: 'grid', note: 'No width attribute: style width:284px;height:213px;max-width:100%, plus the class media query', html: tintImageCell(imgNoAttr(base(single()))), css: `@media (max-width:480px){img.card-img{width:100% !important;height:auto !important}}` },
      { id: 'I5', kind: 'grid', note: 'Image as now plus min-width:100% (no media query needed)', html: tintImageCell(imgMinWidth(base(single()))) },
      { id: 'I6', kind: 'grid', note: 'Image as now; the unit only goes full width on a phone-sized device, so a narrow desktop pane keeps a centred 284px card', html: tintImageCell(unitDeviceQuery(base(single()))), css: `@media only screen and (max-device-width:480px){.card-dev{max-width:100% !important}}` },
    ],
  },
  {
    key: 'stack',
    title: 'Stack card',
    ask: 'New Outlook narrow pane: is the image beside the content or above it? Wide pane and classic Outlook: beside or above? Phone: image above content, both full width? For this email also forward it from classic Outlook to the phone: S2 is a real table row and may arrive as two squeezed columns.',
    variants: [
      { id: 'S1', kind: 'stack', note: 'Current stack card (control): inline-block 250px image unit + 340px content unit', html: stack() },
      { id: 'S2', kind: 'stack', note: 'Real two-cell table row (image td 250, content td fluid); phones stack the cells via media query', html: stackRealRow(fixNegativeMin(stack())), css: `@media (max-width:480px){td.stack-col{display:block !important;width:100% !important}}` },
      { id: 'S3', kind: 'stack', note: 'Percentage units (42% image, 58% content) so a narrow pane keeps them side by side; phones go 100% via media query', html: stackPercent(fixNegativeMin(stack())), css: `@media (max-width:480px){.stack-pct{width:100% !important}}` },
    ],
  },
];

// ---------- document ----------

const STYLE = `body{margin:0;padding:0;background:${C.ground}}table{border-collapse:collapse}img{border:0;line-height:100%;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic}a{color:${C.red}}@media (max-width:480px){.card-cell{max-width:100% !important}}`;

const p = (text: string, size = 13, color = C.graphite, weight = 400) => `<p style="margin:0 0 6px 0;font-size:${size}px;line-height:${size + 6}px;${LH};font-weight:${weight};color:${color}">${text}</p>`;

function sectionRows(s: Section): string {
  let body = `<tr><td style="padding:22px ${SIDE}px 6px ${SIDE}px;border-top:1px solid ${C.border}">${p(`<b>${s.title}.</b> ${s.ask}`, 13, C.ink)}</td></tr>`;
  for (const v of s.variants) {
    body += `<tr><td style="padding:10px ${SIDE}px 4px ${SIDE}px">${p(`<span style="display:inline-block;background:${C.black};color:${C.white};padding:2px 8px;font-weight:700">${v.id}</span>&nbsp; ${v.note}`, 13, C.graphite)}</td></tr>`;
    body += v.kind === 'stack' ? `<tr><td style="padding:8px ${SIDE}px 4px ${SIDE}px">${v.html}</td></tr>` : `<tr><td style="padding:8px ${GRID_PAD}px 0 ${GRID_PAD}px;font-size:0;text-align:center">${v.html}</td></tr>`;
  }
  return body;
}

function document(title: string, secs: Section[]): string {
  const css = STYLE + secs.flatMap((s) => s.variants.map((v) => v.css ?? '')).join('');
  const head = `<tr><td style="padding:20px ${SIDE}px 4px ${SIDE}px">${p(`Card diagnostic: ${title}`, 18, C.black, 700)}${p('Same real card in different constructions. For each row ID, note cards per row, card width, image width and anything broken. Reply with the IDs that look right in each client.')}</td></tr>`;
  const container = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" width="100%" style="margin:0 auto;border-collapse:collapse;background:${C.white};width:100%;max-width:${EMAIL_WIDTH}px;font-family:${FONT};color:${C.graphite}"><tbody>${head}${secs.map(sectionRows).join('')}</tbody></table>`;
  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" lang="en-GB">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no,date=no,address=no,email=no">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>Card diagnostic: ${title}</title>
<!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><style>v\\:* { behavior: url(#default#VML); display: inline-block; }</style><![endif]-->
<style>${css}</style>
</head>
<body style="margin:0;padding:0;background:${C.ground}">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="${C.ground}" style="background:${C.ground}"><tbody><tr><td align="center" style="padding:24px 12px">
<!--[if mso]><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="${EMAIL_WIDTH}"><tr><td><![endif]-->
${container}
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></tbody></table>
</body>
</html>`;
}

/** Rules that never bend, checked on every document. */
function check(html: string, name: string, secs: Section[]): void {
  const bodyOnly = html.slice(html.indexOf('<body'));
  const conditionals = bodyOnly.match(/<!--\[if mso\]>/g) ?? [];
  const pills = bodyOnly.match(/<v:roundrect/g) ?? [];
  if (conditionals.length !== 2 + pills.length) throw new Error(`${name}: unexpected [if mso] count in body: ${conditionals.length} (pills ${pills.length})`);
  if (/align="left"\s+width=/.test(bodyOnly)) throw new Error(`${name}: floated table found`);
  if (/capid/i.test(html)) throw new Error(`${name}: CAP ID leak`);
  // the current build emits an invalid negative min-width on content-sized pills; only the controls may carry it
  for (const s of secs) for (const v of s.variants) if (!CONTROLS.has(v.id) && /min-width:-/.test(v.html)) throw new Error(`${name}: negative min-width in ${v.id}`);
}

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n');
const eml = (subject: string, html: string) =>
  ['X-Unsent: 1', 'From: Offer Mailer <sam.carter@dreamlease.co.uk>', 'To: Matt Wilson <matt.wilson@dreamlease.co.uk>', `Subject: ${subject}`, `Date: ${new Date().toUTCString()}`, 'MIME-Version: 1.0', 'Content-Type: text/html; charset=utf-8', 'Content-Transfer-Encoding: base64', '', b64(html)].join('\r\n');

const outDir = join(import.meta.dirname, '..', 'out');
mkdirSync(outDir, { recursive: true });

for (const s of sections) {
  const html = document(s.title.toLowerCase(), [s]);
  check(html, s.key, [s]);
  const name = `diag-card-${s.key}`;
  writeFileSync(join(outDir, `${name}.eml`), eml(`Card diagnostic ${sections.indexOf(s) + 1}/${sections.length}: ${s.title.toLowerCase()} (${s.variants.map((v) => v.id).join(', ')})`, html));
  writeFileSync(join(outDir, `${name}.html`), html);
  console.log(`${name}.eml  ${(html.length / 1024).toFixed(0)} KB html  ${s.variants.map((v) => v.id).join(' ')}`);
}
const all = document('all sections', sections);
check(all, 'all', sections);
writeFileSync(join(outDir, 'diag-card.html'), all);
console.log(`diag-card.html (browser check, all sections) ${(all.length / 1024).toFixed(0)} KB`);
for (const s of sections) for (const v of s.variants) console.log(`  ${v.id}  ${v.note}`);
