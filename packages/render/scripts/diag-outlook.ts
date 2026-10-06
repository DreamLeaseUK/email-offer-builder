/**
 * Diagnostic (Matt, 6 Oct 2026): the four faults the unspam.email render test showed in Outlook classic (2016 and
 * 2019), each with its candidate fixes side by side, labelled, in ONE email. Paste out/diag-outlook.html into
 * unspam.email → Email preview → Paste HTML, and read the Outlook 2016 / 2019 renders (and Gmail, Apple, iPhone,
 * Outlook.com, which must not get worse). Report, for each question, the letter that looks right.
 *
 *   Q1 the button collapses to a green strip behind the words, and sits right under the spec boxes
 *   Q2 small grey notches on the left edge of the 2nd to 4th spec boxes
 *   Q3 Outlook 2016 stretches the whole email to the window instead of 600px (2019 does not)
 *
 *   pnpm --filter @offer-mailer/render exec tsx scripts/diag-outlook.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { C, FF, FONT, LH, spacer, table } from '../src/html.js';
import { STYLE } from '../src/render.js';

const MSO_HEAD = `<!--[if mso]>
<xml><o:OfficeDocumentSettings><o:AllowPNG/><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml>
<style type="text/css">
  * { font-family: ${FONT} !important; }
  table { border-collapse: collapse !important; mso-table-lspace: 0pt !important; mso-table-rspace: 0pt !important; }
  td, p, a, span { mso-line-height-rule: exactly; }
</style>
<![endif]-->`;

const STATS = [
  { label: 'Range', value: '409 mi' },
  { label: '0–62', value: '6.2s' },
  { label: 'Battery', value: '82 kWh' },
  { label: 'Warranty', value: '8 yrs' },
];
const HREF = 'https://www.dreamlease.co.uk/';

// ---------- the pieces as built today (cards.ts) ----------

const tileTd = (s: { label: string; value: string }, inner = true) =>
  `<td width="24%" class="lock-tint" style="background-color:${C.panel}; border-radius:6px; padding:10px; vertical-align:top;">${inner ? tileText(s) : ''}</td>`;
const tileText = (s: { label: string; value: string }) =>
  `<p class="lock-body" style="margin:0; ${FF} font-size:10px; line-height:14px; ${LH}; font-weight:bold; letter-spacing:0.6px; text-transform:uppercase; color:${C.graphite};">${s.label.toUpperCase()}</p>
<p class="lock-ink" style="margin:2px 0 0 0; ${FF} font-size:15px; line-height:20px; ${LH}; font-weight:bold; color:${C.black}; white-space:nowrap;">${s.value}</p>`;

const GAP_NOW = `<td width="8" style="font-size:0; line-height:0;">&nbsp;</td>`;

/** Today's stats row: four tiles, gap cells between, margin-bottom on the table. */
const statsNow = () => table('width="100%"', 'margin-bottom:18px;', `<tr>\n${STATS.map((s, i) => `${i ? GAP_NOW : ''}${tileTd(s)}`).join('\n')}\n</tr>`);
const statsNoMargin = (gap: string, tile: (s: { label: string; value: string }) => string = (s) => tileTd(s)) =>
  table('width="100%"', '', `<tr>\n${STATS.map((s, i) => `${i ? gap : ''}${tile(s)}`).join('\n')}\n</tr>`);

const anchorStyle = `display:block; ${FF} font-size:16px; line-height:20px; ${LH}; font-weight:bold; color:${C.white}; text-decoration:none;`;
const btnTable = (td: string) => table('class="cta-btn"', 'display:inline-block; vertical-align:middle; max-width:100%;', `<tr>\n${td}\n</tr>`);

// ---------- Q1: the button and the gap above it ----------

