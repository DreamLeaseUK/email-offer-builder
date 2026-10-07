import type React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Badge, Button, Field, Input, OfferCard, Select, Textarea } from 'dreamlease-design-system';
import type { Brochure, BrochureSearch, CtaKind, Offer, Sender } from '@offer-mailer/schema';
import { CTA_DEFAULT_LABELS } from '@offer-mailer/schema';
import { api, type Audience, type ComposeSeed, type ContactMethod, type CreateResponse, type Draft, type Item, type LayoutChoice, type LeaseOption, type MailStatus, type UseCase } from './api';

const gbp = (n: number): string => '£' + Math.round(n).toLocaleString('en-GB');
const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const kMiles = (n: number): string => (n % 1000 === 0 ? `${n / 1000}k` : n.toLocaleString('en-GB'));

/** The three audiences / lease products, in select order. */
const AUDIENCES: { value: Audience; label: string; short: string }[] = [
  { value: 'personal', label: 'PCH — Personal contract hire', short: 'personal (PCH)' },
  { value: 'business', label: 'BCH — Business contract hire', short: 'business (BCH)' },
  { value: 'salary_sacrifice', label: 'Salary sacrifice', short: 'salary sacrifice' },
];
const audienceShort = (a: Audience): string => AUDIENCES.find((x) => x.value === a)?.short ?? a;
const isSalsac = (o: Offer): boolean => o.contractType === 'salary_sacrifice';

/**
 * Turn a looked-up (personal) offer into a salary-sacrifice offer: the vehicle identity, image and
 * options come from the page, but there is no initial payment and the price is entered by hand as
 * two net figures. Existing nets are preserved so re-pricing the term/mileage keeps them.
 */
function toSalsac(o: Offer, keep?: Offer): Offer {
  return {
    ...o,
    contractType: 'salary_sacrifice',
    pricing: {
      ...o.pricing,
      vat: 'inc',
      initialPayment: 0,
      maintenance: true,
      salsac: keep?.pricing.salsac ?? o.pricing.salsac ?? { net20: 0, net40: 0 },
    },
  };
}
const salsacReady = (o: Offer): boolean => (o.pricing.salsac?.net20 ?? 0) > 0 && (o.pricing.salsac?.net40 ?? 0) > 0;

/** The six steps of a campaign, in the order the screen asks for them (Matt, 29 Sept 2026: guide a new user). */
const STEPS = ['Who it’s for', 'Your message', 'Your details', 'Add offers', 'Check and create', 'Send'] as const;

/** The very first campaign's starting text; later ones start from what was used last (Remembered). Renewal first (Matt, 29 Sept 2026). */
const DEFAULT_NAME = 'Renewal offers';
const DEFAULT_SUBJECT = 'The options we talked about';
const DEFAULT_INTRO = 'Thanks for your time. As promised, here are the options that fit what we discussed.';

/**
 * Auto-save (Matt, 30 Sept 2026): what the salesperson is writing survives a reload, closing the tab or coming back
 * tomorrow, in this browser. Kept per signed-in person, for 30 days. Never the customer's name or email address (they
 * are not kept anywhere), and never the created campaign (Create again after a restore). Browser storage can be
 * missing or blocked (private windows): every read and write is guarded, and Compose works the same without it.
 */
const DRAFT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const DRAFT_STALE_MS = 24 * 60 * 60 * 1000; // older than this: re-price the offers live on restore
const draftKey = (email: string): string => `dl-compose-draft:v1:${email.trim().toLowerCase()}`;
/** The parts of a draft that are saved (fixed key order, so two saves of the same draft compare equal). */
interface DraftBody {
  name: string;
  audience: Audience;
  useCase: UseCase;
  useCaseNote: string;
  subject: string;
  preheader: string;
  intro: string;
  ctaKind: CtaKind;
  ctaLabel: string;
  items: Item[];
}
const draftBody = (b: DraftBody): DraftBody => ({ name: b.name, audience: b.audience, useCase: b.useCase, useCaseNote: b.useCaseNote, subject: b.subject, preheader: b.preheader, intro: b.intro, ctaKind: b.ctaKind, ctaLabel: b.ctaLabel, items: b.items });
const AUDIENCE_VALUES = ['personal', 'business', 'salary_sacrifice'];
const USE_CASE_VALUES = ['follow_up', 'offer_pack', 'renewal', 'other'];
const CTA_VALUES = ['view_offer', 'email', 'call', 'whatsapp', 'book', 'link'];
const isItem = (x: unknown): x is Item => {
  const o = (x as { offer?: Partial<Offer> } | null)?.offer;
  return !!o && typeof o.id === 'string' && typeof o.offerUrl === 'string' && typeof o.vehicle?.make === 'string' && typeof o.pricing?.monthly === 'number';
};
interface SavedDraft {
  savedAt: string;
  name: string;
  audience: Audience;
  useCase: UseCase;
  useCaseNote: string;
  subject: string;
  preheader: string;
  intro: string;
  ctaKind: CtaKind;
  ctaLabel: string;
  items: Item[];
}
function readSavedDraft(email: string): SavedDraft | null {
  try {
    const raw = localStorage.getItem(draftKey(email));
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<SavedDraft> | null;
    const strings = d && [d.savedAt, d.name, d.useCaseNote, d.subject, d.preheader, d.intro, d.ctaLabel].every((v) => typeof v === 'string');
    const valid =
      !!d && strings && AUDIENCE_VALUES.includes(d.audience as string) && USE_CASE_VALUES.includes(d.useCase as string) && CTA_VALUES.includes(d.ctaKind as string) && Array.isArray(d.items) && d.items.every(isItem);
    // Malformed (an older shape) or older than 30 days: forget it, so it can never break Compose or linger.
    if (!valid || !(Date.now() - Date.parse(d.savedAt as string) <= DRAFT_TTL_MS)) {
      clearSavedDraft(email);
      return null;
    }
    return d as SavedDraft;
  } catch {
    clearSavedDraft(email);
    return null;
  }
}
function writeSavedDraft(email: string, d: SavedDraft): void {
  try {
    localStorage.setItem(draftKey(email), JSON.stringify(d));
  } catch {
    /* storage full or blocked: auto-save is a convenience only */
  }
}
function clearSavedDraft(email: string): void {
  try {
    localStorage.removeItem(draftKey(email));
  } catch {
    /* ignore */
  }
}
/**
 * Remembered steps 1 and 2 (a salesperson's feedback, Matt 7 Oct 2026: "the last entry stays persistent, but option
 * to override it is still available"). A new campaign starts from what this person used last, not from the defaults:
 * the campaign name, audience, use case, subject, message and offer button. Every field stays editable. Kept in this
 * browser per signed-in person, with no expiry, updated as they type. Never the customer's name or email address.
 * Step 3 (your details) is the saved profile on the server, which Create now also saves when they changed it. Guarded like the draft:
 * without browser storage, Compose starts from the defaults as before.
 */
const rememberKey = (email: string): string => `dl-compose-last:v1:${email.trim().toLowerCase()}`;
interface Remembered {
  name: string;
  audience: Audience;
  useCase: UseCase;
  useCaseNote: string;
  subject: string;
  intro: string;
  ctaKind: CtaKind;
  ctaLabel: string;
}
function readRemembered(email: string): Remembered | null {
  try {
    const raw = localStorage.getItem(rememberKey(email));
    if (!raw) return null;
    const r = JSON.parse(raw) as Partial<Remembered> | null;
    const ok =
      !!r &&
      [r.name, r.useCaseNote, r.subject, r.intro, r.ctaLabel].every((v) => typeof v === 'string') &&
      AUDIENCE_VALUES.includes(r.audience as string) &&
      USE_CASE_VALUES.includes(r.useCase as string) &&
      CTA_VALUES.includes(r.ctaKind as string);
    return ok ? (r as Remembered) : null;
  } catch {
    return null;
  }
}
function writeRemembered(email: string, r: Remembered): void {
  try {
    localStorage.setItem(rememberKey(email), JSON.stringify(r));
  } catch {
    /* storage full or blocked: remembering is a convenience only */
  }
}

const whenSaved = (iso: string): string => new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** What Microsoft's return from Connect Outlook (?outlook=…) means, in plain words. */
const OUTLOOK_OUTCOME: Record<string, { tone: 'success' | 'error' | 'warning'; text: string }> = {
  connected: { tone: 'success', text: 'Outlook connected. Emails you send from the tool now go from your own mailbox.' },
  cancelled: { tone: 'warning', text: 'Outlook was not connected: the Microsoft sign-in was cancelled.' },
  mismatch: { tone: 'error', text: 'Outlook was not connected: sign in to Microsoft as yourself (the same account you use for this tool), then try again.' },
  failed: { tone: 'error', text: 'Outlook could not be connected. Try again; if it keeps failing, tell Matt.' },
  unavailable: { tone: 'error', text: 'Sending from the tool is not working at the moment. Use Copy for Outlook, and tell Matt.' },
  not_allowed: { tone: 'warning', text: 'Sending from the tool is not available for your account yet. Use Copy for Outlook.' },
};
const hhmm = (iso: string): string => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

/** A numbered section heading. `extra` sits on the same line (e.g. the offer count). */
function Step({ n, extra }: { n: number; extra?: React.ReactNode }) {
  return (
    <h2 className="dl-h4 step">
      <span className="step__n" aria-hidden>{n}</span>
      <span>{STEPS[n - 1]}</span>
      {extra}
    </h2>
  );
}

/**
 * WhatsApp is planned but not released (Matt, 29 Sept 2026): salespeople see it, greyed out and marked "coming
 * soon", so they know it is on the way; nothing about WhatsApp reaches an email. A saved number is kept. Set to
 * true to release it: the field, the CTA and the signature link all come back.
 */
const WHATSAPP_LIVE = false;
const SOON = ' — coming soon';

/**
 * Salary sacrifice is parked (Matt, 6 Oct 2026: its template will not be in use for a few months): the audience list
 * shows it greyed out and marked "coming soon", so new campaigns are PCH or BCH only. A draft or a copied campaign that
 * is already salary sacrifice still opens. Set to true to bring it back.
 */
