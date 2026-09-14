/**
 * Offer card markup, translated from design/offer-mailer-email-template-v4.dc.html and then hardened
 * against real-client review on 14 Sept 2026 (New Outlook, Outlook iOS, classic Outlook / Word):
 *  - fluid-hybrid units are inline-block <div>s (Outlook iOS ignores vertical-align on tables)
 *  - buttons and badge pills are VML roundrects for Word, HTML tables for everyone else
 *  - pills have a minimum width, not a fixed one (Word ignores nowrap and wraps fixed cells)
 *  - eyebrows are upper-cased in code (Word ignores text-transform)
 *  - card borders live on a <td>, never a <table> (Word draws table borders as stray lines)
 *  - spacing is <td> padding or white <td> borders, never margins or spacer cells
 *  - rows that vary in height (badges, derivative) get fixed heights so cards line up
 * Sizes come from layout.ts. Four sizes: hero (single), row (stack), half (grid2), compact (grid3).
 */
import { C, FONT, LH, esc } from './html.js';
import { COMPACT_CARD, COMPACT_CELL, HALF_CARD, HALF_CELL, HERO_IMG, ROW_CONTENT_COL, ROW_IMG, ROW_IMG_COL, h43 } from './layout.js';
import type { CardVM, Stat } from './viewmodel.js';

const T = (attrs: string, style: string, inner: string) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" border="0"${attrs ? ' ' + attrs : ''} style="${style}"><tbody>${inner}</tbody></table>`;

/** Vehicle image. Top corners rounded for clients that can; Word shows them square. */
const img = (src: string, w: number, alt: string, radius: number) =>
  `<img src="${esc(src)}" width="${w}" height="${h43(w)}" alt="${esc(alt)}" align="center" style="display:block;border:0;width:100%;height:auto;margin:0 auto${radius ? `;border-radius:${radius}px ${radius}px 0 0` : ''}">`;

/**
 * Grid unit: inline-block div (fluid hybrid). Verified 14 Sept 2026 in classic Outlook (one full-width
 * card per row), Outlook iOS, Gmail iOS and Chrome. New Outlook desktop strips vertical-align on these,
 * so cards in a row are given equal heights (fixed-height rows) rather than relying on alignment.
 * Floated tables (diag-grid G3) were tried and rejected: Word does not float them.
 */
export const unit = (maxWidth: number, inner: string) =>
  `<div class="card-cell" style="display:inline-block;width:100%;max-width:${maxWidth}px;vertical-align:top">${inner}</div>`;

/** Card frame: border on the cell, spacing below as cell padding, image corners follow the radius. */
const cardFrame = (radius: number, gapBelow: number, rows: string) =>
  T('width="100%"', 'border-collapse:collapse;table-layout:fixed', `<tr><td style="padding:0 0 ${gapBelow}px 0">${T('width="100%"', 'border-collapse:separate;table-layout:fixed', `<tr><td style="border:1px solid ${C.border};border-radius:${radius}px;padding:0;background:${C.white}">${T('width="100%"', 'border-collapse:collapse', rows)}</td></tr>`)}</td></tr>`);

// ---------- pills: HTML for modern clients, VML roundrect for Word ----------

interface PillSpec {
  text: string;
  font: number;
  weight: 600 | 700;
  padV: number;
  padH: number;
  bg: string;
  color: string;
  /** Minimum width in px, or 'full' to fill the container. */
  width: number | 'full';
  /** Exact width to draw for Word when 'full' (Word can't do 100% inside VML). */
  fullWidthPx?: number;
  href?: string;
}

/** Word can't measure text, so the VML shape gets an estimated width. Arial bold ≈ 0.58em/char. */
const estimateWidth = (text: string, font: number, padH: number) => Math.round(text.length * font * 0.58) + 2 * padH;

