/**
 * Suppression register — the opt-out list. Any signed-in salesperson can add an opt-out and check an address;
 * removal (re-permitting contact) is admin-only. Plain text, behind Access, CSV-exportable for audit.
 */
import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Field, Input } from 'dreamlease-design-system';
import { api, type Role, type Suppression } from './api';

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const when = (iso: string): string => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export function Suppressions({ role }: { role: Role }) {
  const [list, setList] = useState<Suppression[] | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const [checkEmail, setCheckEmail] = useState('');
  const [checkResult, setCheckResult] = useState<{ email: string; suppressed: boolean } | null>(null);

  const load = () =>
    api
      .listSuppressions()
      .then((r) => setList(r.suppressions))
      .catch((e) => setError(errMsg(e)));
  useEffect(() => {
    load();
  }, []);

  const add = async () => {
    if (!email.trim()) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await api.addSuppression(email.trim(), note.trim() || undefined);
      setEmail(''); setNote(''); setNotice('Added to the opt-out list.');
      await load();
    } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  };

  const runCheck = async () => {
    if (!checkEmail.trim()) return;
    setError('');
    try {
      const r = await api.checkSuppression(checkEmail.trim());
      setCheckResult({ email: checkEmail.trim(), suppressed: r.suppressed });
    } catch (e) { setError(errMsg(e)); }
  };

  const remove = async (s: Suppression) => {
    if (!window.confirm(`Remove ${s.email} from the opt-out list? They can be emailed again.`)) return;
    setBusy(true); setError(''); setNotice('');
    try { await api.removeSuppression(s.email); setNotice(`Removed ${s.email}.`); await load(); }
    catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  };

  return (
    <div className="list">
      <section className="panel">
        <h2 className="dl-h4">Suppression list</h2>
        <p className="dl-small app__muted">People who’ve asked not to be emailed. Add an opt-out as soon as someone replies “stop”. Sending is manual in Outlook, so always check here before you send.</p>
        {error && <Alert tone="error">{error}</Alert>}
        {notice && !error && <p className="dl-small app__muted">{notice}</p>}

        <div className="supp__add">
          <Field label="Add an opt-out — email">{(id) => <Input id={id} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" />}</Field>
          <Field label="Note (optional)">{(id) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. replied ‘please stop’ 16 Sept" />}</Field>
          <Button size="sm" onClick={add} disabled={busy || !email.trim()}>Add opt-out</Button>
        </div>
      </section>

      <section className="panel">
        <h2 className="dl-h4">Check an address</h2>
        <div className="supp__check">
          <Field label="Email">{(id) => <Input id={id} value={checkEmail} onChange={(e) => { setCheckEmail(e.target.value); setCheckResult(null); }} placeholder="name@example.com" />}</Field>
          <Button variant="outline" size="sm" onClick={runCheck} disabled={!checkEmail.trim()}>Check</Button>
        </div>
        {checkResult && (
          checkResult.suppressed
            ? <Alert tone="error" title="Do not email">{checkResult.email} is on the opt-out list.</Alert>
            : <Alert tone="success" title="OK to email">{checkResult.email} is not on the opt-out list.</Alert>
        )}
      </section>

      <section className="panel">
        <div className="tmpl__head">
          <h2 className="dl-h4">Register <span className="dl-small app__muted">{list ? `${list.length}` : ''}</span></h2>
          <a className="dl-small" href="/api/suppressions.csv">Export CSV</a>
        </div>
        {!list && !error && <p className="dl-small app__muted">Loading…</p>}
        {list && list.length === 0 && <p className="dl-small app__muted">No opt-outs recorded yet.</p>}
        <div className="supp-list">
          {list?.map((s) => (
            <div key={s.email} className="supp">
              <div>
                <p className="supp__email">{s.email}</p>
                <p className="dl-small app__muted">{when(s.addedAt)} · added by {s.addedBy}{s.note ? ` · ${s.note}` : ''}</p>
              </div>
              <div className="supp__actions">
                {role === 'admin'
                  ? <Button variant="ghost" size="sm" onClick={() => remove(s)} disabled={busy}>Remove</Button>
                  : <Badge tone="grey">opt-out</Badge>}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