const SALSAC_LIVE = false;

/** The green-button CTA options (brief §5.9). `need` is the sender field that unlocks the option. */
const CTA_OPTIONS: { kind: CtaKind; label: string; need?: 'phone' | 'whatsapp' | 'booking'; needText?: string }[] = [
  { kind: 'view_offer', label: 'View offer — open the offer page' },
  { kind: 'call', label: 'Call me', need: 'phone', needText: 'a Direct phone' },
  { kind: 'whatsapp', label: 'WhatsApp me', need: 'whatsapp', needText: 'a WhatsApp number' },
  { kind: 'email', label: 'Email me' },
  { kind: 'book', label: 'Book a time to discuss', need: 'booking', needText: 'a Booking link' },
];
const ctaDefaultLabel = (kind: CtaKind): string => (CTA_DEFAULT_LABELS as Record<string, string>)[kind] ?? '';

/** The secondary contact links the salesperson can add to their signature (a separate choice from the primary
 *  green button). `need` is the sender field that unlocks it; email is always available. */
const SECONDARY_OPTIONS: { method: ContactMethod; label: string; need?: 'phone' | 'whatsapp' | 'booking'; needText?: string }[] = [
  { method: 'call', label: 'Call', need: 'phone', needText: 'a Direct phone' },
  { method: 'whatsapp', label: 'WhatsApp', need: 'whatsapp', needText: 'a WhatsApp number' },
  { method: 'email', label: 'Email' },
  { method: 'book', label: 'Book a call', need: 'booking', needText: 'a Booking link' },
];

/** Apply the campaign's chosen CTA to an offer's green button. A plain view_offer with no custom label
 *  is the render default (no cta set); any other kind, or a custom label, is stored on the offer. */
function applyCta(o: Offer, kind: CtaKind, label: string): Offer {
  const l = label.trim();
  if (kind === 'view_offer' && !l) {
    const { cta: _drop, ...rest } = o;
    return rest;
  }
  return { ...o, cta: { kind, ...(l ? { label: l } : {}) } };
}

function offerTerms(o: Offer): string {
  const p = o.pricing;
  const parts = [`${p.termMonths} months`, `${p.annualMileage.toLocaleString('en-GB')} miles p.a.`];
  if (isSalsac(o)) parts.push(p.salsac?.net40 ? `${gbp(p.salsac.net40)}/mo at 40% · maint. & insurance` : 'maint. & insurance incl.');
  else parts.push(`${gbp(p.initialPayment)} initial`);
  return parts.join(' · ');
}

/** A row of configuration chips for one lease dimension; hidden when the site offers only one value. */
function ChipRow({ label, options, current, disabled, format, onPick }: { label: string; options: LeaseOption[]; current: number; disabled: boolean; format: (v: number) => string; onPick: (v: number) => void }) {
  if (!options || options.length <= 1) return null;
  return (
    <div className="chiprow">
      <span className="chiprow__label dl-small">{label}</span>
      {options.map((opt) => (
        <button key={opt.value} type="button" className={`chip${opt.value === current ? ' chip--active' : ''}`} disabled={disabled || opt.value === current} onClick={() => onPick(opt.value)}>
          {format(opt.value)}
        </button>
      ))}
    </div>
  );
}

/** Plain words for what the finder concluded, shown above the evidence. */
const SEARCH_HEADLINE: Record<BrochureSearch['status'], string> = {
  verified_pdf: 'Brochure found and checked.',
  verified_web_brochure: 'The manufacturer publishes this brochure as a web page; it has been checked and linked.',
  official_page_only: 'We found the manufacturer’s official page, but not a document we can attach for you.',
  brochure_request: 'The manufacturer only offers a request-a-brochure form for this model.',
  not_verified: 'We searched for an official UK brochure, then for the manufacturer’s European edition in English, and could not verify either.',
  search_failed: 'The brochure search could not be completed. No conclusion was made.',
};

const hostOfUrl = (u: string): string => {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return u;
  }
};

/**
 * Reasons that mean "the wrong document", not "a document we could not confirm": another car, another market, a
 * manual or press pack, a dealer's or sharing site's copy, a form. A near miss is never one of these.
 */
const WRONG_DOCUMENT = /aggregator|another market|another model|a manual, warranty|archived or used-car|not on the official site|range-wide or unrelated|request \/ contact|make and model are not in the document|not in english|dollar pricing/i;

/**
 * When nothing verified: the closest document the finder found, for the salesperson to open and judge (Matt,
 * 29 Sept 2026: "show the latest version it found"). Picked from the stored trace, so it costs nothing: documents
 * the finder actually read first, the newest edition first, a brochure before a price list. Never attached by
 * itself; "Use it anyway" goes through the upload / paste route and records who chose it.
 */
function nearMiss(search: BrochureSearch): BrochureSearch['candidates'][number] | undefined {
  const read = (c: BrochureSearch['candidates'][number]) => (c.evidence && Object.keys(c.evidence).length > 0 ? 1 : 0);
  const date = (c: BrochureSearch['candidates'][number]) => String(c.evidence?.['date'] ?? '');
  return search.candidates
    .filter((c) => c.status !== 'accepted' && !c.reasons.some((r) => WRONG_DOCUMENT.test(r)))
    .sort((a, b) => read(b) - read(a) || date(b).localeCompare(date(a)) || (b.docType === 'brochure' ? 1 : 0) - (a.docType === 'brochure' ? 1 : 0) || b.score - a.score)[0];
}

/** "What we checked": the queries, the pages opened, and every document with the reason it was kept or dropped. */
function SearchTrace({ search }: { search: BrochureSearch }) {
  const mark = (s: string) => (s === 'accepted' ? '✓' : s === 'not_checked' ? '·' : '✕');
  return (
    <details className="brochure__trace">
      <summary>See what we checked ({search.candidates.length} document{search.candidates.length === 1 ? '' : 's'}, {search.credits} credits, {Math.round(search.durationMs / 1000)}s)</summary>
      <p className="dl-small app__muted">
        {search.officialSite ? <>Official UK site: <strong>{search.officialSite}</strong>. </> : 'No official UK site was identified. '}
        Searched: {search.queries.join(' · ')}
      </p>
      {search.pagesOpened.length > 0 && <p className="dl-small app__muted">Pages opened: {search.pagesOpened.map(hostOfUrl).join(', ')}</p>}
      <ul className="brochure__cands">
        {search.candidates.map((c) => (
          <li key={c.url} className={c.status === 'accepted' ? 'is-ok' : ''}>
            <span aria-hidden>{mark(c.status)}</span>{' '}
            <a href={c.url} target="_blank" rel="noreferrer">{hostOfUrl(c.url)}{c.linkText ? ` — ${c.linkText}` : ''}</a>
            {c.reasons.length > 0 && <span className="app__muted"> — {c.reasons.join('; ')}</span>}
            {c.status === 'accepted' && <span className="app__muted"> — {c.evidence?.['market'] === 'eu' ? 'no UK edition verified; accepted as the manufacturer’s European edition, in English' : 'passed every check'}</span>}
          </li>
        ))}
        {search.candidates.length === 0 && <li className="app__muted">No documents turned up at all.</li>}
      </ul>
    </details>
  );
}

const SEARCH_STAGES = ['Searching for the official UK brochure…', 'Opening the manufacturer’s site…', 'Reading the documents it links…', 'Checking the model, the market and the date…', 'Still checking — if there is no UK edition, looking for the European one in English…'];

/**
 * Brief §5.8 "Include brochure". The finder searches, verifies and attaches by itself; the salesperson never picks
 * from a list. When nothing verifies the panel says so, shows what was checked, and offers: search the web,
 * upload a PDF, paste a link, accept the manufacturer's page / request form when there is one, or carry on
 * without. A search that FAILED is shown differently from one that found nothing, and offers a retry.
 * The offer stores only { brochureId, include }; the full record rides on the tray Item for display.
 */
