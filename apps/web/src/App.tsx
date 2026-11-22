import { ProofScreen } from './components/ProofScreen';
import { PhoneFlow } from './components/PhoneFlow';
import { useEffect, useState } from 'react';
import { t, useLang } from './i18n';
import { DEMO_KEY_EVENT } from './api';
import { useCase, useLocalStorage, useVisibleViewportHeight } from './hooks';

/** Shown when the server answers 401: the app has to be opened once with ?key=… (see DEMO_KEY in .env). */
function DemoKeyBanner() {
  useLang();
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    const on = () => setMissing(true);
    window.addEventListener(DEMO_KEY_EVENT, on);
    return () => window.removeEventListener(DEMO_KEY_EVENT, on);
  }, []);
  if (!missing) return null;
  return (
    <div role="alert" data-testid="demo-key-banner" className="border-b border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
      <strong className="font-semibold">{t('common.demoKeyTitle')}</strong> {t('common.demoKeyBody')}
    </div>
  );
}

/** One user flow and one local case across phones, tablets, and desktop windows. */
export default function App() {
  useVisibleViewportHeight();
  const proof = /^\/cases\/([\w-]+)\/proof\/?$/.exec(window.location.pathname);
  return proof ? (
    <main className="app-shell">
      <ProofScreen caseId={proof[1]} />
    </main>
  ) : (
    <CaseApp />
  );
}
function CaseApp() {
  const [caseId, setCaseId] = useLocalStorage<string | null>('cp.caseId', null);
  // the logo and "back to start" links open /?home=1: forget the finished case and show the start screen
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get('home') !== '1') return;
    setCaseId(null);
    url.searchParams.delete('home');
    window.history.replaceState(null, '', url.pathname + url.search + url.hash);
  }, []);
  const onNew = () => setCaseId(null);
  const { c, events, refresh } = useCase(caseId, onNew);
  return (
    <main className="app-shell">
      <DemoKeyBanner />
      <PhoneFlow c={c} events={events} onCreated={setCaseId} onNew={onNew} refresh={refresh} />
    </main>
  );
}