function pill(p: PillSpec): string {
  const lineHeight = p.font + 4;
  const height = lineHeight + 2 * p.padV;
  const vmlWidth = p.width === 'full' ? (p.fullWidthPx ?? 200) : Math.max(p.width, estimateWidth(p.text, p.font, p.padH));
  const text = esc(p.text);
  // Construction chosen by the 14 Sept 2026 classic-Outlook diagnostic (scripts/diag-vml.ts, variant V4):
  // label hidden from Word lives in its own <center>, NO line-height on it, and v:textbox inset="0,0,0,0"
  // (Word's default ~7px text-box margin clips the label in a short pill). Any line-height on the
  // <center> pushes the text off centre; the canonical anchor-inside-shape pattern loses the font
  // styling inside a text box. Verified centred at 22px, 26px and 48px heights.
  const vml = `<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word"${p.href ? ` href="${esc(p.href)}"` : ''} style="height:${height}px;v-text-anchor:middle;width:${vmlWidth}px" arcsize="50%" stroke="f" fillcolor="${p.bg}"><w:anchorlock/><v:textbox inset="0,0,0,0"><center style="color:${p.color};font-family:${FONT};font-size:${p.font}px;font-weight:${p.weight}">${text}</center></v:textbox></v:roundrect><![endif]-->`;
  const label = p.href
    ? `<a href="${esc(p.href)}" style="display:block;font-size:${p.font}px;line-height:${lineHeight}px;${LH};font-weight:${p.weight};color:${p.color};text-decoration:none;white-space:nowrap">${text}</a>`
    : `<span style="display:block;font-size:${p.font}px;line-height:${lineHeight}px;${LH};font-weight:${p.weight};color:${p.color};white-space:nowrap">${text}</span>`;
  const widthStyle = p.width === 'full' ? '' : `;min-width:${p.width - 2 * p.padH}px`;
  const html = T(p.width === 'full' ? 'width="100%"' : '', 'border-collapse:separate', `<tr><td style="background:${p.bg};border-radius:999px;padding:${p.padV}px ${p.padH}px;text-align:center${widthStyle}">${label}</td></tr>`);
  return `${vml}<!--[if !mso]><!-->${html}<!--<![endif]-->`;
}

/** Badge row: hot first, then the rest, capped so the row never exceeds the card. Fixed height so cards line up. */
function badgeRow(vm: CardVM, max: number, minWidth: number, font: number, padV: number, padH: number, height: number, gapBelow: number): string {
  const all = [vm.hot, ...vm.badges].filter((b): b is string => !!b).slice(0, max);
  const cells = all
    .map((b, i) => `<td style="padding:0 ${i < all.length - 1 ? 6 : 0}px 0 0;vertical-align:top">${pill({ text: b, font, weight: 700, padV, padH, bg: C.orange, color: C.white, width: minWidth })}</td>`)
    .join('');
  const row = cells ? T('', 'border-collapse:collapse', `<tr>${cells}</tr>`) : '&nbsp;';
  return T('width="100%"', 'border-collapse:collapse', `<tr><td height="${height}" valign="top" style="height:${height}px;padding:0 0 ${gapBelow}px 0;vertical-align:top;font-size:${font}px">${row}</td></tr>`);
}

/** Green CTA. Content-sized (hero, stack) or full width (grid2, grid3). */
function button(href: string, label: string, font: number, padV: number, padH: number, fullWidthPx?: number): string {
  return pill({ text: label, font, weight: 600, padV, padH, bg: C.green, color: C.white, width: fullWidthPx ? 'full' : 0, ...(fullWidthPx ? { fullWidthPx } : {}), href });
}

// ---------- stat tiles: gaps are white cell borders (Word paints spacer cells grey) ----------

function statTile(s: Stat, labelPx: number, valuePx: number, pad: string, width: string, borders: string): string {
  return `<td width="${width}" style="background:${C.panel};border-radius:6px;padding:${pad};vertical-align:top;${borders}"><p style="margin:0;font-size:${labelPx}px;line-height:${labelPx + 4}px;${LH};font-weight:700;letter-spacing:.5px;color:${C.graphite}">${esc(s.label.toUpperCase())}</p><p style="margin:1px 0 0 0;font-size:${valuePx}px;line-height:${valuePx + 5}px;${LH};font-weight:700;color:${C.black};white-space:nowrap">${esc(s.value)}</p></td>`;
}

const gap = (side: 'left' | 'right' | 'bottom', px: number) => `border-${side}:${px}px solid ${C.white};`;

/** Space below a block as cell padding: Word ignores margins on tables. */
const gapBelow = (html: string, px: number) => T('width="100%"', 'border-collapse:collapse', `<tr><td style="padding:0 0 ${px}px 0">${html}</td></tr>`);

/** Four tiles in one row (hero). */
function statsRow(stats: Stat[]): string {
  if (stats.length === 0) return '';
  const last = stats.length - 1;
  const cells = stats.map((s, i) => statTile(s, 10, 16, '10px 10px 9px 10px', `${Math.floor(100 / stats.length)}%`, `${i > 0 ? gap('left', 4) : ''}${i < last ? gap('right', 4) : ''}`)).join('');
  return gapBelow(T('width="100%"', 'border-collapse:collapse', `<tr>${cells}</tr>`), 18);
}

