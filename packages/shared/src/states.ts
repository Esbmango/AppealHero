/**
 * Case lifecycle. The state machine is owned by code — the LLM can only *propose*
 * transitions inside the investigation phase (see AGENT_ALLOWED).
 */
export const CASE_STATES = [
  'NEW',
  'EXTRACTED',
  'INVESTIGATING',
  'READY_FOR_REVIEW',
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
export type Actor = 'system' | 'agent' | 'user' | 'approval' | 'executor';

export const TRANSITIONS: Readonly<Record<CaseState, readonly CaseState[]>> = {
  NEW: ['EXTRACTED', 'FAILED'],
  EXTRACTED: ['INVESTIGATING', 'FAILED'],
  INVESTIGATING: ['READY_FOR_REVIEW', 'CLOSED_NO_APPEAL', 'FAILED'],
  READY_FOR_REVIEW: ['APPROVED', 'INVESTIGATING', 'CLOSED_NO_APPEAL'],
  APPROVED: ['FILLING', 'READY_FOR_REVIEW'],
  // FILLING → SUBMITTED only when the duplicate pre-check finds an appeal already on file.
  FILLING: ['SUBMITTING', 'SUBMITTED', 'NEEDS_USER', 'BLOCKED', 'READY_FOR_REVIEW', 'FAILED'],
  // A submit attempt is either confirmed or unknown — never "failed" without reconciliation.
  SUBMITTING: ['VERIFYING', 'UNKNOWN_RESULT'],
  VERIFYING: ['SUBMITTED', 'UNKNOWN_RESULT'],
  // UNKNOWN_RESULT → FILLING only after the status page proves nothing was filed.
  UNKNOWN_RESULT: ['SUBMITTED', 'FILLING', 'NEEDS_USER'],
  NEEDS_USER: ['FILLING', 'READY_FOR_REVIEW', 'INVESTIGATING', 'CLOSED_NO_APPEAL'],
  BLOCKED: ['FILLING', 'READY_FOR_REVIEW', 'CLOSED_NO_APPEAL'],
  SUBMITTED: [],
  FAILED: [],
  // Negative triage: the user accepted "pay instead". They can still change their mind.
  CLOSED_NO_APPEAL: ['INVESTIGATING'],
};

/** Transitions only specific actors may perform. Unlisted transitions: any actor except 'agent'. */
const RESTRICTED: Readonly<Record<string, readonly Actor[]>> = {
  'READY_FOR_REVIEW>APPROVED': ['approval'],
  'APPROVED>FILLING': ['executor'],
  'NEEDS_USER>FILLING': ['executor'],
  'BLOCKED>FILLING': ['executor'],
  'UNKNOWN_RESULT>FILLING': ['executor'],
  'FILLING>SUBMITTING': ['executor'],
  'FILLING>SUBMITTED': ['executor'],
  'SUBMITTING>VERIFYING': ['executor'],
  'SUBMITTING>UNKNOWN_RESULT': ['executor', 'system'],
  'VERIFYING>SUBMITTED': ['executor'],
  'VERIFYING>UNKNOWN_RESULT': ['executor', 'system'],
  'UNKNOWN_RESULT>SUBMITTED': ['executor'],
  'INVESTIGATING>CLOSED_NO_APPEAL': ['user'],
  'READY_FOR_REVIEW>CLOSED_NO_APPEAL': ['user'],
  'NEEDS_USER>CLOSED_NO_APPEAL': ['user'],
  'BLOCKED>CLOSED_NO_APPEAL': ['user'],
  'CLOSED_NO_APPEAL>INVESTIGATING': ['user'],
};

/** The LLM agent may only move a case through the investigation phase. */
const AGENT_ALLOWED: ReadonlySet<string> = new Set(['EXTRACTED>INVESTIGATING', 'INVESTIGATING>READY_FOR_REVIEW']);

export type TransitionCheck = { ok: true } | { ok: false; reason: string };

export function checkTransition(from: CaseState, to: CaseState, actor: Actor): TransitionCheck {
  if (!TRANSITIONS[from].includes(to)) return { ok: false, reason: `illegal transition ${from} → ${to}` };
  const key = `${from}>${to}`;
  if (actor === 'agent' && !AGENT_ALLOWED.has(key)) return { ok: false, reason: `the agent may not perform ${key}` };
  const allowed = RESTRICTED[key];
  if (allowed && !allowed.includes(actor)) return { ok: false, reason: `${actor} may not perform ${key}` };
  return { ok: true };
}

/** States in which the browser executor owns the case (no user edits allowed). */
export const EXECUTION_STATES: readonly CaseState[] = ['APPROVED', 'FILLING', 'SUBMITTING', 'VERIFYING'];
export const isExecuting = (s: CaseState) => EXECUTION_STATES.includes(s);
export const TERMINAL_STATES: readonly CaseState[] = ['SUBMITTED', 'FAILED'];
