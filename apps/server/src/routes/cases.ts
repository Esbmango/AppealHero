import type { FastifyInstance } from 'fastify';
import {
  ADAPTER_VERSION,
  ApproveRequestSchema,
  ConfirmFactsRequestSchema,
  DecisionRequestSchema,
  LANGS,
  isExecuting,
  type ChatMessage,
} from '@appealhero/shared';
import { config } from '../config';
import { approvalPreview, issueToken } from '../approval';
import { publishFacts, view, type Ctx } from '../ctx';
import { transition } from '../fsm';
import { newCaseRecord } from '../store';
import { HttpError, newId, now } from '../util';
import { appealAnyway, continueInvestigation, runExtraction } from '../agent';
import { upsertFact } from '../agent/facts';
import { runJob } from '../executor/runner';
import { readForm, saveEvidence } from './uploads';

type IdParams = { Params: { id: string } };

export function registerCaseRoutes(app: FastifyInstance, ctx: Ctx) {
  // ---- helpers (not frozen) ----
  app.get('/api/cases', async () => ctx.store.list().map(view));
  app.get<IdParams>('/api/cases/:id', async (req) => view(ctx.store.must(req.params.id)));
  app.get('/api/stream', (req, reply) => ctx.hub.serve(req, reply, '*'));

  // ---- FROZEN 1: create a case from a ticket photo (+ optional voice note / text) ----
  app.post('/api/cases', async (req, reply) => {
    const { fields, files } = await readForm(req);
    const ticket = files.find((f) => f.field === 'ticket');
    if (!ticket) throw new HttpError(400, 'a ticket photo (field "ticket") is required');
    const lang = fields.lang && fields.lang in LANGS ? fields.lang : 'zh';
    const c = newCaseRecord(lang);
    const ticketEv = saveEvidence(c, ticket, 'ticket_photo');
    const audio = files.find((f) => f.field === 'audio');
    const audioEv = audio ? saveEvidence(c, audio, 'audio') : undefined;
    // Saved profile values are typed by the user themselves → CONFIRMED with PROFILE provenance.
    const profile: [string, string, string | undefined][] = [
      ['fullName', 'Full name', fields.profileName],
      ['mailingAddress', 'Mailing address', fields.profileAddress],
      ['email', 'Email', fields.profileEmail],
    ];
    for (const [key, label, value] of profile)
      if (value?.trim()) upsertFact(c, { key, label, value: value.trim(), provenance: 'PROFILE', status: 'CONFIRMED' });
    if (fields.text || audioEv) {
      const msg: ChatMessage = { id: newId('m'), role: 'user', text: fields.text || '🎙 (voice note)', at: now(), evidenceIds: audioEv ? [audioEv.id] : undefined };
      c.messages.push(msg);
    }
    c.metrics.userActiveMs += Math.max(0, Math.min(Number(fields.activeMs) || 0, 10 * 60_000));
    ctx.store.put(c);
    ctx.hub.emit({ type: 'case.updated', caseId: c.id, state: c.state });
    void runExtraction(ctx, c.id, { ticketId: ticketEv.id, audioId: audioEv?.id, text: fields.text });
    reply.code(202);
    return { caseId: c.id, jobId: c.id };
  });

  // ---- FROZEN 2: user reply (text / voice / photos) ----
  app.post<IdParams>('/api/cases/:id/messages', async (req, reply) => {
    const id = req.params.id;
    const c = ctx.store.must(id);
    if (isExecuting(c.state)) throw new HttpError(409, `the case is executing (${c.state}); wait for it to finish`);
    if (c.state === 'SUBMITTED' || c.state === 'FAILED') throw new HttpError(409, `the case is closed (${c.state})`);
    const { fields, files } = await readForm(req);
    const imageIds: string[] = [];
    let audioId: string | undefined;
    ctx.store.mutate(id, (r) => {
      for (const f of files.filter((x) => x.field === 'images' || x.field === 'image')) imageIds.push(saveEvidence(r, f, 'evidence_photo').id);
      const audio = files.find((x) => x.field === 'audio');
      if (audio) audioId = saveEvidence(r, audio, 'audio').id;
      const text = (fields.text ?? '').trim();
      if (text || imageIds.length) r.messages.push({ id: newId('m'), role: 'user', text: text || `📷 ${imageIds.length} photo(s)`, at: now(), evidenceIds: imageIds });
      r.pendingQuestion = undefined;
      r.metrics.userActiveMs += Math.max(0, Math.min(Number(fields.activeMs) || 0, 10 * 60_000));
    });
    ctx.hub.emit({ type: 'case.updated', caseId: id, state: ctx.store.must(id).state });
    void continueInvestigation(ctx, id, { text: (fields.text ?? '').trim(), evidenceIds: imageIds, audioId });
    reply.code(202);
    return { ok: true };
  });

  // ---- helper: user confirms / edits facts on the review screen (only the user can CONFIRM) ----
  app.post<IdParams>('/api/cases/:id/facts/confirm', async (req) => {
    const id = req.params.id;
    const body = ConfirmFactsRequestSchema.parse(req.body ?? {});
    const c = ctx.store.must(id);
    if (isExecuting(c.state)) throw new HttpError(409, `cannot edit facts while ${c.state}`);
    ctx.store.mutate(id, (r) => {
      for (const fid of body.confirm) {
        const f = r.facts.find((x) => x.id === fid);
        if (f && f.status !== 'RULE_VERIFIED') f.status = 'CONFIRMED';
      }
      for (const e of body.edits) {
        const f = r.facts.find((x) => x.id === e.id);
        if (f && f.provenance !== 'RULE') {
          f.value = e.value.trim();
          f.status = 'CONFIRMED';
          f.note = 'edited by the user';
          f.updatedAt = now();
        }
      }
    });
    publishFacts(ctx, id);
    const after = ctx.store.must(id);
    if (after.draft && after.state === 'READY_FOR_REVIEW') ctx.hub.emit({ type: 'review.ready', caseId: id, preview: approvalPreview(after) });
    return view(after);
  });

  // ---- helper: negative-triage decision ----
  app.post<IdParams>('/api/cases/:id/decision', async (req, reply) => {
    const id = req.params.id;
    const { choice } = DecisionRequestSchema.parse(req.body ?? {});
    const c = ctx.store.must(id);
    if (choice === 'accept_pay') {
      transition(ctx, id, 'CLOSED_NO_APPEAL', 'user', 'user accepted the recommendation to pay');
      return view(ctx.store.must(id));
    }
    if (isExecuting(c.state)) throw new HttpError(409, `cannot change course while ${c.state}`);
    void appealAnyway(ctx, id);
    reply.code(202);
    return { ok: true };
  });

  // ---- FROZEN 3: approve the exact payload the user saw → signed one-time approval → start the executor ----
  app.post<IdParams>('/api/cases/:id/approve', async (req, reply) => {
    const id = req.params.id;
    const { payloadHash, activeMs } = ApproveRequestSchema.parse(req.body ?? {});
    const c = ctx.store.must(id);
    // Idempotent: a double tap on "approve" must not start two jobs.
    if (c.approval?.payloadHash === payloadHash && (isExecuting(c.state) || c.state === 'SUBMITTED')) return { jobId: id, state: c.state, idempotent: true };
    if (c.state !== 'READY_FOR_REVIEW') throw new HttpError(409, `cannot approve in state ${c.state}`);
    const preview = approvalPreview(c);
    if (preview.missing.length || preview.unconfirmedFactIds.length)
      throw new HttpError(422, 'not ready for approval', { missing: preview.missing, unconfirmedFactIds: preview.unconfirmedFactIds });
    if (preview.payloadHash !== payloadHash) throw new HttpError(409, 'the content changed since you reviewed it — please review again', { currentHash: preview.payloadHash });
    const token = issueToken(config.approvalSecret, { caseId: id, payloadHash, adapterVersion: ADAPTER_VERSION, ttlMs: config.approvalTtlMs });
    transition(ctx, id, 'APPROVED', 'approval', `user approved payload ${payloadHash.slice(0, 12)}…`, (r) => {
      r.approval = { token: token.token, payloadHash, issuedAt: now(), expiresAt: token.expiresAt, attempts: 0 };
      r.metrics.userActiveMs += activeMs ?? 0;
    });
    void runJob(ctx, id);
    reply.code(202);
    return { jobId: id, state: 'APPROVED', idempotent: false };
  });

  // ---- FROZEN 4: SSE stream (Last-Event-ID replay, 15 s heartbeat) ----
  app.get<IdParams>('/api/cases/:id/stream', (req, reply) => {
    ctx.store.must(req.params.id);
    ctx.hub.serve(req, reply, req.params.id);
  });
}
