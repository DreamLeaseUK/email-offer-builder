/**
 * Diagnostic: every credible VML pill construction side by side, labelled, in one .eml.
 * Open out/diag-vml.eml in classic Outlook and report which numbers render with the text centred.
 *
 *   pnpm --filter @offer-mailer/render exec tsx scripts/diag-vml.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const FONT = "Arial, 'Helvetica Neue', Helvetica, sans-serif";
const GREEN = '#31BD51';
const ORANGE = '#FF8811';

interface V {
  id: string;
  note: string;
  make: (text: string, w: number, h: number, font: number, bg: string, href?: string) => string;
}

/** Plain HTML pill (what non-Outlook clients get everywhere). */
const htmlPill = (text: string, w: number, h: number, font: number, bg: string, href?: string) => {
  const inner = href
    ? `<a href="${href}" style="display:block;font-size:${font}px;line-height:${h}px;font-weight:700;color:#FFFFFF;text-decoration:none">${text}</a>`
    : `<span style="display:block;font-size:${font}px;line-height:${h}px;font-weight:700;color:#FFFFFF">${text}</span>`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate"><tr><td width="${w}" style="background:${bg};border-radius:999px;text-align:center;width:${w}px;height:${h}px">${inner}</td></tr></table>`;
};

const variants: V[] = [
  {
    id: 'V1',
    note: 'Campaign Monitor canonical: real anchor inside the shape, line-height = height, no textbox, no inset',
    make: (text, w, h, font, bg, href) =>
      `<div><!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word"${href ? ` href="${href}"` : ''} style="height:${h}px;v-text-anchor:middle;width:${w}px" arcsize="50%" stroke="f" fillcolor="${bg}"><w:anchorlock/><center><![endif]--><a${href ? ` href="${href}"` : ''} style="background-color:${bg};border-radius:999px;color:#FFFFFF;display:inline-block;font-family:${FONT};font-size:${font}px;font-weight:bold;line-height:${h}px;text-align:center;text-decoration:none;width:${w}px;-webkit-text-size-adjust:none">${text}</a><!--[if mso]></center></v:roundrect><![endif]--></div>`,
  },
  {
    id: 'V2',
    note: 'Current build: HTML hidden from Word, separate <center> with line-height = height, v:textbox inset 0',
    make: (text, w, h, font, bg, href) =>
      `<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word"${href ? ` href="${href}"` : ''} style="height:${h}px;v-text-anchor:middle;width:${w}px" arcsize="50%" stroke="f" fillcolor="${bg}"><w:anchorlock/><v:textbox inset="0,0,0,0"><center style="color:#FFFFFF;font-family:${FONT};font-size:${font}px;line-height:${h}px;font-weight:700">${text}</center></v:textbox></v:roundrect><![endif]--><!--[if !mso]><!-->${htmlPill(text, w, h, font, bg, href)}<!--<![endif]-->`,
  },
  {
    id: 'V3',
    note: 'Separate <center>, no line-height, no textbox (previous build)',
    make: (text, w, h, font, bg, href) =>
      `<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word"${href ? ` href="${href}"` : ''} style="height:${h}px;v-text-anchor:middle;width:${w}px" arcsize="50%" stroke="f" fillcolor="${bg}"><w:anchorlock/><center style="color:#FFFFFF;font-family:${FONT};font-size:${font}px;font-weight:700">${text}</center></v:roundrect><![endif]--><!--[if !mso]><!-->${htmlPill(text, w, h, font, bg, href)}<!--<![endif]-->`,
  },
  {
    id: 'V4',
    note: 'Separate <center>, no line-height, v:textbox inset 0 (no line-height at all)',
    make: (text, w, h, font, bg, href) =>
      `<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word"${href ? ` href="${href}"` : ''} style="height:${h}px;v-text-anchor:middle;width:${w}px" arcsize="50%" stroke="f" fillcolor="${bg}"><w:anchorlock/><v:textbox inset="0,0,0,0"><center style="color:#FFFFFF;font-family:${FONT};font-size:${font}px;font-weight:700">${text}</center></v:textbox></v:roundrect><![endif]--><!--[if !mso]><!-->${htmlPill(text, w, h, font, bg, href)}<!--<![endif]-->`,
  },
  {
    id: 'V5',
    note: 'Canonical (V1) plus v:textbox inset 0 around the <center>',
    make: (text, w, h, font, bg, href) =>
      `<div><!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word"${href ? ` href="${href}"` : ''} style="height:${h}px;v-text-anchor:middle;width:${w}px" arcsize="50%" stroke="f" fillcolor="${bg}"><w:anchorlock/><v:textbox inset="0,0,0,0"><center><![endif]--><a${href ? ` href="${href}"` : ''} style="background-color:${bg};border-radius:999px;color:#FFFFFF;display:inline-block;font-family:${FONT};font-size:${font}px;font-weight:bold;line-height:${h}px;text-align:center;text-decoration:none;width:${w}px">${text}</a><!--[if mso]></center></v:textbox></v:roundrect><![endif]--></div>`,
  },
  {
    id: 'V6',
    note: 'Canonical (V1) with mso-line-height-rule:exactly and mso-text-raise on the anchor',
    make: (text, w, h, font, bg, href) =>
      `<div><!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word"${href ? ` href="${href}"` : ''} style="height:${h}px;v-text-anchor:middle;width:${w}px" arcsize="50%" stroke="f" fillcolor="${bg}"><w:anchorlock/><center><![endif]--><a${href ? ` href="${href}"` : ''} style="background-color:${bg};border-radius:999px;color:#FFFFFF;display:inline-block;font-family:${FONT};font-size:${font}px;font-weight:bold;line-height:${h}px;mso-line-height-rule:exactly;text-align:center;text-decoration:none;width:${w}px;mso-text-raise:0">${text}</a><!--[if mso]></center></v:roundrect><![endif]--></div>`,
  },
  {
    id: 'V7',
    note: 'No VML: plain table pill (square corners in Word). Control.',
    make: (text, w, h, font, bg, href) => htmlPill(text, w, h, font, bg, href),
  },
];

