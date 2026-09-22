/**
 * Offer card markup, translated line for line from the markup source of truth
 * `dreamlease-offer-mailer` v5 (Claude Design, 14 Sept 2026). Where its brief and the 14 Sept
 * client review disagreed, the reference wins (Matt, 14 Sept). Its non-negotiables:
 *  1. ghost tables ([if mso]) around every group of inline-block cards, one ghost <td> per card, and
 *     inside the stack card (image column / content column) and the hero CTA row
 *  2. buttons: padding on the <td>, display:block on the anchor, mso-padding-alt:0; no VML, square
 *     corners in Outlook classic are accepted
 *  3. images: explicit width and height, display:block, border:0, real alt; sizes hero 550×413,
 *     stack 218×164 (the reference's grid2 262×197 and grid3 166×125 cards are no longer built)
 *  4. background colour, padding and radius on a <td>, never a <div>
 *  5. no negative margins; spacers are <td height> cells with font-size:0
 *  6. fixed-width pills: one-cell tables with the content width on the <td> (126 hero, 100 small)
 *  7. lock-* classes on every coloured cell for the forced-light overrides
 * Sizes come from layout.ts. Two sizes: hero (single) and row (stack). The reference's two-up and
 * three-up grid cards (half, compact) and their row matching (match.ts, measure.ts) were deleted on
 * 22 Sept 2026, once Matt had confirmed the one-offer-per-row layout in Gmail and Outlook; a stored
 * campaign that names a grid renders as the stacked layout (resolveLayout).
 * The only additions to the reference are the salary-sacrifice price blocks (from the v4 design), the
 * red "View this offer" link the brief requires under any non-view_offer button, and the optional
 * secondary contact link row in the signature (sender.secondaryContacts, in render.ts — opt-in, so the
 * fixture sender leaves it unset and diff-reference stays green).
 *
 * Badge pill counts (Matt, 14 Sept, New Outlook focus): ONE pill on the multi-offer row card, up to
 * THREE on the single-offer hero. The v5 reference itself caps at hero 2 and stack 1, so the row card
 * already matches it; only the hero raise (2 → 3) exceeds the reference, on Matt's instruction. Reason
 * for one pill on a multi-offer card: a second PILL_SMALL badge (120px + gap) cannot sit beside the
 * first in a ~230px card column, so two badges wrapped to a second row and threw the row's card heights
 * out in New Outlook (which also drops vertical-align:top). diff-reference therefore reports a third
 * hero pill the reference lacks (layout-A, intended); the row card stays identical to the reference.
 *
 * Knowing deviations of 21 and 22 Sept 2026 (Matt's tests: HTML pasted into New Outlook, read in Gmail and
 * Outlook mobile). The paste drops the <style> block and the conditional comments, so nothing may depend on either.
 * diff-reference reports 82 lines in all: 8 pre-date 21 Sept (2 the logo width, 6 the third hero pill), 10 are
 * a (6) and b (4), and 64 are d (50 the row card, 14 the hero); c sits outside the sections the script compares:
 *  a. pills are inline-block tables, not align="left" floats: the clearing spacer did not survive, and the
 *     make name ran beside the pill and broke in Gmail ("VOLKSWA / GEN").
 *  b. the row card's image column is calc()-fluid (its desktop width beside the details, the full card width
 *     once wrapped on a phone) and its image is max-width:100%: that was the media query's job.
 *  c. the email wrapper (render.ts) is fluid, 100% up to 600px, not fixed at 600px: Outlook mobile shrank the
 *     fixed layout to fit instead of reflowing it. Classic Outlook keeps its 600px from the ghost table.
 *  d. (22 Sept) the car's name comes before its picture on both cards. Row card: the heading (badge, make, model,
 *     derivative) is a row across the top of the card and its small print a row along the bottom, outside the two
 *     columns. The reference put the heading in the details column and the small print under the image, so on a
 *     phone, where the columns wrap, the reader met the legal line between the picture and the car's name (Matt's
 *     Gmail and Outlook screenshots, 22 Sept). Hero: the same heading row sits above the full-width image, carrying
 *     the card's rounded top corners; the image is square below it (Matt: "it should match").
 * And the tool sends one offer per row (auto: 1 → single, 2+ → stack).
 */
