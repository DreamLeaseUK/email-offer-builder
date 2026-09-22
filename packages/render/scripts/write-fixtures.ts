/**
 * Writes rendered fixtures to out/ for eyeballing in a browser and for the real-client tests in
 * brief §8.2: .html for browsers and the hosted look, .eml to open in Outlook / Apple Mail.
 *
 *   pnpm --filter @offer-mailer/render fixtures [publicBaseUrl]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, toEml } from '../src/index.js';
import { fixtureCampaign, fixtureTemplate } from '../src/fixtures/index.js';
import type { FixtureOptions } from '../src/fixtures/index.js';

const publicBaseUrl = process.argv[2] ?? 'https://offer-mailer.matt-wilson-9b8.workers.dev';
const outDir = join(import.meta.dirname, '..', 'out');
mkdirSync(outDir, { recursive: true });

const variants: Record<string, FixtureOptions> = {
  '01-single-personal-brochure': { layout: 'single', offerCount: 1, brochure: 'pdf' },
  '02-single-personal-book-cta': { layout: 'single', offerCount: 1, cta: { kind: 'book' }, brochure: 'gated' },
  '03-stack-business': { layout: 'stack', offerCount: 3, contractType: 'business', brochure: 'pdf' },
  '04-stack-personal-call': { layout: 'auto', offerCount: 4, cta: { kind: 'call' } },
  '05-stack-salsac-shared': { layout: 'auto', offerCount: 6, contractType: 'salary_sacrifice', sender: 'shared', brochure: 'pdf' },
};

for (const [name, opts] of Object.entries(variants)) {
  const { campaign, brochures } = fixtureCampaign(opts);
  const out = render(campaign, fixtureTemplate, { publicBaseUrl, brochures });
  writeFileSync(join(outDir, `${name}.html`), out.html);
  writeFileSync(join(outDir, `${name}.hosted.html`), out.hostedHtml);
  writeFileSync(join(outDir, `${name}.txt`), out.text);
  writeFileSync(join(outDir, `${name}.eml`), toEml(campaign, out, 'Priya Example <priya@example.com>'));
  console.log(`${name}: ${out.layout}, ${Object.keys(out.links).length} tracked links, ${(out.html.length / 1024).toFixed(0)} KB`);
}
console.log(`written to ${outDir}`);