const row = (label: string, cell: string) =>
  `<tr><td style="padding:10px 12px;border-bottom:1px solid #E1E0E4;font-family:${FONT};font-size:13px;color:#393838;width:60px;vertical-align:middle"><b>${label}</b></td><td style="padding:10px 12px;border-bottom:1px solid #E1E0E4;vertical-align:middle">${cell}</td></tr>`;

let body = `<h2 style="font-family:${FONT};font-size:18px;margin:0 0 6px">VML pill diagnostic — classic Outlook</h2><p style="font-family:${FONT};font-size:13px;color:#787580;margin:0 0 16px">For each row, note whether the text is vertically centred, cut off at the top, cut off at the bottom, or missing. Reply with the row numbers that look right.</p>`;

body += `<h3 style="font-family:${FONT};font-size:15px;margin:16px 0 6px">Buttons — 48px tall, 16px text</h3><table cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse">`;
for (const v of variants) body += row(`B-${v.id}`, `${v.make('View this offer', 220, 48, 16, GREEN, 'https://www.dreamlease.co.uk/')}<div style="font-family:${FONT};font-size:11px;color:#787580;margin-top:6px">${v.note}</div>`);
body += `</table>`;

body += `<h3 style="font-family:${FONT};font-size:15px;margin:16px 0 6px">Badges — 22px tall, 12px text</h3><table cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse">`;
for (const v of variants) body += row(`P-${v.id}`, `${v.make('DreamLease exclusive!', 160, 22, 12, ORANGE)}<div style="font-family:${FONT};font-size:11px;color:#787580;margin-top:6px">${v.note}</div>`);
body += `</table>`;

body += `<h3 style="font-family:${FONT};font-size:15px;margin:16px 0 6px">Badges — 26px tall, 12px text (taller shape)</h3><table cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse">`;
for (const v of variants) body += row(`T-${v.id}`, v.make('In stock', 110, 26, 12, ORANGE));
body += `</table>`;

const html = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta http-equiv="Content-Type" content="text/html; charset=UTF-8"><title>VML diagnostic</title><!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><style>v\\:* { behavior: url(#default#VML); display: inline-block; }</style><![endif]--></head><body style="margin:0;padding:24px;background:#FFFFFF"><div style="max-width:640px">${body}</div></body></html>`;

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n');
const eml = [
  'X-Unsent: 1',
  'From: Offer Mailer <sam.carter@dreamlease.co.uk>',
  'To: Matt Wilson <matt.wilson@dreamlease.co.uk>',
  'Subject: VML pill diagnostic',
  `Date: ${new Date().toUTCString()}`,
  'MIME-Version: 1.0',
  'Content-Type: text/html; charset=utf-8',
  'Content-Transfer-Encoding: base64',
  '',
  b64(html),
].join('\r\n');

const outDir = join(import.meta.dirname, '..', 'out');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'diag-vml.eml'), eml);
writeFileSync(join(outDir, 'diag-vml.html'), html);
console.log('written out/diag-vml.eml and out/diag-vml.html');
