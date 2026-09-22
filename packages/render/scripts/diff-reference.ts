/**
 * Fidelity check against the markup source of truth (design/dreamlease-offer-mailer-v5.html).
 * Renders each layout with one offer per reference card, strips everything that is data (text,
 * href, src, alt, title), sorts attributes, and diffs the tag structure of each layout block, the
 * header, the signature and the footer against the reference. Differences that are not data are
 * deviations from the reference and must be justified in the file header of cards.ts.
 *
 *   pnpm --filter @offer-mailer/render exec tsx scripts/diff-reference.ts [reference.html]
 */
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { render } from '../src/index.js';
import { fixtureCampaign, fixtureTemplate } from '../src/fixtures/index.js';

const refPath = process.argv[2] ?? join(import.meta.dirname, '..', '..', '..', 'design', 'dreamlease-offer-mailer-v5.html');
// Merge-tag comments (<!--{{ x }}-->) are data placeholders; some sit inside attribute values, so
// they go before tokenising.
const reference = readFileSync(refPath, 'utf8').replace(/<!--\{\{[^}]*\}\}-->/g, '');
const outDir = join(import.meta.dirname, '..', 'out', 'diff');
mkdirSync(outDir, { recursive: true });

/** Tag skeleton: one line per tag with sorted attributes; data-bearing attribute values blanked. */
function skeleton(html: string): string {
  const lines: string[] = [];
  const re = /<!--\[if mso\]>|<!\[endif\]-->|<!--<!\[endif\]-->|<!--[\s\S]*?-->|<\/?[a-zA-Z][^>]*>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const tok = m[0];
    if (tok === '<!--[if mso]>' || tok === '<![endif]-->') {
      lines.push(tok);
      continue;
    }
    if (tok.startsWith('<!--')) continue; // ordinary comments are documentation, not markup
    const tag = tok.match(/^<\/?([a-zA-Z][\w-]*)/)![1]!.toLowerCase();
    if (tok.startsWith('</')) {
      lines.push(`</${tag}>`);
      continue;
    }
    const attrs = [...tok.matchAll(/([a-zA-Z-]+)\s*=\s*"([^"]*)"/g)]
      .map(([, k, v]) => {
        const key = k!.toLowerCase();
        let val = v!;
        if (['href', 'src', 'alt', 'title'].includes(key)) val = '…';
        if (key === 'style') val = val.replace(/\s+/g, ' ').replace(/;\s*$/, '').trim();
        if (key === 'class') val = val.split(/\s+/).filter(Boolean).sort().join(' ');
        return `${key}="${val}"`;
      })
      .sort();
    lines.push(`<${tag}${attrs.length ? ' ' + attrs.join(' ') : ''}>`);
  }
  return lines.join('\n') + '\n';
}

function between(src: string, start: string, end: string): string {
  const i = src.indexOf(start);
  const j = src.indexOf(end, i + start.length);
  if (i < 0 || j < 0) throw new Error(`section not found: ${start.slice(0, 40)}`);
  return src.slice(i, j);
}

/**
 * The reference's layout block N, cut to its first card (the others are copies). Blocks C (grid2) and D
 * (grid3) are still in the reference file but no longer built (deleted 22 Sept 2026), so they are not compared.
 */
function refLayout(letter: 'A' | 'B', cards: number): string {
  const block = between(reference, `<!--== LAYOUT ${letter} —`, `<!--== LAYOUT ${letter} END ==-->`);
  const body = block.slice(block.indexOf('<tr>'));
  // keep the first `cards` cards with the ghost separators between them, then the block's tail
  const END = '<!--== OFFER CARD END ==-->';
  let cut = -1;
  for (let n = 0; n < cards; n++) cut = body.indexOf(END, cut + 1);
  if (cut < 0) throw new Error(`layout ${letter} has fewer than ${cards} cards`);
  const lastEnd = body.lastIndexOf(END);
  return body.slice(0, cut + END.length) + body.slice(lastEnd + END.length);
}

const BASE = 'https://offers.dreamlease.co.uk';
const ours = (layout: 'single' | 'stack', offerCount: number): string => {
  const { campaign, brochures } = fixtureCampaign({ layout, offerCount, brochure: 'pdf' });
  return render(campaign, fixtureTemplate, { publicBaseUrl: BASE, brochures }).html;
};

function ourSection(html: string, startMarker: string, endMarker: string): string {
  return between(html, startMarker, endMarker);
}

const checks: { name: string; ref: string; our: string }[] = [
  { name: 'header', ref: between(reference, '<!-- Header -->', '<!-- Intro -->'), our: ourSection(ours('single', 1), '<!-- Header -->', '<!-- Intro -->') },
  { name: 'intro', ref: between(reference, '<!-- Intro -->', '<!-- ===================='), our: ourSection(ours('single', 1), '<!-- Intro -->', '<tr>\n<td class="gutter" style="padding:12px') },
  { name: 'layout-A-single', ref: refLayout('A', 1), our: ourSection(ours('single', 1), '<tr>\n<td class="gutter" style="padding:12px', '<!-- Signature -->') },
  { name: 'layout-B-stack', ref: refLayout('B', 1), our: ourSection(ours('stack', 1), '<tr>\n<td class="gutter" style="padding:12px', '<!-- Signature -->') },
  { name: 'signature', ref: between(reference, '<!-- Signature -->', '<!-- Compliance footer'), our: ourSection(ours('single', 1), '<!-- Signature -->', '<!-- Compliance footer') },
  { name: 'footer', ref: between(reference, '<!-- Compliance footer', '<!-- ================= /EMAIL WRAPPER'), our: ourSection(ours('single', 1), '<!-- Compliance footer', '<!-- ================= /EMAIL WRAPPER') },
  { name: 'head', ref: between(reference, '<!DOCTYPE', '<body'), our: ourSection(ours('single', 1), '<!DOCTYPE', '<body') },
];

let deviations = 0;
for (const c of checks) {
  const a = join(outDir, `${c.name}.reference.txt`);
  const b = join(outDir, `${c.name}.ours.txt`);
  writeFileSync(a, skeleton(c.ref));
  writeFileSync(b, skeleton(c.our));
  let diff = '';
  try {
    execSync(`diff -u "${a}" "${b}"`, { encoding: 'utf8' });
  } catch (e) {
    diff = (e as { stdout?: string }).stdout ?? '';
  }
  const changed = diff.split('\n').filter((l) => (l.startsWith('+') || l.startsWith('-')) && !l.startsWith('+++') && !l.startsWith('---')).length;
  deviations += changed;
  console.log(`${c.name}: ${changed === 0 ? 'identical structure' : `${changed} differing lines`}`);
  if (changed) console.log(diff.split('\n').slice(2).join('\n'));
}
console.log(deviations === 0 ? '\nAll sections match the reference structure.' : `\n${deviations} differing lines in total (see ${outDir}).`);