import { C, FF, LH, esc, mso, spacer, table } from './html.js';
import { HERO_IMG, HERO_IMG_H, ICON, PILL_HERO, PILL_SMALL, STACK_CONTENT_COL, STACK_IMG, STACK_IMG_COL, STACK_IMG_H, STACK_INNER } from './layout.js';
import type { CardVM, Stat } from './viewmodel.js';

// ---------- pieces ----------

/** Vehicle image: explicit size for Word, fluid for everyone else, corners follow the card. */
const img = (src: string, w: number, h: number, alt: string, radius: string, maxWidth: string) =>
  `<img src="${esc(src)}" width="${w}" height="${h}" alt="${esc(alt)}" class="fluid-img" style="display:block; border:0; width:100%; max-width:${maxWidth}; height:auto; border-radius:${radius};" />`;

/**
 * Badge pill: a one-cell table with the content width on the td (content-box, so outer width minus padding).
 * An inline-block table, NOT the reference's align="left" float: a float needs the spacer after it to clear,
 * and that did not survive the New Outlook paste, so in Gmail the make name ran beside the pill and broke
 * ("VOLKSWA / GEN", Matt's tests of 21 Sept). An inline-block pill needs no clearing: the next block starts
 * its own line, and several pills still wrap. The card cells are the same construction and did survive.
 */
const PILL_BOX = 'display:inline-block; vertical-align:top;';
const pill = (text: string, width: number, padV: number, padH: number, font: number, lh: number, mb: number) =>
  table('', `${PILL_BOX} margin:0 6px ${mb}px 0;`, `<tr><td width="${width}" align="center" class="lock-white" style="width:${width}px; background-color:${C.orange}; border-radius:999px; padding:${padV}px ${padH}px; ${FF} font-size:${font}px; line-height:${lh}px; ${LH}; font-weight:bold; color:${C.white}; white-space:nowrap;">${esc(text)}</td></tr>`);

const badgeList = (vm: CardVM, max: number): string[] => [vm.hot, ...vm.badges].filter((b): b is string => !!b).slice(0, max);

/** Hot badge first, then the rest, capped, then the gap above the make name. */
function badgeRow(vm: CardVM, max: number, width: number, padV: number, padH: number, font: number, lh: number, mb: number): string {
  const all = badgeList(vm, max);
  if (all.length === 0) return '';
  return `${all.map((b) => pill(b, width, padV, padH, font, lh, mb)).join('\n')}\n${spacer(8)}`;
}

const eyebrow = (vm: CardVM, font: number, lh: number, mb: number) =>
  `<p class="lock-red" style="margin:0 0 ${mb}px 0; font-size:${font}px; line-height:${lh}px; ${LH}; font-weight:bold; letter-spacing:1px; text-transform:uppercase; color:${C.red};">${esc(vm.make.toUpperCase())}</p>`;
const model = (vm: CardVM, font: number, lh: number, mb: number) =>
  `<p class="lock-ink" style="margin:0 0 ${mb}px 0; font-size:${font}px; line-height:${lh}px; ${LH}; font-weight:bold; color:${C.black};">${esc(vm.model)}</p>`;
const derivative = (vm: CardVM, font: number, lh: number, mb: number) =>
  `<p class="lock-body" style="margin:0 0 ${mb}px 0; font-size:${font}px; line-height:${lh}px; ${LH}; color:${C.graphite};">${esc(vm.derivative)}</p>`;
const price = (vm: CardVM, big: number, lh: number, small: number, mb: number) =>
  `<p style="margin:0 0 ${mb}px 0; line-height:${lh}px; ${LH};">
<span class="lock-red" style="font-size:${big}px; font-weight:bold; color:${C.red};">${esc(vm.price)}</span>
<span class="lock-body" style="font-size:${small}px; color:${C.graphite};">${esc(vm.vatLabel)}</span>
</p>`;
const specP = (text: string, font: number, lh: number, mb: number) =>
  `<p style="margin:0 0 ${mb}px 0; font-size:${font}px; line-height:${lh}px; ${LH}; color:${C.ink};">${esc(text)}</p>`;

