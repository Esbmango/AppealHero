/**
 * Case lifecycle (v2). The state machine is owned by code — the LLM can only *propose*
 * moves inside identification/investigation (actor 'agent'), and only the user can pass
 * the two confirmation gates (facts → drafting, statement → approval via the signed approval gate).
 *
 * TRANSITION_TABLE is the single source of truth. docs/ARCHITECTURE.md §1 is generated from it
 * (`npm run docs:fsm -- --write`) and checked in CI (`npm run docs:fsm -- --check`).
 */
export const CASE_STATES = [
  'NEW',
  'IDENTIFYING',
  'INVESTIGATING',
  'FACTS_REVIEW',
  'DRAFTING',
  'STATEMENT_REVIEW',
  'APPROVED',
  'FILLING',
  'SUBMITTING',
  'VERIFYING',
  'SUBMITTED',
  'NEEDS_USER',
  'BLOCKED',
  'UNKNOWN_RESULT',
  'FAILED',
  'CLOSED_NO_APPEAL',
] as const;
export type CaseState = (typeof CASE_STATES)[number];

/** Who is asking for a transition. */
export const ACTORS = ['system', 'agent', 'user', 'approval', 'executor'] as const;
export type Actor = (typeof ACTORS)[number];

type Row = readonly [from: CaseState, to: CaseState, actors: readonly Actor[], note?: string];

/** Every legal transition and exactly who may perform it (default deny). */
export const TRANSITION_TABLE: readonly Row[] = [
  ['NEW', 'IDENTIFYING', ['system']],
  ['NEW', 'FAILED', ['system']],
  ['IDENTIFYING', 'INVESTIGATING', ['system', 'agent'], 'ticket identified'],
  ['IDENTIFYING', 'FAILED', ['system']],
  ['INVESTIGATING', 'FACTS_REVIEW', ['agent', 'system'], 'agent proposes an appeal; code checks required facts'],
  ['INVESTIGATING', 'CLOSED_NO_APPEAL', ['user'], 'user accepts the recommendation to pay'],
  ['INVESTIGATING', 'FAILED', ['system']],
  ['FACTS_REVIEW', 'DRAFTING', ['user'], 'gate 1: the user confirmed every fact'],
  ['FACTS_REVIEW', 'INVESTIGATING', ['user'], 'user adds information'],
  ['FACTS_REVIEW', 'CLOSED_NO_APPEAL', ['user']],
  ['DRAFTING', 'STATEMENT_REVIEW', ['system'], 'writer finished'],
  ['DRAFTING', 'FACTS_REVIEW', ['system'], 'writer failed'],
  ['STATEMENT_REVIEW', 'FACTS_REVIEW', ['user'], 'user changes a fact or asks for a revision: back through gate 1'],
  ['STATEMENT_REVIEW', 'APPROVED', ['approval'], 'gate 2: signed approval of the exact payload'],
  ['STATEMENT_REVIEW', 'CLOSED_NO_APPEAL', ['user']],
  ['APPROVED', 'FILLING', ['executor']],
  ['APPROVED', 'STATEMENT_REVIEW', ['system'], 'approval token invalid'],
  ['FILLING', 'SUBMITTING', ['executor'], 'read-back hash equals the approved hash'],
  ['FILLING', 'SUBMITTED', ['executor'], 'an appeal is already on file'],
  ['FILLING', 'NEEDS_USER', ['executor', 'system']],
  ['FILLING', 'BLOCKED', ['executor'], 'human verification'],
  ['FILLING', 'STATEMENT_REVIEW', ['executor', 'system']],
  ['FILLING', 'FAILED', ['executor', 'system']],
  ['SUBMITTING', 'VERIFYING', ['executor']],
  ['SUBMITTING', 'UNKNOWN_RESULT', ['executor', 'system'], 'timeout or crash after the click'],
  ['VERIFYING', 'SUBMITTED', ['executor']],
  ['VERIFYING', 'UNKNOWN_RESULT', ['executor', 'system']],
  ['UNKNOWN_RESULT', 'SUBMITTED', ['executor'], 'status page shows the appeal'],
  ['UNKNOWN_RESULT', 'FILLING', ['executor'], 'status page proves nothing was filed; one retry'],
  ['UNKNOWN_RESULT', 'NEEDS_USER', ['executor', 'system']],
  ['NEEDS_USER', 'FILLING', ['executor']],
  ['NEEDS_USER', 'SUBMITTED', ['executor'], 'status page shows the appeal after a pause'],
  ['NEEDS_USER', 'STATEMENT_REVIEW', ['user', 'system']],
  ['NEEDS_USER', 'FACTS_REVIEW', ['user']],
  ['NEEDS_USER', 'INVESTIGATING', ['user']],
  ['NEEDS_USER', 'CLOSED_NO_APPEAL', ['user']],
  ['BLOCKED', 'FILLING', ['executor']],
  ['BLOCKED', 'STATEMENT_REVIEW', ['user', 'system']],
  ['BLOCKED', 'CLOSED_NO_APPEAL', ['user']],
  ['CLOSED_NO_APPEAL', 'INVESTIGATING', ['user'], 'user reopens the case'],
];

