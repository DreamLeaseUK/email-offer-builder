import { useEffect, useState } from 'react';
import { Alert, Logo } from 'dreamlease-design-system';
import type { Campaign, Offer } from '@offer-mailer/schema';
import { api, type ComposeSeed, type Item, type LayoutChoice, type Role } from './api';
import { Campaigns } from './Campaigns';
import { Compose } from './Compose';
import { Library } from './Library';
import { Register } from './Register';
import { Suppressions } from './Suppressions';
import { Templates } from './Templates';

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

type View = 'compose' | 'campaigns' | 'library' | 'register' | 'suppressions' | 'templates';

export function App() {
  const [email, setEmail] = useState('');
  const [base, setBase] = useState('');
  const [role, setRole] = useState<Role>('salesperson');
  const [meError, setMeError] = useState('');
  const [view, setView] = useState<View>('compose');
  // The offer tray is shared so the Library can add to the campaign the salesperson is composing.
  const [items, setItems] = useState<Item[]>([]);
  // A campaign being copied pre-fills Compose (its reusable parts; never the recipient).
  const [seed, setSeed] = useState<ComposeSeed | null>(null);

  useEffect(() => {
    api
      .me()
      .then((m) => {
        setEmail(m.email);
        setBase(m.publicBaseUrl.replace(/\/$/, ''));
        setRole(m.role);
      })
      .catch((e) => setMeError(errMsg(e)));
  }, []);

  const addFromLibrary = (o: Offer) => {
    setItems((it) => (it.some((x) => x.offer.id === o.id) ? it : [...it, { offer: o }].slice(0, 6)));
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
          {role === 'admin' && tab('templates', 'Templates')}
        </nav>
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

      {/* Compose stays mounted so its draft survives tab switches; the others mount fresh. */}
      <div hidden={view !== 'compose'}>
        <Compose email={email} base={base} items={items} setItems={setItems} seed={seed} onSeedApplied={() => setSeed(null)} />
      </div>
      {view === 'campaigns' && <Campaigns onCopy={copyCampaign} />}
      {view === 'library' && <Library base={base} role={role} onAdd={addFromLibrary} />}
      {view === 'register' && <Register />}
      {view === 'suppressions' && <Suppressions role={role} />}
      {view === 'templates' && role === 'admin' && <Templates />}
    </div>
  );
}