/** Salary sacrifice, stack: both nets stacked. */
const netPair = (vm: CardVM, big: number, mid: number, small: number, suffix: string) =>
  `<p style="margin:0 0 2px 0; line-height:${big + 4}px; ${LH};"><span class="lock-red" style="font-size:${big}px; font-weight:bold; color:${C.red};">${esc(vm.net20 ?? '')}</span> <span class="lock-body" style="font-size:${small}px; color:${C.graphite};">net &middot; 20%${suffix}</span></p>
<p style="margin:0 0 8px 0; line-height:${mid + 4}px; ${LH};"><span class="lock-red" style="font-size:${mid}px; font-weight:bold; color:${C.red};">${esc(vm.net40 ?? '')}</span> <span class="lock-body" style="font-size:${small}px; color:${C.graphite};">net &middot; 40%${suffix}</span></p>`;

/** Salary sacrifice, hero: the two nets side by side with the illustrative note. */
const heroSalsac = (vm: CardVM) =>
  `${table(
    'width="100%"',
    'margin-bottom:6px;',
    `<tr>
<td width="50%" style="padding:0 8px 0 0; vertical-align:top;">
<p class="lock-red" style="margin:0; font-size:32px; line-height:36px; ${LH}; font-weight:bold; color:${C.red};">${esc(vm.net20 ?? '')}</p>
<p class="lock-body" style="margin:2px 0 0 0; font-size:13px; line-height:18px; ${LH}; color:${C.graphite};">per month net &middot; 20% taxpayer</p>
</td>
<td width="50%" style="padding:0 0 0 16px; vertical-align:top; border-left:1px solid ${C.border};">
<p class="lock-red" style="margin:0; font-size:32px; line-height:36px; ${LH}; font-weight:bold; color:${C.red};">${esc(vm.net40 ?? '')}</p>
<p class="lock-body" style="margin:2px 0 0 0; font-size:13px; line-height:18px; ${LH}; color:${C.graphite};">per month net &middot; 40% taxpayer</p>
</td>
</tr>`,
  )}
<p class="lock-body" style="margin:0 0 14px 0; font-size:12px; line-height:18px; ${LH}; color:${C.graphite};">${esc(vm.grossLine ?? '')} Net figures are illustrative and depend on your employer's scheme and your personal circumstances.</p>`;

// ---------- stat tiles: background, padding and radius on the td; gaps are spacer cells ----------

const gapTd = `<td width="8" style="font-size:0; line-height:0;">&nbsp;</td>`;

function tile(s: Stat, widthPct: number, pad: string, labelFont: number, labelLh: number, ls: number, valueFont: number, valueLh: number, valueMt: number): string {
  return `<td width="${widthPct}%" class="lock-tint" style="background-color:${C.panel}; border-radius:6px; padding:${pad}; vertical-align:top;">
<p class="lock-body" style="margin:0; ${FF} font-size:${labelFont}px; line-height:${labelLh}px; ${LH}; font-weight:bold; letter-spacing:${ls}px; text-transform:uppercase; color:${C.graphite};">${esc(s.label.toUpperCase())}</p>
<p class="lock-ink" style="margin:${valueMt}px 0 0 0; ${FF} font-size:${valueFont}px; line-height:${valueLh}px; ${LH}; font-weight:bold; color:${C.black}; white-space:nowrap;">${esc(s.value)}</p>
</td>`;
}

/** One row of up to four tiles (hero). */
function statsRow(stats: Stat[]): string {
  if (stats.length === 0) return '';
  const n = stats.length;
  const pct = n === 4 ? 24 : Math.floor((100 - 2 * (n - 1)) / n);
  return table('width="100%"', 'margin-bottom:18px;', `<tr>\n${stats.map((s, i) => `${i > 0 ? `${gapTd}\n` : ''}${tile(s, pct, '10px', 10, 14, 0.6, 15, 20, 2)}`).join('\n')}\n</tr>`);
}

/** Two-by-two tiles (stack). */
function statsPairs(stats: Stat[], mb: number): string {
  if (stats.length === 0) return '';
  const rows: string[] = [];
  for (let i = 0; i < stats.length; i += 2) {
    const a = stats[i]!;
    const b = stats[i + 1];
    if (i > 0) rows.push(`<tr><td colspan="3" height="4" style="font-size:0; line-height:0; height:4px;">&nbsp;</td></tr>`);
    rows.push(`<tr>\n${tile(a, 48, '7px 8px', 9, 12, 0.5, 13, 18, 1)}\n${gapTd}\n${b ? tile(b, 48, '7px 8px', 9, 12, 0.5, 13, 18, 1) : '<td width="48%"></td>'}\n</tr>`);
  }
  return table('width="100%"', `margin-bottom:${mb}px;`, rows.join('\n'));
}

