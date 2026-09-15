import type React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Button, Field, Input, OfferCard, Select, Textarea } from 'dreamlease-design-system';
import type { Offer, Sender } from '@offer-mailer/schema';
import { api, type CreateResponse, type Draft, type LayoutChoice, type LeaseOption, type PricingOptions, type UseCase } from './api';

const gbp = (n: number): string => '£' + Math.round(n).toLocaleString('en-GB');
const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const kMiles = (n: number): string => (n % 1000 === 0 ? `${n / 1000}k` : n.toLocaleString('en-GB'));

interface Item {
  offer: Offer;
  options: PricingOptions;
}

function offerTerms(o: Offer): string {
  const p = o.pricing;
  const parts = [`${p.termMonths} months`, `${p.annualMileage.toLocaleString('en-GB')} miles p.a.`];
  parts.push(o.contractType === 'salary_sacrifice' ? (p.maintenance ? 'maintenance incl.' : 'salary sacrifice') : `${gbp(p.initialPayment)} initial`);
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

export function Compose({ email, base }: { email: string; base: string }) {
  // Our-origin asset/link URLs are stamped absolute (the email needs that), but they only resolve on
  // the public origin. For in-app display, strip our origin so they become same-origin (served by the
  // Vite proxy in dev, the Worker in production). The Copy-for-Outlook HTML stays absolute.
  const sameOrigin = (u: string): string => (base && u.startsWith(base) ? u.slice(base.length) || '/' : u);
  const displayHtml = (html: string): string => (base ? html.split(base).join('') : html);

  const [name, setName] = useState('Follow-up offers');
  const [useCase, setUseCase] = useState<UseCase>('follow_up');
  const [subject, setSubject] = useState('The options we talked about');
  const [preheader, setPreheader] = useState('');
  const [intro, setIntro] = useState('Thanks for your time. As promised, here are the options that fit what we discussed.');
  const [layout, setLayout] = useState<LayoutChoice>('auto');
  const [recipientFirst, setRecipientFirst] = useState('');

  const [senderName, setSenderName] = useState('');
  const [senderTitle, setSenderTitle] = useState('Account Manager, DreamLease');
  const [senderPhone, setSenderPhone] = useState('');

  const [items, setItems] = useState<Item[]>([]);
  const [url, setUrl] = useState('');
  const [fetching, setFetching] = useState(false);
  const [reloading, setReloading] = useState<number | null>(null);
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

  const sender: Sender = useMemo(
    () => ({
      kind: 'user',
      displayName: senderName || email || 'DreamLease',
      email: email || 'unknown@dreamlease.co.uk',
      mailbox: email || 'unknown@dreamlease.co.uk',
      ...(senderTitle ? { jobTitle: senderTitle } : {}),
      ...(senderPhone ? { phone: senderPhone } : {}),
    }),
    [senderName, senderTitle, senderPhone, email],
  );

  const draft: Draft = useMemo(
    () => ({
      name,
      useCase,
      subject,
      ...(preheader ? { preheader } : {}),
      intro,
      layout,
      offers: items.map((x) => x.offer),
      sender,
      ...(recipientFirst ? { recipient: { firstName: recipientFirst } } : {}),
    }),
    [name, useCase, subject, preheader, intro, layout, items, sender, recipientFirst],
  );

  const ready = items.length > 0 && !!name.trim() && !!subject.trim() && !!intro.trim() && !!email;

  async function addOffer(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    setFetching(true);
    setAddError('');
    setWarnings([]);
    try {
      const res = await api.lookup(url.trim());
      setItems((it) => [...it, { offer: res.offer, options: res.options }].slice(0, 6));
      setUrl('');
      setCreated(null);
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
      const u = new URL(items[i]!.offer.offerUrl);
      u.searchParams.set(param, String(value));
      const res = await api.lookup(u.toString());
      setItems((it) => it.map((x, k) => (k === i ? { offer: res.offer, options: res.options } : x)));
      setCreated(null);
    } catch (err) {
      setAddError(errMsg(err));
    } finally {
      setReloading(null);
    }
  }

  const removeOffer = (i: number) => {
    setItems((it) => it.filter((_, k) => k !== i));
    setCreated(null);
  };

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

        <h2 className="dl-h4" style={{ marginTop: 24 }}>Sender</h2>
        <Field label="Name">{(id) => <Input id={id} value={senderName} onChange={(e) => setSenderName(e.target.value)} />}</Field>
        <Field label="Job title">{(id) => <Input id={id} value={senderTitle} onChange={(e) => setSenderTitle(e.target.value)} />}</Field>
        <Field label="Direct phone" help="Enables the call CTA.">{(id) => <Input id={id} value={senderPhone} onChange={(e) => setSenderPhone(e.target.value)} />}</Field>
      </section>

      {/* ---- offers ---- */}
      <section className="panel">
        <h2 className="dl-h4">Offers <span className="dl-small">{items.length}/6</span></h2>
        <form onSubmit={addOffer} className="addoffer">
          <Input placeholder="Paste a dreamlease.co.uk vehicle URL" value={url} onChange={(e) => setUrl(e.target.value)} disabled={items.length >= 6} />
          <Button type="submit" size="sm" disabled={fetching || !url.trim() || items.length >= 6}>{fetching ? 'Fetching…' : 'Add'}</Button>
        </form>
        {addError && <Alert tone="error">{addError}</Alert>}
        {warnings.map((w, i) => <Alert key={i} tone="warning">{w}</Alert>)}

        <div className="offers">
          {items.length === 0 && <p className="dl-small app__muted">No offers yet. Paste a vehicle URL above to fetch one.</p>}
          {items.map(({ offer: o, options }, i) => (
            <div key={i} className={`offers__item${reloading === i ? ' offers__item--busy' : ''}`}>
              <OfferCard
                make={o.vehicle.make}
                model={o.vehicle.model}
                derivative={o.vehicle.derivative}
                monthly={gbp(o.pricing.monthly)}
                terms={offerTerms(o)}
                image={o.image ? <img src={sameOrigin(o.image.url)} alt={`${o.vehicle.make} ${o.vehicle.model}`} style={{ width: '100%', display: 'block' }} /> : undefined}
                badge={o.hotBadge ? { label: o.hotBadge, tone: 'red' } : o.badges[0] ? { label: o.badges[0], tone: 'orange' } : undefined}
                ctaLabel="View this offer"
              />
              <div className="chips">
                <ChipRow label="Term" options={options.contractLength} current={o.pricing.termMonths} disabled={reloading !== null} format={(v) => `${v} mo`} onPick={(v) => reLook(i, 'contractLength', v)} />
                <ChipRow label="Mileage" options={options.annualMileage} current={o.pricing.annualMileage} disabled={reloading !== null} format={kMiles} onPick={(v) => reLook(i, 'annualMileage', v)} />
                <ChipRow label="Initial" options={options.initialRental} current={o.pricing.initialMonths} disabled={reloading !== null} format={(v) => `${v} mo`} onPick={(v) => reLook(i, 'initialRental', v)} />
              </div>
              <Button variant="ghost" size="sm" onClick={() => removeOffer(i)} disabled={reloading === i}>Remove</Button>
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
