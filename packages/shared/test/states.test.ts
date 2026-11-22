import { describe, expect, it } from 'vitest';
import { CASE_STATES, TRANSITIONS, canonicalize, checkTransition } from '../src';

describe('state machine', () => {
  it('every transition target is a known state', () => {
    for (const from of CASE_STATES) for (const to of TRANSITIONS[from]) expect(CASE_STATES).toContain(to);
  });

  it('only the approval gate can approve', () => {
    expect(checkTransition('READY_FOR_REVIEW', 'APPROVED', 'approval').ok).toBe(true);
    for (const actor of ['agent', 'user', 'system', 'executor'] as const) {
      expect(checkTransition('READY_FOR_REVIEW', 'APPROVED', actor).ok).toBe(false);
    }
  });

  it('only the executor can submit, and never straight from review', () => {
    expect(checkTransition('FILLING', 'SUBMITTING', 'executor').ok).toBe(true);
    expect(checkTransition('FILLING', 'SUBMITTING', 'agent').ok).toBe(false);
    expect(checkTransition('READY_FOR_REVIEW', 'SUBMITTING', 'executor').ok).toBe(false);
    expect(checkTransition('INVESTIGATING', 'SUBMITTING', 'executor').ok).toBe(false);
  });

  it('the agent is confined to the investigation phase', () => {
    expect(checkTransition('INVESTIGATING', 'READY_FOR_REVIEW', 'agent').ok).toBe(true);
    expect(checkTransition('INVESTIGATING', 'CLOSED_NO_APPEAL', 'agent').ok).toBe(false); // user decides
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
});

describe('canonicalize', () => {
  it('is independent of key order, CRLF and Unicode composition', () => {
    const a = canonicalize({ b: 'x\r\ny ', a: 'Café' });
    const b = canonicalize({ a: 'Café', b: 'x\ny' });
    expect(a).toBe(b);
  });
  it('drops undefined keys', () => {
    expect(canonicalize({ a: 1, b: undefined })).toBe('{"a":1}');
  });
});