const Q1 = [
  {
    id: 'B0',
    note: "Today's build: padding on the cell, mso-padding-alt:0, the gap is a margin on the spec row",
    html: () =>
      statsNow() +
      btnTable(`<td align="center" style="background-color:${C.green}; border-radius:999px; padding:13px 30px; mso-padding-alt:0;"><a href="${HREF}" style="${anchorStyle}" class="lock-white">View this offer</a></td>`),
  },
  {
    id: 'B1',
    note: 'No mso-padding-alt (Word keeps the cell padding); the gap is an 18px spacer cell',
    html: () =>
      statsNoMargin(GAP_NOW) +
      spacer(18) +
      btnTable(`<td align="center" style="background-color:${C.green}; border-radius:999px; padding:13px 30px;"><a href="${HREF}" style="${anchorStyle}" class="lock-white">View this offer</a></td>`),
  },
  {
    id: 'B2',
    note: 'B1 plus bgcolor on the cell (the green also as an attribute)',
    html: () =>
      statsNoMargin(GAP_NOW) +
      spacer(18) +
      btnTable(`<td align="center" bgcolor="${C.green}" style="background-color:${C.green}; border-radius:999px; padding:13px 30px;"><a href="${HREF}" style="${anchorStyle}" class="lock-white">View this offer</a></td>`),
  },
  {
    id: 'B3',
    note: 'Padding on the link itself, with Word spacers so the whole green area is clickable in Outlook too',
    html: () =>
      statsNoMargin(GAP_NOW) +
      spacer(18) +
      btnTable(
        `<td align="center" bgcolor="${C.green}" style="background-color:${C.green}; border-radius:999px;"><a href="${HREF}" style="display:inline-block; padding:13px 30px; ${FF} font-size:16px; line-height:20px; ${LH}; font-weight:bold; color:${C.white}; text-decoration:none; mso-padding-alt:0;" class="lock-white"><!--[if mso]><i style="mso-font-width:300%; mso-text-raise:26pt;" hidden>&#8202;</i><![endif]--><span style="mso-text-raise:13pt;">View this offer</span><!--[if mso]><i style="mso-font-width:300%;" hidden>&#8202;&#8203;</i><![endif]--></a></td>`,
      ),
  },
];

// ---------- Q2: the notches on the spec boxes ----------

const Q2 = [
  { id: 'G0', note: "Today's build: gap cells with font-size:0 and a non-breaking space", html: () => statsNoMargin(GAP_NOW) },
  { id: 'G1', note: 'Gap cells empty (no space), width only', html: () => statsNoMargin(`<td width="8" style="width:8px;"></td>`) },
  {
    id: 'G2',
    note: 'Gap cells white, 1px text, line height exactly 1px',
    html: () => statsNoMargin(`<td width="8" bgcolor="${C.white}" style="width:8px; background-color:${C.white}; font-size:1px; line-height:1px; ${LH};">&nbsp;</td>`),
  },
  {
    id: 'G3',
    note: 'No gap cells: an 8px white left border on boxes 2 to 4',
    html: () =>
      table('width="100%"', '', `<tr>\n${STATS.map((s, i) => `<td width="24%" class="lock-tint" style="background-color:${C.panel}; border-radius:6px; padding:10px; vertical-align:top;${i ? ` border-left:8px solid ${C.white};` : ''}">${tileText(s)}</td>`).join('\n')}\n</tr>`),
  },
  {
    id: 'G4',
    note: 'Each box is its own one-cell table inside a plain cell; empty gap cells',
    html: () =>
      statsNoMargin(`<td width="8" style="width:8px;"></td>`, (s) => `<td width="24%" style="vertical-align:top;">${table('width="100%"', '', `<tr><td class="lock-tint" style="background-color:${C.panel}; border-radius:6px; padding:10px; vertical-align:top;">${tileText(s)}</td></tr>`)}</td>`),
  },
];

// ---------- Q3: the 600px width (each block carries its own width construction) ----------

const W_INNER = (label: string, note: string) =>
  `<tr><td style="padding:16px; border:2px dashed ${C.red}; ${FF} font-size:14px; line-height:20px; ${LH}; color:${C.ink};"><p style="margin:0; font-size:18px; line-height:24px; font-weight:bold; color:${C.black};">${label}</p><p style="margin:4px 0 0 0;">${note}</p><p style="margin:4px 0 0 0; color:${C.graphite};">The dashed box should be 600px wide (about half a laptop screen), never the full window.</p></td></tr>`;