// ---------- button, links ----------

/** Green pill: padding on the td, display:block anchor, mso-padding-alt:0 so Word keeps the height. */
function button(href: string, label: string, padV: number, padH: number, font: number, lh: number, opts: { full?: boolean; inline?: boolean } = {}): string {
  return table(
    `${opts.full ? 'width="100%" ' : ''}class="cta-btn"`,
    opts.inline ? 'display:inline-block; vertical-align:middle; max-width:100%;' : '',
    `<tr>
<td align="center" style="background-color:${C.green}; border-radius:999px; padding:${padV}px ${padH}px; mso-padding-alt:0;">
<a href="${esc(href)}" style="display:block; ${FF} font-size:${font}px; line-height:${lh}px; ${LH}; font-weight:bold; color:${C.white}; text-decoration:none;" class="lock-white">${esc(label)}</a>
</td>
</tr>`,
  );
}

/** Brief §5.9: when the button is not the offer page, the offer page stays one click away. */
const viewLink = (href: string, font: number, lh: number, mt: number, centred: boolean) =>
  `<p style="margin:${mt}px 0 0 0; font-size:${font}px; line-height:${lh}px; ${LH};${centred ? ' text-align:center;' : ''}"><a href="${esc(href)}" style="color:${C.red}; text-decoration:underline; font-weight:bold;" class="lock-red">View this offer</a></p>`;

type Brochure = NonNullable<CardVM['brochure']>;

const brochureIconTd = (b: Brochure, pad: string) =>
  `<td style="padding:${pad}; vertical-align:middle;"><img src="${esc(b.iconUrl)}" width="${ICON}" height="${ICON}" alt="${esc(b.alt)}" style="display:block; border:0; width:${ICON}px; height:${ICON}px;" /></td>`;
const brochureLinkTd = (b: Brochure, label: string, font: number, lh: number, pad: string) =>
  `<td class="appleLinks" style="${pad ? `padding:${pad}; ` : ''}vertical-align:middle; ${FF} font-size:${font}px; line-height:${lh}px; ${LH}; white-space:nowrap;">
<a href="${esc(b.href)}" style="color:${C.graphite}; text-decoration:underline;" class="lock-body">${esc(label)}</a>
</td>`;

/** Hero: sits beside the button inside the ghost row. */
const brochureHero = (b: Brochure) => table('', 'display:inline-block; vertical-align:middle;', `<tr>\n${brochureIconTd(b, '10px 6px 10px 16px')}\n${brochureLinkTd(b, b.label, 13, 18, '10px 0')}\n</tr>`);
/** Stack: under the button, left aligned. */
const brochureStack = (b: Brochure) => table('', 'margin-top:8px;', `<tr>\n${brochureIconTd(b, '0 6px 0 0')}\n${brochureLinkTd(b, b.label, 13, 18, '')}\n</tr>`);

const smallPrint = (text: string, margin: string, font: number, lh: number) =>
  `<p class="lock-body" style="margin:${margin}; font-size:${font}px; line-height:${lh}px; ${LH}; color:${C.graphite};">${esc(text)}</p>`;

// ---------- A. Hero (single) — image on top ----------

export function heroCard(vm: CardVM): string {
  const btn = button(vm.cta.href, vm.cta.label, 13, 30, 16, 20, { inline: true });
  // Ghost table keeps button and brochure side by side in Outlook; without it they stack, which is
  // the intended narrow behaviour.
  const ctaRow = vm.brochure
    ? `${mso('<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td valign="middle">')}
${btn}
${mso('</td><td valign="middle">')}
${brochureHero(vm.brochure)}
${mso('</td></tr></table>')}`
    : btn;
  const priceBlock = vm.isSalsac ? heroSalsac(vm) : price(vm, 34, 38, 14, 14);

  // Reading order (Matt, 22 Sept 2026): the car's name before its picture, the same as the stacked card
  // (deviation d in the header). The reference put the image first with the card's rounded top corners on it;
  // the heading row now carries those corners and the image sits square between the heading and the price.
  return table(
    'width="100%"',
    `border:1px solid ${C.border}; border-radius:16px; margin-bottom:20px;`,
    `<tr>
<td class="lock-bg" style="padding:20px 20px 4px 20px; background-color:${C.white}; border-radius:16px 16px 0 0; ${FF}">
${badgeRow(vm, 3, PILL_HERO, 4, 12, 12, 16, 8)}
${eyebrow(vm, 12, 16, 4)}
${model(vm, 26, 32, 4)}
${derivative(vm, 14, 20, 12)}
</td>
</tr>
<tr>
<td class="lock-bg" style="padding:0; background-color:${C.white};">
${img(vm.imageUrl, HERO_IMG, HERO_IMG_H, vm.alt, '0', `${HERO_IMG}px`)}
</td>
</tr>
<tr>
<td style="padding:20px 20px 22px 20px; ${FF}">
${priceBlock}
${specP(vm.specLine, 14, 20, 16)}
${statsRow(vm.stats)}
${ctaRow}
${vm.viewHref ? viewLink(vm.viewHref, 14, 20, 12, false) : ''}
${smallPrint(vm.smallPrint, '14px 0 0 0', 12, 18)}
</td>
</tr>`,
  );
}

