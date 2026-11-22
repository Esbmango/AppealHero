import { useState } from 'react';
import { DISPUTE_REASONS, type CaseView, type DisputeReason, type Fact } from '@appealhero/shared';
import { api, ApiError } from '../api';
import { Button, Card, ProvBadge, StatusMark, cx } from './ui';

const ISO_KEYS = ['issuedAt', 'paidUntil', 'paidFrom'];
const PENDING = ['NEEDS_CONFIRMATION', 'USER_STATEMENT'];
const factText = (f: Fact) =>
  ISO_KEYS.includes(f.key) && !Number.isNaN(Date.parse(f.value))
    ? new Date(f.value).toLocaleString('zh-CN', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' }) + '（波士顿时间）'
    : (f.note ?? f.value);

/**
 * Gate 1 (v2): the user confirms every fact BEFORE anything is written. Only this screen can make a fact CONFIRMED.
 * WP0 keeps it minimal (confirm all, or tell the agent what is wrong in the chat); WP9 adds per-fact edits and i18n.
 */
export function FactsReviewCard({ c, onChanged }: { c: CaseView; onChanged: () => void }) {
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
    <Card title="第一步：核对事实 · Confirm the facts">
      {c.triage?.summary && <p className="mb-2 text-sm">{c.triage.summary}</p>}
      {reason && <p className="mb-2 text-xs text-slate-600">建议的申诉理由：{DISPUTE_REASONS[reason as DisputeReason] ?? reason}</p>}
      <p className="mb-2 text-xs text-slate-600">写申诉信之前，请确认下面每一条。只有你能确认；有不对的地方，直接在下方告诉我。</p>
      <ul className="space-y-1 text-xs">
        {c.facts.map((f) => (
          <li key={f.id} className={cx('flex items-start justify-between gap-2 rounded-lg p-1', PENDING.includes(f.status) && 'bg-amber-50')}>
            <span>
              {f.label}：<b className="break-all">{factText(f)}</b>
            </span>
            <span className="whitespace-nowrap">
              <ProvBadge p={f.provenance} /> <StatusMark s={f.status} />
            </span>
          </li>
        ))}
      </ul>
      <Button className="mt-3 w-full" disabled={busy} onClick={confirmAll}>
        全部核对无误，开始写申诉信
      </Button>
      {err && <p className="mt-1 text-xs text-rose-700">{err}</p>}
    </Card>
  );
}
