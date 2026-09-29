import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, OfferCard } from 'dreamlease-design-system';
import type { Brochure, LibraryEntry, Offer } from '@offer-mailer/schema';
import { api, type LibraryShelf, type Role } from './api';

const gbp = (n: number): string => '£' + Math.round(n).toLocaleString('en-GB');
const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const shortDate = (iso?: string): string => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

function offerTerms(o: Offer): string {
  const p = o.pricing;
  const parts = [`${p.termMonths} months`, `${p.annualMileage.toLocaleString('en-GB')} miles p.a.`];
  parts.push(o.contractType === 'salary_sacrifice' ? (p.maintenance ? 'maintenance incl.' : 'salary sacrifice') : `${gbp(p.initialPayment)} initial`);
  return parts.join(' · ');
}

type Tab = 'shared' | 'personal';

/**
 * The offer library, kept simple (Matt, 29 Sept 2026: "far too complicated"). Two tabs: Team offers (the shared
 * shelves an admin curates, shown first) and My saved offers. A card has one main action, Add to email (priced live
 * the moment it is used, so nothing stale ships), and Remove for whoever may remove it: the owner, or an admin on
 * Team offers. Remove archives the entry; only an admin sees removed offers and can restore them (the daily Cron
 * purges them after 6 months). An admin shares a saved offer with the team onto a shelf.
 */
