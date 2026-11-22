import { ProofScreen } from './components/ProofScreen';
import { PhoneFlow } from './components/PhoneFlow';
import { useCase, useLocalStorage } from './hooks';

/** One user flow and one local case across phones, tablets, and desktop windows. */
export default function App() {
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
  const onNew = () => setCaseId(null);
  const { c, events, refresh } = useCase(caseId, onNew);
  return (
    <main className="app-shell">
      <PhoneFlow c={c} events={events} onCreated={setCaseId} onNew={onNew} refresh={refresh} />
    </main>
  );
}
