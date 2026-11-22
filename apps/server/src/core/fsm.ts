import { RECOVERY, checkTransition, type Actor, type CaseState } from '@appealhero/shared';
import type { Ctx } from './ctx';
import type { CaseRecord } from './types';
import { now } from './util';

export class TransitionError extends Error {}

/**
 * The ONLY way to change a case's state. Checks the transition table and the actor rules
 * (only 'approval' can approve, only 'executor' can submit, the agent is confined to investigation).
 */
export function transition(ctx: Ctx, caseId: string, to: CaseState, actor: Actor, reason: string, patch?: (c: CaseRecord) => void): CaseRecord {
  const from = ctx.store.must(caseId).state;
  const check = checkTransition(from, to, actor);
  if (!check.ok) throw new TransitionError(check.reason);
  const c = ctx.store.mutate(caseId, (r) => {
    r.state = to;
    r.stateHistory.push({ from, to, reason, actor, at: now() });
    if (from === 'NEEDS_USER' || from === 'BLOCKED') r.needsUser = undefined;
    patch?.(r);
  });
  // Durability: every state change is on disk before anyone acts on it (atomic write, small file).
  ctx.store.flush();
  ctx.audit.append({ caseId, type: 'state.changed', actor, data: { from, to, reason } });
  ctx.hub.emit({ type: 'state.changed', caseId, from, to, reason, actor });
  if (c.needsUser && (to === 'NEEDS_USER' || to === 'BLOCKED')) ctx.hub.emit({ type: 'needs_user', caseId, needsUser: c.needsUser });
  return c;
}

/**
 * Crash recovery on startup (a restart kills any in-flight browser job or writer). Bypasses the actor
 * rules on purpose: it is the only other place a state may change, and it only ever moves a case to a
 * SAFE state (see RECOVERY in packages/shared/src/states.ts — never into execution or a submit).
 */
export function recoverAfterRestart(c: CaseRecord): string | null {
  const to = RECOVERY[c.state];
  if (!to) return null;
  if (c.state === 'IDENTIFYING' && c.pendingQuestion) return null; // waiting for the user, not for a dead job
  const from = c.state;
  const reasons: Partial<Record<CaseState, string>> = {
    FILLING: 'server restarted during FILLING — nothing was submitted; safe to retry',
    SUBMITTING: 'server restarted during submission — must reconcile before any retry',
    VERIFYING: 'server restarted during verification — must reconcile before any retry',
    APPROVED: 'server restarted before the job started — re-approval required',
    DRAFTING: 'server restarted while drafting — please confirm the facts again',
    NEW: 'server restarted before the ticket was read — please start a new case',
    IDENTIFYING: 'server restarted while reading the ticket — please start a new case',
  };
  if (from === 'FILLING')
    c.needsUser = { code: 'RESTARTED', reason: 'Server restarted while filling the form. Nothing was submitted; it is safe to retry.', resumeTo: 'FILLING' };
  if (from === 'APPROVED') c.approval = undefined;
  c.stateHistory.push({ from, to, reason: reasons[from] ?? 'server restarted', actor: 'system', at: now() });
  c.state = to;
  return `${from} → ${to}`;
}
