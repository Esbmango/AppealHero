import { z } from 'zod';
import { CaseStateSchema } from './schemas';

/**
 * The 5 frozen endpoints. jobId === caseId (one execution job per case).
 * Helpers that are NOT frozen: GET /api/cases, GET /api/cases/:id, POST /api/cases/:id/facts/confirm,
 * POST /api/cases/:id/decision, /api/demo/*, GET /api/stream (all cases), /api/files/*, /api/shots/*.
 */
export const FROZEN_API = {
  createCase: 'POST /api/cases', // multipart: ticket (file, required), audio? (wav), text?, lang?, profileName?, profileAddress?, profileEmail?
  postMessage: 'POST /api/cases/:id/messages', // multipart: text?, audio?, images* (files), activeMs?
  approve: 'POST /api/cases/:id/approve', // json: { payloadHash }
  stream: 'GET /api/cases/:id/stream', // SSE, supports Last-Event-ID replay
  resume: 'POST /api/jobs/:id/resume', // json: { action, field?, value? }
} as const;

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
   *  back_to_review: discard the approval and return to review
   *  provide_info: answer a MISSING_FIELD → payload changes → re-approval required */
  action: z.enum(['retry', 'reconcile', 'back_to_review', 'provide_info']).default('retry'),
  field: z.string().optional(),
  value: z.string().optional(),
});
export type ResumeRequest = z.infer<typeof ResumeRequestSchema>;

export const ConfirmFactsRequestSchema = z.object({
  confirm: z.array(z.string()).default([]),
  edits: z.array(z.object({ id: z.string(), value: z.string().min(1) })).default([]),
});
export const DecisionRequestSchema = z.object({ choice: z.enum(['accept_pay', 'appeal_anyway']) });

export const SCENARIOS = [
  'normal',
  'redesign',
  'submit_timeout_after_record',
  'submit_timeout_before_record',
  'captcha',
  'missing_field',
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
};
