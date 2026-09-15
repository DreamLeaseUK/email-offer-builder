import { useEffect, useState } from 'react';
import { Alert, Logo } from 'dreamlease-design-system';
import { api } from './api';
import { Campaigns } from './Campaigns';
import { Compose } from './Compose';

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

type View = 'compose' | 'campaigns';

export function App() {
  const [email, setEmail] = useState('');
  const [base, setBase] = useState('');
  const [meError, setMeError] = useState('');
  const [view, setView] = useState<View>('compose');

  useEffect(() => {
    api
      .me()
      .then((m) => {
        setEmail(m.email);
        setBase(m.publicBaseUrl.replace(/\/$/, ''));
      })
      .catch((e) => setMeError(errMsg(e)));
  }, []);

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

      {view === 'compose' ? <Compose email={email} base={base} /> : <Campaigns />}
    </div>
  );
}
