/**
 * Operating a page the way a person does — inside Firecrawl's own browser, in ONE scrape (1 credit).
 *
 * A brochure is often not a link at all: it is a button that fetches a file, a tab that has to be opened, a
 * control behind a cookie banner (Geely's "Download Geely EX2 Brochure" is a button; its address is nowhere in
 * the page's links). Reading the page source cannot see those. These two scripts run as `executeJavascript`
 * actions of a Firecrawl scrape, with a wait between them:
 *
 *   OPERATE  hooks every way a page hands over a file (window.open, a.click(), fetch, XHR, link clicks),
 *            dismisses a cookie banner, notes the links already rendered, then presses the controls whose
 *            label says brochure / download / specification / price list, one at a time.
 *   REPORT   returns what was seen: each document address with HOW it was reached and the LABEL of the control
 *            or link that led to it. The label is the evidence a person uses: "Download Geely EX2 Brochure".
 *
 * Nothing is submitted and no form is filled in: request / test-drive / configurator controls are never pressed.
 * Matt, 21 Sept 2026: "You are not leveraging Firecrawl capability to its optimum."
 */

/** One document address the page gave up, and how. */
export interface OperatedFind {
  url: string;
  /** 'link' = an anchor already in the rendered page; 'press' = it appeared because a control was pressed. */
  how: 'link' | 'press';
  /** The text of the link, or of the control that was pressed. */
  label: string;
}

export interface OperatedPage {
  finds: OperatedFind[];
  /** Labels of the controls that were pressed, in order (for the trace). */
  pressed: string[];
  /** A brochure-request control or link, when the page offers one. */
  request?: { url: string; label: string };
}

const SCRIPT_OPERATE = String.raw`
(() => {
  const finds = []; const pressed = []; let current = ''; let request = null;
  const isDoc = (u) => /\.pdf(\?|#|$)/i.test(u);
  const note = (u, how, label) => { try { const abs = new URL(String(u), location.href).href; if (isDoc(abs)) finds.push({ url: abs, how: how, label: String(label || current || '').slice(0, 120) }); } catch (e) {} };
  window.open = function (u) { note(u, 'press'); return null; };
  HTMLAnchorElement.prototype.click = function () { note(this.href, 'press'); };
  const f0 = window.fetch; if (f0) window.fetch = function (u) { note(u && u.url ? u.url : u, 'press'); return f0.apply(this, arguments); };
  const x0 = XMLHttpRequest.prototype.open; XMLHttpRequest.prototype.open = function (m, u) { note(u, 'press'); return x0.apply(this, arguments); };
  document.addEventListener('click', (e) => { const a = e.target && e.target.closest ? e.target.closest('a[href]') : null; if (a) { note(a.href, 'press'); if (isDoc(a.href)) e.preventDefault(); } }, true);
  const txt = (el) => (el.innerText || el.textContent || el.getAttribute('aria-label') || el.getAttribute('title') || '').replace(/\s+/g, ' ').trim();
  const all = (sel) => Array.from(document.querySelectorAll(sel));
  const cookie = all('button, a, [role=button]').find((el) => /^(accept( all)?( cookies)?|allow all( cookies)?|agree|i agree|got it|ok|accept and continue)$/i.test(txt(el)));
  if (cookie) { try { cookie.click(); } catch (e) {} }
  const WANT = /brochure|download|specification|spec sheet|price ?(list|guide)|pricelist/i;
  const NEVER = /request|test drive|configur|build (and|&) price|newsletter|app store|google play|sign ?up|register|book/i;
  all('a[href]').forEach((a) => {
    const t = txt(a);
    if (isDoc(a.href)) finds.push({ url: a.href, how: 'link', label: t.slice(0, 120) });
    else if (/brochure/i.test(t) && /request|order/i.test(t + ' ' + a.href) && !request) request = { url: a.href, label: t.slice(0, 120) };
  });
  const controls = all('button, a, [role=button], [role=tab], summary').filter((el) => { const t = txt(el); return t && t.length < 90 && WANT.test(t) && !NEVER.test(t) && !(el.tagName === 'A' && isDoc(el.href || '')); }).slice(0, 8);
  window.__dl = { finds: finds, pressed: pressed, request: function () { return request; } };
  controls.forEach((el, i) => setTimeout(() => { current = txt(el); pressed.push(current.slice(0, 120)); try { el.click(); } catch (e) {} }, 500 * i));
  return 'armed:' + controls.length;
})()`;

const SCRIPT_REPORT = String.raw`
(() => {
  const o = window.__dl || { finds: [], pressed: [], request: function () { return null; } };
  const seen = {}; const finds = [];
  o.finds.forEach((f) => { const k = f.url; if (!seen[k] || (seen[k].how === 'link' && f.how === 'press' && !seen[k].label)) { if (!seen[k]) finds.push(f); seen[k] = f; } });
  return JSON.stringify({ finds: finds.slice(0, 40), pressed: o.pressed.slice(0, 12), request: o.request() });
})()`;

/** The `actions` of the scrape: let the page settle, operate it, give the presses time to fetch, report. */
export const OPERATE_ACTIONS: unknown[] = [
  { type: 'wait', milliseconds: 2500 },
  { type: 'executeJavascript', script: SCRIPT_OPERATE },
  { type: 'wait', milliseconds: 4500 },
  { type: 'executeJavascript', script: SCRIPT_REPORT },
];

/** Reads REPORT's answer out of the scrape's javascript returns. Anything unexpected is "the page gave nothing". */
export function parseOperated(returns: unknown[] | undefined): OperatedPage {
  const empty: OperatedPage = { finds: [], pressed: [] };
  for (const r of [...(returns ?? [])].reverse()) {
    const raw = typeof r === 'string' ? r : r && typeof r === 'object' && 'value' in r ? (r as { value: unknown }).value : undefined;
    if (typeof raw !== 'string' || !raw.startsWith('{')) continue;
    try {
      const j = JSON.parse(raw) as { finds?: unknown; pressed?: unknown; request?: unknown };
      const finds: OperatedFind[] = [];
      for (const f of Array.isArray(j.finds) ? j.finds : []) {
        if (!f || typeof f !== 'object') continue;
        const { url, how, label } = f as { url?: unknown; how?: unknown; label?: unknown };
        if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) continue;
        finds.push({ url, how: how === 'press' ? 'press' : 'link', label: typeof label === 'string' ? label : '' });
      }
      const out: OperatedPage = { finds, pressed: Array.isArray(j.pressed) ? j.pressed.filter((x): x is string => typeof x === 'string') : [] };
      const rq = j.request as { url?: unknown; label?: unknown } | null | undefined;
      if (rq && typeof rq.url === 'string') out.request = { url: rq.url, label: typeof rq.label === 'string' ? rq.label : '' };
      return out;
    } catch {
      continue;
    }
  }
  return empty;
}
