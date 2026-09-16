import type React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Badge, Button, Field, Input, OfferCard, Select, Textarea } from 'dreamlease-design-system';
import type { Brochure, CtaKind, Offer, Sender } from '@offer-mailer/schema';
import { CTA_DEFAULT_LABELS } from '@offer-mailer/schema';
import { api, type Audience, type ContactMethod, type CreateResponse, type Draft, type Item, type LayoutChoice, type LeaseOption, type UseCase } from './api';

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

/** The green-button CTA options (brief §5.9). `need` is the sender field that unlocks the option. */
const CTA_OPTIONS: { kind: CtaKind; label: string; need?: 'phone' | 'whatsapp' | 'booking'; needText?: string }[] = [
  { kind: 'view_offer', label: 'View offer — open the offer page' },
  { kind: 'call', label: 'Call me', need: 'phone', needText: 'a Direct phone' },
  { kind: 'whatsapp', label: 'WhatsApp me', need: 'whatsapp', needText: 'a WhatsApp number' },
  { kind: 'email', label: 'Email me' },
  { kind: 'book', label: 'Book a time to discuss', need: 'booking', needText: 'a Booking link' },
];
const ctaDefaultLabel = (kind: CtaKind): string => (CTA_DEFAULT_LABELS as Record<string, string>)[kind] ?? '';

/** The secondary contact links the rep can add to their signature (a separate choice from the primary
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

/**
 * Brief §5.8 "Include brochure". Tries the stored copy / Firecrawl harvest first (`ensure`); if that
 * finds nothing or harvest is not configured, it drops to the manual path (upload a PDF or paste a link).
 * The offer stores only { brochureId, include }; the full record rides on the tray Item for display.
 */
