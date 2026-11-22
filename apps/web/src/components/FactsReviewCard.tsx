import { useState } from 'react';
import type { CaseView } from '@appealhero/shared';
import { t, useLang, factText, fieldLabel, reasonLabel } from '../i18n';
import { api, ApiError } from '../api';
import { Button, Card, ProvBadge, StatusMark, cx } from './ui';

const PENDING = ['NEEDS_CONFIRMATION', 'USER_STATEMENT'];

/**
 * Gate 1 (v2): the user confirms every fact BEFORE anything is written. Only this screen can make a fact CONFIRMED.
 * Users can correct individual source facts before confirming the set.
 */
export function FactsReviewCard({ c, onChanged }: { c: CaseView; onChanged: () => void }) {
  useLang();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const pending = c.facts.filter((f) => PENDING.includes(f.status));
  const [editing, setEditing] = useState<string | null>(null),
    [value, setValue] = useState('');
  async function save() {
    if (!editing || !value.trim()) return;
    setBusy(true);
    setErr('');
    try {
      await api.editFact(c.id, editing, value.trim());
      setEditing(null);
      onChanged();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const reason = c.triage?.disputeReason;

  const confirmAll = async () => {
    setBusy(true);
    setErr('');
    try {
      await api.confirmFacts(
        c.id,
        pending.map((f) => f.id),
        true,
      );
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setBusy(false);
      onChanged();
    }
  };

  return (
    <Card title={t('review.factsTitle')}>
      {c.triage?.summary && <p className="mb-2 text-sm">{c.triage.summary}</p>}
      {reason && <p className="mb-2 text-xs text-slate-600">{t('review.reason', { reason: reasonLabel(reason) })}</p>}
      <p className="mb-2 text-xs text-slate-600">{t('review.factsHelp')}</p>
      <ul className="space-y-1 text-xs">
        {c.facts.map((f) => (
          <li
            key={f.id}
            className={cx('flex flex-col items-start justify-between gap-1 rounded-lg p-2 sm:flex-row sm:gap-3', PENDING.includes(f.status) && 'bg-amber-50')}
          >
            {editing === f.id ? (
              <div className="w-full space-y-2">
                <label className="form-label">
                  {fieldLabel(f.key, f.label)}
                  <textarea autoFocus value={value} onChange={(e) => setValue(e.target.value)} />
                </label>
                {['issuedAt', 'paidFrom', 'paidUntil'].includes(f.key) && <p>{t('review.timeHint')}</p>}
                <Button disabled={busy || !value.trim()} onClick={save}>
                  {t('review.save')}
                </Button>{' '}
                <Button variant="ghost" disabled={busy} onClick={() => setEditing(null)}>
                  {t('review.cancel')}
                </Button>
              </div>
            ) : (
              <>
                <span className="min-w-0">
                  {fieldLabel(f.key, f.label)}: <b className="whitespace-pre-line break-words">{factText(f)}</b>
                </span>
                <span className="flex shrink-0 flex-wrap items-center gap-1">
                  <ProvBadge p={f.provenance} />
                  <StatusMark s={f.status} />
                  {f.provenance !== 'RULE' && (
                    <button
                      className="text-sky-700 underline"
                      aria-label={t('review.editField', { field: fieldLabel(f.key, f.label) })}
                      disabled={busy || !!editing}
                      onClick={() => {
                        setValue(f.value);
                        setEditing(f.id);
                      }}
                    >
                      {t('review.edit')}
                    </button>
                  )}
                </span>
              </>
            )}
          </li>
        ))}
      </ul>
      <Button className="mt-3 w-full" disabled={busy || !!editing} onClick={confirmAll}>
        {t('review.confirmAll')}
      </Button>
      {err && <p className="mt-1 text-xs text-rose-700">{err}</p>}
    </Card>
  );
}
