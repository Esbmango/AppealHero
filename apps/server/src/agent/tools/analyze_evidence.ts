import { z } from 'zod';
import { defineTool, type ToolResult } from '@appealhero/shared';
import type { ToolCtx } from './types';
import { config } from '../../core/config';
import { publishFacts, type Ctx } from '../../core/ctx';
import type { CaseRecord, EvidenceRecord } from '../../core/types';
import { str } from '../../core/util';
import { latestFact, upsertFact } from '../policy/facts';
import { generateJson, inlinePart } from '../llm';

const params = z.object({
  evidence_id: z.string(),
  extract: z.enum(['paid_until', 'sign_text', 'vehicle_description', 'general']),
  question: z.string().optional(),
});

export const analyzeEvidenceTool = defineTool<ToolCtx, typeof params>({
  name: 'analyze_evidence',
  description: 'Inspect one uploaded photo and extract a specific finding. Findings become PHOTO_EVIDENCE facts the user must confirm.',
  stages: ['IDENTIFYING', 'INVESTIGATING'],
  params,
  run: (t, a) => analyzeEvidence(t.ctx, t.caseId, a),
});

interface Finding {
  summary: string;
  facts: { key: string; label: string; value: string }[];
}

async function analyzeEvidence(ctx: Ctx, caseId: string, a: Record<string, unknown>): Promise<ToolResult> {
  const c = ctx.store.must(caseId);
  const ev = c.evidence.find((e) => e.id === str(a.evidence_id));
  if (!ev || ev.kind === 'audio') throw new Error(`no photo evidence with id ${str(a.evidence_id)}`);
  const extract = str(a.extract) || 'general';
  const finding = config.aiMode === 'gemini' ? await analyzeWithGemini(ctx, caseId, ev, extract, str(a.question)) : fakeFinding(c, ev, extract);
  const ids: string[] = [];
  ctx.store.mutate(caseId, (r) => {
    for (const f of finding.facts) ids.push(upsertFact(r, { ...f, provenance: 'PHOTO_EVIDENCE', status: 'NEEDS_CONFIRMATION', sourceRef: ev.id }).id);
    if (!r.fake.analyzed.includes(ev.id)) r.fake.analyzed.push(ev.id);
  });
  publishFacts(ctx, caseId);
  return { result: { summary: finding.summary, facts: finding.facts.map((f, i) => ({ id: ids[i], ...f })) } };
}

async function analyzeWithGemini(ctx: Ctx, caseId: string, ev: EvidenceRecord, extract: string, question: string): Promise<Finding> {
  const ask: Record<string, string> = {
    paid_until:
      'This is a parking payment receipt or a ParkBoston app screenshot. Return paid_from and paid_until as ISO 8601 with the America/New_York offset if visible.',
    sign_text: 'Transcribe the parking sign text exactly and classify visibility as clear, partially_obscured or not_visible.',
    vehicle_description: 'Describe the vehicle: make, color, plate state and number if visible.',
    general: question || 'Describe what this photo shows that is relevant to a parking ticket appeal.',
  };
  const out = await generateJson<{ summary: string; paid_from?: string; paid_until?: string; sign_text?: string; sign_visibility?: string; vehicle?: string }>(
    ctx,
    caseId,
    [inlinePart(ev.path, ev.mime), { text: ask[extract] ?? ask.general }],
    {
      type: 'object',
      properties: {
        summary: { type: 'string' },
        paid_from: { type: 'string' },
        paid_until: { type: 'string' },
        sign_text: { type: 'string' },
        sign_visibility: { type: 'string', enum: ['clear', 'partially_obscured', 'not_visible'] },
        vehicle: { type: 'string' },
      },
      required: ['summary'],
    },
    'You read evidence photos for a parking ticket appeal. Report only what is visible. Output JSON only.',
  );
  const facts: Finding['facts'] = [];
  if (out.paid_until) facts.push({ key: 'paidUntil', label: 'Paid until (receipt)', value: out.paid_until });
  if (out.paid_from) facts.push({ key: 'paidFrom', label: 'Paid from (receipt)', value: out.paid_from });
  if (out.sign_text) facts.push({ key: 'signText', label: 'Sign text (photo)', value: out.sign_text });
  if (out.sign_visibility) facts.push({ key: 'signVisibility', label: 'Sign visibility (photo)', value: out.sign_visibility });
  if (out.vehicle) facts.push({ key: 'vehiclePhoto', label: 'Vehicle (photo)', value: out.vehicle });
  return { summary: out.summary, facts };
}

/** Fake mode: deterministic findings so the flows can be demoed without a key. */
function fakeFinding(c: CaseRecord, _ev: EvidenceRecord, extract: string): Finding {
  const issued = latestFact(c, 'issuedAt')?.value ?? new Date().toISOString();
  if (extract === 'paid_until') {
    const until = new Date(new Date(issued).getTime() + 13 * 60_000).toISOString();
    return {
      summary: '[fake] receipt shows paid until 13 minutes after the ticket time',
      facts: [{ key: 'paidUntil', label: 'Paid until (receipt)', value: until }],
    };
  }
  if (extract === 'sign_text') {
    const obscured = /遮|看不清|obscur|hidden|block/i.test(latestFact(c, 'userAccount')?.value ?? '');
    return {
      summary: obscured ? '[fake] sign partially obscured by branches' : '[fake] sign clearly visible',
      facts: [
        { key: 'signText', label: 'Sign text (photo)', value: 'RESIDENT PERMIT PARKING ONLY · MON–SAT 8AM–6PM' },
        { key: 'signVisibility', label: 'Sign visibility (photo)', value: obscured ? 'partially_obscured' : 'clear' },
      ],
    };
  }
  return { summary: '[fake] general photo', facts: [] };
}
