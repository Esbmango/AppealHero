/**
 * Ticket-type playbooks (docs/PLAYBOOKS.md §1). Types only — implementations live in
 * apps/server/src/agent/playbooks/<city>/<id>.ts (WP4). The same playbook drives both the
 * Gemini driver (rendered into the prompt, then used to validate propose_outcome) and the fake driver.
 */
import type { DisputeReason } from './portal';
import type { Evidence, Fact, TicketInfo, Vehicle } from './schemas';

export type PlaybookLang = 'zh' | 'es' | 'en';
export type L10n = Record<PlaybookLang, string>;
export type Verdict = 'yes' | 'no' | 'unknown';
export type FactKey = string;
export type RuleId = string;

/** What analyze_evidence should extract from a photo (WP3 implements each target). */
export const EVIDENCE_TARGETS = [
  'receipt_paid_until',
  'sign',
  'permit_sticker',
  'placard',
  'hydrant_distance',
  'temp_sign',
  'vehicle',
  'general',
] as const;
export type EvidenceTarget = (typeof EVIDENCE_TARGETS)[number];

export interface RuleResult {
  result: 'PASS' | 'FAIL' | 'UNKNOWN' | string | boolean;
  detail: string;
  source?: string;
}

export interface PlaybookCtx {
  ticket?: TicketInfo;
  facts: ReadonlyMap<FactKey, Fact>;
  rules: ReadonlyMap<RuleId, RuleResult>;
  evidence: readonly Evidence[];
  vehicles: readonly Vehicle[];
  /** questionId → the user's answer */
  answers: Readonly<Record<string, string>>;
}

export interface Question {
  id: string;
  /** false = already known or irrelevant → skip */
  askIf: (c: PlaybookCtx) => boolean;
  expects: 'yesno' | 'choice' | 'photo' | 'text';
  options?: { value: string; label: L10n }[];
  /** used verbatim by the fake driver; reference wording for Gemini */
  text: L10n;
  /** shown to the user: why we ask */
  why: L10n;
  /** which fact the answer is recorded as */
  records: FactKey;
  evidenceTarget?: EvidenceTarget;
}

export interface Defense {
  id: string;
  reason: DisputeReason;
  /** rule = asserts an official rule (must be verified) · evidence/statement = states facts only, no legal claims */
  basis: 'rule' | 'evidence' | 'statement';
  verified: boolean;
  /** official source URL (+ section) */
  source?: string;
  holds: (c: PlaybookCtx) => Verdict;
  /** facts the draft must cite */
  needs: FactKey[];
  explain: L10n;
  /** English hint for the writer — factual wording only */
  draftHint: string;
}

export interface PayAdvice {
  fine: number;
  late: number;
  /** ISO date */
  deadline: string;
  why: L10n;
}

export interface Playbook {
  /** e.g. 'boston.meter' */
  id: string;
  /** bump on any change; recorded in the audit log */
  version: string;
  title: L10n;
  match: (violation: string) => boolean;
  fines: { violation: string; fine: number; late: number }[];
  /** run as soon as the case enters INVESTIGATING */
  autoRules: RuleId[];
  /** in order; the ideal path asks at most 3 */
  questions: Question[];
  /** in priority order */
  defenses: Defense[];
  /** honest "pay instead" advice when no defense holds */
  recommendPay: (c: PlaybookCtx) => PayAdvice | null;
  notes?: { when: (c: PlaybookCtx) => boolean; text: L10n }[];
}

export interface RuleDef<I = Record<string, unknown>> {
  id: RuleId;
  verified: boolean;
  source: string;
  /** YYYY-MM-DD the source was last read */
  checkedAt: string;
  run: (input: I) => RuleResult;
}

export const definePlaybook = (p: Playbook): Playbook => p;
export const defineRule = <I>(r: RuleDef<I>): RuleDef<I> => r;
