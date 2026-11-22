import { z } from 'zod';
import { ApprovalPayloadSchema, CaseStateSchema, PersonaIdSchema, ReceiptSchema, TicketInfoSchema, UserSchema, VehicleSchema } from './schemas';
import { TierSchema } from './events';

/**
 * The 5 frozen endpoints (paths never change; payloads only grow additively). jobId === caseId.
 * Helpers that are NOT frozen: GET /api/cases, GET /api/cases/:id, POST /api/cases/:id/facts/confirm,
 * POST /api/cases/:id/decision, /api/demo/*, GET /api/stream (all cases), /api/files/*, /api/shots/*, GET /api/health.
 */
export const FROZEN_API = {
  createCase: 'POST /api/cases', // multipart, see CreateCaseFieldsSchema; v2: ticket photo(s) optional when mode=lookup|chat
  postMessage: 'POST /api/cases/:id/messages', // multipart: text?, audio? (wav), images* (files), activeMs?
  approve: 'POST /api/cases/:id/approve', // json: { payloadHash, activeMs? } — v2: only valid in STATEMENT_REVIEW
  stream: 'GET /api/cases/:id/stream', // SSE, supports Last-Event-ID replay
  resume: 'POST /api/jobs/:id/resume', // json: { action, field?, value? }
} as const;

/** v2 endpoints, frozen once WP0 is merged (tag contracts-v2). Owners: see docs/TASKS.md §4. */
export const V2_API = {
  me: 'GET /api/me', // WP1 — creates the user + session cookie on first call
  updateMe: 'PUT /api/me', // WP1
  addVehicle: 'POST /api/me/vehicles', // WP1
  deleteVehicle: 'DELETE /api/me/vehicles/:id', // WP1
  persona: 'POST /api/session/persona', // WP1
  confirmFacts: 'POST /api/cases/:id/facts/confirm', // WP0 — { confirm, edits, done }
  editStatement: 'PUT /api/cases/:id/statement', // WP0 contract, WP5 implementation
  selectTicket: 'POST /api/cases/:id/select-ticket', // A4 — { ticketNumber } chosen from lookupResults
  decision: 'POST /api/cases/:id/decision', // existing
  proof: 'GET /api/cases/:id/proof', // WP8
  trace: 'GET /api/cases/:id/trace', // WP8
  statusCheck: 'POST /api/cases/:id/status-check', // WP8
} as const;

export const CASE_MODES = ['photo', 'lookup', 'chat'] as const;
export const CaseModeSchema = z.enum(CASE_MODES);

/** Multipart text fields of POST /api/cases (files: ticket* (1–3 photos), audio?). All optional and additive. */
export const CreateCaseFieldsSchema = z.object({
  mode: CaseModeSchema.optional(), // default 'photo' when a ticket photo is attached, else 'chat'
  ticketNumber: z
    .string()
    .regex(/^\d{6,12}$/)
    .optional(), // lookup by ticket number
  vehicleId: z.string().optional(), // lookup by a saved vehicle (MA plates only — see PLAYBOOKS §8)
  plate: z.string().max(10).optional(), // lookup by plate (Demo Mode: the persona's plate) — MA plates only
  plateState: z.string().max(5).optional(),
  text: z.string().max(4000).optional(),
  lang: z.string().optional(),
  circumstances: z.string().optional(), // comma-separated CircumstanceChoice ids; empty means skip
  profileName: z.string().optional(), // v0.2 compatibility; v2 reads the profile from the account
  profileAddress: z.string().optional(),
  profileEmail: z.string().optional(),
  activeMs: z.coerce.number().optional(),
});
export type CreateCaseFields = z.infer<typeof CreateCaseFieldsSchema>;

export const CreateCaseResponseSchema = z.object({ caseId: z.string(), jobId: z.string() });

export const ApproveRequestSchema = z.object({
  payloadHash: z.string().regex(/^[0-9a-f]{64}$/),
  /** optional, additive: ms the user spent on the review screen (for the "time saved" metric) */
  activeMs: z.number().int().min(0).max(600_000).optional(),
});
export const ApproveResponseSchema = z.object({ jobId: z.string(), state: CaseStateSchema, idempotent: z.boolean() });

export const ResumeRequestSchema = z.object({
  /** retry: rerun with the same approval (only if payload unchanged and nothing was submitted)
   *  reconcile: re-check the portal status page (UNKNOWN_RESULT)
   *  back_to_review: discard the approval and return to statement review
   *  provide_info: answer a MISSING_FIELD → payload changes → re-approval required */
  action: z.enum(['retry', 'reconcile', 'back_to_review', 'provide_info']).default('retry'),
  field: z.string().optional(),
  value: z.string().optional(),
});
export type ResumeRequest = z.infer<typeof ResumeRequestSchema>;