export function Library({ base, role, onAdd }: { base: string; role: Role; onAdd: (o: Offer, brochure?: Brochure) => void }) {
  const [tab, setTab] = useState<Tab>('shared');
  const [shelf, setShelf] = useState<LibraryShelf | null>(null); // a Team offers filter; null = all
  const [showRemoved, setShowRemoved] = useState(false); // admins only
  const [search, setSearch] = useState('');
  const [entries, setEntries] = useState<LibraryEntry[] | null>(null);
  const [shelves, setShelves] = useState<LibraryShelf[]>([]);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [sharing, setSharing] = useState<string | null>(null);
  const isAdmin = role === 'admin';
  const sameOrigin = (u: string): string => (base && u.startsWith(base) ? u.slice(base.length) || '/' : u);

  useEffect(() => {
    api.libraryShelves().then((r) => setShelves(r.shelves)).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setEntries(null);
    setError('');
    try {
      if (showRemoved) {
        setEntries((await api.listArchivedLibrary(tab)).entries);
      } else if (tab === 'shared') {
        const smart = shelf?.kind === 'smart';
        const r = await api.listLibrary({ scope: 'shared', ...(shelf && !smart ? { category: shelf.name } : {}), ...(smart && shelf?.rule?.maxMonthly ? { maxMonthly: shelf.rule.maxMonthly } : {}), ...(search ? { q: search } : {}) });
        setEntries(r.entries);
      } else {
        setEntries((await api.listLibrary({ scope: 'personal', ...(search ? { q: search } : {}) })).entries);
      }
    } catch (e) {
      setError(errMsg(e));
    }
  }, [tab, shelf, showRemoved, search]);

  useEffect(() => {
    load();
  }, [load]);

  const patch = (e: LibraryEntry) => setEntries((es) => (es ?? []).map((x) => (x.id === e.id ? e : x)));
  const drop = (id: string) => setEntries((es) => (es ?? []).filter((x) => x.id !== id));
  const carName = (e: LibraryEntry) => `${e.offer.vehicle.make} ${e.offer.vehicle.model}`;

  async function add(e: LibraryEntry) {
    setBusy(e.id);
    setError('');
    setNote('');
    try {
      const r = await api.repriceLibrary(e.id); // priced live the moment it is used
      if (r.ok) {
        onAdd(r.offer, r.brochure);
        setNote(`${carName(e)} added to your email at today’s price, ${gbp(r.offer.pricing.monthly)} a month${r.brochure ? ', with its brochure' : ''}.`);
      } else {
        setError(r.error);
        if (r.entry) patch(r.entry); // show that the offer has changed on the website
      }
    } finally {
      setBusy(null);
    }
  }

  async function checkAgain(e: LibraryEntry) {
    setBusy(e.id);
    setError('');
    try {
      const r = await api.repriceLibrary(e.id);
      if (r.ok) {
        patch(r.entry);
        setNote(`${carName(e)} is on the website again, at ${gbp(r.offer.pricing.monthly)} a month.`);
      } else {
        setError(r.error);
        if (r.entry) patch(r.entry);
      }
    } finally {
      setBusy(null);
    }
  }

  async function removeOrRestore(e: LibraryEntry) {
    setBusy(e.id);
    setError('');
    setNote('');
    try {
      await (showRemoved ? api.unarchiveLibrary(e.id) : api.archiveLibrary(e.id));
      drop(e.id);
      setNote(showRemoved ? `${carName(e)} restored.` : `${carName(e)} removed.`);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(null);
    }
  }

  async function share(e: LibraryEntry, shelfName: string) {
    setBusy(e.id);
    setError('');
    try {
      await api.promoteLibrary(e.id, shelfName);
      setSharing(null);
      setNote(`${carName(e)} shared with the team in “${shelfName}”.`);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(null);
    }
  }

  const tabButton = (v: Tab, label: string) => (
    <button type="button" className={`lib-seg${tab === v ? ' is-on' : ''}`} onClick={() => { setTab(v); setShelf(null); setShowRemoved(false); setNote(''); setError(''); }}>
      {label}
    </button>
  );

  const emptyText = showRemoved
    ? 'Nothing removed here.'
    : tab === 'shared'
      ? shelf
        ? 'No team offers here yet.'
        : 'No team offers yet. Marketing shares the best deals here.'
      : 'No saved offers yet. On the Compose tab, add an offer and press “Save to library”.';

  return (
    <div className="list">
      <section className="panel">
        <div className="lib-head">
          <h2 className="dl-h4">Offer library</h2>
          <div className="lib-segs">
            {tabButton('shared', 'Team offers')}
            {tabButton('personal', 'My saved offers')}
          </div>
        </div>

        {tab === 'shared' && !showRemoved && (
          <div className="lib-shelves">
            <button type="button" className={`lib-chip${!shelf ? ' is-on' : ''}`} onClick={() => setShelf(null)}>All</button>
            {shelves.map((s) => (
              <button type="button" key={s.name} className={`lib-chip${shelf?.name === s.name ? ' is-on' : ''}`} onClick={() => setShelf(s)}>
                {s.name}
              </button>
            ))}
          </div>
        )}

        <div className="lib-controls">
          <input className="lib-search" placeholder="Search by brand or model" value={search} onChange={(ev) => setSearch(ev.target.value)} />
          {isAdmin && (
            <label className="lib-archtoggle">
              <input type="checkbox" checked={showRemoved} onChange={(ev) => setShowRemoved(ev.target.checked)} /> Show removed offers
            </label>
          )}
        </div>

        {error && <Alert tone="error">{error}</Alert>}
        {note && <Alert tone="success">{note}</Alert>}
        {!entries && !error && <p className="dl-small app__muted">Loading…</p>}
        {entries && entries.length === 0 && <p className="dl-small app__muted">{emptyText}</p>}

        <div className="lib-grid">
          {entries?.map((e) => {
            const o = e.offer;
            const gone = e.urlHealth.state !== 'ok';
            // the owner removes their own saved offers; an admin curates Team offers
            const canRemove = tab === 'personal' || isAdmin;
            const canShare = isAdmin && tab === 'personal' && !showRemoved;
            return (
              <div key={e.id} className={`lib-item${gone ? ' lib-item--dead' : ''}`}>
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
                <p className="dl-small app__muted lib-meta">
                  {e.lastPricedAt ? `Price checked ${shortDate(e.lastPricedAt)}` : `Saved ${shortDate(e.addedAt)}`}
                  {tab === 'shared' && e.category ? ` · ${e.category}` : ''}
                </p>
                {gone && (
                  <div className="lib-dead">
                    <strong>This offer has changed on the website.</strong> Press “Check again”. If it has ended, add the current offer from the Compose tab instead.
                  </div>
                )}
                {sharing === e.id ? (
                  <div className="lib-promote">
                    <span className="dl-small">Share in:</span>
                    <select className="lib-search" defaultValue="" onChange={(ev) => ev.target.value && share(e, ev.target.value)} disabled={busy === e.id}>
                      <option value="" disabled>
                        Choose…
                      </option>
                      {shelves.filter((s) => s.kind === 'manual').map((s) => (
                        <option key={s.name} value={s.name}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                    <Button variant="ghost" size="sm" onClick={() => setSharing(null)}>Cancel</Button>
                  </div>
                ) : (
                  <div className="lib-item__btns">
                    {!showRemoved &&
                      (gone ? (
                        <Button size="sm" variant="outline" onClick={() => checkAgain(e)} disabled={busy === e.id}>
                          {busy === e.id ? 'Checking…' : 'Check again'}
                        </Button>
                      ) : (
                        <Button size="sm" onClick={() => add(e)} disabled={busy === e.id}>
                          {busy === e.id ? 'Adding…' : 'Add to email'}
                        </Button>
                      ))}
                    {canShare && <Button variant="outline" size="sm" onClick={() => setSharing(e.id)}>Share with team</Button>}
                    {canRemove && (
                      <Button variant="ghost" size="sm" onClick={() => removeOrRestore(e)} disabled={busy === e.id}>
                        {showRemoved ? 'Restore' : 'Remove'}
                      </Button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
