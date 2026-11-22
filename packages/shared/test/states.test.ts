import { describe, expect, it } from 'vitest';
import { ACTORS, AGENT_TRANSITIONS, CASE_STATES, RECOVERY, TRANSITIONS, TRANSITION_TABLE, canonicalize, checkTransition } from '../src';

describe('state machine v2', () => {
  it('every transition target is a known state and every row lists at least one actor', () => {
    for (const from of CASE_STATES) for (const to of TRANSITIONS[from]) expect(CASE_STATES).toContain(to);
    for (const [, , actors] of TRANSITION_TABLE) expect(actors.length).toBeGreaterThan(0);
    const keys = TRANSITION_TABLE.map(([f, t]) => `${f}>${t}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('only the approval gate can approve, and only from statement review', () => {
    expect(checkTransition('STATEMENT_REVIEW', 'APPROVED', 'approval').ok).toBe(true);
    for (const actor of ACTORS.filter((a) => a !== 'approval')) expect(checkTransition('STATEMENT_REVIEW', 'APPROVED', actor).ok).toBe(false);
    for (const from of CASE_STATES.filter((s) => s !== 'STATEMENT_REVIEW')) expect(checkTransition(from, 'APPROVED', 'approval').ok).toBe(false);
  });

  it('gate 1: only the user can move confirmed facts into drafting', () => {
    expect(checkTransition('FACTS_REVIEW', 'DRAFTING', 'user').ok).toBe(true);
    for (const actor of ACTORS.filter((a) => a !== 'user')) expect(checkTransition('FACTS_REVIEW', 'DRAFTING', actor).ok).toBe(false);
    expect(checkTransition('INVESTIGATING', 'DRAFTING', 'agent').ok).toBe(false);
  });

  it('only the executor can submit, and never straight from review', () => {
    expect(checkTransition('FILLING', 'SUBMITTING', 'executor').ok).toBe(true);
    expect(checkTransition('FILLING', 'SUBMITTING', 'agent').ok).toBe(false);
    expect(checkTransition('STATEMENT_REVIEW', 'SUBMITTING', 'executor').ok).toBe(false);
    expect(checkTransition('INVESTIGATING', 'SUBMITTING', 'executor').ok).toBe(false);
  });

  it('the agent is confined to identification and investigation', () => {
    expect([...AGENT_TRANSITIONS].sort()).toEqual(['IDENTIFYING>INVESTIGATING', 'INVESTIGATING>FACTS_REVIEW']);
    expect(checkTransition('INVESTIGATING', 'CLOSED_NO_APPEAL', 'agent').ok).toBe(false); // the user decides
    expect(checkTransition('APPROVED', 'FILLING', 'agent').ok).toBe(false);
  });

  it('an unknown submit result can only become SUBMITTED, a proven-safe retry, or a human handoff', () => {
    expect(TRANSITIONS.UNKNOWN_RESULT).toEqual(['SUBMITTED', 'FILLING', 'NEEDS_USER']);
    expect(TRANSITIONS.SUBMITTING).not.toContain('FAILED');
  });

  it('SUBMITTED and FAILED are terminal', () => {
    expect(TRANSITIONS.SUBMITTED).toEqual([]);
    expect(TRANSITIONS.FAILED).toEqual([]);
  });

  it('crash recovery never resumes into execution or a submit', () => {
    expect(RECOVERY.SUBMITTING).toBe('UNKNOWN_RESULT');
    expect(RECOVERY.VERIFYING).toBe('UNKNOWN_RESULT');
    expect(RECOVERY.FILLING).toBe('NEEDS_USER');
    expect(RECOVERY.APPROVED).toBe('STATEMENT_REVIEW');
    expect(RECOVERY.DRAFTING).toBe('FACTS_REVIEW');
    for (const to of Object.values(RECOVERY)) expect(['APPROVED', 'FILLING', 'SUBMITTING', 'VERIFYING']).not.toContain(to);
  });
});

describe('canonicalize', () => {
  it('is independent of key order, CRLF and Unicode composition', () => {
    const a = canonicalize({ b: 'x\r\ny ', a: 'Café' });
    const b = canonicalize({ a: 'Café', b: 'x\ny' });
    expect(a).toBe(b);
  });
  it('drops undefined keys', () => {
    expect(canonicalize({ a: 1, b: undefined })).toBe('{"a":1}');
  });
});