const key = (from: CaseState, to: CaseState) => `${from}>${to}`;
const ACTORS_BY_KEY: ReadonlyMap<string, readonly Actor[]> = new Map(TRANSITION_TABLE.map(([f, t, a]) => [key(f, t), a]));

export const TRANSITIONS: Readonly<Record<CaseState, readonly CaseState[]>> = Object.fromEntries(
  CASE_STATES.map((s) => [s, TRANSITION_TABLE.filter(([f]) => f === s).map(([, t]) => t)]),
) as unknown as Record<CaseState, readonly CaseState[]>;

/** The LLM agent may only perform these (derived from the table, for tests and docs). */
export const AGENT_TRANSITIONS: readonly string[] = TRANSITION_TABLE.filter(([, , a]) => a.includes('agent')).map(([f, t]) => key(f, t));

export type TransitionCheck = { ok: true } | { ok: false; reason: string };

export function checkTransition(from: CaseState, to: CaseState, actor: Actor): TransitionCheck {
  const allowed = ACTORS_BY_KEY.get(key(from, to));
  if (!allowed) return { ok: false, reason: `illegal transition ${from} → ${to}` };
  if (!allowed.includes(actor)) return { ok: false, reason: `${actor} may not perform ${from} → ${to}` };
  return { ok: true };
}

export const allowedActors = (from: CaseState, to: CaseState): readonly Actor[] => ACTORS_BY_KEY.get(key(from, to)) ?? [];

/** States in which the browser executor owns the case (no user edits allowed). */
export const EXECUTION_STATES: readonly CaseState[] = ['APPROVED', 'FILLING', 'SUBMITTING', 'VERIFYING'];
export const isExecuting = (s: CaseState) => EXECUTION_STATES.includes(s);
export const TERMINAL_STATES: readonly CaseState[] = ['SUBMITTED', 'FAILED'];
/** States where the agent loop may run (tools are offered only here). */
export const AGENT_STATES: readonly CaseState[] = ['IDENTIFYING', 'INVESTIGATING'];

/**
 * Where an interrupted case goes when the server restarts (crash, or `tsx watch` reloading on save).
 * FILLING: nothing submitted yet → safe to retry · SUBMITTING/VERIFYING: the click may have gone through → reconcile first
 * APPROVED: job never started, secret may have rotated → re-approve · DRAFTING: writer died → confirm facts again
 * IDENTIFYING: only when no question is pending (the extraction job died) → FAILED.
 */
export const RECOVERY: Readonly<Partial<Record<CaseState, CaseState>>> = {
  FILLING: 'NEEDS_USER',
  SUBMITTING: 'UNKNOWN_RESULT',
  VERIFYING: 'UNKNOWN_RESULT',
  APPROVED: 'STATEMENT_REVIEW',
  DRAFTING: 'FACTS_REVIEW',
  NEW: 'FAILED',
  IDENTIFYING: 'FAILED',
};