function BrochureControl({ item, onAttach, onToggle, onRemove }: { item: Item; onAttach: (b: Brochure) => void; onToggle: (include: boolean) => void; onRemove: () => void }) {
  const o = item.offer;
  const attached = item.brochure;
  const included = o.brochure?.include ?? false;
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState(false);
  const [murl, setMurl] = useState('');
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  async function doEnsure() {
    setBusy(true);
    setErr('');
    setNote('');
    try {
      const res = await api.ensureBrochure(o.vehicle.make, o.vehicle.model);
      onAttach(res.brochure);
      setManual(false);
      setNote(res.state === 'fresh' ? 'Harvested a fresh brochure.' : res.state === 'stale' ? `Kept the stored copy — harvest failed: ${res.error ?? 'unknown error'}.` : (res.warning ?? 'Attached the stored brochure.'));
    } catch (e) {
      setErr(errMsg(e));
      setManual(true); // nothing found, or harvest not configured — offer the manual path
    } finally {
      setBusy(false);
    }
  }

  async function doManual(file?: File) {
    if (!file && !murl.trim()) {
      setErr('Paste a PDF or brochure-page link, or choose a PDF file.');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      const res = await api.manualBrochure(o.vehicle.make, o.vehicle.model, { url: murl.trim() || undefined, file });
      onAttach(res.brochure);
      setManual(false);
      setMurl('');
      setNote('Brochure attached.');
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  if (attached) {
    return (
      <div className="brochure">
        <label className="brochure__on">
          <input type="checkbox" checked={included} onChange={(e) => onToggle(e.target.checked)} /> Include brochure in the email
        </label>
        <span className="brochure__title">{attached.kind === 'pdf' ? '📄' : '🔗'} {attached.title} <span className="app__muted">({attached.kind === 'pdf' ? 'PDF' : 'request page'})</span></span>
        <div className="brochure__btns">
          <Button variant="ghost" size="sm" onClick={doEnsure} disabled={busy}>{busy ? '…' : 'Replace'}</Button>
          <Button variant="ghost" size="sm" onClick={onRemove} disabled={busy}>Remove brochure</Button>
        </div>
        {note && <span className="dl-small app__muted">{note}</span>}
        {err && <span className="dl-small brochure__err">{err}</span>}
      </div>
    );
  }

  return (
    <div className="brochure">
      {!manual ? (
        <div className="brochure__btns">
          <Button variant="outline" size="sm" onClick={doEnsure} disabled={busy}>{busy ? 'Finding brochure…' : 'Add brochure'}</Button>
          <Button variant="ghost" size="sm" onClick={() => { setManual(true); setErr(''); }} disabled={busy}>Upload / paste link</Button>
        </div>
      ) : (
        <div className="brochure__manual">
          <Input placeholder="Paste a PDF or brochure-page link (https)" value={murl} onChange={(e) => setMurl(e.target.value)} />
          <input ref={fileRef} type="file" accept="application/pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) doManual(f); }} />
          <div className="brochure__btns">
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={busy}>Choose PDF…</Button>
            <Button size="sm" onClick={() => doManual()} disabled={busy}>{busy ? 'Attaching…' : 'Attach link'}</Button>
            <Button variant="ghost" size="sm" onClick={() => { setManual(false); setErr(''); }} disabled={busy}>Cancel</Button>
          </div>
        </div>
      )}
      {err && <span className="dl-small brochure__err">{err}</span>}
    </div>
  );
}

/** Upload / manage the rep's portrait. Persists server-side and shows in the signature of every email. */
function SenderPhoto({ base }: { base: string }) {
  const sameOrigin = (u: string): string => (base && u.startsWith(base) ? u.slice(base.length) || '/' : u);
  const [url, setUrl] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api
      .me()
      .then((m) => setUrl(m.headshotUrl))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  async function upload(file: File) {
    setBusy(true);
    setErr('');
    try {
      setUrl((await api.uploadPhoto(file)).headshotUrl);
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

export function Compose({ email, base, items, setItems }: { email: string; base: string; items: Item[]; setItems: React.Dispatch<React.SetStateAction<Item[]>> }) {
  // Our-origin asset/link URLs are stamped absolute (the email needs that), but they only resolve on
  // the public origin. For in-app display, strip our origin so they become same-origin (served by the
  // Vite proxy in dev, the Worker in production). The Copy-for-Outlook HTML stays absolute.
  const sameOrigin = (u: string): string => (base && u.startsWith(base) ? u.slice(base.length) || '/' : u);
  const displayHtml = (html: string): string => (base ? html.split(base).join('') : html);

  const [name, setName] = useState('Follow-up offers');
  const [audience, setAudience] = useState<Audience>('personal');
  const [useCase, setUseCase] = useState<UseCase>('follow_up');
  const [subject, setSubject] = useState('The options we talked about');
  const [preheader, setPreheader] = useState('');
  const [intro, setIntro] = useState('Thanks for your time. As promised, here are the options that fit what we discussed.');
  const [layout, setLayout] = useState<LayoutChoice>('auto');
  const [recipientFirst, setRecipientFirst] = useState('');

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

  const [previewHtml, setPreviewHtml] = useState('');
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [created, setCreated] = useState<CreateResponse | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!email) return;
    const guess = (email.split('@')[0] ?? '').replace(/\./g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    setSenderName((n) => n || guess);
  }, [email]);

  // Prefill the rep's saved contact details so they never re-enter them; they stay editable.
  useEffect(() => {
    api
      .me()
      .then((m) => {
        const s = m.savedSender;
        if (!s) return;
        setSenderName(s.displayName);
        setSenderTitle(s.jobTitle);
        setSenderPhone(s.phone);
        setSenderWhatsapp(s.whatsapp);
        setSenderBooking(s.bookingUrl);
        setSecondary(s.secondaryContacts ?? []);
      })
      .catch(() => {});
  }, []);

  /** Is a secondary contact method usable yet — its underlying sender field filled? (Email always is.) */
  const secondaryReady = (m: ContactMethod): boolean =>
    m === 'email' ? true : m === 'call' ? !!senderPhone.trim() : m === 'whatsapp' ? !!senderWhatsapp.trim() : !!senderBooking.trim();
  const toggleSecondary = (m: ContactMethod) => setSecondary((cur) => (cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m]));

  async function saveDetails() {
    setSavingDetails(true);
    setDetailsError('');
    setDetailsSaved(false);
    try {
      await api.saveSender({ displayName: senderName || email, jobTitle: senderTitle, phone: senderPhone, whatsapp: senderWhatsapp, bookingUrl: senderBooking, secondaryContacts: secondary });
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
      ...(senderWhatsapp.trim() ? { whatsapp: senderWhatsapp.trim() } : {}),
      ...(senderBooking.trim() ? { bookingUrl: senderBooking.trim() } : {}),
      ...(() => {
        const ready = secondary.filter((m) => (m === 'email' ? true : m === 'call' ? !!senderPhone.trim() : m === 'whatsapp' ? !!senderWhatsapp.trim() : !!senderBooking.trim()));
        return ready.length ? { secondaryContacts: ready } : {};
      })(),
    }),
    [senderName, senderTitle, senderPhone, senderWhatsapp, senderBooking, secondary, email],
  );

  /** Is the chosen CTA usable — i.e. the sender field it needs is filled in? */
  const ctaAvailable = (kind: CtaKind): boolean => {
    const need = CTA_OPTIONS.find((o) => o.kind === kind)?.need;
    if (!need) return true;
    return need === 'phone' ? !!senderPhone.trim() : need === 'whatsapp' ? !!senderWhatsapp.trim() : !!senderBooking.trim();
  };

  const draft: Draft = useMemo(
    () => ({
      name,
      useCase,
      subject,
      ...(preheader ? { preheader } : {}),
      intro,
      layout,
      offers: items.map((x) => applyCta(x.offer, ctaKind, ctaLabel)),
      sender,
      ...(recipientFirst ? { recipient: { firstName: recipientFirst } } : {}),
    }),
    [name, useCase, subject, preheader, intro, layout, items, sender, recipientFirst, ctaKind, ctaLabel],
  );

  const salsacNeedsFigures = items.some((x) => isSalsac(x.offer) && !salsacReady(x.offer));
  const ready = items.length > 0 && !!name.trim() && !!subject.trim() && !!intro.trim() && !!email && !salsacNeedsFigures && ctaAvailable(ctaKind);

  /** Any change to the offer set invalidates the rendered output; clear it so the preview is never stale. */
  const clearOutput = () => {
    setCreated(null);
    setPreviewHtml('');
  };

  async function addOffer(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
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
    const had = items.length;
    setAudience(next);
    setItems([]);
    setAddError('');
    clearOutput();
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
  function attachBrochure(i: number, brochure: Brochure) {
    setItems((it) => it.map((x, k) => (k === i ? { ...x, brochure, offer: { ...x.offer, brochure: { brochureId: brochure.id, include: true } } } : x)));
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
    } catch (err) {
      setPreviewError(errMsg(err));
    } finally {
      setPreviewing(false);
    }
  }

  async function doCreate() {
    setCreating(true);
    setCreateError('');
    try {
      const res = await api.create(draft);
      setCreated(res); // res.html stays absolute — Copy-for-Outlook needs it that way
      setPreviewHtml(displayHtml(res.html));
    } catch (err) {
      setCreateError(errMsg(err));
    } finally {
      setCreating(false);
    }
  }

  async function copyForOutlook() {
    if (!created) return;
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([created.html], { type: 'text/html' }),
          'text/plain': new Blob([created.text], { type: 'text/plain' }),
        }),
      ]);
    } catch {
      await navigator.clipboard.writeText(created.html);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="compose">
      {/* ---- details ---- */}
      <section className="panel">
        <h2 className="dl-h4">Campaign</h2>
        <Field label="Campaign name">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <Field label="Audience type" help="Sets the compliance wording, terms and disclaimer for the whole campaign.">{(id) => (
          <Select id={id} value={audience} onChange={(e) => changeAudience(e.target.value as Audience)}>
            {AUDIENCES.map((a) => (
              <option key={a.value} value={a.value}>{a.label}</option>
            ))}
          </Select>
        )}</Field>
        <Field label="Use case">{(id) => (
          <Select id={id} value={useCase} onChange={(e) => setUseCase(e.target.value as UseCase)}>
            <option value="follow_up">Cold-lead follow-up</option>
            <option value="offer_pack">Offer pack for an organisation</option>
            <option value="renewal">Renewal</option>
          </Select>
        )}</Field>
        <Field label="Subject line" help="Shown as the email subject.">{(id) => <Input id={id} value={subject} onChange={(e) => setSubject(e.target.value)} />}</Field>
        <Field label="Preheader" help="Optional preview text after the subject.">{(id) => <Input id={id} value={preheader} onChange={(e) => setPreheader(e.target.value)} />}</Field>
        <Field label="Intro message">{(id) => <Textarea id={id} rows={5} value={intro} onChange={(e) => setIntro(e.target.value)} />}</Field>
        <Field label="Recipient first name" help="Optional greeting.">{(id) => <Input id={id} value={recipientFirst} onChange={(e) => setRecipientFirst(e.target.value)} />}</Field>
        <Field label="Layout">{(id) => (
          <Select id={id} value={layout} onChange={(e) => setLayout(e.target.value as LayoutChoice)}>
            <option value="auto">Auto</option>
            <option value="single">Single (one hero)</option>
            <option value="stack">Stack (full-width rows)</option>
            <option value="grid2">Two-up grid</option>
            <option value="grid3">Three-up grid</option>
          </Select>
        )}</Field>
        <Field label="Offer button (CTA)" help="What the green button on every offer does.">{(id) => (
          <Select id={id} value={ctaKind} onChange={(e) => setCtaKind(e.target.value as CtaKind)}>
            {CTA_OPTIONS.map((o) => (
              <option key={o.kind} value={o.kind} disabled={!ctaAvailable(o.kind)}>
                {o.label}
                {ctaAvailable(o.kind) ? '' : ` — add ${o.needText} in Sender`}
              </option>
            ))}
          </Select>
        )}</Field>
        <Field label="Button label" help="Optional — rename the button. Up to 30 characters, so it fits.">{(id) => <Input id={id} value={ctaLabel} onChange={(e) => setCtaLabel(e.target.value)} placeholder={ctaDefaultLabel(ctaKind)} maxLength={30} />}</Field>

        <h2 className="dl-h4" style={{ marginTop: 24 }}>Sender</h2>
        <Field label="Name">{(id) => <Input id={id} value={senderName} onChange={(e) => setSenderName(e.target.value)} />}</Field>
        <Field label="Job title">{(id) => <Input id={id} value={senderTitle} onChange={(e) => setSenderTitle(e.target.value)} />}</Field>
        <Field label="Direct phone" help="Enables the Call CTA.">{(id) => <Input id={id} value={senderPhone} onChange={(e) => setSenderPhone(e.target.value)} />}</Field>
        <Field label="WhatsApp number" help="E.164 with country code, e.g. +447700900123. Enables the WhatsApp CTA.">{(id) => <Input id={id} value={senderWhatsapp} onChange={(e) => setSenderWhatsapp(e.target.value)} placeholder="+44…" />}</Field>
        <Field label="Booking link" help="Your Microsoft Bookings page (https). Enables the Book CTA.">{(id) => <Input id={id} value={senderBooking} onChange={(e) => setSenderBooking(e.target.value)} placeholder="https://outlook.office365.com/book/…" />}</Field>
        <Field label="Secondary contact links" help="Optional — extra ways to reach you, shown as a row under your signature. This is separate from the green offer button.">{() => (
          <div className="secondary">
            {SECONDARY_OPTIONS.map((o) => {
              const ok = secondaryReady(o.method);
              return (
                <label key={o.method} className={`secondary__opt${ok ? '' : ' secondary__opt--off'}`}>
                  <input type="checkbox" checked={secondary.includes(o.method)} disabled={!ok} onChange={() => toggleSecondary(o.method)} />
                  <span>{o.label}{ok ? '' : ` — add ${o.needText} above`}</span>
                </label>
              );
            })}
          </div>
        )}</Field>
        <div className="dl-field portrait__side">
          <Button variant="outline" size="sm" onClick={saveDetails} disabled={savingDetails}>{savingDetails ? 'Saving…' : detailsSaved ? 'Saved ✓' : 'Save my details'}</Button>
          <span className="dl-small app__muted">Saves your name and contact details for next time — edit them anytime. (Your photo saves when you upload it.)</span>
          {detailsError && <span className="dl-small brochure__err">{detailsError}</span>}
        </div>
        <SenderPhoto base={base} />
      </section>

      {/* ---- offers ---- */}
      <section className="panel">
        <h2 className="dl-h4">Offers <span className="dl-small">{items.length}/6</span></h2>
        <form onSubmit={addOffer} className="addoffer">
          <Input placeholder="Paste a dreamlease.co.uk vehicle URL" value={url} onChange={(e) => setUrl(e.target.value)} disabled={items.length >= 6} />
          <Button type="submit" size="sm" disabled={fetching || !url.trim() || items.length >= 6}>{fetching ? 'Fetching…' : 'Add'}</Button>
        </form>
        {items.length >= 6
          ? <p className="dl-small app__muted">You’ve reached the maximum of 6 offers per email.</p>
          : items.length > 0 && <p className="dl-small app__muted">Paste another vehicle URL and press Add to include another offer (up to 6).</p>}
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
              <BrochureControl item={{ offer: o, options, brochure }} onAttach={(b) => attachBrochure(i, b)} onToggle={(inc) => toggleBrochure(i, inc)} onRemove={() => removeBrochure(i)} />
              <div className="offers__btns">
                <Button variant="outline" size="sm" onClick={() => saveToLibrary(o)} disabled={saving === o.id || savedIds.has(o.id)}>{savedIds.has(o.id) ? 'Saved ✓' : saving === o.id ? 'Saving…' : 'Save to library'}</Button>
                <Button variant="ghost" size="sm" onClick={() => removeOffer(i)} disabled={reloading === i}>Remove</Button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ---- preview + send ---- */}
      <section className="panel">
        <div className="preview__actions">
          <Button variant="secondary" size="sm" onClick={doPreview} disabled={!ready || previewing}>{previewing ? 'Rendering…' : 'Update preview'}</Button>
          <Button size="sm" onClick={doCreate} disabled={!ready || creating}>{creating ? 'Creating…' : 'Create campaign'}</Button>
        </div>
        {salsacNeedsFigures && <p className="dl-small app__muted" style={{ marginBottom: 12 }}>Enter the 20% and 40% net figures for every salary-sacrifice offer to preview and create.</p>}
        {previewError && <Alert tone="error">{previewError}</Alert>}
        {createError && <Alert tone="error">{createError}</Alert>}

        {created && (
          <Alert tone="success" title="Campaign created">
            <div className="created">
              <div>
                Hosted page: <a href={created.hostedUrl} target="_blank" rel="noreferrer">{created.hostedUrl}</a>
              </div>
              <div className="created__btns">
                <Button size="sm" onClick={copyForOutlook}>{copied ? 'Copied ✓' : 'Copy for Outlook'}</Button>
                <Button variant="outline" size="sm" onClick={() => navigator.clipboard.writeText(created.hostedUrl)}>Copy hosted link</Button>
              </div>
              <span className="dl-small app__muted">Paste into a New Outlook message (Ctrl+V) and press Send. Drafts only — nothing is sent for you.</span>
            </div>
          </Alert>
        )}

        <div className="preview">
          {previewHtml ? (
            <iframe title="Email preview" srcDoc={previewHtml} className="preview__frame" />
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