// ---------- B. Row (stack) — heading across the top, image left, small print along the bottom ----------

export function rowCard(vm: CardVM): string {
  const priceBlock = vm.isSalsac ? netPair(vm, 28, 22, 12, ' taxpayer') : price(vm, 28, 32, 13, 8);
  // Reading order (Matt, 22 Sept 2026, from his phone): the car's name before its picture, the small print last.
  // On a phone the two columns wrap, so the heading (badge, make, model, derivative) is a row across the top of
  // the card and the small print a row along the bottom; between them the image column and the details column
  // sit side by side on a desktop and one under the other on a phone (deviation d in the header). The reference
  // kept the heading in the details column and the small print under the image, which on a phone put the legal
  // line between the picture and the car's name.
  // The image column is STACK_IMG_COL wide beside the details, and the full card width once the columns
  // have wrapped on a phone. That used to be the media query's job, but the style block does not survive the
  // New Outlook paste, so it is done inline: below a 480px card the calc() is huge and max-width wins (100%),
  // above it the calc() is negative and min-width wins. A client without calc() falls back to min-width, which
  // is the old fixed column. Classic Outlook takes its widths from the ghost table and ignores all of this.
  const imageCol = table(
    'class="stack-col"',
    `display:inline-block; width:calc((480px - 100%) * 480); min-width:${STACK_IMG_COL}px; max-width:100%; vertical-align:top;`,
    `<tr>
<td style="padding:0 16px 12px 16px; font-size:14px; text-align:left;">
${img(vm.imageUrl, STACK_IMG, STACK_IMG_H, vm.alt, '10px', '100%')}
</td>
</tr>`,
  );
  const contentCol = table(
    'class="stack-col"',
    `display:inline-block; width:100%; max-width:${STACK_CONTENT_COL}px; vertical-align:top;`,
    `<tr>
<td style="padding:0 18px; font-size:14px; text-align:left; ${FF}">
${priceBlock}
${specP(vm.specLine, 13, 18, 12)}
${statsPairs(vm.stats, 14)}
${button(vm.cta.href, vm.cta.label, 10, 22, 14, 18)}
${vm.viewHref ? viewLink(vm.viewHref, 13, 18, 8, false) : ''}
${vm.brochure ? brochureStack(vm.brochure) : ''}
</td>
</tr>`,
  );
  return table(
    'width="100%"',
    `border:1px solid ${C.border}; border-radius:16px; margin-bottom:16px;`,
    `<tr>
<td style="padding:16px 18px 0 18px; font-size:14px; text-align:left; ${FF}">
${badgeRow(vm, 1, PILL_SMALL, 3, 10, 11, 14, 6)}
${eyebrow(vm, 11, 14, 2)}
${model(vm, 20, 26, 2)}
${derivative(vm, 13, 18, 12)}
</td>
</tr>
<tr>
<td style="padding:0; font-size:0; text-align:left;">
${mso(`<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="${STACK_INNER}"><tr><td width="${STACK_IMG_COL}" valign="top">`)}
${imageCol}
${mso(`</td><td width="${STACK_CONTENT_COL}" valign="top">`)}
${contentCol}
${mso('</td></tr></table>')}
</td>
</tr>
<tr>
<td style="padding:0 18px 16px 18px; font-size:14px; text-align:left; ${FF}">
${smallPrint(vm.smallPrint, '12px 0 0 0', 11, 16)}
</td>
</tr>`,
  );
}