const Q3 = [
  {
    id: 'W0',
    note: "Today's build: a 600px Outlook-only table around a 100%-wide table capped at 600px",
    html: () =>
      `<!--[if mso]><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" align="center"><tr><td><![endif]-->` +
      table('width="100%"', `width:100%; max-width:600px; background-color:${C.white};`, W_INNER('W0', "Today's build")) +
      `<!--[if mso]></td></tr></table><![endif]-->`,
  },
  {
    id: 'W1',
    note: 'W0 with the width also on the Outlook cell, in pixels as a style too',
    html: () =>
      `<!--[if mso]><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" align="center" style="width:600px;"><tr><td width="600" style="width:600px;"><![endif]-->` +
      table('width="100%"', `width:100%; max-width:600px; background-color:${C.white};`, W_INNER('W1', 'Width on the Outlook table and its cell')) +
      `<!--[if mso]></td></tr></table><![endif]-->`,
  },
  {
    id: 'W2',
    note: 'The inner table itself is 600 wide by attribute, capped at 100% by style (no Outlook-only table)',
    html: () => table('width="600" align="center"', `width:600px; max-width:100%; background-color:${C.white};`, W_INNER('W2', 'Width attribute 600 on the table, max-width 100%')),
  },
];

// ---------- the document ----------

const section = (title: string, intro: string, items: { id: string; note: string; html: () => string }[], wrap: boolean) =>
  `<tr><td style="padding:28px 0 8px 0; ${FF} font-size:22px; line-height:28px; ${LH}; font-weight:bold; color:${C.black};">${title}</td></tr>
<tr><td style="padding:0 0 12px 0; ${FF} font-size:14px; line-height:20px; ${LH}; color:${C.ink};">${intro}</td></tr>
${items
  .map((v) => {
    const head = `<p style="margin:0 0 4px 0; ${FF} font-size:20px; line-height:26px; ${LH}; font-weight:bold; color:${C.red};">${v.id}</p><p style="margin:0 0 12px 0; ${FF} font-size:13px; line-height:18px; ${LH}; color:${C.graphite};">${v.note}</p>`;
    const body = wrap
      ? `<!--[if mso]><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" align="center"><tr><td><![endif]-->${table('width="100%"', `width:100%; max-width:600px; background-color:${C.white};`, `<tr><td class="lock-bg" style="padding:20px; background-color:${C.white};">${head}${v.html()}</td></tr>`)}<!--[if mso]></td></tr></table><![endif]-->`
      : `${table('width="100%"', '', `<tr><td style="padding:0 0 8px 0;">${head}</td></tr>`)}${v.html()}`;
    return `<tr><td style="padding:0 0 16px 0;">${body}</td></tr>`;
  })
  .join('\n')}`;

const html = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" lang="en">
<head>
<meta charset="utf-8" />
<meta http-equiv="X-UA-Compatible" content="IE=edge" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="x-apple-disable-message-reformatting" />
<meta name="color-scheme" content="light only" />
<meta name="supported-color-schemes" content="light only" />
<title>Outlook classic diagnostic: button, gap, spec boxes, width</title>
${MSO_HEAD}
<style type="text/css">
${STYLE}
</style>
</head>
<body id="body" style="margin:0; padding:0; background-color:${C.ground};">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:${C.ground};">
<tr><td align="center" style="padding:24px 8px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
<tr><td style="${FF} font-size:26px; line-height:32px; ${LH}; font-weight:bold; color:${C.black};">Outlook classic diagnostic (6 Oct 2026)</td></tr>
<tr><td style="padding:6px 0 0 0; ${FF} font-size:14px; line-height:20px; ${LH}; color:${C.ink};">For each question, note the letter that looks right in Outlook 2016 and 2019, and check Gmail, Apple Mail, iPhone and Outlook.com still look right.</td></tr>
${section('Q1. The button', 'Right looks like: a green pill (square corners are fine in Outlook) with space around the words, and a clear gap between the grey boxes and the button.', Q1, true)}
${section('Q2. The grey spec boxes', 'Right looks like: four even grey boxes, white gaps between them, no small grey notch on the left edge of boxes 2 to 4.', Q2, true)}
${section('Q3. The email width', 'Right looks like: each dashed box 600px wide in every client, including Outlook 2016; narrower on a phone.', Q3, false)}
</table>
</td></tr>
</table>
</body>
</html>
`;

const dir = join(import.meta.dirname, '..', 'out');
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'diag-outlook.html'), html);
console.log(`wrote ${join(dir, 'diag-outlook.html')} (${html.length} characters)`);
