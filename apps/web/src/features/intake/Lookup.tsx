import { useState } from 'react';
import { TicketQuerySchema, US_STATES, type TicketQuery, type CaseView } from '@appealhero/shared';
import { api } from '../../api';
import { t, formatDate } from '../../i18n';
import { Button, Card } from '../../components/ui';

export function LookupForm({
  initialPlate = '',
  initialState = 'MA',
  byNumber = false,
  onSearch,
}: {
  initialPlate?: string;
  initialState?: string;
  byNumber?: boolean;
  onSearch: (query: TicketQuery) => Promise<void>;
}) {
  const [mode, setMode] = useState(byNumber ? 'number' : 'plate');
  const [plate, setPlate] = useState(initialPlate);
  const [state, setState] = useState(initialState);
  const [number, setNumber] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const query = TicketQuerySchema.safeParse(mode === 'plate' ? { plate, state } : { ticketNumber: number });
  async function search() {
    if (!query.success || busy) return;
    setBusy(true);
    setError('');
    try {
      await onSearch(query.data);
    } catch {
      setError(t('common.error'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        void search();
      }}
    >
      <label className="form-label">
        {t('intake.searchBy')}
        <select aria-label={t('intake.searchBy')} value={mode} onChange={(e) => setMode(e.target.value)}>
          <option value="plate">{t('intake.byPlate')}</option>
          <option value="number">{t('intake.byNumber')}</option>
        </select>
      </label>
      {mode === 'plate' ? (
        <div className="grid grid-cols-2 gap-2">
          <label className="form-label">
            {t('review.fields.plateNumber')}
            <input value={plate} maxLength={10} onChange={(e) => setPlate(e.target.value.toUpperCase())} />
          </label>
          <label className="form-label">
            {t('review.fields.plateState')}
            <select aria-label={t('review.fields.plateState')} value={state} onChange={(e) => setState(e.target.value)}>
              {Object.entries(US_STATES).map(([code, name]) => (
                <option key={code} value={code}>
                  {code} · {name}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : (
        <label className="form-label">
          {t('review.fields.ticketNumber')}
          <input inputMode="numeric" pattern="[0-9]{6,12}" maxLength={12} value={number} onChange={(e) => setNumber(e.target.value)} />
        </label>
      )}
      <Button type="submit" disabled={busy || !query.success}>
        {t('intake.search')}
      </Button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}

export function LookupResults({ c }: { c: CaseView }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function select(number: string) {
    setBusy(true);
    setError('');
    try {
      await api.selectTicket(c.id, number);
    } catch {
      setError(t('common.error'));
    } finally {
      setBusy(false);
    }
  }
  async function retry(query: TicketQuery) {
    const body = new FormData();
    for (const [key, value] of Object.entries(query)) body.set(key, value);
    await api.postMessage(c.id, body);
  }
  return (
    <Card title={t('intake.lookupResults')}>
      {c.lookupMessage && (
        <p role="status" className="mb-3">
          {t(`intake.${c.lookupMessage}`)}
        </p>
      )}
      <ul className="space-y-2">
        {c.lookupResults?.map((row) => (
          <li key={row.ticketNumber} className="rounded-lg border p-3 text-sm">
            <div className="flex flex-wrap justify-between gap-2">
              <b>{row.ticketNumber}</b>
              {row.status && <span>{t(`intake.status.${row.status}`)}</span>}
            </div>
            <p>
              {row.violation} · {row.state} {row.plate}
            </p>
            <p>
              {formatDate(row.issuedAt)} · {row.location}
            </p>
            {row.amountDue !== undefined && <p>{t('intake.amountDue', { amount: row.amountDue })}</p>}
            {row.decision && <p>{t(`intake.decision.${row.decision}`)}</p>}
            {row.status === 'OPEN' && (
              <Button disabled={busy} onClick={() => select(row.ticketNumber)}>
                {t('intake.chooseTicket', { number: row.ticketNumber })}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {error && <p role="alert">{error}</p>}
      <details className="mt-2" key={c.lookupMessage ?? 'results'} open={c.lookupResults?.length === 0 || undefined}>
        <summary>{t('intake.searchAgain')}</summary>
        <LookupForm onSearch={retry} byNumber />
      </details>
    </Card>
  );
}
