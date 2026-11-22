import fs from 'node:fs';
import path from 'node:path';
import { ProofResponseSchema, ProofStepSchema, type ProofResponse } from '@appealhero/shared';
import { config } from '../core/config';
import type { Ctx } from '../core/ctx';

export const tracePath = (id: string) => path.join(config.dataDir, 'traces', id, 'trace.zip');

export function recordProofEvents(ctx: Ctx) {
  return ctx.hub.subscribe('*', ({ event }) => {
    const { caseId } = event;
    switch (event.type) {
      case 'exec.step':
        ctx.audit.append({
          caseId,
          type: event.type,
          actor: 'executor',
          data: { step: event.step, status: event.status, tier: event.tier, detail: event.detail },
        });
        break;
      case 'exec.screenshot':
        ctx.audit.append({ caseId, type: event.type, actor: 'executor', data: { step: event.label, status: 'info', screenshotUrl: event.url } });
        break;
      case 'agent.tool':
        ctx.audit.append({ caseId, type: event.type, actor: 'agent', data: { name: event.name, ms: event.ms } });
        break;
      case 'receipt':
        ctx.audit.append({ caseId, type: event.type, actor: 'executor', data: event.receipt });
        ctx.audit.flush();
        break;
    }
  });
}

export function proof(ctx: Ctx, id: string): ProofResponse {
  const c = ctx.store.must(id);
  const a = c.approval;
  const events = ctx.audit.list(id);
  const steps = events
    .filter((e) => e.type === 'exec.step' || e.type === 'exec.screenshot')
    .map((e) => ProofStepSchema.parse({ at: e.at, ...(typeof e.data === 'object' && e.data !== null ? e.data : {}) }));
  return ProofResponseSchema.parse({
    caseId: id,
    state: c.state,
    ticket: c.ticket,
    approvedPayload: a?.payload,
    approvedPayloadHash: a?.payloadHash,
    statementUserLang: a?.statementUserLang,
    readbackHash: a?.readbackHash,
    readbackMatches: a?.readbackMatches,
    steps,
    receipt: c.receipt,
    auditHead: events.at(-1)?.hash,
    auditCount: events.length,
    traceUrl: a?.traceReady && fs.existsSync(tracePath(id)) ? '/api/cases/' + id + '/trace' : undefined,
  });
}
