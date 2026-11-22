import type { FastifyInstance } from 'fastify';
import { ResumeRequestSchema } from '@appealhero/shared';
import { approvalPreview } from '../approval';
import { publishFacts, view, type Ctx } from '../core/ctx';
import { transition } from '../core/fsm';
import { HttpError } from '../core/util';
import { upsertFact } from '../agent/policy/facts';
import { reconcile, runJob } from '../portal/runner';

/** FROZEN 5: POST /api/jobs/:id/resume  (jobId === caseId) */
export function registerJobRoutes(app: FastifyInstance, ctx: Ctx) {
  app.post<{ Params: { id: string } }>('/api/jobs/:id/resume', async (req, reply) => {
    const id = req.params.id;
    const body = ResumeRequestSchema.parse(req.body ?? {});
    const c = ctx.store.must(id);

    // An unknown submit result is ALWAYS reconciled first — never resubmitted blindly.
    if (c.state === 'UNKNOWN_RESULT') {
      void reconcile(ctx, id);
      reply.code(202);
      return { jobId: id, state: c.state, action: 'reconcile' };
    }
    if (c.state !== 'NEEDS_USER' && c.state !== 'BLOCKED') throw new HttpError(409, `nothing to resume in state ${c.state}`);

    if (body.action === 'provide_info') {
      // A new fact changes the payload → the old approval is void → the user must approve again.
      const label = (body.field ?? c.needsUser?.field ?? '').trim();
      const value = (body.value ?? '').trim();
      if (!label || !value) throw new HttpError(400, 'field and value are required');
      ctx.store.mutate(id, (r) => {
        upsertFact(r, { key: `extra:${label}`, label, value, provenance: 'USER_TEXT', status: 'CONFIRMED' });
      });
      publishFacts(ctx, id);
      transition(ctx, id, 'STATEMENT_REVIEW', 'user', `user provided "${label}" — re-approval required`, (r) => {
        r.approval = undefined;
      });
      ctx.hub.emit({ type: 'review.ready', caseId: id, preview: approvalPreview(ctx.store.must(id)) });
      return view(ctx.store.must(id));
    }

    if (body.action === 'back_to_review') {
      transition(ctx, id, 'STATEMENT_REVIEW', 'user', 'user went back to statement review', (r) => {
        r.approval = undefined;
      });
      return view(ctx.store.must(id));
    }

    // retry: same approval; runJob re-verifies the signed token against the current payload.
    void runJob(ctx, id);
    reply.code(202);
    return { jobId: id, state: c.state, action: 'retry' };
  });
}
