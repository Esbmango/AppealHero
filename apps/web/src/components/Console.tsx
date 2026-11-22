import { useEffect, useState } from 'react';
import { CASE_STATES, SCENARIOS, SCENARIO_LABELS, type AgentEvent, type CaseView, type Scenario } from '@appealhero/shared';
import { api } from '../api';
import { cx, ms } from './ui';

type Health = Awaited<ReturnType<typeof api.health>>;

/** Judge-facing console (English): scenario switches, FSM, live browser, tool trace, cost/time meters. */
export function Console({ c, events }: { c: CaseView | null; events: AgentEvent[] }) {
  const [health, setHealth] = useState<Health | null>(null);
  const [scenario, setScenario] = useState<Scenario>('normal');
  useEffect(() => {
    api.health().then(setHealth, () => undefined);
    api.demoState().then(
      (s) => setScenario(s.scenario),
      () => undefined,
    );
  }, []);

  const shots = events.filter((e): e is Extract<AgentEvent, { type: 'exec.screenshot' }> => e.type === 'exec.screenshot');
  const steps = events.filter((e): e is Extract<AgentEvent, { type: 'exec.step' }> => e.type === 'exec.step').slice(-40);
  const tools = events.filter((e): e is Extract<AgentEvent, { type: 'agent.tool' }> => e.type === 'agent.tool').slice(-20);
  const latest = shots.at(-1);

  return (
    <div className="flex h-full flex-col gap-3 overflow-hidden text-slate-800">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-lg font-bold">AppealHero · Agent console</span>
        {health && (
          <span
            className={cx(
              'rounded-full px-2 py-0.5 text-xs font-semibold',
              health.aiMode === 'gemini' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900',
            )}
          >
            AI: {health.aiMode === 'gemini' ? health.model : 'FAKE (no Gemini key)'} · tiers {health.tiers.join('→')}
          </span>
        )}
        <span className="ml-auto text-xs text-slate-500">Portal scenario:</span>
        {SCENARIOS.map((s) => (
          <button
            key={s}
            onClick={() => api.setScenario(s).then((r) => setScenario(r.scenario))}
            className={cx('rounded-full border px-2 py-0.5 text-xs', s === scenario ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white')}
          >
            {SCENARIO_LABELS[s]}
          </button>
        ))}
        <button className="rounded-full border border-rose-300 px-2 py-0.5 text-xs text-rose-700" onClick={() => api.resetDemo().then(() => location.reload())}>
          Reset demo
        </button>
      </div>

      <div className="flex flex-wrap gap-1">
        {CASE_STATES.map((s) => {
          const visited = c?.stateHistory.some((h) => h.to === s) || c?.state === s;
          return (
            <span
              key={s}
              className={cx(
                'rounded px-1.5 py-0.5 font-mono text-[10px]',
                c?.state === s ? 'bg-sky-600 text-white' : visited ? 'bg-sky-100 text-sky-900' : 'bg-slate-200 text-slate-500',
              )}
            >
              {s}
            </span>
          );
        })}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[1.5fr_1fr] gap-3">
        <div className="flex min-h-0 flex-col gap-3">
          <div className="relative aspect-[16/10] w-full shrink-0 overflow-hidden rounded-xl border bg-slate-900">
            {latest ? (
              <img src={latest.url} alt={latest.label} className="h-full w-full object-contain" />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-slate-400">Browser view appears when the executor starts</div>
            )}
            {latest && <span className="absolute left-2 top-2 rounded bg-black/60 px-2 py-0.5 font-mono text-xs text-white">{latest.label}</span>}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border bg-white p-2 font-mono text-[11px]">
            {steps.map((s, i) => (
              <div key={i} className="flex gap-2">
                <span
                  className={cx(
                    'w-14 shrink-0',
                    s.status === 'blocked'
                      ? 'text-rose-600'
                      : s.status === 'fail'
                        ? 'text-amber-600'
                        : s.status === 'ok'
                          ? 'text-emerald-700'
                          : 'text-slate-500',
                  )}
                >
                  {s.tier ?? ''} {s.status}
                </span>
                <span className="break-all">
                  {s.step} {s.detail ? `— ${s.detail}` : ''}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex min-h-0 flex-col gap-3">
          {c && (
            <div className="grid grid-cols-3 gap-2 text-center">
              {[
                ['User active', ms(c.metrics.userActiveMs)],
                ['Agent time', ms(c.metrics.agentMs)],
                ['Browser time', ms(c.metrics.execMs)],
                ['Questions', String(c.metrics.questionsAsked)],
                ['LLM calls', String(c.metrics.llmCalls)],
                ['AI cost', `$${c.metrics.costUsd.toFixed(4)}`],
                ['Tokens in/out', `${c.metrics.tokensIn}/${c.metrics.tokensOut}`],
                ['CU actions', String(c.metrics.cuSteps)],
                [
                  'Tiers',
                  Object.entries(c.metrics.tiers)
                    .map(([k, v]) => `${k}:${v}`)
                    .join(' ') || '—',
                ],
              ].map(([k, v]) => (
                <div key={k} className="rounded-lg border bg-white p-1.5">
                  <div className="text-[10px] text-slate-500">{k}</div>
                  <div className="truncate text-sm font-semibold">{v}</div>
                </div>
              ))}
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border bg-white p-2 text-[11px]">
            <div className="mb-1 font-semibold">Agent tool calls</div>
            {tools.map((t, i) => (
              <div key={i} className="border-b border-slate-100 py-0.5 font-mono">
                <span className="text-violet-700">{t.name}</span> {JSON.stringify(t.args).slice(0, 90)}
                <div className="text-slate-500">→ {JSON.stringify(t.result).slice(0, 140)}</div>
              </div>
            ))}
          </div>
          <div className="h-40 overflow-y-auto rounded-xl border bg-white p-2 text-[11px]">
            <div className="mb-1 font-semibold">State history (who did what)</div>
            {c?.stateHistory.map((h, i) => (
              <div key={i} className="font-mono">
                {h.from} → <b>{h.to}</b>{' '}
                <span className="text-slate-500">
                  [{h.actor}] {h.reason}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
