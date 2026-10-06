/** Small HTML helpers. Every dynamic string in the markup goes through esc(). */

export function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Plain text with line breaks -> paragraphs. Blank line = new paragraph, single newline = <br>. */
export function paragraphs(text: string, pStyle: string, pClass = ''): string {
  return text
    .split(/\r?\n\s*\r?\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p${pClass ? ` class="${pClass}"` : ''} style="${pStyle}">${esc(p).replace(/\r?\n/g, '<br />')}</p>`)
    .join('\n');
}

/** Outlook needs mso-line-height-rule:exactly next to every line-height. */
export const LH = 'mso-line-height-rule:exactly';

/** The reference's fallback stack. No web fonts by design; Sofia Pro is UI only. */
export const FONT = 'Arial, Helvetica, sans-serif';
export const FF = `font-family:${FONT};`;

export const C = {
  red: '#E30613',
  green: '#31BD51',
  orange: '#FF8811',
  black: '#000000',
  ink: '#393838',
  graphite: '#787580',
  border: '#E1E0E4',
  panel: '#F6F6F7',
  white: '#FFFFFF',
  ground: '#EDEDEF',
} as const;

/** A presentation table without tbody, as the reference writes them. */
export const table = (attrs: string, style: string, rows: string): string =>
  `<table role="presentation" cellpadding="0" cellspacing="0" border="0"${attrs ? ' ' + attrs : ''}${style ? ` style="${style}"` : ''}>${rows}</table>`;

/**
 * Vertical spacer: a cell with a height, never a margin (Word ignores margins on tables). Its line is the cell's own
 * height, not 0: Word (Outlook classic) drew a font-size:0 line as a grey sliver and shrank the cell to it (unspam.email
 * renders of 6 Oct 2026, scripts/diag-outlook.ts).
 */
export const spacer = (h: number): string =>
  table('width="100%"', '', `<tr><td height="${h}" style="height:${h}px; font-size:${h}px; line-height:${h}px; ${LH};">&nbsp;</td></tr>`);

/** Outlook conditional comment. */
export const mso = (html: string): string => `<!--[if mso]>${html}<![endif]-->`;