function BrochureControl({ item, onAttach, onToggle, onRemove }: { item: Item; onAttach: (b: Brochure, include?: boolean) => void; onToggle: (include: boolean) => void; onRemove: () => void }) {
  const o = item.offer;
  const attached = item.brochure;
  const included = o.brochure?.include ?? false;
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState(0);
  const [manual, setManual] = useState(false);
  const [murl, setMurl] = useState('');
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [search, setSearch] = useState<BrochureSearch | undefined>();
  const [remembered, setRemembered] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // the search is one request of 10–60s: walk the stage line so the salesperson can see it is working
  useEffect(() => {
    if (!busy) return;
    setStage(0);
    const t = setInterval(() => setStage((s) => Math.min(s + 1, SEARCH_STAGES.length - 1)), 6000);
    return () => clearInterval(t);
  }, [busy]);

  async function doEnsure(force = false) {
    setBusy(true);
    setErr('');
    setNote('');
    setSkipped(false);
    try {
      const res = await api.ensureBrochure(o.vehicle.make, o.vehicle.model, force);
      setSearch(res.search);
      setRemembered(!!res.remembered);
      if (res.brochure) {
        // a European edition someone accepted earlier is shown, but NOT included until this salesperson ticks it
        const european = res.brochure.market === 'eu';
        onAttach(res.brochure, !european);
        setManual(false);
        setNote(european ? 'This is the stored European edition for this model. It is NOT in the email until you tick “Include in the email”.' : res.state === 'fresh' ? 'Found and checked just now.' : res.state === 'stale' ? `Kept the stored copy — the new search found nothing (${res.error ?? 'no reason given'}). Replace it if it looks out of date.` : (res.warning ?? 'Attached the stored copy.'));
      }
    } catch (e) {
      setErr(errMsg(e));
      setManual(true); // search not configured — the manual path still works
    } finally {
      setBusy(false);
    }
  }

  async function doAccept() {
    setBusy(true);
    setErr('');
    try {
      const res = await api.acceptBrochure(o.vehicle.make, o.vehicle.model);
      onAttach(res.brochure);
      setNote(res.brochure.market === 'eu' ? 'European edition added. The email’s small print tells the recipient it is not the UK brochure.' : 'Linked the manufacturer’s page.');
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function doManual(file?: File, link = murl.trim()) {
    if (!file && !link) {
      setErr('Paste a PDF or brochure-page link, or choose a PDF file.');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      const res = await api.manualBrochure(o.vehicle.make, o.vehicle.model, { url: link || undefined, file });
      onAttach(res.brochure);
      setManual(false);
      setMurl('');
      setNote('Brochure attached. It is now the stored copy for this model, for every salesperson.');
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const manualForm = (
    <div className="brochure__manual">
      <Input placeholder="Paste a PDF or brochure-page link (https)" value={murl} onChange={(e) => setMurl(e.target.value)} />
      <input ref={fileRef} type="file" accept="application/pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) doManual(f); }} />
      <div className="brochure__btns">
        <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={busy}>Choose PDF…</Button>
        <Button size="sm" onClick={() => doManual()} disabled={busy}>{busy ? 'Attaching…' : 'Attach link'}</Button>
        <Button variant="ghost" size="sm" onClick={() => { setManual(false); setErr(''); }} disabled={busy}>Cancel</Button>
      </div>
    </div>
  );

  if (busy && !manual) {
    return (
      <div className="brochure">
        <span className="brochure__progress"><span className="brochure__spinner" aria-hidden /> {SEARCH_STAGES[stage]}</span>
        <span className="dl-small app__muted">This usually takes 10–40 seconds the first time a model is searched. After that it is instant for everyone.</span>
      </div>
    );
  }

  if (attached) {
    const what = attached.kind === 'gated' ? 'request form' : attached.documentType === 'price_spec_guide' ? 'price & spec guide' : 'brochure';
    const how = attached.kind === 'pdf' ? 'PDF, hosted by us' : attached.kind === 'web' ? 'manufacturer’s web page' : 'manufacturer’s form';
    return (
      <div className="brochure">
        <label className="brochure__on">
          <input type="checkbox" checked={included} onChange={(e) => onToggle(e.target.checked)} /> Include in the email
        </label>
        <span className="brochure__title">
          {attached.kind === 'pdf' ? '📄' : '🔗'} {attached.title} <span className="app__muted">({what} · {how})</span>
        </span>
        <span className="dl-small app__muted">
          From {hostOfUrl(attached.sourceUrl)}
          {attached.editionDate ? ` · edition ${attached.editionDate}` : ''}
          {attached.source === 'manual' ? ` · added by ${attached.createdBy}` : attached.ukVerified.by === 'user' ? ` · accepted by ${attached.createdBy}` : ' · checked automatically'}
          {' · '}
          {/* our copy is opened same-origin (/b/:id): file.url carries PUBLIC_BASE_URL, which in local dev is the production host that does not hold this file */}
          <a href={attached.kind === 'pdf' ? `/b/${attached.id}` : attached.sourceUrl} target="_blank" rel="noreferrer">Open it to check</a>
        </span>
        {attached.finder?.flags?.includes('older_edition') && (
          <span className="dl-small brochure__eu">
            <strong>Older edition{attached.editionDate ? ` (${attached.editionDate.slice(0, 7)})` : ''}.</strong> It is the one the manufacturer’s own site is serving today, so it is treated as current. Open it to check, or replace it if you have a newer one.
          </span>
        )}
        {attached.market === 'eu' && (
          <span className="dl-small brochure__eu">
            <strong>European edition{included ? '' : ' — not in the email yet'}.</strong> No UK brochure could be verified; this is the manufacturer’s own European brochure, in English. Specification, equipment and any prices in it are not the UK’s
            {attached.finder?.flags?.includes('euro_pricing') ? ' (it shows euro prices)' : ''}. The email’s small print tells the recipient so. Open it to check, or replace it if you have the UK one.
          </span>
        )}
        {manual ? manualForm : (
          <div className="brochure__btns">
            <Button variant="ghost" size="sm" onClick={() => { setManual(true); setErr(''); }}>Wrong? Replace it</Button>
            <Button variant="ghost" size="sm" onClick={() => doEnsure(true)}>Search again</Button>
            <Button variant="ghost" size="sm" onClick={onRemove}>Remove</Button>
          </div>
        )}
        {note && <span className="dl-small app__muted">{note}</span>}
        {err && <span className="dl-small brochure__err">{err}</span>}
        {search && <SearchTrace search={search} />}
      </div>
    );
  }

  if (search && !skipped) {
    const failed = search.status === 'search_failed';
    const europeanOffer = search.market === 'eu' && (search.status === 'verified_pdf' || search.status === 'verified_web_brochure') && !!search.url;
    const canAccept = ((search.status === 'official_page_only' || search.status === 'brochure_request') && !!search.url) || europeanOffer;
    const near = search.status === 'not_verified' ? nearMiss(search) : undefined;
    const nearDate = near?.evidence?.['date'] ? String(near.evidence['date']) : undefined;
    const vehicle = `${o.vehicle.make} ${o.vehicle.model}`;
    const google = `https://www.google.com/search?q=${encodeURIComponent(`${vehicle} brochure UK filetype:pdf`)}`;
    return (
      <div className={`brochure brochure__panel ${failed ? 'brochure__panel--failed' : 'brochure__panel--none'}`}>
        <strong>{failed ? SEARCH_HEADLINE.search_failed : europeanOffer ? `No UK brochure found for ${vehicle}. A European edition is available.` : `No brochure attached for ${vehicle}.`}</strong>
        {!failed && (
          <span className="dl-small">
            {europeanOffer
              ? `It is the manufacturer’s own European brochure, in English${search.editionDate ? ` (edition ${search.editionDate.slice(0, 7)})` : ''}, found and checked. Specification, equipment and any prices in it are not the UK’s${search.flags.includes('euro_pricing') ? ' (it shows euro prices)' : ''}. Nothing is in the email unless you choose: use it, put your own in its place, or send without a brochure.`
              : SEARCH_HEADLINE[search.status]}
          </span>
        )}
        {search.reason && !europeanOffer && <span className="dl-small app__muted">{search.reason}</span>}
        {near && !manual && (
          <div className="brochure__near">
            <span className="dl-small">
              <strong>Closest match found (not verified):</strong>{' '}
              <a href={near.url} target="_blank" rel="noreferrer">{hostOfUrl(near.url)}{near.linkText ? ` — ${near.linkText}` : ''}</a>
              {nearDate ? ` · dated ${nearDate}` : ''}
            </span>
            <span className="dl-small app__muted">Not attached because: {near.reasons.length ? near.reasons.join('; ') : 'the search stopped before it was read'}. Open it and judge for yourself.</span>
            <div className="brochure__btns">
              <a className="dl-btn dl-btn--outline dl-btn--sm" href={near.url} target="_blank" rel="noreferrer">Open it ↗</a>
              <Button size="sm" onClick={() => doManual(undefined, near.url)} disabled={busy}>Use it anyway</Button>
            </div>
          </div>
        )}
        {remembered && <span className="dl-small app__muted">This is the result of a search on {new Date(search.searchedAt).toLocaleDateString('en-GB')}; it is re-run automatically after 7 days.</span>}
        {manual ? manualForm : (
          <div className="brochure__btns">
            {failed && <Button size="sm" onClick={() => doEnsure(true)}>Try again</Button>}
            {canAccept && (
              <Button size="sm" onClick={doAccept}>
                {europeanOffer ? 'Use the European edition' : search.status === 'brochure_request' ? 'Add a “Request a brochure” link' : search.documentType === 'price_spec_guide' ? 'Link the official price & spec page' : 'Link the official brochure page'}
              </Button>
            )}
            {canAccept && search.url && <a className="dl-small" href={search.url} target="_blank" rel="noreferrer">Open it first ↗</a>}
            {!failed && <a className="dl-btn dl-btn--outline dl-btn--sm" href={google} target="_blank" rel="noreferrer">Search the web for it ↗</a>}
            {!failed && search.officialSite && <a className="dl-small" href={`https://${search.officialSite}`} target="_blank" rel="noreferrer">Go to {search.officialSite} ↗</a>}
            <Button variant="outline" size="sm" onClick={() => { setManual(true); setErr(''); }}>{europeanOffer ? 'Use my own instead (upload / paste)' : 'Upload a PDF / paste a link'}</Button>
            {!failed && <Button variant="ghost" size="sm" onClick={() => doEnsure(true)}>Search again</Button>}
            <Button variant="ghost" size="sm" onClick={() => setSkipped(true)}>Send without a brochure</Button>
          </div>
        )}
        {err && <span className="dl-small brochure__err">{err}</span>}
        <SearchTrace search={search} />
      </div>
    );
  }

  return (
    <div className="brochure">
      {!manual ? (
        <div className="brochure__btns">
          <Button variant="outline" size="sm" onClick={() => doEnsure()}>{skipped ? 'Add a brochure after all' : 'Add brochure'}</Button>
          <Button variant="ghost" size="sm" onClick={() => { setManual(true); setErr(''); }}>Upload / paste link</Button>
        </div>
      ) : manualForm}
      {err && <span className="dl-small brochure__err">{err}</span>}
    </div>
  );
}

/** Upload / manage the salesperson's portrait. Persists server-side and shows in the signature of every email.
 *  `onChange` reports the current headshot URL up so the app header can show it too. */
function SenderPhoto({ base, onChange }: { base: string; onChange?: (url: string | null) => void }) {
  const sameOrigin = (u: string): string => (base && u.startsWith(base) ? u.slice(base.length) || '/' : u);
  const [url, setUrl] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api
      .me()
      .then((m) => {
        setUrl(m.headshotUrl);
        onChange?.(m.headshotUrl);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function upload(file: File) {
    setBusy(true);
    setErr('');
    try {
      const u = (await api.uploadPhoto(file)).headshotUrl;
      setUrl(u);
      onChange?.(u);
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    setErr('');
    try {
      await api.deletePhoto();
      setUrl(null);
      onChange?.(null);
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dl-field">
      <label className="dl-label">Portrait photo</label>
      <div className="portrait">
        {url ? <img className="portrait__img" src={sameOrigin(url)} alt="Your portrait" /> : <div className="portrait__empty">No photo</div>}
        <div className="portrait__side">
          <div className="portrait__btns">
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }} />
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={busy || !loaded}>{busy ? 'Uploading…' : url ? 'Replace' : 'Upload photo'}</Button>
            {url && (
              <Button variant="ghost" size="sm" onClick={remove} disabled={busy}>Remove</Button>
            )}
          </div>
          <span className="dl-small app__muted">Optional. Shows in your email signature on every email, and is saved for next time.</span>
        </div>
      </div>
      {err && <span className="dl-small brochure__err">{err}</span>}
    </div>
  );
}

export function Compose({ email, base, items, setItems, seed, onSeedApplied, onHeadshotChange, newCampaignRequest = 0 }: { email: string; base: string; items: Item[]; setItems: React.Dispatch<React.SetStateAction<Item[]>>; seed?: ComposeSeed | null; onSeedApplied?: () => void; onHeadshotChange?: (url: string | null) => void; /** Bumped by the top bar's "+ New campaign". */ newCampaignRequest?: number }) {
  // Our-origin asset/link URLs are stamped absolute (the email needs that), but they only resolve on
  // the public origin. For in-app display, strip our origin so they become same-origin (served by the
  // Vite proxy in dev, the Worker in production). The Copy-for-Outlook HTML stays absolute.
  const sameOrigin = (u: string): string => (base && u.startsWith(base) ? u.slice(base.length) || '/' : u);
  const displayHtml = (html: string): string => (base ? html.split(base).join('') : html);

  const [name, setName] = useState(DEFAULT_NAME);
  const [audience, setAudience] = useState<Audience>('personal');
  // Renewal first and by default (Matt, 29 Sept 2026): it is the sales team's main use.
  const [useCase, setUseCase] = useState<UseCase>('renewal');
  const [useCaseNote, setUseCaseNote] = useState('');
  const [subject, setSubject] = useState(DEFAULT_SUBJECT);
  const [preheader, setPreheader] = useState('');
  const [intro, setIntro] = useState(DEFAULT_INTRO);
  // One offer per row, always (Matt, 21 Sept 2026): a single offer is the hero card, two or more are stacked
  // rows. The two-up / three-up grids are no longer offered, so there is nothing for the salesperson to choose.
  const layout: LayoutChoice = 'auto';
  const [recipientFirst, setRecipientFirst] = useState('');
  // Auto-save: restore once (when the signed-in email is known), then save as the draft changes.
  const draftRestored = useRef(false);
  /** True once the saved draft or the remembered steps have been applied: only then are steps 1 and 2 remembered, so
   *  the defaults on screen before that can never overwrite what was remembered. */
  const [rememberReady, setRememberReady] = useState(false);
  /** Step 3 is saved on Create only when the salesperson changed it in this campaign and their saved profile has
   *  loaded (see doCreate). The prefill, a copied campaign and the defaults never set detailsEdited. */
  const profileLoaded = useRef(false);
  const detailsEdited = useRef(false);
  const savedWhatsapp = useRef('');
  const [restoredAt, setRestoredAt] = useState<string | null>(null);
  /** The draft as last saved or restored (JSON, without its time): unchanged content is not saved again, so the saved
   *  time stays the time of the last real edit (it drives the 30-day expiry). '' means nothing saved. */
  const lastSavedBody = useRef<string | null>(null);
  /** The save waiting on its half-second timer, run at once if the page is being left. */
  const pendingSave = useRef<(() => void) | null>(null);
  /** Each re-price takes a number; a newer one, or New campaign / an audience switch, makes an older one's result void. */
  const repriceRun = useRef(0);

  const [senderName, setSenderName] = useState('');
  const [senderTitle, setSenderTitle] = useState('Account Manager, DreamLease');
  const [senderPhone, setSenderPhone] = useState('');
  const [senderWhatsapp, setSenderWhatsapp] = useState('');
  const [senderBooking, setSenderBooking] = useState('');
  const [secondary, setSecondary] = useState<ContactMethod[]>([]);
  const [ctaKind, setCtaKind] = useState<CtaKind>('view_offer');
  const [ctaLabel, setCtaLabel] = useState('');
  const [savingDetails, setSavingDetails] = useState(false);
  const [detailsSaved, setDetailsSaved] = useState(false);
  const [detailsError, setDetailsError] = useState('');

  const [url, setUrl] = useState('');
  const [fetching, setFetching] = useState(false);
  const [reloading, setReloading] = useState<number | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [addError, setAddError] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [repricing, setRepricing] = useState(false);

  const [previewHtml, setPreviewHtml] = useState('');
  const [previewStale, setPreviewStale] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [created, setCreated] = useState<CreateResponse | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [copied, setCopied] = useState(false);
  const [copyProblems, setCopyProblems] = useState<string[]>([]);

  // Sending from the salesperson's own mailbox (Phase 1). `mail` is null until the status arrives.
  const [mail, setMail] = useState<MailStatus | null>(null);
  const [outlookNote, setOutlookNote] = useState<{ tone: 'success' | 'error' | 'warning'; text: string } | null>(null);
  const [recipientEmail, setRecipientEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sentAt, setSentAt] = useState<string | null>(null);
  const [sendError, setSendError] = useState<{ text: string; problems: string[] } | null>(null);
  const canSend = !!mail?.available;
  // The draft as it was when the campaign was created. Send and Copy use the STORED campaign, so any later edit
  // (subject, message, CTA, your details, the first name) must invalidate it: create again to send the changes.
  const createdFrom = useRef<string | null>(null);
  const [changedAfterCreate, setChangedAfterCreate] = useState(false);
  const connectPoll = useRef<number | null>(null);

  // Resizable Compose columns: the salesperson drags the dividers to widen whichever panel they are working in.
  // Two px widths (campaign, offers) are remembered per browser; the preview takes the rest. Wide screens only —
  // below 1100px the panels stack and the dividers hide (styles.css).
  const COLS_KEY = 'dl-compose-cols';
  const [cols, setCols] = useState<{ a: number; b: number }>(() => {
    try {
      const p = JSON.parse(localStorage.getItem(COLS_KEY) ?? 'null') as { a?: unknown; b?: unknown } | null;
      if (p && typeof p.a === 'number' && typeof p.b === 'number') return { a: p.a, b: p.b };
    } catch {
      /* private mode / blocked storage: fall back to the defaults */
    }
    return { a: 340, b: 460 };
  });
  useEffect(() => {
    try {
      localStorage.setItem(COLS_KEY, JSON.stringify(cols));
    } catch {
      /* ignore */
    }
  }, [cols]);
  const composeRef = useRef<HTMLDivElement>(null);
  const startResize = (key: 'a' | 'b') => (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    let last = e.clientX;
    const min = key === 'a' ? 260 : 300;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - last;
      last = ev.clientX;
      setCols((c) => {
        const width = composeRef.current?.clientWidth ?? 1280;
        const other = key === 'a' ? c.b : c.a;
        const max = Math.max(min, width - other - 32 - 300); // keep the preview ≥ 300px, less the two 16px dividers
        return { ...c, [key]: Math.min(max, Math.max(min, c[key] + dx)) };
      });
    };
    const stop = (ev: PointerEvent) => {
      handle.releasePointerCapture(ev.pointerId);
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', stop);
      handle.removeEventListener('pointercancel', stop);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
  };
  const gridStyle = { '--col-a': `${cols.a}px`, '--col-b': `${cols.b}px` } as React.CSSProperties;

  useEffect(() => {
    if (!email) return;
    const guess = (email.split('@')[0] ?? '').replace(/\./g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    setSenderName((n) => n || guess);
  }, [email]);

  // Prefill the salesperson's saved contact details so they never re-enter them; they stay editable.
  useEffect(() => {
    api
      .me()
      .then((m) => {
        profileLoaded.current = true;
        const s = m.savedSender;
        if (!s) return;
        savedWhatsapp.current = s.whatsapp;
        setSenderName(s.displayName);
        setSenderTitle(s.jobTitle);
        setSenderPhone(s.phone);
        setSenderWhatsapp(s.whatsapp);
        setSenderBooking(s.bookingUrl);
        setSecondary(s.secondaryContacts ?? []);
      })
      .catch(() => {});
  }, []);

  // Is sending set up and Outlook connected? And, on the way back from Microsoft's sign-in, say how it went
  // (?outlook=…), then drop the parameter so a reload does not repeat the message.
  useEffect(() => {
    api
      .mailStatus()
      .then(setMail)
      .catch(() => setMail({ available: false, connected: false }));
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get('outlook');
    // Back from Microsoft in the Connect window: hand the result to the tool's own window and close.
    if (outcome && window.opener && window.opener !== window) {
      try {
        (window.opener as Window).postMessage({ type: 'dl-outlook', outcome }, window.location.origin);
        window.close();
        return;
      } catch {
        /* no opener to tell: show the result here */
      }
    }
    if (outcome) {
      setOutlookNote(OUTLOOK_OUTCOME[outcome] ?? OUTLOOK_OUTCOME.failed!);
      params.delete('outlook');
      const rest = params.toString();
      window.history.replaceState(null, '', `${window.location.pathname}${rest ? `?${rest}` : ''}${window.location.hash}`);
    }
    const onMessage = (e: MessageEvent) => {
      const data = e.data as { type?: string; outcome?: string } | null;
      if (e.origin !== window.location.origin || data?.type !== 'dl-outlook') return;
      setOutlookNote(OUTLOOK_OUTCOME[data.outcome ?? ''] ?? OUTLOOK_OUTCOME.failed!);
      void api.mailStatus().then(setMail).catch(() => {});
    };
    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
      if (connectPoll.current) window.clearInterval(connectPoll.current);
    };
  }, []);

  /**
   * Connect Outlook in its own window, so the campaign being written here survives the Microsoft sign-in. The status is
   * polled too, in case Microsoft's pages cut the link between the two windows. If the browser blocks the window,
   * the whole page goes to Microsoft instead (and comes back to a fresh Compose).
   */
  function connectOutlook() {
    const popup = window.open(api.connectOutlookUrl, 'dl-connect-outlook', 'popup,width=560,height=720');
    if (!popup) {
      pendingSave.current?.();
      window.location.assign(api.connectOutlookUrl);
      return;
    }
    setOutlookNote({ tone: 'warning', text: 'Finish signing in to Microsoft in the window that opened. Your campaign stays here.' });
    if (connectPoll.current) window.clearInterval(connectPoll.current);
    let tries = 0;
    connectPoll.current = window.setInterval(() => {
      tries += 1;
      if (tries > 90 && connectPoll.current) window.clearInterval(connectPoll.current);
      void api
        .mailStatus()
        .then((st) => {
          if (!st.connected) return;
          if (connectPoll.current) window.clearInterval(connectPoll.current);
          setMail(st);
          setOutlookNote(OUTLOOK_OUTCOME.connected!);
        })
        .catch(() => {});
    }, 2000);
  }

  async function disconnectOutlook() {
    try {
      await api.disconnectOutlook();
      setMail((m) => (m ? { ...m, connected: false } : m));
      setOutlookNote({ tone: 'success', text: 'Outlook disconnected. The tool no longer holds permission to send from your mailbox.' });
    } catch (e) {
      setOutlookNote({ tone: 'error', text: errMsg(e) });
    }
  }

  // Copying a past campaign: pre-fill the reusable parts (never the recipient), load its offers into the tray,
  // and re-price each one live from its source URL so the copy never carries a stale price. Applied after the
  // saved-sender effect above so the copied sender wins, then cleared so it applies once.
  useEffect(() => {
    if (!seed) return;
    setName(seed.name);
    setAudience(seed.audience);
    setUseCase(seed.useCase);
    setUseCaseNote(seed.useCaseNote);
    setSubject(seed.subject);
    setPreheader(seed.preheader);
    setIntro(seed.intro);
    setSenderName(seed.sender.name);
    setSenderTitle(seed.sender.title);
    setSenderPhone(seed.sender.phone);
    setSenderWhatsapp(seed.sender.whatsapp);
    setSenderBooking(seed.sender.booking);
    setSecondary(seed.sender.secondary);
    setCtaKind(seed.ctaKind === 'whatsapp' && !WHATSAPP_LIVE ? 'view_offer' : seed.ctaKind);
    setCtaLabel(seed.ctaLabel);
    setRecipientFirst('');
    setRecipientEmail('');
    setRestoredAt(null);
    setItems(seed.offers.map((o) => ({ offer: o }))); // show the copied offers at once…
    void repriceCopied(seed.offers); // …then refresh each price live
    onSeedApplied?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed]);

  // Restore the unsent campaign saved in this browser, once, as soon as we know who is signed in. A campaign being
  // copied (seed), or offers already in the tray (the Library), win over it. With no draft to restore, steps 1 and 2
  // start from what this person used last (the audience only when the tray is empty, so it cannot contradict offers
  // already in it).
  useEffect(() => {
    if (!email || draftRestored.current) return;
    draftRestored.current = true;
    setRememberReady(true);
    if (seed) return;
    const d = items.length > 0 ? null : readSavedDraft(email);
    if (!d) {
      lastSavedBody.current = '';
      const r = readRemembered(email);
      if (r) {
        setName(r.name);
        if (items.length === 0) setAudience(r.audience === 'salary_sacrifice' && !SALSAC_LIVE ? 'personal' : r.audience);
        setUseCase(r.useCase);
        setUseCaseNote(r.useCaseNote);
        setSubject(r.subject);
        setIntro(r.intro);
        setCtaKind(r.ctaKind === 'whatsapp' && !WHATSAPP_LIVE ? 'view_offer' : r.ctaKind);
        setCtaLabel(r.ctaLabel);
      }
      return;
    }
    setName(d.name);
    setAudience(d.audience);
    setUseCase(d.useCase);
    setUseCaseNote(d.useCaseNote);
    setSubject(d.subject);
    setPreheader(d.preheader);
    setIntro(d.intro);
    const ctaRestored = d.ctaKind === 'whatsapp' && !WHATSAPP_LIVE ? 'view_offer' : d.ctaKind;
    setCtaKind(ctaRestored);
    setCtaLabel(d.ctaLabel);
    const offers = d.items.slice(0, 6);
    setItems(offers);
    setRestoredAt(d.savedAt);
    lastSavedBody.current = JSON.stringify(draftBody({ ...d, ctaKind: ctaRestored, items: offers }));
    // An offer looked up more than a day ago: refresh the prices live, keeping the salesperson's brochure choices. So
    // too an offer priced before the website began needing the special-offer id (6 Oct 2026: no source.pricingVersion),
    // whose price may be the ordinary one, however recent.
    const oldest = Math.min(...offers.map((x) => Date.parse(x.offer.source.fetchedAt ?? '') || 0));
    const pricedOldWay = offers.some((x) => x.offer.source.kind === 'url' && !x.offer.source.pricingVersion);
    if (offers.length && (pricedOldWay || Date.now() - oldest > DRAFT_STALE_MS)) void repriceCopied(offers.map((x) => x.offer), { keepBrochureChoice: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email]);

  // Remember steps 1 and 2 as they change (see Remembered). A copied campaign's values count as the last used.
  useEffect(() => {
    if (!email || !rememberReady) return;
    writeRemembered(email, { name, audience, useCase, useCaseNote, subject, intro, ctaKind, ctaLabel });
  }, [email, rememberReady, name, audience, useCase, useCaseNote, subject, intro, ctaKind, ctaLabel]);

  // Save as the draft changes (half a second after the last change). A draft is a campaign with offers in it: without
  // offers there is nothing to pick up again (the text is remembered anyway), so nothing is kept.
  useEffect(() => {
    if (!email || !draftRestored.current) return;
    const untouched = items.length === 0;
    const body = draftBody({ name, audience, useCase, useCaseNote, subject, preheader, intro, ctaKind, ctaLabel, items });
    const json = untouched ? '' : JSON.stringify(body);
    if (json === lastSavedBody.current) {
      pendingSave.current = null;
      return;
    }
    const save = () => {
      pendingSave.current = null;
      lastSavedBody.current = json;
      if (untouched) clearSavedDraft(email);
      else writeSavedDraft(email, { savedAt: new Date().toISOString(), ...body });
    };
    pendingSave.current = save;
    const t = window.setTimeout(save, 500);
    return () => {
      window.clearTimeout(t);
      pendingSave.current = null;
    };
  }, [email, name, audience, useCase, useCaseNote, subject, preheader, intro, ctaKind, ctaLabel, items]);

  // Leaving the page (reload, closing the tab, switching away): save the last half-second of typing too.
  useEffect(() => {
    const flush = () => pendingSave.current?.();
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, []);

  /**
   * Re-price the offers of a copied campaign live from each offer's own source URL, so the new campaign never
   * ships a stale price. Salary-sacrifice nets are hand-entered, so they are kept (like reLook). A source page
   * that has moved keeps its copied price and is reported, so nothing silently goes out wrong.
   */
  async function repriceCopied(offers: Offer[], opts: { keepBrochureChoice?: boolean } = {}) {
    const run = ++repriceRun.current;
    setRepricing(true);
    setWarnings([]);
    setAddError('');
    const refreshed = new Map<Offer, Item>();
    const failed: string[] = [];
    for (const o of offers) {
      try {
        const res = await api.lookup(o.offerUrl);
        const offer = isSalsac(o) ? toSalsac(res.offer, o) : res.offer;
        // Re-attach the model's stored brochure (like the library). Uses the stored copy only — never a search — keeps
        // the prior include, and a European edition stays unticked. A restored draft keeps the salesperson's choice:
        // an offer whose brochure they removed gets none back.
        const b = opts.keepBrochureChoice && !o.brochure ? null : await api.currentBrochure(offer.vehicle.make, offer.vehicle.model);
        if (b) refreshed.set(o, { offer: { ...offer, brochure: { brochureId: b.id, include: o.brochure?.include ?? b.market !== 'eu' } }, options: res.options, brochure: b });
        else refreshed.set(o, { offer, options: res.options });
      } catch {
        failed.push(`${o.vehicle.make} ${o.vehicle.model}`); // keeps the copied price rather than lose the offer
      }
    }
    // A newer campaign (New campaign, another copy, an audience switch) started meanwhile: this result is void.
    if (run !== repriceRun.current) return;
    // Merge into the tray as it is NOW: only offers still there and untouched since this started are replaced, so
    // anything added, removed or changed meanwhile stays as the salesperson left it.
    setItems((cur) => cur.map((x) => refreshed.get(x.offer) ?? x));
    setRepricing(false);
    setWarnings(failed.length ? [`Couldn't re-price ${failed.join(', ')} — the copied price is shown and its brochure was not re-attached. That offer page may have changed; re-fetch it (the chips reload it) or remove it before sending.`] : []);
  }

  /** Is a secondary contact method usable yet — its underlying sender field filled? (Email always is.) */
  const secondaryReady = (m: ContactMethod): boolean =>
    m === 'email' ? true : m === 'call' ? !!senderPhone.trim() : m === 'whatsapp' ? WHATSAPP_LIVE && !!senderWhatsapp.trim() : !!senderBooking.trim();
  const toggleSecondary = (m: ContactMethod) => {
    detailsEdited.current = true;
    setSecondary((cur) => (cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m]));
  };

  /** Step 3 as it is saved. While WhatsApp is not live its field is disabled and a copied campaign carries no number,
   *  so the saved number is sent back unchanged rather than erased. */
  const senderToSave = () => ({
    displayName: senderName || email,
    jobTitle: senderTitle,
    phone: senderPhone,
    whatsapp: WHATSAPP_LIVE ? senderWhatsapp : savedWhatsapp.current,
    bookingUrl: senderBooking,
    secondaryContacts: secondary,
  });

  async function saveDetails() {
    setSavingDetails(true);
    setDetailsError('');
    setDetailsSaved(false);
    try {
      await api.saveSender(senderToSave());
      detailsEdited.current = false;
      setDetailsSaved(true);
      setTimeout(() => setDetailsSaved(false), 2500);
    } catch (e) {
      setDetailsError(errMsg(e));
    } finally {
      setSavingDetails(false);
    }
  }

  const sender: Sender = useMemo(
    () => ({
      kind: 'user',
      displayName: senderName || email || 'DreamLease',
      email: email || 'unknown@dreamlease.co.uk',
      mailbox: email || 'unknown@dreamlease.co.uk',
      ...(senderTitle ? { jobTitle: senderTitle } : {}),
      ...(senderPhone ? { phone: senderPhone } : {}),
      ...(WHATSAPP_LIVE && senderWhatsapp.trim() ? { whatsapp: senderWhatsapp.trim() } : {}),
      ...(senderBooking.trim() ? { bookingUrl: senderBooking.trim() } : {}),
      ...(() => {
        const ready = secondary.filter((m) => (m === 'email' ? true : m === 'call' ? !!senderPhone.trim() : m === 'whatsapp' ? WHATSAPP_LIVE && !!senderWhatsapp.trim() : !!senderBooking.trim()));
        return ready.length ? { secondaryContacts: ready } : {};
      })(),
    }),
    [senderName, senderTitle, senderPhone, senderWhatsapp, senderBooking, secondary, email],
  );

  /** Is the chosen CTA usable — i.e. the sender field it needs is filled in? */
  const ctaAvailable = (kind: CtaKind): boolean => {
    if (kind === 'whatsapp' && !WHATSAPP_LIVE) return false;
    const need = CTA_OPTIONS.find((o) => o.kind === kind)?.need;
    if (!need) return true;
    return need === 'phone' ? !!senderPhone.trim() : need === 'whatsapp' ? !!senderWhatsapp.trim() : !!senderBooking.trim();
  };

  const draft: Draft = useMemo(
    () => ({
      name,
      useCase,
      ...(useCase === 'other' && useCaseNote.trim() ? { useCaseNote: useCaseNote.trim() } : {}),
      subject,
      ...(preheader ? { preheader } : {}),
      intro,
      layout,
      offers: items.map((x) => applyCta(x.offer, ctaKind, ctaLabel)),
      sender,
      ...(recipientFirst ? { recipient: { firstName: recipientFirst } } : {}),
    }),
    [name, useCase, useCaseNote, subject, preheader, intro, layout, items, sender, recipientFirst, ctaKind, ctaLabel],
  );

  const salsacNeedsFigures = items.some((x) => isSalsac(x.offer) && !salsacReady(x.offer));
  const ready = items.length > 0 && !!name.trim() && !!subject.trim() && !!intro.trim() && !!email && !salsacNeedsFigures && ctaAvailable(ctaKind) && (useCase !== 'other' || !!useCaseNote.trim());

  // Auto-render the preview as soon as the first offer is added, so the salesperson sees the email straight away.
  // Subsequent changes keep the preview but flag it stale (the salesperson presses Update preview to refresh).
  useEffect(() => {
    if (items.length === 1 && ready && !previewHtml && !previewing) void doPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length, ready]);

  /** Any change to the offer set invalidates the rendered output; clear it so the preview is never stale. */
  // Invalidate output when the offers change: drop any created result and mark the preview stale — but
  // KEEP it on screen (the panel flags it "out of date"), so it never vanishes when you tweak a chip.
  const clearOutput = () => {
    setCreated(null);
    setPreviewStale(true);
  };
  // The offer tray is shared with the Library, which adds to it from outside this component, and Compose stays
  // mounted across tabs. So a campaign created before a Library add kept its "Campaign created" panel, and
  // Copy for Outlook handed out an email with fewer offers than the list showed (Matt, 22 Sept 2026: three
  // offers, one in the email). Whatever changes the tray, from wherever, the created result is dropped.
  const lastItems = useRef(items);
  useEffect(() => {
    if (lastItems.current === items) return;
    lastItems.current = items;
    clearOutput();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);
  // Full clear — used when the whole offer context is thrown away (e.g. switching audience).
  const resetPreview = () => {
    setCreated(null);
    setPreviewHtml('');
    setPreviewStale(false);
  };

  async function addOffer(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) {
      document.getElementById('addoffer-url')?.focus(); // guide the salesperson to paste a URL instead of a dead click
      return;
    }
    setFetching(true);
    setAddError('');
    setWarnings([]);
    try {
      const res = await api.lookup(url.trim());
      let offer = res.offer;
      if (audience === 'salary_sacrifice') {
        offer = toSalsac(offer); // the URL gives the vehicle; the price is entered by hand below
      } else if (offer.contractType !== audience) {
        setAddError(`That URL is a ${audienceShort(offer.contractType)} lease, but the audience is set to ${audienceShort(audience)}. Switch the audience above, or paste the matching URL.`);
        return;
      }
      setItems((it) => [...it, { offer, options: res.options }].slice(0, 6));
      setUrl('');
      clearOutput();
      if (res.warnings.length) setWarnings(res.warnings);
    } catch (err) {
      setAddError(errMsg(err));
    } finally {
      setFetching(false);
    }
  }

  /** Re-price one offer for a changed term / mileage / initial-payment months, in place. */
  async function reLook(i: number, param: 'contractLength' | 'annualMileage' | 'initialRental', value: number) {
    setReloading(i);
    setAddError('');
    try {
      const prev = items[i]!.offer;
      const u = new URL(prev.offerUrl);
      u.searchParams.set(param, String(value));
      const res = await api.lookup(u.toString());
      const offer = isSalsac(prev) ? toSalsac(res.offer, prev) : res.offer; // keep the hand-entered nets
      setItems((it) => it.map((x, k) => (k === i ? { offer, options: res.options } : x)));
      clearOutput();
    } catch (err) {
      setAddError(errMsg(err));
    } finally {
      setReloading(null);
    }
  }

  /**
   * Switch the campaign's audience. The three audiences use different URLs and pricing, so the offer
   * list is cleared on a change — a campaign is always one audience, built from scratch for it.
   */
  function changeAudience(next: Audience) {
    if (next === audience) return;
    repriceRun.current += 1; // an in-flight re-price belongs to the old audience
    setRepricing(false);
    const had = items.length;
    setAudience(next);
    setItems([]);
    setAddError('');
    resetPreview();
    setWarnings(had ? [`Audience set to ${audienceShort(next)} — the offer list was cleared. Add offers from a ${audienceShort(next)} URL.`] : []);
  }

  /** Edit a salary-sacrifice offer's hand-entered net figures in place. */
  function setSalsac(i: number, patch: Partial<{ net20: number; net40: number }>) {
    setItems((it) =>
      it.map((x, k) => (k === i ? { ...x, offer: { ...x.offer, pricing: { ...x.offer.pricing, salsac: { ...(x.offer.pricing.salsac ?? { net20: 0, net40: 0 }), ...patch } } } } : x)),
    );
    clearOutput();
  }

  async function saveToLibrary(o: Offer) {
    setSaving(o.id);
    setAddError('');
    try {
      await api.saveOffer(o);
      setSavedIds((s) => new Set(s).add(o.id));
    } catch (err) {
      setAddError(errMsg(err));
    } finally {
      setSaving(null);
    }
  }

  const removeOffer = (i: number) => {
    setItems((it) => it.filter((_, k) => k !== i));
    clearOutput();
  };

  /** Attach a resolved brochure to one offer (id + include on the offer; full record on the Item for display). */
  function attachBrochure(i: number, brochure: Brochure, include = true) {
    setItems((it) => it.map((x, k) => (k === i ? { ...x, brochure, offer: { ...x.offer, brochure: { brochureId: brochure.id, include } } } : x)));
    clearOutput();
  }
  function toggleBrochure(i: number, include: boolean) {
    setItems((it) => it.map((x, k) => (k === i && x.offer.brochure ? { ...x, offer: { ...x.offer, brochure: { ...x.offer.brochure, include } } } : x)));
    clearOutput();
  }
  function removeBrochure(i: number) {
    setItems((it) =>
      it.map((x, k) => {
        if (k !== i) return x;
        const { brochure: _drop, ...offer } = x.offer;
        const { brochure: _rec, ...rest } = x;
        return { ...rest, offer };
      }),
    );
    clearOutput();
  }

  async function doPreview() {
    setPreviewing(true);
    setPreviewError('');
    try {
      setPreviewHtml(displayHtml((await api.preview(draft)).html));
      setPreviewStale(false);
    } catch (err) {
      setPreviewError(errMsg(err));
    } finally {
      setPreviewing(false);
    }
  }

  /**
   * Start a new campaign (Matt, 30 Sept 2026): clear the offers and the customer. Steps 1 to 3 stay as last used (Matt,
   * 7 Oct 2026: the campaign name, audience, use case, subject, message, offer button and your details), all still
   * editable; salary sacrifice, while parked, goes back to personal. The Outlook connection stays. Asks first only when
   * there is work that was never sent.
   */
  function startNew() {
    const unsent = items.length > 0 && !sentAt;
    if (unsent && !window.confirm('Start a new campaign? This clears the offers and the customer’s name; your message and details stay. Nothing has been sent.')) return;
    if (audience === 'salary_sacrifice' && !SALSAC_LIVE) setAudience('personal');
    setPreheader('');
    setRecipientFirst('');
    setUrl('');
    setAddError('');
    setWarnings([]);
    setSavedIds(new Set());
    setItems([]);
    createdFrom.current = null;
    setChangedAfterCreate(false);
    setOutlookNote(null);
    setRestoredAt(null);
    repriceRun.current += 1;
    setRepricing(false);
    if (email) clearSavedDraft(email);
    lastSavedBody.current = '';
    resetPreview();
    composeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // The top bar's "+ New campaign" (App.tsx): start again here, asking first if unsent work would be lost.
  useEffect(() => {
    if (newCampaignRequest > 0) startNew();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newCampaignRequest]);

  async function doCreate() {
    setCreating(true);
    setCreateError('');
    try {
      const res = await api.create(draft);
      // Step 3 is remembered too (Matt, 7 Oct 2026): details the salesperson changed here become their saved profile,
      // so the next campaign starts with them. Only their own edits, and only once the profile has loaded: a copied
      // campaign's older details or the defaults left by a failed load never overwrite it. Quietly: a failure here never
      // blocks the campaign (it is tried again at the next Create, and "Save my details" remains).
      if (profileLoaded.current && detailsEdited.current) {
        detailsEdited.current = false;
        void api.saveSender(senderToSave()).catch(() => {
          detailsEdited.current = true;
        });
      }
      createdFrom.current = JSON.stringify(draft);
      setChangedAfterCreate(false);
      setCreated(res); // res.html stays absolute — Copy-for-Outlook needs it that way
      setPreviewHtml(displayHtml(res.html));
      setPreviewStale(false);
    } catch (err) {
      setCreateError(errMsg(err));
    } finally {
      setCreating(false);
    }
  }

  // A new (or cleared) campaign starts with nothing sent, no messages and no customer address (never the last one's).
  useEffect(() => {
    setSentAt(null);
    setSendError(null);
    setCopyProblems([]);
    setRecipientEmail('');
  }, [created]);

  // An edit after Create would not reach the customer (Send and Copy use the stored campaign): drop it, and say so.
  useEffect(() => {
    if (!created || createdFrom.current === null || JSON.stringify(draft) === createdFrom.current) return;
    setCreated(null);
    setPreviewStale(true);
    setChangedAfterCreate(true);
  }, [draft, created]);

  /** Send to the customer from the salesperson's own mailbox. The server runs every check first and refuses a faulty email. */
  async function doSend() {
    if (!created || !recipientEmail.trim()) return;
    setSending(true);
    setSendError(null);
    try {
      const r = await api.send(created.campaign.id, recipientEmail.trim(), recipientFirst.trim() || undefined);
      if (r.ok) {
        setSentAt(r.sentAt);
        if (email) clearSavedDraft(email); // sent: nothing to come back to
        setRestoredAt(null);
        setMail((m) => (m ? { ...m, lastSentAt: r.sentAt } : m));
      } else {
        const problems = (r.checks ?? []).filter((c) => !c.ok).flatMap((c) => c.problems);
        setSendError({ text: problems.length ? 'Not sent. Fix these, then press Send again:' : r.error, problems });
        if (r.code === 'connect' || r.code === 'reconnect') setMail((m) => (m ? { ...m, connected: false } : m));
      }
    } catch (e) {
      setSendError({ text: errMsg(e), problems: [] });
    } finally {
      setSending(false);
    }
  }

  function copyForOutlook() {
    if (!created) return;
    const { html, text } = created;
    // The backup route runs the same checks (all but the customer's address), so it cannot be used to get round them.
    setCopyProblems([]);
    const allowed = api.checks(created.campaign.id).then(
      (r) => {
        if (!r.ok) {
          setCopyProblems(r.checks.filter((c) => !c.ok).flatMap((c) => c.problems));
          throw new Error('blocked by a check');
        }
      },
      (e: unknown) => {
        setCopyProblems([errMsg(e)]);
        throw e;
      },
    );
    allowed.catch(() => {});
    const done = () => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    };
    // Start the write now, inside the click, with the content arriving once the checks pass: Safari and Firefox refuse
    // a clipboard write that starts after a network wait.
    let write: Promise<void>;
    try {
      const blob = (body: string, type: string) => allowed.then(() => new Blob([body], { type }));
      write = navigator.clipboard.write([new ClipboardItem({ 'text/html': blob(html, 'text/html'), 'text/plain': blob(text, 'text/plain') })]);
    } catch {
      write = allowed.then(() => navigator.clipboard.writeText(html));
    }
    write.then(done).catch(async () => {
      try {
        await allowed;
      } catch {
        return; // a check failed: its message is already on screen
      }
      try {
        await navigator.clipboard.writeText(html);
        done();
      } catch {
        setCopyProblems(['Your browser did not allow the copy. Press Copy for Outlook again, or use Edge or Chrome.']);
      }
    });
  }

  return (
    <div className="compose" ref={composeRef} style={gridStyle}>
      {/* ---- details ---- */}
      <section className="panel">
        <Step n={1} />
        {restoredAt && <p className="dl-small app__muted">Picked up where you left off (saved {whenSaved(restoredAt)}). “+ New campaign” at the top clears the offers.</p>}
        <Field label="Campaign name" help="Your own label, to find it again on the Campaigns tab. The customer never sees it.">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <Field label="Audience type" help="Sets the compliance wording, terms and disclaimer for the whole campaign.">{(id) => (
          <Select id={id} value={audience} onChange={(e) => changeAudience(e.target.value as Audience)}>
            {AUDIENCES.map((a) => {
              const parked = a.value === 'salary_sacrifice' && !SALSAC_LIVE;
              return (
                <option key={a.value} value={a.value} disabled={parked}>
                  {a.label}
                  {parked ? SOON : ''}
                </option>
              );
            })}
          </Select>
        )}</Field>
        <Field label="Use case">{(id) => (
          <Select id={id} value={useCase} onChange={(e) => setUseCase(e.target.value as UseCase)}>
            <option value="renewal">Renewal</option>
            <option value="follow_up">Cold-lead follow-up</option>
            <option value="offer_pack">Offer pack for an organisation</option>
            <option value="other">Other…</option>
          </Select>
        )}</Field>
        {useCase === 'other' && (
          <Field label="Describe the use case" help="A few words, e.g. “Staff event follow-up”.">{(id) => <Input id={id} value={useCaseNote} onChange={(e) => setUseCaseNote(e.target.value)} maxLength={80} placeholder="e.g. Staff event follow-up" />}</Field>
        )}
        <Field label="Recipient first name" help="Optional greeting.">{(id) => <Input id={id} value={recipientFirst} onChange={(e) => setRecipientFirst(e.target.value)} />}</Field>

        <Step n={2} />
        <Field label="Subject line" help="Shown as the email subject.">{(id) => <Input id={id} value={subject} onChange={(e) => setSubject(e.target.value)} />}</Field>
        <Field label="Intro message">{(id) => <Textarea id={id} rows={5} value={intro} onChange={(e) => setIntro(e.target.value)} />}</Field>
        <Field label="Offer button (CTA)" help="What the green button on every offer does.">{(id) => (
          <Select id={id} value={ctaKind} onChange={(e) => setCtaKind(e.target.value as CtaKind)}>
            {CTA_OPTIONS.map((o) => (
              <option key={o.kind} value={o.kind} disabled={!ctaAvailable(o.kind)}>
                {o.label}
                {ctaAvailable(o.kind) ? '' : o.kind === 'whatsapp' && !WHATSAPP_LIVE ? SOON : ` — add ${o.needText} in Sender`}
              </option>
            ))}
          </Select>
        )}</Field>
        <Field label="Button label" help="Optional — rename the button. Up to 30 characters, so it fits.">{(id) => <Input id={id} value={ctaLabel} onChange={(e) => setCtaLabel(e.target.value)} placeholder={ctaDefaultLabel(ctaKind)} maxLength={30} />}</Field>

        <Step n={3} />
        <Field label="Name">{(id) => <Input id={id} value={senderName} onChange={(e) => { detailsEdited.current = true; setSenderName(e.target.value); }} />}</Field>
        <Field label="Job title">{(id) => <Input id={id} value={senderTitle} onChange={(e) => { detailsEdited.current = true; setSenderTitle(e.target.value); }} />}</Field>
        <Field label="Direct phone" help="Enables the Call CTA.">{(id) => <Input id={id} value={senderPhone} onChange={(e) => { detailsEdited.current = true; setSenderPhone(e.target.value); }} />}</Field>
        <div className={WHATSAPP_LIVE ? undefined : 'soon'}>
          <Field label={`WhatsApp number${WHATSAPP_LIVE ? '' : ' (coming soon)'}`} help={WHATSAPP_LIVE ? 'E.164 with country code, e.g. +447700900123. Enables the WhatsApp CTA.' : 'WhatsApp contact is on the way. You will be able to add your number here and offer a WhatsApp button.'}>{(id) => <Input id={id} value={senderWhatsapp} onChange={(e) => { detailsEdited.current = true; setSenderWhatsapp(e.target.value); }} placeholder="+44…" disabled={!WHATSAPP_LIVE} />}</Field>
        </div>
        <Field label="Booking link" help="Your Microsoft Bookings page (https). Enables the Book CTA.">{(id) => <Input id={id} value={senderBooking} onChange={(e) => { detailsEdited.current = true; setSenderBooking(e.target.value); }} placeholder="https://outlook.office365.com/book/…" />}</Field>
        <Field label="Secondary contact links" help="Optional — extra ways to reach you, shown as a row under your signature. This is separate from the green offer button.">{() => (
          <div className="secondary">
            {SECONDARY_OPTIONS.map((o) => {
              const ok = secondaryReady(o.method);
              return (
                <label key={o.method} className={`secondary__opt${ok ? '' : ' secondary__opt--off'}`}>
                  <input type="checkbox" checked={secondary.includes(o.method)} disabled={!ok} onChange={() => toggleSecondary(o.method)} />
                  <span>{o.label}{ok ? '' : o.method === 'whatsapp' && !WHATSAPP_LIVE ? SOON : ` — add ${o.needText} above`}</span>
                </label>
              );
            })}
          </div>
        )}</Field>
        <div className="dl-field portrait__side">
          <Button variant="outline" size="sm" onClick={saveDetails} disabled={savingDetails}>{savingDetails ? 'Saving…' : detailsSaved ? 'Saved ✓' : 'Save my details'}</Button>
          <span className="dl-small app__muted">Saves your name and contact details for next time; creating a campaign saves them too. Edit them anytime. (Your photo saves when you upload it.)</span>
          {detailsError && <span className="dl-small brochure__err">{detailsError}</span>}
        </div>
        <SenderPhoto base={base} onChange={onHeadshotChange} />
        {outlookNote && <Alert tone={outlookNote.tone}>{outlookNote.text}</Alert>}
        {canSend && (
          <div className="dl-field outlook">
            <span className="dl-label">Outlook</span>
            {mail?.connected ? (
              <div className="outlook__row">
                <span className="dl-small">Connected. Emails go from your own mailbox.</span>
                <Button variant="ghost" size="sm" onClick={disconnectOutlook}>Disconnect</Button>
              </div>
            ) : (
              <div className="outlook__row">
                <Button size="sm" onClick={connectOutlook}>Connect Outlook</Button>
                <span className="dl-small app__muted">Once, so the tool can send your emails from your own mailbox. It never reads your mail.</span>
              </div>
            )}
          </div>
        )}
      </section>

      <div className="compose__resizer" onPointerDown={startResize('a')} role="separator" aria-orientation="vertical" aria-label="Drag to resize the campaign panel" title="Drag to resize" />

      {/* ---- offers ---- */}
      <section className="panel">
        <Step n={4} extra={<><span className="dl-small step__count">{items.length}/6</span>{repricing && <span className="dl-small app__muted"> · re-pricing the copied offers…</span>}</>} />
        <form onSubmit={addOffer} className="addoffer">
          <Input id="addoffer-url" placeholder="Paste a dreamlease.co.uk vehicle URL" value={url} onChange={(e) => setUrl(e.target.value)} disabled={items.length >= 6} />
          <Button type="submit" size="sm" disabled={fetching || items.length >= 6}>{fetching ? 'Fetching…' : items.length ? 'Add another offer' : 'Add offer'}</Button>
        </form>
        {items.length >= 6 && <p className="dl-small app__muted">You’ve reached the maximum of 6 offers per email.</p>}
        {audience === 'salary_sacrifice' && <p className="dl-small app__muted">Salary sacrifice: paste the vehicle URL for the make, model and image, then enter the net monthly figures by hand. The price includes finance, maintenance and insurance.</p>}
        {addError && <Alert tone="error">{addError}</Alert>}
        {warnings.map((w, i) => <Alert key={i} tone="warning">{w}</Alert>)}

        <div className="offers">
          {items.length === 0 && <p className="dl-small app__muted">No offers yet. Paste a vehicle URL above, or add one from the Library tab.</p>}
          {items.map(({ offer: o, options, brochure }, i) => (
            <div key={i} className={`offers__item${reloading === i ? ' offers__item--busy' : ''}`}>
              <OfferCard
                make={o.vehicle.make}
                model={o.vehicle.model}
                derivative={o.vehicle.derivative}
                monthly={isSalsac(o) ? (o.pricing.salsac?.net20 ? gbp(o.pricing.salsac.net20) : '—') : gbp(o.pricing.monthly)}
                period={isSalsac(o) ? 'per month net · 20% taxpayer' : undefined}
                terms={offerTerms(o)}
                image={o.image ? <img src={sameOrigin(o.image.url)} alt={`${o.vehicle.make} ${o.vehicle.model}`} style={{ width: '100%', display: 'block' }} /> : undefined}
                badge={o.hotBadge ? { label: o.hotBadge, tone: 'red' } : o.badges[0] ? { label: o.badges[0], tone: 'orange' } : undefined}
                ctaLabel="View this offer"
              />
              {isSalsac(o) && (
                <div className="salsac">
                  <div className="salsac__row">
                    <label className="salsac__label dl-small">Net · 20% taxpayer</label>
                    <Input type="number" min={0} inputMode="numeric" placeholder="£/mo" value={o.pricing.salsac?.net20 || ''} onChange={(e) => setSalsac(i, { net20: Number(e.target.value) })} />
                  </div>
                  <div className="salsac__row">
                    <label className="salsac__label dl-small">Net · 40% taxpayer</label>
                    <Input type="number" min={0} inputMode="numeric" placeholder="£/mo" value={o.pricing.salsac?.net40 || ''} onChange={(e) => setSalsac(i, { net40: Number(e.target.value) })} />
                  </div>
                </div>
              )}
              {options && (
                <div className="chips">
                  <ChipRow label="Term" options={options.contractLength} current={o.pricing.termMonths} disabled={reloading !== null} format={(v) => `${v} mo`} onPick={(v) => reLook(i, 'contractLength', v)} />
                  <ChipRow label="Mileage" options={options.annualMileage} current={o.pricing.annualMileage} disabled={reloading !== null} format={kMiles} onPick={(v) => reLook(i, 'annualMileage', v)} />
                  {!isSalsac(o) && <ChipRow label="Initial" options={options.initialRental} current={o.pricing.initialMonths} disabled={reloading !== null} format={(v) => `${v} mo`} onPick={(v) => reLook(i, 'initialRental', v)} />}
                </div>
              )}
              <BrochureControl item={{ offer: o, options, brochure }} onAttach={(b, include) => attachBrochure(i, b, include)} onToggle={(inc) => toggleBrochure(i, inc)} onRemove={() => removeBrochure(i)} />
              <div className="offers__btns">
                <Button variant="outline" size="sm" onClick={() => saveToLibrary(o)} disabled={saving === o.id || savedIds.has(o.id)}>{savedIds.has(o.id) ? 'Saved ✓' : saving === o.id ? 'Saving…' : 'Save to library'}</Button>
                <Button variant="ghost" size="sm" onClick={() => removeOffer(i)} disabled={reloading === i}>Remove</Button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="compose__resizer" onPointerDown={startResize('b')} role="separator" aria-orientation="vertical" aria-label="Drag to resize the offers panel" title="Drag to resize" />

      {/* ---- preview + send ---- */}
      <section className="panel">
        <Step n={5} />
        <div className="preview__actions">
          <Button variant="secondary" size="sm" className={`btn-orange${previewStale && previewHtml && !previewing ? ' btn-pulse' : ''}`} onClick={doPreview} disabled={!ready || previewing}>{previewing ? 'Rendering…' : previewHtml && !previewStale ? 'Updated ✓' : 'Update preview'}</Button>
          <Button size="sm" onClick={doCreate} disabled={!ready || creating}>{creating ? 'Creating…' : 'Create campaign'}</Button>
        </div>
        {salsacNeedsFigures && <p className="dl-small app__muted" style={{ marginBottom: 12 }}>Enter the 20% and 40% net figures for every salary-sacrifice offer to preview and create.</p>}
        {previewError && <Alert tone="error">{previewError}</Alert>}
        {createError && <Alert tone="error">{createError}</Alert>}

        <Step n={6} />
        {!created && changedAfterCreate && <Alert tone="warning">You changed the email after creating it. Press Create campaign again, then send.</Alert>}
        {!created && (
          <p className="dl-small app__muted">
            {canSend
              ? 'Once the campaign is created, enter the customer’s email and press Send. It goes from your own mailbox, after the tool has checked it.'
              : 'Once the campaign is created: Copy for Outlook, paste it into a new Outlook email, and send it from there.'}
          </p>
        )}
        {created && canSend && (
          <div className="send">
            {sentAt ? (
              <Alert tone="success" title={`Sent from your mailbox at ${hhmm(sentAt)}`}>
                <div className="created">
                  <span>It’s in your Outlook Sent Items, and replies come to you. To send these offers to someone else, create the campaign again.</span>
                  <div className="created__btns">
                    <Button size="sm" onClick={startNew}>Start a new campaign</Button>
                  </div>
                </div>
              </Alert>
            ) : (
              <>
                <Field label="Customer’s email" help="One customer per email. The address is used for this send and not kept by the tool.">{(id) => (
                  <Input id={id} type="email" autoComplete="off" value={recipientEmail} onChange={(e) => setRecipientEmail(e.target.value)} placeholder="name@example.com" />
                )}</Field>
                <div className="created__btns">
                  <Button onClick={doSend} disabled={!mail?.connected || !recipientEmail.trim() || sending}>{sending ? 'Checking and sending…' : 'Send'}</Button>
                  {!mail?.connected && (
                    <>
                      <Button variant="outline" size="sm" onClick={connectOutlook}>Connect Outlook</Button>
                      <span className="dl-small app__muted">once, then Send</span>
                    </>
                  )}
                </div>
                {sendError && (
                  <Alert tone="error">
                    {sendError.text}
                    {sendError.problems.length > 0 && (
                      <ul className="send__problems">{sendError.problems.map((p, i) => <li key={i}>{p}</li>)}</ul>
                    )}
                  </Alert>
                )}
              </>
            )}
          </div>
        )}
        {created && (
          <Alert tone={canSend ? 'info' : 'success'} title={canSend ? 'Other ways to share it' : 'Campaign created'}>
            <div className="created">
              <div>
                Hosted page: <a href={created.hostedUrl} target="_blank" rel="noreferrer">{created.hostedUrl}</a>
              </div>
              <div className="created__btns">
                <Button size="sm" variant={canSend ? 'outline' : undefined} onClick={copyForOutlook}>{copied ? 'Copied ✓' : 'Copy for Outlook'}</Button>
                <Button variant="outline" size="sm" onClick={() => navigator.clipboard.writeText(created.hostedUrl)}>Copy hosted link</Button>
              </div>
              {copyProblems.length > 0 && (
                <Alert tone="error">
                  Not copied. Fix these first:
                  <ul className="send__problems">{copyProblems.map((p, i) => <li key={i}>{p}</li>)}</ul>
                </Alert>
              )}
              <span className="dl-small app__muted">
                {canSend ? 'Backup only: Send above is the reliable way. ' : ''}Paste into a New Outlook message (Ctrl+V) <strong>with Keep source formatting</strong>: the small (Ctrl) paste button under the pasted email, or once in Settings → Mail → Compose and reply → Cut, copy and paste → Pasting from other apps. Outlook's default, Merge formatting, turns the red price black. Then press Send.
              </span>
            </div>
          </Alert>
        )}

        <div className="preview">
          {previewHtml && items.length > 0 ? (
            <>
              {previewStale && <p className="preview__stale dl-small">You changed the email — this preview is out of date. Press “Update preview” to refresh it.</p>}
              <iframe title="Email preview" srcDoc={previewHtml} className={`preview__frame${previewStale ? ' preview__frame--stale' : ''}`} />
            </>
          ) : (
            <div className="preview__empty">
              <Badge tone="grey">Preview</Badge>
              <p className="dl-small app__muted">Add at least one offer, then “Update preview” to see the email.</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
