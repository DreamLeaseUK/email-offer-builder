import { useEffect, useState } from 'react';
import { Alert, Button, OfferCard } from 'dreamlease-design-system';
import type { Offer } from '@offer-mailer/schema';
import { api } from './api';

const gbp = (n: number): string => '£' + Math.round(n).toLocaleString('en-GB');
const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function offerTerms(o: Offer): string {
  const p = o.pricing;
  const parts = [`${p.termMonths} months`, `${p.annualMileage.toLocaleString('en-GB')} miles p.a.`];
  parts.push(o.contractType === 'salary_sacrifice' ? (p.maintenance ? 'maintenance incl.' : 'salary sacrifice') : `${gbp(p.initialPayment)} initial`);
  return parts.join(' · ');
}

export function Library({ base, onAdd }: { base: string; onAdd: (o: Offer) => void }) {
  const [offers, setOffers] = useState<Offer[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const sameOrigin = (u: string): string => (base && u.startsWith(base) ? u.slice(base.length) || '/' : u);

  useEffect(() => {
    api
      .listLibrary()
      .then((r) => setOffers(r.offers))
      .catch((e) => setError(errMsg(e)));
  }, []);

  async function remove(id: string) {
    setBusy(id);
    try {
      await api.deleteLibraryOffer(id);
      setOffers((os) => (os ?? []).filter((o) => o.id !== id));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="list">
      <section className="panel">
        <h2 className="dl-h4">Offer library</h2>
        {error && <Alert tone="error">{error}</Alert>}
        {!offers && !error && <p className="dl-small app__muted">Loading…</p>}
        {offers && offers.length === 0 && <p className="dl-small app__muted">No saved offers yet. On the Compose tab, fetch an offer and click “Save to library”.</p>}
        <div className="lib-grid">
          {offers?.map((o) => (
            <div key={o.id} className="lib-item">
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
              <div className="lib-item__btns">
                <Button size="sm" onClick={() => onAdd(o)}>Add to campaign</Button>
                <Button variant="ghost" size="sm" onClick={() => remove(o.id)} disabled={busy === o.id}>Delete</Button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
