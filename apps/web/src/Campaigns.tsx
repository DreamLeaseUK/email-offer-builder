import { useEffect, useState } from 'react';
import { Alert, Badge, Button } from 'dreamlease-design-system';
import type { Campaign } from '@offer-mailer/schema';
import { api, type CampaignStats } from './api';

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const when = (iso: string): string => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const gbp = (n: number): string => '£' + Math.round(n).toLocaleString('en-GB');

const layoutLabel: Record<string, string> = { auto: 'Auto', single: 'Single', stack: 'Stack', grid2: 'Two-up', grid3: 'Three-up' };
const audienceLabel: Record<string, string> = { personal: 'PCH', business: 'BCH', salary_sacrifice: 'Salary sacrifice' };

/** The cars in a campaign — the thing that actually tells two "Follow-up offers" apart. */
const vehicleLine = (c: Campaign): string => c.offers.map((o) => `${o.vehicle.make} ${o.vehicle.model}`).join(' · ');

function StatsPanel({ id }: { id: string }) {
  const [stats, setStats] = useState<CampaignStats | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    api
      .stats(id)
      .then((s) => live && setStats(s))
      .catch((e) => live && setError(errMsg(e)));
    return () => {
      live = false;
    };
  }, [id]);

  if (error) return <Alert tone="error">{error}</Alert>;
  if (!stats) return <p className="dl-small app__muted">Loading stats…</p>;

  return (
    <div className="stats">
      <div className="stats__row">
        <span className="stats__metric"><strong>{stats.clicks}</strong> clicks</span>
        <span className="stats__metric"><strong>{stats.views}</strong> hosted views</span>
        {stats.scannerHits > 0 && <span className="dl-small app__muted">{stats.scannerHits} scanner hits excluded</span>}
      </div>
      {stats.byLink.length > 0 && (
        <div className="stats__links">
          {stats.byLink.map((l) => (
            <span key={l.linkId} className="dl-small">
              <Badge tone="grey">{l.linkId}</Badge> {l.count}
            </span>
          ))}
        </div>
      )}
      <div className="stats__when dl-small app__muted">
        <span>Last click: {stats.lastClick ? when(stats.lastClick) : '—'}</span>
        <span>Last view: {stats.lastView ? when(stats.lastView) : '—'}</span>
      </div>
      {!stats.lastClick && !stats.lastView && (
        <p className="dl-small app__muted">No clicks or views yet. Link scanners are excluded, so a genuine click will show here.</p>
      )}
    </div>
  );
}

/** Everything that identifies a campaign, revealed in place: each car with its price, the message, the sender. */
function Detail({ c }: { c: Campaign }) {
  const s = c.sender;
  return (
    <div className="camp-detail">
      <div className="camp-detail__offers">
        {c.offers.map((o) => (
          <div key={o.id} className="camp-offer">
            <span className="camp-offer__veh">
              <strong>{o.vehicle.make} {o.vehicle.model}</strong> {o.vehicle.derivative}
            </span>
            <span className="camp-offer__price">{gbp(o.pricing.monthly)}/mo · {o.pricing.termMonths}m · {o.pricing.annualMileage.toLocaleString('en-GB')} mi</span>
          </div>
        ))}
      </div>
      {c.preheader && <p className="dl-small"><span className="app__muted">Preheader:</span> {c.preheader}</p>}
      <p className="dl-small camp-detail__intro">{c.intro}</p>
      <p className="dl-small app__muted">
        From {s.displayName || '—'}{s.jobTitle ? `, ${s.jobTitle}` : ''} · {audienceLabel[c.compliance.variant] ?? c.compliance.variant} · {layoutLabel[c.layout] ?? c.layout}
      </p>
    </div>
  );
}

export function Campaigns({ onCopy }: { onCopy: (c: Campaign) => void }) {
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [error, setError] = useState('');
  const [openStats, setOpenStats] = useState<string | null>(null);
  const [openDetail, setOpenDetail] = useState<string | null>(null);

  useEffect(() => {
    api
      .listCampaigns()
      .then((r) => setCampaigns(r.campaigns))
      .catch((e) => setError(errMsg(e)));
  }, []);

  return (
    <div className="list">
      <section className="panel">
        <h2 className="dl-h4">Your campaigns</h2>
        <p className="dl-small app__muted">Copy any campaign to start a new one from it — the offers and your message carry over; the recipient does not.</p>
        {error && <Alert tone="error">{error}</Alert>}
        {!campaigns && !error && <p className="dl-small app__muted">Loading…</p>}
        {campaigns && campaigns.length === 0 && <p className="dl-small app__muted">No campaigns yet. Build one on the Compose tab.</p>}
        <div className="camp-list">
          {campaigns?.map((c) => {
            const open = openDetail === c.id;
            return (
              <div key={c.id} className="camp">
                <div className="camp__head">
                  <div className="camp__id">
                    <p className="camp__name">
                      {c.name} <Badge tone={c.status === 'sent' ? 'green' : 'grey'}>{c.status}</Badge>
                    </p>
                    <p className="camp__veh">{vehicleLine(c) || 'No offers'}</p>
                    <p className="dl-small app__muted">
                      {when(c.createdAt)} · {c.offers.length} offer{c.offers.length === 1 ? '' : 's'} · {audienceLabel[c.compliance.variant] ?? c.compliance.variant} · “{c.subject}”
                    </p>
                  </div>
                  <div className="camp__actions">
                    <Button size="sm" onClick={() => onCopy(c)}>Copy</Button>
                    <Button variant="ghost" size="sm" onClick={() => setOpenDetail((d) => (d === c.id ? null : c.id))}>{open ? 'Hide' : 'Details'}</Button>
                    <a className="dl-small" href={c.hostedPage.url} target="_blank" rel="noreferrer">Hosted page</a>
                    <Button variant="ghost" size="sm" onClick={() => setOpenStats((sv) => (sv === c.id ? null : c.id))}>{openStats === c.id ? 'Hide stats' : 'Stats'}</Button>
                  </div>
                </div>
                {open && <Detail c={c} />}
                {openStats === c.id && <StatsPanel id={c.id} />}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
