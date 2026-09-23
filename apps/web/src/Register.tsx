import { useEffect, useState } from 'react';
import { Alert } from 'dreamlease-design-system';
import { api, type RegisterData } from './api';

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const when = (iso: string): string => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

export function Register() {
  const [data, setData] = useState<RegisterData | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .register()
      .then(setData)
      .catch((e) => setError(errMsg(e)));
  }, []);

  return (
    <div className="register">
      <section className="panel">
        <div className="list__head">
          <div>
            <h2 className="dl-h4">Promotions register</h2>
            <p className="dl-small app__muted">Every campaign built in the tool — the salesperson-authored copy and the compliance metadata. All salespeople.</p>
          </div>
          <a className="dl-small list__export" href="/api/register.csv" download>Export CSV</a>
        </div>
        {error && <Alert tone="error">{error}</Alert>}
        {!data && !error && <p className="dl-small app__muted">Loading…</p>}
        {data && data.rows.length === 0 && <p className="dl-small app__muted">No promotions recorded yet. Create a campaign on the Compose tab.</p>}
        {data && data.rows.length > 0 && (
          <div className="reg-scroll">
            <table className="reg-table">
              <thead>
                <tr>
                  {data.columns.map((c) => (
                    <th key={c.key}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row, i) => (
                  <tr key={i}>
                    {data.columns.map((c) => {
                      const v = row[c.key] ?? '';
                      if (c.key === 'hostedUrl' && v)
                        return (
                          <td key={c.key}>
                            <a href={v} target="_blank" rel="noreferrer">
                              open
                            </a>
                          </td>
                        );
                      const display = c.key === 'created' || c.key === 'sentAt' ? when(v) : v;
                      return (
                        <td key={c.key} title={display}>
                          {display}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