/** Two-by-two tiles (stack and grid2). */
function statsPairs(stats: Stat[], marginBottom: number): string {
  if (stats.length === 0) return '';
  const rows: string[] = [];
  for (let i = 0; i < stats.length; i += 2) {
    const pair = stats.slice(i, i + 2);
    const notLastRow = i + 2 < stats.length;
    rows.push(`<tr>${pair.map((s, j) => statTile(s, 9, 14, '7px 8px', '50%', `${j > 0 ? gap('left', 4) : gap('right', 4)}${notLastRow ? gap('bottom', 4) : ''}`)).join('')}</tr>`);
  }
  return gapBelow(T('width="100%"', 'border-collapse:collapse', rows.join('')), marginBottom);
}

// ---------- text pieces ----------

function viewLink(href: string, font: number, marginTop: number, center: boolean): string {
  return `<p style="margin:${marginTop}px 0 0 0;font-size:${font}px;line-height:${font + 5}px;${LH}${center ? ';text-align:center' : ''}"><a href="${esc(href)}" style="color:${C.red};text-decoration:underline;font-weight:600">View this offer</a></p>`;
}

/** Brochure link. The 14px glyphs are deferred (design/assets); the row renders without them for now. */
function brochureRow(b: NonNullable<CardVM['brochure']>, font: number, marginTop: number, center: boolean): string {
  return `<p style="margin:${marginTop}px 0 0 0;font-size:${font}px;line-height:${font + 5}px;${LH}${center ? ';text-align:center' : ''}"><a href="${esc(b.href)}" style="color:${C.graphite};text-decoration:underline">${esc(b.label)}</a></p>`;
}

const price = (vm: CardVM, big: number, small: number, marginBottom: number) =>
  `<p style="margin:0 0 ${marginBottom}px 0;line-height:${big + 4}px;${LH}"><span style="font-size:${big}px;font-weight:700;color:${C.red}">${esc(vm.price)}</span> <span style="font-size:${small}px;font-weight:500;color:${C.graphite}">${esc(vm.vatLabel)}</span></p>`;

const netPair = (vm: CardVM, big: number, mid: number, small: number, suffix: string) =>
  `<p style="margin:0 0 2px 0;line-height:${big + 4}px;${LH}"><span style="font-size:${big}px;font-weight:700;color:${C.red}">${esc(vm.net20 ?? '')}</span> <span style="font-size:${small}px;color:${C.graphite}">net · 20%${suffix}</span></p><p style="margin:0 0 8px 0;line-height:${mid + 4}px;${LH}"><span style="font-size:${mid}px;font-weight:700;color:${C.red}">${esc(vm.net40 ?? '')}</span> <span style="font-size:${small}px;color:${C.graphite}">net · 40%${suffix}</span></p>`;

const eyebrow = (vm: CardVM, font: number, mb: number) =>
  `<p style="margin:0 0 ${mb}px 0;font-size:${font}px;line-height:${font + 4}px;${LH};font-weight:700;letter-spacing:1px;color:${C.red}">${esc(vm.make.toUpperCase())}</p>`;
const heading = (vm: CardVM, font: number, mb: number) =>
  `<p style="margin:0 0 ${mb}px 0;font-size:${font}px;line-height:${font + 6}px;${LH};font-weight:700;color:${C.black}">${esc(vm.model)}</p>`;
const sub = (vm: CardVM, font: number, mb: number) =>
  `<p style="margin:0 0 ${mb}px 0;font-size:${font}px;line-height:${font + 5}px;${LH};color:${C.graphite}">${esc(vm.derivative)}</p>`;
/** Any short text in a fixed-height cell, so cards in a row keep equal height whatever wraps. */
const fixedText = (text: string, font: number, height: number, gapBelow: number, color: string) =>
  T('width="100%"', 'border-collapse:collapse', `<tr><td height="${height}" valign="top" style="height:${height}px;padding:0 0 ${gapBelow}px 0;vertical-align:top;font-size:${font}px;line-height:${font + 5}px;${LH};color:${color}">${esc(text)}</td></tr>`);
