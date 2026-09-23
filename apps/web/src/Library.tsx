import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, OfferCard } from 'dreamlease-design-system';
import type { LibraryEntry, Offer } from '@offer-mailer/schema';
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

/**
 * The offer library — a curated repository (23 Sept 2026). Two surfaces: the salesperson's own shelf, and the
 * shared shelves an admin curates. Prices are re-fetched live when an offer is added to a campaign, so nothing
 * stale ships; an entry whose source URL has moved or gone is flagged and cannot be used until it is re-pointed.
 */
export function Library({ base, role, onAdd }: { base: string; role: Role; onAdd: (o: Offer) => void }) {
  const [scope, setScope] = useState<'personal' | 'shared'>('personal');
  const [shelf, setShelf] = useState<LibraryShelf | null>(null); // selected shared shelf; null = all shared
  const [showArchived, setShowArchived] = useState(false);
  const [search, setSearch] = useState('');
  const [entries, setEntries] = useState<LibraryEntry[] | null>(null);
  const [shelves, setShelves] = useState<LibraryShelf[]>([]);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [promoting, setPromoting] = useState<string | null>(null);
  const isAdmin = role === 'admin';
  const sameOrigin = (u: string): string => (base && u.startsWith(base) ? u.slice(base.length) || '/' : u);

  useEffect(() => {
    api.libraryShelves().then((r) => setShelves(r.shelves)).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setEntries(null);
    setError('');
    try {
      if (showArchived) {
        setEntries((await api.listArchivedLibrary(scope)).entries);
      } else if (scope === 'shared') {
        const smart = shelf?.kind === 'smart';
        const r = await api.listLibrary({ scope: 'shared', ...(shelf && !smart ? { category: shelf.name } : {}), ...(smart && shelf?.rule?.maxMonthly ? { maxMonthly: shelf.rule.maxMonthly } : {}), ...(search ? { q: search } : {}) });
        setEntries(r.entries);
      } else {
        setEntries((await api.listLibrary({ scope: 'personal', ...(search ? { q: search } : {}) })).entries);
      }
    } catch (e) {
      setError(errMsg(e));
    }
  }, [scope, shelf, showArchived, search]);

  useEffect(() => {
    load();
  }, [load]);

  const patch = (e: LibraryEntry) => setEntries((es) => (es ?? []).map((x) => (x.id === e.id ? e : x)));
  const drop = (id: string) => setEntries((es) => (es ?? []).filter((x) => x.id !== id));

  async function add(e: LibraryEntry) {
    setBusy(e.id);
    setError('');
    setNote('');
    try {
      const r = await api.repriceLibrary(e.id); // priced live the moment it is used
      if (r.ok) {
        onAdd(r.offer);
        setNote(`${e.offer.vehicle.make} ${e.offer.vehicle.model} added to the campaign — priced live at ${gbp(r.offer.pricing.monthly)}/mo${r.message ? ` (${r.message})` : ''}.`);
      } else {
        setError(r.error);
        if (r.entry) patch(r.entry); // show the dead-URL flag on the card
      }
    } finally {
      setBusy(null);
    }
  }

  async function recheck(e: LibraryEntry) {
    setBusy(e.id);
    setError('');
    try {
      const r = await api.repriceLibrary(e.id);
      if (r.ok) {
        patch(r.entry);
        setNote(`${e.offer.vehicle.make} ${e.offer.vehicle.model} re-priced at ${gbp(r.offer.pricing.monthly)}/mo — the URL is current again.`);
      } else {
        setError(r.error);
        if (r.entry) patch(r.entry);
      }
    } finally {
      setBusy(null);
    }
  }

  async function archiveToggle(e: LibraryEntry) {
    setBusy(e.id);
    setError('');
    try {
      await (showArchived ? api.unarchiveLibrary(e.id) : api.archiveLibrary(e.id));
      drop(e.id);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(null);
    }
  }

  async function del(e: LibraryEntry) {
    setBusy(e.id);
    try {
      await api.deleteLibraryOffer(e.id);
      drop(e.id);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(null);
    }
  }

  async function promote(e: LibraryEntry, category: string) {
    setBusy(e.id);
    setError('');
    try {
      await api.promoteLibrary(e.id, category);
      setPromoting(null);
      setNote(`Added ${e.offer.vehicle.make} ${e.offer.vehicle.model} to the shared shelf “${category}”. It stays on your own shelf too.`);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(null);
    }
  }

  const seg = (v: 'personal' | 'shared', label: string) => (
    <button type="button" className={`lib-seg${scope === v ? ' is-on' : ''}`} onClick={() => { setScope(v); setShelf(null); setShowArchived(false); }}>
      {label}
    </button>
  );

  return (
    <div className="list">
      <section className="panel">
        <div className="lib-head">
          <h2 className="dl-h4">Offer library</h2>
          <div className="lib-segs">
            {seg('personal', 'My library')}
            {seg('shared', 'Shared shelves')}
          </div>
        </div>

        {scope === 'shared' && !showArchived && (
          <div className="lib-shelves">
            <button type="button" className={`lib-chip${!shelf ? ' is-on' : ''}`} onClick={() => setShelf(null)}>All</button>
            {shelves.map((s) => (
              <button type="button" key={s.name} className={`lib-chip${shelf?.name === s.name ? ' is-on' : ''}`} onClick={() => setShelf(s)}>
                {s.name}
                {s.kind === 'smart' && <span className="lib-chip__smart" title="Filled automatically from the live price">auto</span>}
              </button>
            ))}
          </div>
        )}

        <div className="lib-controls">
          <input className="lib-search" placeholder="Search by brand or model" value={search} onChange={(ev) => setSearch(ev.target.value)} />
          <label className="lib-archtoggle">
            <input type="checkbox" checked={showArchived} onChange={(ev) => setShowArchived(ev.target.checked)} /> Show archived
          </label>
        </div>

        {error && <Alert tone="error">{error}</Alert>}
        {note && <Alert tone="success">{note}</Alert>}
        {!entries && !error && <p className="dl-small app__muted">Loading…</p>}
        {entries && entries.length === 0 && (
          <p className="dl-small app__muted">
            {showArchived ? 'Nothing archived here.' : scope === 'shared' ? 'This shelf is empty. On the Compose tab, save an offer, then promote it here.' : 'No saved offers yet. On the Compose tab, fetch an offer and click “Save to library”.'}
          </p>
        )}

        <div className="lib-grid">
          {entries?.map((e) => {
            const o = e.offer;
            const dead = e.urlHealth.state !== 'ok';
            const canPromote = isAdmin && scope === 'personal' && !showArchived;
            return (
              <div key={e.id} className={`lib-item${dead ? ' lib-item--dead' : ''}`}>
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
                  Added {shortDate(e.addedAt)}
                  {scope === 'shared' && e.category ? ` · ${e.category}` : ''}
                  {e.lastPricedAt ? ` · price as of ${shortDate(e.lastPricedAt)}` : ''}
                </p>
                {dead && (
                  <div className="lib-dead">
                    <strong>URL not current — update with the latest.</strong> {e.urlHealth.note ?? 'The offer page has changed.'} Re-fetch the current offer from Compose and save it, then delete this one.
                  </div>
                )}
                {promoting === e.id ? (
                  <div className="lib-promote">
                    <span className="dl-small">Put on shelf:</span>
                    <select className="lib-search" defaultValue="" onChange={(ev) => ev.target.value && promote(e, ev.target.value)} disabled={busy === e.id}>
                      <option value="" disabled>
                        Choose a shelf…
                      </option>
                      {shelves.filter((s) => s.kind === 'manual').map((s) => (
                        <option key={s.name} value={s.name}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                    <Button variant="ghost" size="sm" onClick={() => setPromoting(null)}>Cancel</Button>
                  </div>
                ) : (
                  <div className="lib-item__btns">
                    {!showArchived &&
                      (dead ? (
                        <Button size="sm" variant="outline" onClick={() => recheck(e)} disabled={busy === e.id}>
                          {busy === e.id ? 'Checking…' : 'Re-check URL'}
                        </Button>
                      ) : (
                        <Button size="sm" onClick={() => add(e)} disabled={busy === e.id}>
                          {busy === e.id ? 'Pricing…' : 'Add to campaign'}
                        </Button>
                      ))}
                    {canPromote && <Button variant="outline" size="sm" onClick={() => setPromoting(e.id)}>Promote</Button>}
                    <Button variant="ghost" size="sm" onClick={() => archiveToggle(e)} disabled={busy === e.id}>
                      {showArchived ? 'Restore' : 'Archive'}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => del(e)} disabled={busy === e.id}>Delete</Button>
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
