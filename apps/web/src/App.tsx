import type React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Button, Field, Input, Logo, OfferCard, Select, Textarea } from 'dreamlease-design-system';
import type { Offer, Sender } from '@offer-mailer/schema';
import { api, type CreateResponse, type Draft, type LayoutChoice, type UseCase } from './api';

const gbp = (n: number): string => '£' + Math.round(n).toLocaleString('en-GB');
const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function offerTerms(o: Offer): string {
  const p = o.pricing;
  const parts = [`${p.termMonths} months`, `${p.annualMileage.toLocaleString('en-GB')} miles p.a.`];
  parts.push(o.contractType === 'salary_sacrifice' ? (p.maintenance ? 'maintenance incl.' : 'salary sacrifice') : `${gbp(p.initialPayment)} initial`);
  return parts.join(' · ');
}

export function App() {
  const [email, setEmail] = useState('');
  const [base, setBase] = useState('');
  const [meError, setMeError] = useState('');

  // Our-origin asset/link URLs are stamped absolute (the email needs that), but they only resolve on
  // the public origin. For in-app display, strip our origin so they become same-origin: served by the
  // Vite proxy in dev, and by the Worker itself in production. The Copy-for-Outlook HTML stays absolute.
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

  const [offers, setOffers] = useState<Offer[]>([]);
  const [url, setUrl] = useState('');
  const [fetching, setFetching] = useState(false);
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
    api
      .me()
      .then((m) => {
        setEmail(m.email);
        setBase(m.publicBaseUrl.replace(/\/$/, ''));
        const guess = (m.email.split('@')[0] ?? '').replace(/\./g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
        setSenderName((n) => n || guess);
      })
      .catch((e) => setMeError(errMsg(e)));
  }, []);

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
      offers,
      sender,
      ...(recipientFirst ? { recipient: { firstName: recipientFirst } } : {}),
    }),
    [name, useCase, subject, preheader, intro, layout, offers, sender, recipientFirst],
  );

  const ready = offers.length > 0 && !!name.trim() && !!subject.trim() && !!intro.trim() && !!email;

  async function addOffer(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    setFetching(true);
    setAddError('');
    setWarnings([]);
    try {
      const res = await api.lookup(url.trim());
      setOffers((o) => [...o, res.offer].slice(0, 6));
      setUrl('');
      setCreated(null);
      if (res.warnings.length) setWarnings(res.warnings);
    } catch (err) {
      setAddError(errMsg(err));
    } finally {
      setFetching(false);
    }
  }

  const removeOffer = (id: string) => {
    setOffers((o) => o.filter((x) => x.id !== id));
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
    <div className="app">
      <header className="app__bar">
        <Logo size={26} />
        <span className="app__title">Offer Mailer</span>
        <span className="app__spacer" />
        <span className="dl-small app__user">{email || (meError ? 'not signed in' : '…')}</span>
      </header>

      {meError && (
        <div className="app__notice">
          <Alert tone="warning" title="Running without the API">
            {meError}. Start the Worker with <code>pnpm dev</code> (it supplies a dev user via <code>.dev.vars</code>); the tool talks to it through the Vite proxy.
          </Alert>
        </div>
      )}

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
          <h2 className="dl-h4">Offers <span className="dl-small">{offers.length}/6</span></h2>
          <form onSubmit={addOffer} className="addoffer">
            <Input placeholder="Paste a dreamlease.co.uk offer URL" value={url} onChange={(e) => setUrl(e.target.value)} disabled={offers.length >= 6} />
            <Button type="submit" size="sm" disabled={fetching || !url.trim() || offers.length >= 6}>{fetching ? 'Fetching…' : 'Add'}</Button>
          </form>
          {addError && <Alert tone="error">{addError}</Alert>}
          {warnings.map((w, i) => <Alert key={i} tone="warning">{w}</Alert>)}

          <div className="offers">
            {offers.length === 0 && <p className="dl-small app__muted">No offers yet. Paste an offer URL above to fetch one.</p>}
            {offers.map((o) => (
              <div key={o.id} className="offers__item">
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
                <Button variant="ghost" size="sm" onClick={() => removeOffer(o.id)}>Remove</Button>
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
    </div>
  );
}
