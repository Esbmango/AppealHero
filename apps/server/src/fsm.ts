import { checkTransition, type Actor, type CaseState } from '@appealhero/shared';
import type { Ctx } from './ctx';
import type { CaseRecord } from './types';
import { now } from './util';

export class TransitionError extends Error {}

/**
 * The ONLY way to change a case's state. Checks the transition table and the actor rules
 * (only 'approval' can approve, only 'executor' can submit, the agent is confined to investigation).
 */
export function transition(
  ctx: Ctx,
  caseId: string,
  to: CaseState,
  actor: Actor,
  reason: string,
  patch?: (c: CaseRecord) => void,
): CaseRecord {
  const from = ctx.store.must(caseId).state;
  const check = checkTransition(from, to, actor);
  if (!check.ok) throw new TransitionError(check.reason);
  const c = ctx.store.mutate(caseId, (r) => {
    r.state = to;
    r.stateHistory.push({ from, to, reason, actor, at: now() });
    if (from === 'NEEDS_USER' || from === 'BLOCKED') r.needsUser = undefined;
    patch?.(r);
  });
  ctx.hub.emit({ type: 'state.changed', caseId, from, to, reason, actor });
  if (c.needsUser && (to === 'NEEDS_USER' || to === 'BLOCKED')) ctx.hub.emit({ type: 'needs_user', caseId, needsUser: c.needsUser });
  return c;
}
