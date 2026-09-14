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
export function paragraphs(text: string, pStyle: string): string {
  return text
    .split(/\r?\n\s*\r?\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p style="${pStyle}">${esc(p).replace(/\r?\n/g, '<br>')}</p>`)
    .join('');
}

/** Outlook needs mso-line-height-rule:exactly next to every line-height. */
export const LH = 'mso-line-height-rule:exactly';

export const FONT = "Arial, 'Helvetica Neue', Helvetica, sans-serif";

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

/** MSO conditional comment helpers for the fluid-hybrid ghost tables. */
export const mso = {
  open: (html: string) => `<!--[if mso]>${html}<![endif]-->`,
};
