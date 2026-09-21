/**
 * How many lines a piece of text will take in a card column, without a browser.
 *
 * Email has no way to stretch two side-by-side cards to the same height (no flexbox in the fluid-hybrid
 * pattern, and nothing at all once Outlook has pasted the HTML), so the cards in a row only line up if the
 * shorter one reserves the space its neighbour uses. For text that means knowing where it wraps. The widths
 * are Arial's own advance widths (the email's font stack is Arial, which is what Gmail web and New Outlook
 * on Windows render; side by side only ever happens at desktop width), per 1000 units of font size.
 */
const NARROW = 278;
const ARIAL: Record<string, number> = {
  ' ': 278, '!': 278, '"': 355, '#': 556, '%': 889, '&': 667, "'": 191, '’': 222, '(': 333, ')': 333, '*': 389, '+': 584, ',': NARROW, '-': 333, '.': NARROW, '/': NARROW,
  ':': NARROW, ';': NARROW, '=': 584, '?': 556, '@': 1015, '·': 333, '–': 556, '—': 1000, '£': 556, '€': 556,
  A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 500, K: 667, L: 556, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222, j: 222, k: 500, l: 222, m: 833, n: 556, o: 556, p: 556, q: 556, r: 333, s: 500, t: 278, u: 556, v: 500, w: 722, x: 500, y: 500, z: 500,
};
/** Digits, accented letters and anything unlisted. */
const DEFAULT = 556;
/** Arial Bold runs about this much wider than Arial. */
const BOLD = 1.07;

export function textWidth(text: string, fontPx: number, bold = false): number {
  let units = 0;
  for (const ch of text) units += ARIAL[ch] ?? DEFAULT;
  return (units / 1000) * fontPx * (bold ? BOLD : 1);
}

/** Greedy word wrap, the way a browser breaks a paragraph. Empty text is no lines. */
export function wrapLines(text: string, fontPx: number, widthPx: number, bold = false): number {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 0;
  const space = textWidth(' ', fontPx, bold);
  let lines = 1;
  let used = 0;
  for (const word of words) {
    const w = textWidth(word, fontPx, bold);
    if (used === 0) {
      // a single word wider than the column is broken across lines by nobody: it overflows, on one line
      used = w;
    } else if (used + space + w <= widthPx) {
      used += space + w;
    } else {
      lines += 1;
      used = w;
    }
  }
  return lines;
}
