import { z } from 'zod';
import { defineTool, type ToolResult } from '@appealhero/shared';
import type { ToolCtx } from './types';
import { extractTicket } from '../perception';
import { samePlate } from '../rules/boston';
import { readDemoTruth } from '../perception/demoTruth';
import { config } from '../../core/config';
import { publishFacts, type Ctx } from '../../core/ctx';
import type { EvidenceRecord } from '../../core/types';
import { str } from '../../core/util';
import { upsertFact } from '../policy/facts';
import { generateJson, inlinePart } from '../llm';

const params = z.object({
  evidence_id: z.string(),
  extract: z.enum(['paid_until', 'sign_text', 'permit_sticker', 'hydrant_context', 'vehicle_description', 'duplicate_notice', 'general']),
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
  let finding: Finding;
  if (extract === 'duplicate_notice') {
    const other = config.aiMode === 'fake' ? readDemoTruth(ev.path) : await extractTicket(ctx, caseId, { ticket: ev, lang: c.lang });
    const t = c.ticket;
    const normalize = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
    const match =
      t &&
      other &&
      (!('kind' in other) || other.kind === 'ticket') &&
      other.ticketNumber &&
      other.ticketNumber !== t.ticketNumber &&
      samePlate(other.plateNumber, t.plate) &&
      other.plateState.toUpperCase() === t.state &&
      Date.parse(other.issuedAt) === Date.parse(t.issuedAt) &&
      normalize(other.location) === normalize(t.location) &&
      normalize(other.violationDescription) === normalize(t.violation)
        ? other.ticketNumber
        : undefined;
    finding = match
      ? {
          summary: 'Distinct ticket with matching vehicle, time, place and violation.',
          facts: [{ key: 'duplicateNotice', label: 'Other ticket number for the same incident', value: match }],
        }
      : { summary: 'No matching second notice established.', facts: [] };
  } else finding = config.aiMode === 'gemini' ? await analyzeWithGemini(ctx, caseId, ev, extract, str(a.question)) : fakeFinding(ev, extract);
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
      'This is a parking payment receipt or a ParkBoston app screenshot. Return the printed plate in receipt_plate, and paid_from and paid_until as ISO 8601 with the America/New_York offset if visible.',
    hydrant_context:
      'Describe whether both the parked vehicle and hydrant are visible in hydrant_photo. Omit the field if either is missing. Do not estimate a distance from the image.',
    permit_sticker:
      'Read the printed neighborhood (permit_area), plate (permit_plate), and whether the photo shows the sticker displayed on the vehicle (permit_displayed: yes/no). Omit anything unreadable.',
    sign_text:
      'For a single legible weekly restriction return all its days in sign_days as comma-separated Mon,Tue,..., and sign_start and sign_end as 24-hour HH:MM. Omit all three for complex, ambiguous or seasonal schedules. Read the neighborhood into sign_area when visible. Transcribe the parking sign text exactly and classify visibility as clear, partially_obscured or not_visible.',
    vehicle_description: 'Describe the vehicle: make, color, plate state and number if visible.',
    general: question || 'Describe what this photo shows that is relevant to a parking ticket appeal.',
  };
  const out = await generateJson<{
    summary: string;
    paid_from?: string;
    paid_until?: string;
    receipt_plate?: string;
    permit_plate?: string;
    permit_area?: string;
    sign_area?: string;
    sign_days?: string;
    sign_start?: string;
    sign_end?: string;
    hydrant_photo?: string;
    permit_displayed?: string;
    sign_text?: string;
    sign_visibility?: string;
    vehicle?: string;
  }>(
    ctx,
    caseId,
    [inlinePart(ev.path, ev.mime), { text: ask[extract] ?? ask.general }],
    {
      type: 'object',
      properties: {
        summary: { type: 'string' },
        paid_from: { type: 'string' },
        paid_until: { type: 'string' },
        receipt_plate: { type: 'string' },
        permit_plate: { type: 'string' },
        permit_area: { type: 'string' },
        sign_area: { type: 'string' },
        sign_days: { type: 'string' },
        sign_start: { type: 'string' },
        sign_end: { type: 'string' },
        hydrant_photo: { type: 'string' },
        permit_displayed: { type: 'string', enum: ['yes', 'no'] },
        sign_text: { type: 'string' },
        sign_visibility: { type: 'string', enum: ['clear', 'partially_obscured', 'not_visible'] },
        vehicle: { type: 'string' },
      },
      required: ['summary'],
    },
    'You read evidence photos for a parking ticket appeal. Report only what is visible. Output JSON only.',
  );
  const facts: Finding['facts'] = [];
  if (extract === 'paid_until' && out.receipt_plate) facts.push({ key: 'receiptPlate', label: 'Plate on receipt', value: out.receipt_plate });
  if (extract === 'permit_sticker') {
    if (out.permit_area) facts.push({ key: 'permitArea', label: 'Permit neighborhood', value: out.permit_area });
    if (out.permit_plate) facts.push({ key: 'permitPlate', label: 'Permit plate', value: out.permit_plate });
    if (out.permit_displayed) facts.push({ key: 'permitDisplayed', label: 'Permit displayed on vehicle', value: out.permit_displayed });
  }
  if (extract === 'hydrant_context' && out.hydrant_photo) facts.push({ key: 'hydrantPhoto', label: 'Vehicle and hydrant in photo', value: out.hydrant_photo });
  if (extract === 'sign_text' && out.sign_days && out.sign_start && out.sign_end)
    facts.push(
      { key: 'signDays', label: 'Restriction days on sign', value: out.sign_days },
      { key: 'signStart', label: 'Restriction starts', value: out.sign_start },
      { key: 'signEnd', label: 'Restriction ends', value: out.sign_end },
    );
  if (extract === 'sign_text' && out.sign_area) facts.push({ key: 'signArea', label: 'Neighborhood on sign', value: out.sign_area });
  if (out.paid_until) facts.push({ key: 'paidUntil', label: 'Paid until (receipt)', value: out.paid_until });
  if (out.paid_from) facts.push({ key: 'paidFrom', label: 'Paid from (receipt)', value: out.paid_from });
  if (out.sign_text) facts.push({ key: 'signText', label: 'Sign text (photo)', value: out.sign_text });
  if (out.sign_visibility) facts.push({ key: 'signVisibility', label: 'Sign visibility (photo)', value: out.sign_visibility });
  if (out.vehicle) facts.push({ key: 'vehiclePhoto', label: 'Vehicle (photo)', value: out.vehicle });
  return { summary: out.summary, facts };
}

/** Fake mode: deterministic findings so the flows can be demoed without a key. */
function fakeFinding(ev: EvidenceRecord, extract: string): Finding {
  if (extract === 'paid_until') {
    const truth = readDemoTruth(ev.path);
    if (truth?.kind === 'receipt')
      return {
        summary: '[fake] payment period read from synthetic receipt',
        facts: [
          { key: 'paidFrom', label: 'Paid from (receipt)', value: truth.paidFrom },
          { key: 'paidUntil', label: 'Paid until (receipt)', value: truth.paidUntil },
          { key: 'receiptPlate', label: 'Plate on receipt', value: truth.plate },
        ],
      };
    return { summary: '[fake] no supported payment receipt in this image', facts: [] };
  }
  if (extract === 'sign_text') {
    const truth = readDemoTruth(ev.path);
    if (truth?.kind !== 'sign') return { summary: '[fake] sign visibility unavailable in this image', facts: [] };
    return {
      summary: '[fake] sign information from the synthetic image',
      facts: [
        { key: 'signText', label: 'Sign text (photo)', value: truth.text },
        { key: 'signVisibility', label: 'Sign visibility (photo)', value: truth.visibility },
      ],
    };
  }
  return { summary: '[fake] general photo', facts: [] };
}
