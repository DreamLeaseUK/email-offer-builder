import { useEffect, useState } from 'react';
import { Alert, Badge, Button } from 'dreamlease-design-system';
import type { Campaign } from '@offer-mailer/schema';
import { api, type CampaignStats } from './api';

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const when = (iso: string): string => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

const layoutLabel: Record<string, string> = { auto: 'Auto', single: 'Single', stack: 'Stack', grid2: 'Two-up', grid3: 'Three-up' };

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
      <p className="dl-small app__muted">
        {stats.lastActivity ? `Last activity ${when(stats.lastActivity)}` : 'No clicks or views yet. Link scanners are excluded, so a genuine click will show here.'}
      </p>
    </div>
  );
}

export function Campaigns() {
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [error, setError] = useState('');
  const [openStats, setOpenStats] = useState<string | null>(null);

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
        {error && <Alert tone="error">{error}</Alert>}
        {!campaigns && !error && <p className="dl-small app__muted">Loading…</p>}
        {campaigns && campaigns.length === 0 && <p className="dl-small app__muted">No campaigns yet. Build one on the Compose tab.</p>}
        <div className="camp-list">
          {campaigns?.map((c) => (
            <div key={c.id} className="camp">
              <div className="camp__head">
                <div>
                  <p className="camp__name">{c.name}</p>
                  <p className="dl-small app__muted">
                    {when(c.createdAt)} · {c.offers.length} offer{c.offers.length === 1 ? '' : 's'} · {layoutLabel[c.layout] ?? c.layout} · {c.status}
                  </p>
                </div>
                <div className="camp__actions">
                  <a className="dl-small" href={c.hostedPage.url} target="_blank" rel="noreferrer">Hosted page</a>
                  <Button variant="ghost" size="sm" onClick={() => setOpenStats((s) => (s === c.id ? null : c.id))}>
                    {openStats === c.id ? 'Hide stats' : 'Stats'}
                  </Button>
                </div>
              </div>
              <p className="dl-small camp__subject">“{c.subject}”</p>
              {openStats === c.id && <StatsPanel id={c.id} />}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