/** Gate 1. Only this endpoint can make a fact CONFIRMED. done=true moves FACTS_REVIEW → DRAFTING (422 if anything is still pending). */
export const ConfirmFactsRequestSchema = z.object({
  confirm: z.array(z.string()).default([]),
  edits: z.array(z.object({ id: z.string(), value: z.string().min(1) })).default([]),
  done: z.boolean().default(false),
});
export type ConfirmFactsRequest = z.infer<typeof ConfirmFactsRequestSchema>;

export const DecisionRequestSchema = z.object({ choice: z.enum(['accept_pay', 'appeal_anyway']) });

/** Read-only simulated-portal search. */
export const TicketQuerySchema = z.union([
  z.object({
    ticketNumber: z
      .string()
      .trim()
      .regex(/^\d{6,12}$/),
  }),
  z.object({
    plate: z.string().trim().min(1).max(10),
    state: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{2}$/)
      .toUpperCase(),
  }),
]);
export type TicketQuery = z.infer<typeof TicketQuerySchema>;

/** After a read-only portal lookup, the user picks one of case.lookupResults. */
export const SelectTicketRequestSchema = z.object({ ticketNumber: z.string().regex(/^\d{6,12}$/) });

/** The user edits the statement directly. Unchanged paragraphs keep their citations; changed ones become author 'user'. */
export const StatementEditRequestSchema = z.object({
  paragraphs: z
    .array(z.object({ text: z.string().trim().min(1).max(2000), factIds: z.array(z.string()).default([]) }))
    .min(1)
    .max(12),
});
export type StatementEditRequest = z.infer<typeof StatementEditRequestSchema>;

// ---------------------------------------------------------------- accounts (WP1)
export const MeResponseSchema = UserSchema;
export const UpdateMeRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    mailingAddress: z.string().trim().min(1).max(200),
    email: z.email().max(120),
    lang: z.string().min(2).max(5),
  })
  .partial();
export const AddVehicleRequestSchema = VehicleSchema.omit({ id: true, isDefault: true }).extend({ isDefault: z.boolean().optional() });
export const PersonaRequestSchema = z.object({ persona: PersonaIdSchema });

// ---------------------------------------------------------------- proof & status (WP8)
export const StatusCheckResponseSchema = z.object({
  found: z.boolean(),
  confirmationNumber: z.string().optional(),
  checkedAt: z.string(),
});
export const ProofStepSchema = z.object({
  at: z.string(),
  step: z.string(),
  status: z.enum(['start', 'ok', 'fail', 'blocked', 'info']),
  tier: TierSchema.optional(),
  detail: z.string().optional(),
  screenshotUrl: z.string().optional(),
});
export const ProofResponseSchema = z.object({
  caseId: z.string(),
  state: CaseStateSchema,
  ticket: TicketInfoSchema.optional(),
  approvedPayload: ApprovalPayloadSchema.optional(),
  approvedPayloadHash: z.string().optional(),
  statementUserLang: z.string().optional(),
  readbackHash: z.string().optional(),
  readbackMatches: z.boolean().optional(),
  steps: z.array(ProofStepSchema),
  receipt: ReceiptSchema.optional(),
  auditHead: z.string().optional(),
  auditCount: z.number().int().optional(),
  traceUrl: z.string().optional(),
});
export type ProofResponse = z.infer<typeof ProofResponseSchema>;

// ---------------------------------------------------------------- simulated portal scenarios
export const SCENARIOS = [
  'normal',
  'redesign',
  'submit_timeout_after_record',
  'submit_timeout_before_record',
  'captcha',
  'missing_field',
  // v2 (WP7 implements; until then they behave like 'normal')
  'session_expired',
  'upload_rejected',
  'injection',
] as const;
export const ScenarioSchema = z.enum(SCENARIOS);
export type Scenario = z.infer<typeof ScenarioSchema>;
export const SCENARIO_LABELS: Record<Scenario, string> = {
  normal: 'Normal',
  redesign: 'Portal redesign (self-heal)',
  submit_timeout_after_record: 'Submit timeout · recorded',
  submit_timeout_before_record: 'Submit timeout · not recorded',
  captcha: 'Human verification',
  missing_field: 'Missing required field',
  session_expired: 'Session expired (WP7)',
  upload_rejected: 'Upload rejected (WP7)',
  injection: 'Prompt injection on page (WP7)',
};
