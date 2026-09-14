/**
 * Diagnostic: two-column card constructions side by side, labelled, in one .eml.
 * Open out/diag-grid.eml in New Outlook desktop (narrow and wide reading pane), forward it to a phone,
 * and report which rows show two equal columns on desktop and one column on the phone.
 *
 *   pnpm --filter @offer-mailer/render exec tsx scripts/diag-grid.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const FONT = "Arial, 'Helvetica Neue', Helvetica, sans-serif";
const CELL = 308;

/** A stand-in card: bordered box with an image-sized grey block and a few lines, so height varies like real cards. */
const card = (label: string, lines: number, w: number) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse"><tr><td style="padding:0 12px 20px 12px"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:separate"><tr><td style="border:1px solid #E1E0E4;border-radius:16px;padding:0;background:#FFFFFF"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse"><tr><td style="padding:0"><img src="https://offer-mailer.matt-wilson-9b8.workers.dev/a/vehicle-placeholder.png" width="${w}" height="${Math.round((w * 3) / 4)}" alt="" style="display:block;border:0;width:100%;height:auto"></td></tr><tr><td style="padding:14px 16px 16px 16px;font-family:${FONT};font-size:14px;line-height:20px;color:#393838"><b>${label}</b>${'<br>line'.repeat(lines)}</td></tr></table></td></tr></table></td></tr></table>`;

interface V {
  id: string;
  note: string;
  make: (a: string, b: string) => string;
  extraCss?: string;
}

const variants: V[] = [
  {
    id: 'G1',
    note: 'Current build: inline-block div, width:100%, max-width:308px, vertical-align:top, container font-size:0',
    make: (a, b) => `<div style="font-size:0;text-align:center"><div class="g1" style="display:inline-block;width:100%;max-width:${CELL}px;vertical-align:top">${a}</div><div class="g1" style="display:inline-block;width:100%;max-width:${CELL}px;vertical-align:top">${b}</div></div>`,
    extraCss: `@media (max-width:480px){.g1{max-width:100% !important}}`,
  },
  {
    id: 'G2',
    note: 'inline-block div with fixed width:308px (no 100%), media query sets width:100%',
    make: (a, b) => `<div style="font-size:0;text-align:center"><div class="g2" style="display:inline-block;width:${CELL}px;vertical-align:top">${a}</div><div class="g2" style="display:inline-block;width:${CELL}px;vertical-align:top">${b}</div></div>`,
    extraCss: `@media (max-width:480px){.g2{width:100% !important}}`,
  },
  {
    id: 'G3',
    note: 'Floated tables: <table align="left" width="308">, no divs at all (classic pre-ghost hybrid)',
    make: (a, b) => `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse"><tr><td style="padding:0;font-size:0"><table role="presentation" cellpadding="0" cellspacing="0" border="0" align="left" width="${CELL}" class="g3" style="width:${CELL}px"><tr><td style="font-size:14px">${a}</td></tr></table><table role="presentation" cellpadding="0" cellspacing="0" border="0" align="left" width="${CELL}" class="g3" style="width:${CELL}px"><tr><td style="font-size:14px">${b}</td></tr></table></td></tr></table>`,
    extraCss: `@media (max-width:480px){table.g3{width:100% !important}}`,
  },
  {
    id: 'G4',
    note: 'Real two-cell table row, cells width 50%; media query turns each td into display:block',
    make: (a, b) => `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse"><tr><td width="50%" class="g4" style="vertical-align:top;padding:0">${a}</td><td width="50%" class="g4" style="vertical-align:top;padding:0">${b}</td></tr></table>`,
    extraCss: `@media (max-width:480px){td.g4{display:block !important;width:100% !important}}`,
  },
  {
    id: 'G5',
    note: 'Two-cell table row, each td itself display:inline-block;width:100%;max-width:308px (responsive td)',
    make: (a, b) => `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse"><tr><td class="g5" style="display:inline-block;width:100%;max-width:${CELL}px;vertical-align:top;padding:0">${a}</td><td class="g5" style="display:inline-block;width:100%;max-width:${CELL}px;vertical-align:top;padding:0">${b}</td></tr></table>`,
    extraCss: `@media (max-width:480px){td.g5{max-width:100% !important}}`,
  },
  {
    id: 'G6',
    note: 'inline-block div, width:50% with min-width:280px so it wraps below ~560px without a media query',
    make: (a, b) => `<div style="font-size:0;text-align:center"><div style="display:inline-block;width:50%;min-width:280px;vertical-align:top">${a}</div><div style="display:inline-block;width:50%;min-width:280px;vertical-align:top">${b}</div></div>`,
  },
];

const css = variants.map((v) => v.extraCss ?? '').join('');

let body = `<h2 style="font-family:${FONT};font-size:18px;margin:0 0 6px">Two-column diagnostic</h2><p style="font-family:${FONT};font-size:13px;color:#787580;margin:0 0 16px">Desktop: which rows show two equal-width columns, tops aligned? Phone: which rows show one column, full width? Reply with the row IDs.</p>`;
for (const v of variants) {
  body += `<p style="font-family:${FONT};font-size:14px;margin:24px 0 8px"><b>${v.id}</b> <span style="color:#787580;font-size:12px">${v.note}</span></p>${v.make(card(`${v.id} card A`, 2, CELL - 24), card(`${v.id} card B`, 3, CELL - 24))}`;
}

const html = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:o="urn:schemas-microsoft-com:office:office"><head><meta http-equiv="Content-Type" content="text/html; charset=UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Two-column diagnostic</title><style>body{margin:0;padding:0;background:#EDEDEF}${css}</style></head><body style="margin:0;padding:0;background:#EDEDEF"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="#EDEDEF"><tr><td align="center" style="padding:24px 12px"><!--[if mso]><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="640"><tr><td><![endif]--><table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" width="100%" style="margin:0 auto;border-collapse:collapse;background:#FFFFFF;width:100%;max-width:640px"><tr><td style="padding:20px 12px">${body}</td></tr></table><!--[if mso]></td></tr></table><![endif]--></td></tr></table></body></html>`;

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n');
const eml = [
  'X-Unsent: 1',
  'From: Offer Mailer <sam.carter@dreamlease.co.uk>',
  'To: Matt Wilson <matt.wilson@dreamlease.co.uk>',
  'Subject: Two-column diagnostic',
  `Date: ${new Date().toUTCString()}`,
  'MIME-Version: 1.0',
  'Content-Type: text/html; charset=utf-8',
  'Content-Transfer-Encoding: base64',
  '',
  b64(html),
].join('\r\n');

const outDir = join(import.meta.dirname, '..', 'out');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'diag-grid.eml'), eml);
writeFileSync(join(outDir, 'diag-grid.html'), html);
console.log('written out/diag-grid.eml and out/diag-grid.html');
