import type { Content } from '@google/genai';
import type { Actor, CaseState, ChatMessage, Draft, Evidence, Fact, Metrics, NeedsUser, Receipt, TicketInfo, Triage } from '@appealhero/shared';
import type { ViolationType } from '../agent/rules/boston';

export interface EvidenceRecord extends Evidence {
  /** absolute path on disk — never sent to clients */
  path: string;
}

export interface ApprovalRecord {
  token: string;
  payloadHash: string;
  issuedAt: string;
  expiresAt: string;
  /** submit attempts made under this approval (max 2; the 2nd only after the status page proved attempt 1 was not filed) */
  attempts: number;
  lastReconcile?: 'FOUND' | 'NOT_FOUND';
}

export interface TicketExtraction {
  ticketNumber: string;
  plateNumber: string;
  plateState: string;
  violationDescription: string;
  issuedAt: string;
  location: string;
  fineAmount?: number;
  confidence: number;
  userStatement?: { original: string; language: string; english: string };
}

export interface CaseRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  state: CaseState;
  lang: string;
  /** v2: owner account (WP1) */
  userId?: string;
  /** v2: the ticket as identified (OCR or portal lookup) */
  ticket?: TicketInfo;
  /** v2: matched playbook id, e.g. 'boston.meter' (WP4) */
  playbookId?: string;
  violationType?: ViolationType;
  extraction?: TicketExtraction;
  facts: Fact[];
  evidence: EvidenceRecord[];
  messages: ChatMessage[];
  pendingQuestion?: ChatMessage;
  triage?: Triage;
  draft?: Draft;
  approval?: ApprovalRecord;
  /** write-ahead record of the latest submit attempt (persisted before the click) */
  submission?: { attemptId: string; payloadHash: string; startedAt: string };
  /** the user explicitly chose "appeal anyway" after an honest PAY recommendation */
  appealAnyway?: boolean;
  receipt?: Receipt;
  needsUser?: NeedsUser;
  metrics: Metrics;
  stateHistory: { from: CaseState; to: CaseState; reason: string; actor: Actor; at: string }[];
  /** Gemini conversation (kept verbatim so Gemini 3 thought signatures are returned intact) */
  llm: { contents: Content[] };
  /** memory for the scripted fake agent */
  fake: { analyzed: string[]; awaiting?: string };
}
