import { z } from 'zod';
import { ACTORS, CASE_STATES } from './states';
import { DISPUTE_REASON_KEYS, PORTAL_FIELD_IDS } from './portal';

export const CaseStateSchema = z.enum(CASE_STATES);
export const ActorSchema = z.enum(ACTORS);
export const DisputeReasonSchema = z.enum(DISPUTE_REASON_KEYS);

/** Where a fact came from — rendered as a badge next to every value the user approves. */
export const ProvenanceSchema = z.enum(['TICKET_OCR', 'PORTAL_LOOKUP', 'USER_VOICE', 'USER_TEXT', 'PHOTO_EVIDENCE', 'RULE', 'PROFILE']);
export type Provenance = z.infer<typeof ProvenanceSchema>;

/** Only the user can make a fact CONFIRMED. RULE_VERIFIED comes from deterministic rule code. */
export const FactStatusSchema = z.enum(['NEEDS_CONFIRMATION', 'CONFIRMED', 'USER_STATEMENT', 'RULE_VERIFIED', 'UNVERIFIABLE']);
export type FactStatus = z.infer<typeof FactStatusSchema>;

export const FactSchema = z.object({
  id: z.string(),
  key: z.string(),
  label: z.string(),
  value: z.string(),
  provenance: ProvenanceSchema,
  status: FactStatusSchema,
  /** evidence id, or a source URL for RULE facts */
  sourceRef: z.string().optional(),
  note: z.string().optional(),
  updatedAt: z.string(),
});
export type Fact = z.infer<typeof FactSchema>;

export const EvidenceSchema = z.object({
  id: z.string(),
  kind: z.enum(['ticket_photo', 'evidence_photo', 'document', 'audio']),
  filename: z.string(),
  mime: z.string(),
  bytes: z.number(),
  sha256: z.string(),
  url: z.string(),
  submitToPortal: z.boolean(),
  createdAt: z.string(),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

export const ChatMessageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'agent', 'system']),
  text: z.string(),
  textEn: z.string().optional(),
  at: z.string(),
  questionId: z.string().optional(),
  expects: z.enum(['text', 'photo', 'choice', 'yesno']).optional(),
  options: z.array(z.string()).optional(),
  evidenceIds: z.array(z.string()).optional(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const GroundSchema = z.object({ text: z.string(), factIds: z.array(z.string()).min(1) });
export type Ground = z.infer<typeof GroundSchema>;

export const TriageSchema = z.object({
  recommendation: z.enum(['APPEAL', 'PAY']),
  summary: z.string(),
  reasons: z.array(GroundSchema),
  /** APPEAL only: the portal dispute type the writer will use once the facts are confirmed */
  disputeReason: DisputeReasonSchema.optional(),
  fineAmount: z.number().optional(),
  latePenalty: z.number().optional(),
  deadline: z.string().optional(),
});
export type Triage = z.infer<typeof TriageSchema>;

/** Agent paragraphs must cite facts; paragraphs the user wrote themselves may cite none. */
export const DraftParagraphSchema = z.object({
  text: z.string(),
  factIds: z.array(z.string()),
  author: z.enum(['agent', 'user']).optional(),
});
export type DraftParagraph = z.infer<typeof DraftParagraphSchema>;

export const DraftSchema = z.object({
  disputeReason: DisputeReasonSchema,
  paragraphs: z.array(DraftParagraphSchema),
  statementEn: z.string(),
  statementUserLang: z.string(),
  lang: z.string(),
  /** starts at 1; every rewrite or user edit increments it (and changes the approval hash) */
  revision: z.number().int().min(1),
});
export type Draft = z.infer<typeof DraftSchema>;

/** Exactly what will be typed into the portal. This — not abstract "facts" — is what gets hashed and approved. */
export const ApprovalPayloadSchema = z.object({
  v: z.literal(1),
  caseId: z.string(),
  portal: z.object({ id: z.string(), adapterVersion: z.string() }),
  fields: z.record(z.enum(PORTAL_FIELD_IDS), z.string()),
  /** Extra required fields discovered on the portal (label → value), added via NEEDS_USER → re-approval. */
  extra: z.record(z.string(), z.string()),
  evidence: z.array(z.object({ sha256: z.string(), filename: z.string(), mime: z.string(), bytes: z.number() })),
  attestation: z.literal(true),
});
export type ApprovalPayload = z.infer<typeof ApprovalPayloadSchema>;

export const FieldSourceSchema = z.object({
  factId: z.string().optional(),
  provenance: ProvenanceSchema.optional(),
  status: FactStatusSchema.optional(),
});

export const ApprovalPreviewSchema = z.object({
  payload: ApprovalPayloadSchema,
  payloadHash: z.string(),
  unconfirmedFactIds: z.array(z.string()),
  missing: z.array(z.string()),
  statementUserLang: z.string(),
  fieldSources: z.record(z.string(), FieldSourceSchema),
});
export type ApprovalPreview = z.infer<typeof ApprovalPreviewSchema>;

export const ReceiptSchema = z.object({
  confirmationNumber: z.string(),
  source: z.enum(['confirmation_page', 'status_page']),
  at: z.string(),
  alreadyOnFile: z.boolean().optional(),
  emailVerified: z.boolean().optional(),
});
export type Receipt = z.infer<typeof ReceiptSchema>;

export const MetricsSchema = z.object({
  llmCalls: z.number(),
  tokensIn: z.number(),
  tokensOut: z.number(),
  costUsd: z.number(),
  cuSteps: z.number(),
  userActiveMs: z.number(),
  agentMs: z.number(),
  execMs: z.number(),
  questionsAsked: z.number(),
  tiers: z.record(z.string(), z.number()),
});
export type Metrics = z.infer<typeof MetricsSchema>;

export const NeedsUserSchema = z.object({
  code: z.string(),
  reason: z.string(),
  resumeTo: CaseStateSchema.optional(),
  field: z.string().optional(),
});
export type NeedsUser = z.infer<typeof NeedsUserSchema>;

export const StateHistoryEntrySchema = z.object({
  from: CaseStateSchema,
  to: CaseStateSchema,
  reason: z.string(),
  actor: ActorSchema,
  at: z.string(),
});
export type StateHistoryEntry = z.infer<typeof StateHistoryEntrySchema>;

// ------------------------------------------------------------------ v2: accounts, tickets, audit

export const PERSONA_IDS = ['lin', 'maria', 'sam'] as const;
export const PersonaIdSchema = z.enum(PERSONA_IDS);
export type PersonaId = z.infer<typeof PersonaIdSchema>;

export const VehicleSchema = z.object({
  id: z.string(),
  plate: z.string().min(1).max(10),
  state: z.string().length(2).or(z.literal('OTHER')),
  make: z.string().optional(),
  color: z.string().optional(),
  nickname: z.string().optional(),
  isDefault: z.boolean(),
});
export type Vehicle = z.infer<typeof VehicleSchema>;

export const UserSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  name: z.string(),
  mailingAddress: z.string(),
  email: z.string(),
  lang: z.string(),
  vehicles: z.array(VehicleSchema),
  persona: PersonaIdSchema.optional(),
});
export type User = z.infer<typeof UserSchema>;

