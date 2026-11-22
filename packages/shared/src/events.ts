import { z } from 'zod';
import {
  ActorSchema,
  ApprovalPreviewSchema,
  CaseStateSchema,
  ChatMessageSchema,
  FactSchema,
  MetricsSchema,
  NeedsUserSchema,
  ReceiptSchema,
  TriageSchema,
} from './schemas';

/** T1 semantic locator · T1b select-by-option · T2 heuristic DOM · T3 Computer Use · FILE deterministic upload */
export const TierSchema = z.enum(['T1', 'T1b', 'T2', 'T3', 'FILE']);
export type Tier = z.infer<typeof TierSchema>;

/** Everything streamed over SSE (GET /api/cases/:id/stream). Clients should refetch the case on any event. */
export const AgentEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('case.updated'), caseId: z.string(), state: CaseStateSchema }),
  z.object({
    type: z.literal('state.changed'),
    caseId: z.string(),
    from: CaseStateSchema,
    to: CaseStateSchema,
    reason: z.string(),
    actor: ActorSchema,
  }),
  z.object({ type: z.literal('agent.message'), caseId: z.string(), message: ChatMessageSchema }),
  z.object({ type: z.literal('agent.tool'), caseId: z.string(), name: z.string(), args: z.unknown(), result: z.unknown(), ms: z.number() }),
  z.object({ type: z.literal('facts.updated'), caseId: z.string(), facts: z.array(FactSchema) }),
  z.object({ type: z.literal('triage'), caseId: z.string(), triage: TriageSchema }),
  z.object({ type: z.literal('review.ready'), caseId: z.string(), preview: ApprovalPreviewSchema }),
  z.object({
    type: z.literal('exec.step'),
    caseId: z.string(),
    step: z.string(),
    status: z.enum(['start', 'ok', 'fail', 'blocked', 'info']),
    tier: TierSchema.optional(),
    detail: z.string().optional(),
  }),
  z.object({ type: z.literal('exec.screenshot'), caseId: z.string(), url: z.string(), label: z.string() }),
  z.object({ type: z.literal('needs_user'), caseId: z.string(), needsUser: NeedsUserSchema }),
  z.object({ type: z.literal('receipt'), caseId: z.string(), receipt: ReceiptSchema }),
  z.object({ type: z.literal('metrics'), caseId: z.string(), metrics: MetricsSchema }),
  z.object({ type: z.literal('error'), caseId: z.string(), message: z.string() }),
]);
export type AgentEvent = z.infer<typeof AgentEventSchema>;
export type AgentEventType = AgentEvent['type'];
