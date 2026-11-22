import { useRef, useState } from 'react';
import { DISPUTE_REASONS, PORTAL_FIELDS, US_STATES, type CaseView, type DisputeReason, type Fact } from '@appealhero/shared';

const isoKeys = ['issuedAt', 'paidUntil', 'paidFrom'];
const factText = (f: Fact) =>
  isoKeys.includes(f.key) && !Number.isNaN(Date.parse(f.value))
    ? new Date(f.value).toLocaleString('zh-CN', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' }) + '（波士顿时间）'
    : (f.note ?? f.value);
import { api, ApiError } from '../api';
import { Button, Card, ProvBadge, StatusMark } from './ui';

/** Human-in-the-loop gate: confirm facts → see exactly what will be typed (EN + your language) → approve one submission. */
export function ReviewCard({ c, onChanged }: { c: CaseView; onChanged: () => void }) {
  const p = c.preview;
  const [attest, setAttest] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [showTranslation, setShowTranslation] = useState(true);
  const mountedAt = useRef(Date.now());
  if (!p) return null;

  const facts = new Map(c.facts.map((f) => [f.id, f]));
  const unconfirmed = p.unconfirmedFactIds.map((id) => facts.get(id)).filter((f): f is NonNullable<typeof f> => Boolean(f));
  const pretty = (id: string, v: string) =>
    id === 'disputeReason' ? (DISPUTE_REASONS[v as DisputeReason] ?? v) : id === 'plateState' ? `${US_STATES[v] ?? v} (${v})` : v;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setErr('');
    try {
      await fn();
      onChanged();
    } catch (e) {
      const ae = e as ApiError;
      setErr(ae.status === 409 ? '内容刚刚更新了，请重新核对后再批准。' : ae.message);
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="第二步：核对申诉信并授权 · Review & approve">
      <table className="w-full text-xs">
        <tbody>
          {PORTAL_FIELDS.filter((f) => f.id !== 'statement').map((f) => {
            const src = p.fieldSources[f.id];
            return (
              <tr key={f.id} className="border-b border-slate-100 align-top">
                <td className="py-1 pr-2 text-slate-500">{f.label}</td>
                <td className="py-1 pr-2 font-medium break-all">{pretty(f.id, p.payload.fields[f.id]) || <span className="text-rose-600">缺失</span>}</td>
                <td className="py-1 text-right whitespace-nowrap">
                  <ProvBadge p={src?.provenance} /> <StatusMark s={src?.status} />
                </td>
              </tr>
            );
          })}
          {Object.entries(p.payload.extra).map(([label, value]) => (
            <tr key={label} className="border-b border-slate-100">
              <td className="py-1 pr-2 text-slate-500">{label}</td>
              <td className="py-1 font-medium">{value}</td>
              <td className="py-1 text-right">
                <ProvBadge p="USER_TEXT" /> <StatusMark s="CONFIRMED" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {unconfirmed.length > 0 && (
        <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-2 text-xs">
          <p className="mb-1 font-semibold">以下 {unconfirmed.length} 项来自识别或你的陈述，提交前需要你亲自确认：</p>
          <ul className="mb-2 space-y-1">
            {unconfirmed.map((f) => (
              <li key={f.id} className="flex items-start justify-between gap-2">
                <span>
                  {f.label}：<b>{factText(f)}</b>
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
            全部核对无误
          </Button>
        </div>
      )}

      <div className="mt-3">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs font-semibold">英文申诉陈述（将原样提交）</span>
          {p.statementUserLang && (
            <button className="text-xs text-sky-700 underline" onClick={() => setShowTranslation((s) => !s)}>
              {showTranslation ? '隐藏对照' : '显示中文对照'}
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

      <p className="mt-2 text-xs text-slate-600">证据：{p.payload.evidence.map((e) => e.filename).join('、') || '无'}</p>
      {p.missing.length > 0 && <p className="mt-1 text-xs text-rose-700">还缺：{p.missing.join('；')}</p>}

      <label className="mt-3 flex items-start gap-2 text-xs">
        <input type="checkbox" className="mt-0.5" checked={attest} onChange={(e) => setAttest(e.target.checked)} />
        <span>我确认以上内容真实。我授权 AppealHero 在（模拟）门户上以我的名义填写，并只提交这一次。</span>
      </label>
      <Button
        className="mt-2 w-full"
        disabled={!attest || busy || unconfirmed.length > 0 || p.missing.length > 0}
        onClick={() => run(() => api.approve(c.id, p.payloadHash, Date.now() - mountedAt.current))}
      >
        批准并提交
      </Button>
      <p className="mt-1 text-center font-mono text-[10px] text-slate-400">批准指纹 {p.payloadHash.slice(0, 16)}…</p>
      {err && <p className="mt-1 text-xs text-rose-700">{err}</p>}
    </Card>
  );
}
