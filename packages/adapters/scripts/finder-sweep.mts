// Run the brochure finder LIVE over a list of cars, two at a time, record every
// Firecrawl response under %TEMP%/finder-sweep, and print what happened. It spends real credits (about 10 a car).
// Usage: pnpm --filter @offer-mailer/render exec tsx ../adapters/scripts/finder-sweep.mts "Make|Model" "Make|Model" …
// This is how finder-1.4 was proven (21 Sept 2026): a miss or a wrong attachment shows in the trace it prints.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createFirecrawlClient } from '../src/firecrawl/client.js';
import { findBrochure } from '../src/brochure/finder.js';
import type { FinderHttp } from '../src/brochure/finder.js';

const REPO = 'C:/Users/MatthewWilson/email-offer-builder';
const OUT = `${process.env.TEMP}/finder-sweep`;
mkdirSync(`${OUT}/fixtures`, { recursive: true });
const KEY = readFileSync(`${REPO}/apps/api/.dev.vars`, 'utf8').match(/^FIRECRAWL_API_KEY\s*=\s*"?([^"\r\n]+)"?/m)![1]!;
const slimHtml = (h: string) => { const out: string[] = []; let i = -1; while ((i = h.indexOf('.pdf', i + 1)) >= 0) out.push(h.slice(Math.max(0, i - 400), i + 40)); return out.join('\n<!-- … -->\n').slice(0, 60000); };
const recordingFetch: typeof fetch = async (input, init) => {
  const res = await fetch(input, init);
  const json: any = await res.clone().json().catch(() => ({}));
  const path = new URL(String(input)).pathname.replace(/^\/v2/, '');
  const body = JSON.parse(String(init?.body ?? '{}'));
  const name = createHash('sha1').update(path + JSON.stringify(body)).digest('hex');
  const slim = json?.data?.rawHtml ? { ...json, data: { ...json.data, rawHtml: slimHtml(json.data.rawHtml) } } : json;
  writeFileSync(`${OUT}/fixtures/${name}.json`, JSON.stringify({ path, body, response: slim }));
  return res;
};
const http: FinderHttp = async (url) => {
  try {
    const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36', accept: 'text/html,application/pdf;q=0.9,*/*;q=0.8', 'accept-language': 'en-GB,en;q=0.9' }, redirect: 'follow', signal: AbortSignal.timeout(15000) });
    const lm = res.headers.get('last-modified'); return { status: res.status, contentType: res.headers.get('content-type') ?? '', finalUrl: res.url || url, ...(lm ? { lastModified: lm } : {}), text: () => res.text() };
  } catch {
    return undefined;
  }
};

const cars = process.argv.slice(2).map((a) => a.split('|') as [string, string]);
const results: any[] = [];
async function one([make, model]: [string, string]) {
  const t = Date.now();
  const r = await findBrochure({ make, model }, { firecrawl: createFirecrawlClient(KEY, recordingFetch), http, now: () => new Date() });
  const top = r.candidates[0];
  results.push({ car: `${make} ${model}`, status: r.status, market: r.market, type: r.documentType, edition: r.editionDate, credits: r.credits, secs: Math.round((Date.now() - t) / 1000), official: r.officialSite, exhausted: r.exhausted, pages: r.pagesOpened, url: r.url, reason: r.reason, how: top?.status === 'accepted' ? `${top.via} · ${(top.discoveredBy ?? []).join('+')}${top.action ? ' · ' + top.action : ''}` : undefined, candidates: r.candidates.slice(0, 8).map((c) => ({ status: c.status, score: c.score, via: c.via, by: c.discoveredBy, action: c.action, url: c.url, reasons: c.reasons })) });
  console.log(`${r.status === 'verified_pdf' || r.status === 'verified_web_brochure' ? 'FOUND ' : 'MISS  '} ${make} ${model} → ${r.status}${r.market === 'eu' ? ' (EU)' : ''} ${r.documentType ?? ''} ${r.editionDate ?? ''} | ${r.credits} credits, ${Math.round((Date.now() - t) / 1000)}s | ${r.url ?? r.reason ?? ''}`);
}
for (let i = 0; i < cars.length; i += 2) await Promise.all(cars.slice(i, i + 2).map((c) => one(c).catch((e) => console.log('ERROR', c.join(' '), e?.message))));
writeFileSync(`${OUT}/results-${Date.now()}.json`, JSON.stringify(results, null, 1));
const found = results.filter((r) => r.status === 'verified_pdf' || r.status === 'verified_web_brochure').length;
console.log(`\n${found}/${results.length} found | ${results.reduce((a, r) => a + r.credits, 0)} credits in all`);