/** Derivative in a fixed-height cell so two- and three-line names don't misalign a row of cards. */
const subFixed = (vm: CardVM, font: number, height: number, gapBelow: number) =>
  T('width="100%"', 'border-collapse:collapse', `<tr><td height="${height}" valign="top" style="height:${height}px;padding:0 0 ${gapBelow}px 0;vertical-align:top;font-size:${font}px;line-height:${font + 5}px;${LH};color:${C.graphite}">${esc(vm.derivative)}</td></tr>`);
const specP = (text: string, font: number, mb: number) =>
  `<p style="margin:0 0 ${mb}px 0;font-size:${font}px;line-height:${font + 5}px;${LH};color:${C.ink}">${esc(text)}</p>`;
const smallP = (text: string, font: number, marginTop: number) =>
  `<p style="margin:${marginTop}px 0 0 0;font-size:${font}px;line-height:${font + 5}px;${LH};color:${C.graphite}">${esc(text)}</p>`;

// ---------- A. Hero (single) — image on top ----------

export function heroCard(vm: CardVM): string {
  const salsac = vm.isSalsac
    ? `${T('width="100%"', 'border-collapse:collapse;margin-bottom:6px', `<tr><td width="50%" style="padding:0 8px 0 0;vertical-align:top"><p style="margin:0;font-size:32px;line-height:36px;${LH};font-weight:700;color:${C.red}">${esc(vm.net20 ?? '')}</p><p style="margin:2px 0 0 0;font-size:13px;line-height:18px;${LH};color:${C.graphite}">per month net · 20% taxpayer</p></td><td width="50%" style="padding:0 0 0 16px;vertical-align:top;border-left:1px solid ${C.border}"><p style="margin:0;font-size:32px;line-height:36px;${LH};font-weight:700;color:${C.red}">${esc(vm.net40 ?? '')}</p><p style="margin:2px 0 0 0;font-size:13px;line-height:18px;${LH};color:${C.graphite}">per month net · 40% taxpayer</p></td></tr>`)}<p style="margin:0 0 14px 0;font-size:12px;line-height:18px;${LH};color:${C.graphite}">${esc(vm.grossLine ?? '')} Net figures are illustrative and depend on your employer's scheme and your personal circumstances.</p>`
    : price(vm, 36, 15, 14);

  return cardFrame(16, 20, `<tr><td style="padding:0">${img(vm.imageUrl, HERO_IMG, vm.alt, 15)}</td></tr><tr><td style="padding:22px 22px 24px 22px">${badgeRow(vm, 3, 130, 12, 4, 12, 24, 10)}${eyebrow(vm, 14, 4)}${heading(vm, 28, 4)}${sub(vm, 15, 16)}${salsac}${specP(vm.specLine, 15, 16)}${statsRow(vm.stats)}${button(vm.cta.href, vm.cta.label, 17, 14, 32)}${vm.viewHref ? viewLink(vm.viewHref, 14, 10, false) : ''}${vm.brochure ? brochureRow(vm.brochure, 14, 10, false) : ''}${smallP(vm.smallPrint, 12, 14)}</td></tr>`);
}

// ---------- B. Row (stack) — image left, fluid hybrid ----------

export function rowCard(vm: CardVM): string {
  const priceBlock = vm.isSalsac ? netPair(vm, 28, 22, 12, ' taxpayer') : price(vm, 30, 13, 8);
  const imageCol = unit(ROW_IMG_COL, T('width="100%"', 'border-collapse:collapse', `<tr><td style="padding:16px 16px 0 16px;font-size:14px;text-align:left">${T('', 'border-collapse:separate', `<tr><td style="padding:0;background:${C.white}">${img(vm.imageUrl, ROW_IMG, vm.alt, 10)}</td></tr>`)}<p style="margin:12px 0 16px 0;font-size:11px;line-height:16px;${LH};color:${C.graphite}">${esc(vm.smallPrint)}</p></td></tr>`));
  const contentCol = unit(ROW_CONTENT_COL, T('width="100%"', 'border-collapse:collapse', `<tr><td style="padding:16px 18px 18px 18px;font-size:14px;text-align:left">${badgeRow(vm, 2, 104, 11, 3, 10, 20, 6)}${eyebrow(vm, 13, 3)}${heading(vm, 22, 2)}${sub(vm, 13, 10)}${priceBlock}${specP(vm.specLine, 13, 12)}${statsPairs(vm.stats, 14)}${button(vm.cta.href, vm.cta.label, 15, 11, 24)}${vm.viewHref ? viewLink(vm.viewHref, 13, 8, false) : ''}${vm.brochure ? brochureRow(vm.brochure, 13, 8, false) : ''}</td></tr>`));
  return cardFrame(16, 16, `<tr><td style="padding:0;font-size:0;text-align:center">${imageCol}${contentCol}</td></tr>`);
}

