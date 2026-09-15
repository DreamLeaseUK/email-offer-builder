import { readFileSync } from 'node:fs';
const key = (readFileSync('apps/api/.dev.vars', 'utf8').match(/^FIRECRAWL_API_KEY=(.+)$/m) || [])[1]?.trim();
if (!key) { console.error('no firecrawl key'); process.exit(1); }

// brand -> current allowlist entry (host or host/path)
const BRANDS = [
  ['Kia', 'kia.co.uk'], ['Hyundai', 'hyundai.co.uk'], ['BMW', 'bmw.co.uk'], ['MINI', 'mini.co.uk'],
  ['Mercedes-Benz', 'mercedes-benz.co.uk'], ['Audi', 'audi.co.uk'], ['Volkswagen', 'volkswagen.co.uk'],
  ['Skoda', 'skoda.co.uk'], ['SEAT', 'seat.co.uk'], ['Cupra', 'cupraofficial.co.uk'], ['Ford', 'ford.co.uk'],
  ['Vauxhall', 'vauxhall.co.uk'], ['Peugeot', 'peugeot.co.uk'], ['Citroen', 'citroen.co.uk'],
  ['Renault', 'renault.co.uk'], ['Nissan', 'nissan.co.uk'], ['Toyota', 'toyota.co.uk'], ['Lexus', 'lexus.co.uk'],
  ['Honda', 'honda.co.uk'], ['Mazda', 'mazda.co.uk'], ['Volvo', 'volvocars.com/uk'], ['Polestar', 'polestar.com/uk'],
  ['Tesla', 'tesla.com/en_gb'], ['BYD', 'byd.com/uk'], ['MG', 'mg.co.uk'], ['Jaguar', 'jaguar.co.uk'],
  ['Land Rover', 'landrover.co.uk'], ['Omoda', 'omodajaecoo.co.uk'], ['Jaecoo', 'omodajaecoo.co.uk'],
  ['smart', 'smart.com/gb'], ['Dacia', 'dacia.co.uk'], ['Fiat', 'fiat.co.uk'], ['Jeep', 'jeep.co.uk'],
  ['Alfa Romeo', 'alfaromeo.co.uk'], ['Porsche', 'porsche.com/uk'], ['Genesis', 'genesis.com/uk'],
  ['Ora', 'ora.co.uk'], ['Xpeng', 'xpeng.co.uk'], ['Leapmotor', 'leapmotor.co.uk'],
];

// hosts that are never the manufacturer's own site
const DENY = ['scribd', 'carwow', 'autocatalogarchive', 'auto-brochures', 'motaclarity', 'pentagon-group',
  'mycarusermanual', 'ebay', 'device.report', 'rac.co.uk', 'zmags', 'dealereprocess', 'prnewswire', 'wikipedia',
  'youtube', 'reddit', 'autotrader', 'heycar', 'cinch', 'parkers', 'whatcar', 'honestjohn', 'facebook',
  'stellantis', 'issuu', 'yumpu', 'slideshare'];

const host = (u) => { try { return new URL(u).host.replace(/^www\./, ''); } catch { return ''; } };
const ukMarker = (u) => /\.co\.uk$/i.test(host(u)) || /\/uk(\/|$)|\/gb(\/|$)|\/en[_-]gb(\/|$)/i.test(u);
const isDeny = (h) => DENY.some((d) => h.includes(d));

async function search(q) {
  const r = await fetch('https://api.firecrawl.dev/v2/search', {
    method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query: q, limit: 8, country: 'GB', location: 'United Kingdom', sources: [{ type: 'web' }] }),
  });
  const j = await r.json().catch(() => ({}));
  return (j.data?.web ?? []).map((x) => x.url).filter(Boolean);
}

const norm = (s) => s.toLowerCase().replace(/[^a-z]/g, '');
async function one([brand, entry]) {
  const urls = await search(`${brand} brochure pdf`);
  const token = norm(brand).slice(0, 5); // first chunk of the brand
  const cands = [...new Set(urls.map(host))].filter((h) => h && !isDeny(h));
  // official-likely: brand token in host, prefer a UK marker in any of its urls
  const official = cands.filter((h) => norm(h).includes(token) || urls.some((u) => host(u) === h && ukMarker(u) && norm(h).includes(token.slice(0, 3))));
  const uk = official.filter((h) => urls.some((u) => host(u) === h && ukMarker(u)));
  const pick = uk[0] ?? official[0] ?? cands[0] ?? '(none)';
  const entryHost = entry.split('/')[0];
  const match = pick !== '(none)' && (pick === entryHost || norm(pick).includes(norm(entryHost).replace(/couk|com/g, '')));
  return { brand, entry, pick, uk: uk.join(', ') || official.join(', ') || cands.slice(0, 3).join(', '), match };
}

const out = [];
for (let i = 0; i < BRANDS.length; i += 5) {
  const batch = await Promise.all(BRANDS.slice(i, i + 5).map(one));
  out.push(...batch);
  for (const r of batch) console.log(`${r.match ? 'OK  ' : 'XX  '} ${r.brand.padEnd(14)} entry=${r.entry.padEnd(22)} found=${r.uk}`);
}
console.log('\n--- MISMATCHES ---');
for (const r of out.filter((r) => !r.match)) console.log(`${r.brand.padEnd(14)} list:${r.entry.padEnd(22)} -> real:${r.uk}`);
