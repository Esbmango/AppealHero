import { useState } from 'react';
import type { CaseView } from '@appealhero/shared';
import { t, useLang, factText, fieldLabel, reasonLabel } from '../i18n';
import { api, ApiError } from '../api';
import { Button, Card, ProvBadge, StatusMark, cx } from './ui';

const PENDING = ['NEEDS_CONFIRMATION', 'USER_STATEMENT'];

/**
 * Gate 1 (v2): the user confirms every fact BEFORE anything is written. Only this screen can make a fact CONFIRMED.
 * WP0 keeps it minimal (confirm all, or tell the agent what is wrong in the chat); WP9 adds per-fact edits and i18n.
 */
export function FactsReviewCard({ c, onChanged }: { c: CaseView; onChanged: () => void }) {
  useLang();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const pending = c.facts.filter((f) => PENDING.includes(f.status));
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
          <li key={f.id} className={cx('flex items-start justify-between gap-2 rounded-lg p-1', PENDING.includes(f.status) && 'bg-amber-50')}>
            <span>
              {fieldLabel(f.key, f.label)}: <b className="break-all">{factText(f)}</b>
            </span>
            <span className="whitespace-nowrap">
              <ProvBadge p={f.provenance} /> <StatusMark s={f.status} />
            </span>
          </li>
        ))}
      </ul>
      <Button className="mt-3 w-full" disabled={busy} onClick={confirmAll}>
        {t('review.confirmAll')}
      </Button>
      {err && <p className="mt-1 text-xs text-rose-700">{err}</p>}
    </Card>
  );
}
