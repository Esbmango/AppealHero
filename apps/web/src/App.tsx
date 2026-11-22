import { useState } from 'react';
import { Console } from './components/Console';
import { PhoneFlow } from './components/PhoneFlow';
import { useCase, useLatestCaseId, useLocalStorage, useMedia } from './hooks';

/**
 * Phone (< 1100 px): the user flow.
 * Desktop: split console — phone UI on the left, live agent/executor console on the right.
 * The desktop follows the newest case, so the presenter can drive it from a real phone.
 */
export default function App() {
  const wide = useMedia('(min-width: 1100px)');
  const [localId, setLocalId] = useLocalStorage<string | null>('cp.caseId', null);
  const [since, setSince] = useState('1970-01-01T00:00:00.000Z');
  const latest = useLatestCaseId(wide, since);
  const caseId = wide ? (latest ?? (localId && since === '1970-01-01T00:00:00.000Z' ? localId : null)) : localId;
  const onNew = () => {
    setLocalId(null);
    if (wide) setSince(new Date().toISOString());
  };
  const { c, events, refresh } = useCase(caseId, onNew);
  const phone = <PhoneFlow c={c} events={events} onCreated={setLocalId} onNew={onNew} refresh={refresh} />;

  if (!wide) return <div className="h-dvh">{phone}</div>;
  return (
    <div className="grid h-dvh grid-cols-[400px_1fr] gap-4 bg-slate-900 p-4">
      <div className="overflow-hidden rounded-[2rem] border-[10px] border-slate-700 bg-slate-50">{phone}</div>
      <div className="overflow-hidden rounded-2xl bg-slate-100 p-3">
        <Console c={c} events={events} />
      </div>
    </div>
  );
}