// ---------- C. Half (grid2) ----------

export function halfCard(vm: CardVM): string {
  const priceBlock = vm.isSalsac ? netPair(vm, 28, 22, 12, '') : price(vm, 30, 13, 8);
  const inner = HALF_CARD - 2 * 18 - 2; // card width minus padding and borders
  const card = cardFrame(16, 0, `<tr><td style="padding:0">${img(vm.imageUrl, HALF_CARD, vm.alt, 15)}</td></tr><tr><td style="padding:16px 18px 20px 18px">${badgeRow(vm, 2, 0, 11, 3, 10, 20, 8)}${eyebrow(vm, 13, 3)}${heading(vm, 22, 2)}${subFixed(vm, 13, 36, 10)}${priceBlock}${fixedText(vm.specLine, 13, 36, 12, C.ink)}${statsPairs(vm.stats, 12)}${button(vm.cta.href, vm.cta.label, 15, 12, 12, inner)}${vm.viewHref ? viewLink(vm.viewHref, 13, 8, true) : ''}${vm.brochure ? brochureRow(vm.brochure, 13, 8, true) : ''}${T('width="100%"', 'border-collapse:collapse', `<tr><td style="padding:12px 0 0 0">${fixedText(vm.smallPrint, 11, 48, 0, C.graphite)}</td></tr>`)}</td></tr>`);
  return unit(HALF_CELL, T('width="100%"', 'border-collapse:collapse', `<tr><td style="padding:0 12px 20px 12px;font-size:14px;text-align:left">${card}</td></tr>`));
}

// ---------- D. Compact (grid3) ----------

export function compactCard(vm: CardVM): string {
  const priceBlock = vm.isSalsac
    ? `<p style="margin:0;line-height:28px;${LH}"><span style="font-size:24px;font-weight:700;color:${C.red}">${esc(vm.net20 ?? '')}</span></p><p style="margin:0 0 2px 0;font-size:10px;line-height:14px;${LH};color:${C.graphite}">net · 20% taxpayer · ${esc(vm.net40 ?? '')} at 40%</p>`
    : `<p style="margin:0;line-height:28px;${LH}"><span style="font-size:24px;font-weight:700;color:${C.red}">${esc(vm.price)}</span></p><p style="margin:0 0 2px 0;font-size:10px;line-height:14px;${LH};color:${C.graphite}">${esc(vm.vatLabel)}</p>`;
  const inner = COMPACT_CARD - 2 * 12 - 2;
  const card = cardFrame(12, 0, `<tr><td style="padding:0">${img(vm.imageUrl, COMPACT_CARD, vm.alt, 11)}</td></tr><tr><td style="padding:12px 12px 14px 12px">${badgeRow(vm, 1, 0, 10, 2, 8, 18, 6)}${eyebrow(vm, 12, 2)}${heading(vm, 18, 2)}${subFixed(vm, 11, 32, 8)}${priceBlock}<p style="margin:0 0 8px 0;font-size:10px;line-height:14px;${LH};color:${C.graphite}">${esc(vm.validityLine)}</p>${fixedText(vm.specShort, 11, 32, 10, C.ink)}${button(vm.cta.href, vm.cta.label, 13, 9, 10, inner)}${vm.viewHref ? viewLink(vm.viewHref, 11, 8, true) : ''}${vm.brochure ? brochureRow(vm.brochure, 11, 8, true) : ''}</td></tr>`);
  return unit(COMPACT_CELL, T('width="100%"', 'border-collapse:collapse', `<tr><td style="padding:0 12px 16px 12px;font-size:14px;text-align:left">${card}</td></tr>`));
}

/**
 * Lay out inline-block units, no Outlook ghost table. Decided 14 Sept 2026 after diagnosis: classic
 * Outlook unwraps [if mso] markup when it sends or forwards, so a ghost grid reached phones as two fixed
 * columns squeezed to fit, and New Outlook's sanitiser left artefacts at the comment boundaries.
 * Without it Outlook desktop shows one card per row, which degrades cleanly everywhere.
 */
export function ghostGrid(cards: string[], _perRow: number, _cellWidth: number): string {
  return cards.join('');
}