export const TicketStatusSchema = z.enum(['OPEN', 'PAID', 'APPEALED']);
export const TicketInfoSchema = z.object({
  ticketNumber: z.string(),
  plate: z.string(),
  state: z.string(),
  violation: z.string(),
  /** ISO 8601 with offset */
  issuedAt: z.string(),
  location: z.string(),
  fine: z.number().optional(),
  status: TicketStatusSchema.optional(),
  source: z.enum(['TICKET_OCR', 'PORTAL_LOOKUP']),
});
export type TicketInfo = z.infer<typeof TicketInfoSchema>;

/** Append-only, hash-chained: hash = sha256(prevHash + canonical(event without hash)). */
export const AuditEventSchema = z.object({
  seq: z.number().int().min(1),
  caseId: z.string(),
  at: z.string(),
  type: z.string(),
  actor: ActorSchema.optional(),
  data: z.unknown(),
  prevHash: z.string(),
  hash: z.string(),
});
export type AuditEvent = z.infer<typeof AuditEventSchema>;

export const CaseViewSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  state: CaseStateSchema,
  lang: z.string(),
  userId: z.string().optional(),
  ticket: TicketInfoSchema.optional(),
  /** read-only portal lookup results waiting for the user's choice (mode=lookup) */
  lookupResults: z.array(TicketInfoSchema).optional(),
  playbookId: z.string().optional(),
  violationType: z.string().optional(),
  facts: z.array(FactSchema),
  evidence: z.array(EvidenceSchema),
  messages: z.array(ChatMessageSchema),
  pendingQuestion: ChatMessageSchema.optional(),
  triage: TriageSchema.optional(),
  draft: DraftSchema.optional(),
  preview: ApprovalPreviewSchema.optional(),
  approvedPayloadHash: z.string().optional(),
  receipt: ReceiptSchema.optional(),
  needsUser: NeedsUserSchema.optional(),
  manualPack: z.array(z.object({ label: z.string(), value: z.string() })).optional(),
  metrics: MetricsSchema,
  stateHistory: z.array(StateHistoryEntrySchema),
});
export type CaseView = z.infer<typeof CaseViewSchema>;
