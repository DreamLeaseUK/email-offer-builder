import { useEffect, useState } from 'react';
import { Alert, Button, Logo } from 'dreamlease-design-system';
import type { Brochure, Campaign, Offer } from '@offer-mailer/schema';
import { api, type ComposeSeed, type Item, type LayoutChoice, type Role } from './api';
import { Campaigns } from './Campaigns';
import { Compose } from './Compose';
import { Library } from './Library';
import { Register } from './Register';
import { Suppressions } from './Suppressions';
import { Templates } from './Templates';
import { pinTipNeeded, pinTipSeen, useInstallApp } from './install';

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

type View = 'compose' | 'campaigns' | 'library' | 'register' | 'suppressions' | 'templates';

export function App() {
  const [email, setEmail] = useState('');
  const [base, setBase] = useState('');
  const [role, setRole] = useState<Role>('salesperson');
  // Compliance (config/compliance.json) alone edits and publishes the wording; master admins can only read it.
  const [complianceApprover, setComplianceApprover] = useState(false);
  const [headshotUrl, setHeadshotUrl] = useState<string | null>(null);
  const [meError, setMeError] = useState('');
  const [view, setView] = useState<View>('compose');
  // The offer tray is shared so the Library can add to the campaign the salesperson is composing.
  const [items, setItems] = useState<Item[]>([]);
  // A campaign being copied pre-fills Compose (its reusable parts; never the recipient).
  const [seed, setSeed] = useState<ComposeSeed | null>(null);
  // "+ New campaign" in the top bar: each press asks Compose (which owns the draft) to start again.
  const [newCampaignRequest, setNewCampaignRequest] = useState(0);
  // "Install app" (Matt, 7 Oct 2026): shown only while the browser can install the tool; gone once it is installed.
  const { canInstall, justInstalled, install } = useInstallApp();
  const [installedTipClosed, setInstalledTipClosed] = useState(false);
  const [showPinTip, setShowPinTip] = useState(pinTipNeeded);
  const newCampaign = () => {
    setView('compose');
    setNewCampaignRequest((n) => n + 1);
  };

  useEffect(() => {
    api
      .me()
      .then((m) => {
        setEmail(m.email);
        setBase(m.publicBaseUrl.replace(/\/$/, ''));
        setRole(m.role);
        setComplianceApprover(m.complianceApprover);
        setHeadshotUrl(m.headshotUrl);
      })
      .catch((e) => setMeError(errMsg(e)));
  }, []);

  const addFromLibrary = (o: Offer, brochure?: Brochure) => {
    setItems((it) => (it.some((x) => x.offer.id === o.id) ? it : [...it, { offer: o, ...(brochure ? { brochure } : {}) }].slice(0, 6)));
    setView('compose');
  };

  // Copy a past campaign: its offers into the tray and its reusable parts into Compose, as a fresh draft.
  // Campaigns never flow into the library; this only ever creates a new campaign, never touches the repository.
  const copyCampaign = (c: Campaign) => {
    const first = c.offers[0]?.cta;
    const layout: LayoutChoice = c.layout === 'single' || c.layout === 'stack' ? c.layout : 'auto';
    // Compose loads the offers into the tray and re-prices each live; it owns the tray, so we don't setItems here.
    setSeed({
      name: c.name,
      audience: c.compliance.variant,
      useCase: c.useCase,
      useCaseNote: c.useCaseNote ?? '',
      subject: c.subject,
      preheader: c.preheader ?? '',
      intro: c.intro,
      layout,
      ctaKind: first?.kind ?? 'view_offer',
      ctaLabel: first?.label ?? '',
      sender: { name: c.sender.displayName, title: c.sender.jobTitle ?? '', phone: c.sender.phone ?? '', whatsapp: c.sender.whatsapp ?? '', booking: c.sender.bookingUrl ?? '', secondary: c.sender.secondaryContacts ?? [] },
      offers: c.offers.slice(0, 6),
    });
    setView('compose');
  };

  // In-app display strips our origin so headshot URLs (stamped absolute for the email) resolve same-origin.
  const sameOrigin = (u: string): string => (base && u.startsWith(base) ? u.slice(base.length) || '/' : u);

  const seesTemplates = role === 'admin' || complianceApprover;

  const tab = (v: View, label: string) => (
    <button className={`app__tab${view === v ? ' app__tab--active' : ''}`} onClick={() => setView(v)} type="button">
      {label}
    </button>
  );

  return (
    <div className="app">
      <header className="app__bar">
        <Logo size={26} />
        <span className="app__title">Offer Mailer</span>
        <nav className="app__nav">
          {tab('compose', 'Compose')}
          {tab('campaigns', 'Campaigns')}
          {tab('library', 'Library')}
          {tab('register', 'Register')}
          {tab('suppressions', 'Suppressions')}
          {seesTemplates && tab('templates', 'Templates')}
        </nav>
        <span className="app__spacer" />
        {canInstall && (
          <span className="app__install">
            <Button size="sm" variant="outline" onClick={() => void install()} title="Install the Offer Mailer as its own app; then right-click its taskbar icon and choose Pin to taskbar">
              <InstallIcon /> Install app and pin to taskbar
            </Button>
          </span>
        )}
        <span className="app__new">
          <Button size="sm" onClick={newCampaign}>+ New campaign</Button>
        </span>
        <span className="app__user" title={email || undefined}>
          {headshotUrl && <img className="app__avatar" src={sameOrigin(headshotUrl)} alt="" />}
          <span className="dl-small app__email">{email || (meError ? 'not signed in' : '…')}</span>
        </span>
      </header>

      {justInstalled && !installedTipClosed && (
        <div className="app__notice">
          <Alert tone="success" title="The Offer Mailer is installed">
            It opens in its own window with the DreamLease icon. To keep it on your taskbar, right-click that icon and choose <strong>Pin to taskbar</strong>.{' '}
            <Button size="sm" variant="ghost" onClick={() => setInstalledTipClosed(true)}>Got it</Button>
          </Alert>
        </div>
      )}
      {showPinTip && (
        <div className="app__notice">
          <Alert tone="info" title="Pin the Offer Mailer to your taskbar">
            Right-click the DreamLease icon on your taskbar and choose <strong>Pin to taskbar</strong>, so it is one click away next time.{' '}
            <Button size="sm" variant="ghost" onClick={() => { pinTipSeen(); setShowPinTip(false); }}>Got it</Button>
          </Alert>
        </div>
      )}

      {meError && (
        <div className="app__notice">
          <Alert tone="warning" title="Running without the API">
            {meError}. Start the Worker with <code>pnpm dev</code> (it supplies a dev user via <code>.dev.vars</code>); the tool talks to it through the Vite proxy.
          </Alert>
        </div>
      )}

      {/* Compose stays mounted so its draft survives tab switches; the others mount fresh. */}
      <div hidden={view !== 'compose'}>
        <Compose email={email} base={base} items={items} setItems={setItems} seed={seed} onSeedApplied={() => setSeed(null)} onHeadshotChange={setHeadshotUrl} newCampaignRequest={newCampaignRequest} />
      </div>
      {view === 'campaigns' && <Campaigns onCopy={copyCampaign} />}
      {view === 'library' && <Library base={base} role={role} onAdd={addFromLibrary} />}
      {view === 'register' && <Register />}
      {view === 'suppressions' && <Suppressions role={role} />}
      {view === 'templates' && seesTemplates && <Templates canEdit={complianceApprover} />}
    </div>
  );
}

/** A screen with a down arrow: "install this as an app". Follows the button's text colour. */
function InstallIcon() {
  return (
    <svg className="app__install-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2.5" y="3.5" width="19" height="13" rx="2" />
      <path d="M8 20.5h8M12 16.5v4M12 6.5v6M9.2 9.8 12 12.6l2.8-2.8" />
    </svg>
  );
}
