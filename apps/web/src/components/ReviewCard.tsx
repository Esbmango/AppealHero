import { useRef, useState } from 'react';
import { PORTAL_FIELDS, US_STATES, type CaseView } from '@appealhero/shared';
import { t, useLang, factText, fieldLabel, reasonLabel } from '../i18n';

import { api, ApiError } from '../api';
import { Button, Card, ProvBadge, StatusMark } from './ui';

/** Human-in-the-loop gate: confirm facts → see exactly what will be typed (EN + your language) → approve one submission. */
export function ReviewCard({ c, onChanged }: { c: CaseView; onChanged: () => void }) {
  useLang();
  const p = c.preview;
  const [attest, setAttest] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [showTranslation, setShowTranslation] = useState(true);
  const mountedAt = useRef(Date.now());
  if (!p) return null;

  const facts = new Map(c.facts.map((f) => [f.id, f]));
  const unconfirmed = p.unconfirmedFactIds.map((id) => facts.get(id)).filter((f): f is NonNullable<typeof f> => Boolean(f));
  const pretty = (id: string, v: string) => (id === 'disputeReason' ? reasonLabel(v) : id === 'plateState' ? `${US_STATES[v] ?? v} (${v})` : v);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setErr('');
    try {
      await fn();
      onChanged();
    } catch (e) {
      const ae = e as ApiError;
      setErr(ae.status === 409 ? t('review.changed') : ae.message);
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title={t('review.statementTitle')}>
      <dl className="divide-y divide-slate-100 text-sm">
        {PORTAL_FIELDS.filter((f) => f.id !== 'statement').map((f) => {
          const src = p.fieldSources[f.id];
          return (
            <div key={f.id} className="grid gap-1 py-2 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-3">
              <dt className="text-slate-500">{fieldLabel(f.id, f.label)}</dt>
              <dd className="min-w-0 font-medium">
                {pretty(f.id, p.payload.fields[f.id]) || <span className="text-rose-600">{t('common.missing')}</span>}
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  <ProvBadge p={src?.provenance} /> <StatusMark s={src?.status} />
                </div>
              </dd>
            </div>
          );
        })}
        {Object.entries(p.payload.extra).map(([label, value]) => (
          <div key={label} className="grid gap-1 py-2 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-3">
            <dt className="text-slate-500">{label}</dt>
            <dd className="min-w-0 font-medium">
              {value}
              <div className="mt-1 flex flex-wrap items-center gap-1">
                <ProvBadge p="USER_TEXT" /> <StatusMark s="CONFIRMED" />
              </div>
            </dd>
          </div>
        ))}
      </dl>

      {unconfirmed.length > 0 && (
        <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-2 text-xs">
          <p className="mb-1 font-semibold">{t('review.pendingCount', { count: unconfirmed.length })}</p>
          <ul className="mb-2 space-y-1">
            {unconfirmed.map((f) => (
              <li key={f.id} className="flex flex-wrap items-start justify-between gap-2">
                <span className="min-w-0">
                  {fieldLabel(f.key, f.label)}: <b>{factText(f)}</b>
                </span>
                <ProvBadge p={f.provenance} />
              </li>
            ))}
          </ul>
          <Button
            disabled={busy}
            onClick={() =>
              run(() =>
                api.confirmFacts(
                  c.id,
                  unconfirmed.map((f) => f.id),
                ),
              )
            }
          >
            {t('review.confirm')}
          </Button>
        </div>
      )}

      <div className="mt-3">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-semibold">{t('review.statementEnglish')}</span>
          {p.statementUserLang && (
            <button className="min-h-11 min-w-11 text-xs text-sky-700 underline" onClick={() => setShowTranslation((s) => !s)}>
              {showTranslation ? t('review.hideTranslation') : t('review.showTranslation', { language: t(`common.languages.${c.lang}`) })}
            </button>
          )}
        </div>
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-xl bg-slate-100 p-2 text-[11px] leading-relaxed">{p.payload.fields.statement}</pre>
        {showTranslation && p.statementUserLang && (
          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded-xl bg-violet-50 p-2 text-[11px] leading-relaxed text-violet-900">
            {p.statementUserLang}
          </pre>
        )}
      </div>

      <p className="mt-2 text-xs text-slate-600">{t('review.evidence', { files: p.payload.evidence.map((e) => e.filename).join(', ') || t('common.none') })}</p>
      {p.missing.length > 0 && (
        <p className="mt-1 text-xs text-rose-700">{t('review.missing', { fields: p.missing.map((key) => fieldLabel(key)).join('; ') })}</p>
      )}

      <label className="mt-3 flex min-h-11 cursor-pointer items-start gap-2 text-sm">
        <input type="checkbox" className="mt-0.5 h-6 w-6 shrink-0" checked={attest} onChange={(e) => setAttest(e.target.checked)} />
        <span>{t('review.attest')}</span>
      </label>
      <Button
        className="mt-2 w-full"
        disabled={!attest || busy || unconfirmed.length > 0 || p.missing.length > 0}
        onClick={() => run(() => api.approve(c.id, p.payloadHash, Date.now() - mountedAt.current))}
      >
        {t('review.approve')}
      </Button>
      <p className="mt-1 text-center font-mono text-[10px] text-slate-400">{t('review.fingerprint', { hash: p.payloadHash.slice(0, 16) })}</p>
      {err && <p className="mt-1 text-xs text-rose-700">{err}</p>}
    </Card>
  );
}
