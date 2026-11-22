import type { FunctionDeclaration } from '@google/genai';
import { DISPUTE_REASON_KEYS, type ChatMessage, type DisputeReason, type Ground, type Triage } from '@appealhero/shared';
import { config } from '../config';
import { approvalPreview } from '../approval';
import { publishFacts, say, type Ctx } from '../ctx';
import { transition } from '../fsm';
import type { CaseRecord, EvidenceRecord } from '../types';
import { isObj, newId, now, str } from '../util';
import { composeDraft } from './draft';
import { latestFact, upsertFact, validateGrounds } from './facts';
import { generateJson, inlinePart } from './llm';
import { FINES, RULE_LABELS, RULE_NAMES, runRule, type RuleInput, type RuleName } from './rules';

export interface ToolOutcome {
  result: unknown;
  /** stop the agent loop and wait for the user */
  endTurn?: boolean;
  isError?: boolean;
}

/** Tool surface given to Gemini. Note what is absent: there is no submit/approve tool in any state. */
export const TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: 'ask_user',
    description:
      'Ask the user exactly ONE short question in their language. Use expects=photo to request a photo (meter receipt, ParkBoston screenshot, street sign). Ends your turn.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        question: { type: 'string' },
        question_en: { type: 'string' },
        expects: { type: 'string', enum: ['text', 'photo', 'choice'] },
        options: { type: 'array', items: { type: 'string' } },
        why: { type: 'string', description: 'which missing fact this resolves' },
      },
      required: ['question', 'question_en', 'expects', 'why'],
    },
  },
  {
    name: 'analyze_evidence',
    description: 'Inspect one uploaded photo and extract a specific finding. Findings become PHOTO_EVIDENCE facts the user must confirm.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        evidence_id: { type: 'string' },
        extract: { type: 'string', enum: ['paid_until', 'sign_text', 'vehicle_description', 'general'] },
        question: { type: 'string' },
      },
      required: ['evidence_id', 'extract'],
    },
  },
  {
    name: 'check_rule',
    description:
      'Run a deterministic Boston rule with an official source. Never compute dates, meter rules, fines or deadlines yourself. Ticket facts (issuedAt, plateState, violationType, paidUntil) are filled in from the case automatically.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        rule: { type: 'string', enum: [...RULE_NAMES] },
        input: {
          type: 'object',
          properties: {
            isMaResident: { type: 'boolean' },
            hasPlacard: { type: 'boolean' },
            over65: { type: 'boolean' },
          },
        },
      },
      required: ['rule'],
    },
  },
  {
    name: 'record_fact',
    description:
      'Record something the user told you (status USER_STATEMENT). You can never mark a fact CONFIRMED — only the user can, on the review screen. Keys: fullName, mailingAddress, email, userAccount, vehicleMatches, …',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        key: { type: 'string' },
        label: { type: 'string' },
        value: { type: 'string' },
        english: { type: 'string', description: 'English translation if the value is not in English' },
        provenance: { type: 'string', enum: ['USER_TEXT', 'USER_VOICE'] },
      },
      required: ['key', 'label', 'value', 'provenance'],
    },
  },
  {
    name: 'propose_outcome',
    description:
      'Finish the investigation. recommendation=PAY when there is no lawful ground (say so honestly, with fine, late penalty and deadline). recommendation=APPEAL needs dispute_reason and grounds that cite fact ids.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        recommendation: { type: 'string', enum: ['APPEAL', 'PAY'] },
        dispute_reason: { type: 'string', enum: [...DISPUTE_REASON_KEYS] },
        summary_user_lang: { type: 'string', description: 'short explanation for the user, in their language' },
        grounds: {
          type: 'array',
          items: {
            type: 'object',
            properties: { text_en: { type: 'string' }, fact_ids: { type: 'array', items: { type: 'string' } } },
            required: ['text_en', 'fact_ids'],
          },
        },
      },
      required: ['recommendation', 'summary_user_lang', 'grounds'],
    },
  },
];

export async function runTool(ctx: Ctx, caseId: string, name: string, args: Record<string, unknown>): Promise<ToolOutcome> {
  const t0 = Date.now();
  let out: ToolOutcome;
  try {
    out = await dispatch(ctx, caseId, name, args);
  } catch (err) {
    out = { result: { error: (err as Error).message ?? String(err) }, isError: true };
  }
  ctx.hub.emit({ type: 'agent.tool', caseId, name, args, result: out.result, ms: Date.now() - t0 });
  return out;
}

function dispatch(ctx: Ctx, caseId: string, name: string, a: Record<string, unknown>): Promise<ToolOutcome> | ToolOutcome {
  switch (name) {
    case 'ask_user':
      return askUser(ctx, caseId, a);
    case 'analyze_evidence':
      return analyzeEvidence(ctx, caseId, a);
    case 'check_rule':
      return checkRule(ctx, caseId, a);
    case 'record_fact':
      return recordFact(ctx, caseId, a);
    case 'propose_outcome':
      return proposeOutcome(ctx, caseId, a);
    default:
      return { result: { error: `unknown tool ${name}` }, isError: true };
  }
}

function askUser(ctx: Ctx, caseId: string, a: Record<string, unknown>): ToolOutcome {
  const question = str(a.question);
  if (!question) throw new Error('question is required');
  const expects = (['text', 'photo', 'choice'].includes(str(a.expects)) ? str(a.expects) : 'text') as ChatMessage['expects'];
  const options = Array.isArray(a.options) ? a.options.map(String).slice(0, 6) : undefined;
  const msg: ChatMessage = { id: newId('m'), role: 'agent', text: question, textEn: str(a.question_en) || undefined, at: now(), questionId: newId('q'), expects, options };
  ctx.store.mutate(caseId, (c) => {
    c.messages.push(msg);
    c.pendingQuestion = msg;
    c.metrics.questionsAsked += 1;
  });
  ctx.hub.emit({ type: 'agent.message', caseId, message: msg });
  return { result: { status: 'asked — waiting for the user', why: str(a.why) }, endTurn: true };
}

interface Finding {
  summary: string;
  facts: { key: string; label: string; value: string }[];
}

async function analyzeEvidence(ctx: Ctx, caseId: string, a: Record<string, unknown>): Promise<ToolOutcome> {
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
    paid_until: 'This is a parking payment receipt or a ParkBoston app screenshot. Return paid_from and paid_until as ISO 8601 with the America/New_York offset if visible.',
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
    return { summary: '[fake] receipt shows paid until 13 minutes after the ticket time', facts: [{ key: 'paidUntil', label: 'Paid until (receipt)', value: until }] };
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

/** Ticket facts always override model-supplied inputs, so the model cannot "choose" a convenient date. */
function ruleInputFromCase(c: CaseRecord, modelInput: Record<string, unknown>): RuleInput {
  const known: RuleInput = {
    issuedAt: latestFact(c, 'issuedAt')?.value,
    plateState: latestFact(c, 'plateState')?.value,
    violationType: c.violationType,
    paidUntil: latestFact(c, 'paidUntil')?.value,
    paidFrom: latestFact(c, 'paidFrom')?.value,
  };
  const out: RuleInput = {
    isMaResident: typeof modelInput.isMaResident === 'boolean' ? modelInput.isMaResident : undefined,
    hasPlacard: typeof modelInput.hasPlacard === 'boolean' ? modelInput.hasPlacard : undefined,
    over65: typeof modelInput.over65 === 'boolean' ? modelInput.over65 : undefined,
  };
  for (const [k, v] of Object.entries(known)) if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  return out;
}

function checkRule(ctx: Ctx, caseId: string, a: Record<string, unknown>): ToolOutcome {
  const rule = str(a.rule) as RuleName;
  if (!RULE_NAMES.includes(rule)) throw new Error(`unknown rule ${rule}`);
  const c = ctx.store.must(caseId);
  const r = runRule(rule, ruleInputFromCase(c, isObj(a.input) ? a.input : {}));
  let factId = '';
  ctx.store.mutate(caseId, (rec) => {
    factId = upsertFact(rec, { key: `rule:${rule}`, label: RULE_LABELS[rule], value: r.detail, provenance: 'RULE', status: 'RULE_VERIFIED', sourceRef: r.source }).id;
  });
  publishFacts(ctx, caseId);
  return { result: { ...r, factId } };
}

const TICKET_KEYS = ['ticketNumber', 'plateNumber', 'plateState', 'issuedAt', 'location', 'violation', 'fineAmount'];

function recordFact(ctx: Ctx, caseId: string, a: Record<string, unknown>): ToolOutcome {
  const key = str(a.key);
  if (!/^[a-zA-Z][\w-]{0,40}$/.test(key)) throw new Error('key must be camelCase letters/digits');
  if (TICKET_KEYS.includes(key)) throw new Error(`${key} comes from the ticket and is confirmed by the user on the review screen — do not overwrite it`);
  const value = str(a.value).trim();
  if (!value) throw new Error('value is required');
  const c = ctx.store.must(caseId);
  const existing = latestFact(c, key);
  if (existing && existing.value === value && existing.status === 'CONFIRMED') return { result: { factId: existing.id, status: 'already confirmed' } };
  let id = '';
  ctx.store.mutate(caseId, (r) => {
    id = upsertFact(r, {
      key,
      label: str(a.label) || key,
      value,
      note: str(a.english) || undefined,
      provenance: a.provenance === 'USER_VOICE' ? 'USER_VOICE' : 'USER_TEXT',
      status: 'USER_STATEMENT',
    }).id;
  });
  publishFacts(ctx, caseId);
  return { result: { factId: id, status: 'USER_STATEMENT — the user confirms it on the review screen' } };
}

async function proposeOutcome(ctx: Ctx, caseId: string, a: Record<string, unknown>): Promise<ToolOutcome> {
  const c = ctx.store.must(caseId);
  const recommendation = a.recommendation === 'PAY' ? 'PAY' : 'APPEAL';
  const grounds: Ground[] = (Array.isArray(a.grounds) ? a.grounds : [])
    .filter(isObj)
    .map((g) => ({ text: str(g.text_en ?? g.text), factIds: (Array.isArray(g.fact_ids) ? g.fact_ids : []).map(String) }))
    .filter((g) => g.text);
  const errors = validateGrounds(grounds, c.facts);
  if (errors.length) return { result: { error: 'invalid grounds', details: errors }, isError: true };
  const summary = str(a.summary_user_lang);

  if (recommendation === 'PAY') {
    const f = FINES[c.violationType ?? 'OTHER'];
    const issued = latestFact(c, 'issuedAt')?.value;
    const deadline = issued ? runRule('appeal_deadline', { issuedAt: issued }) : null;
    const triage: Triage = {
      recommendation: 'PAY',
      summary,
      reasons: grounds,
      fineAmount: f?.fine,
      latePenalty: f?.late,
      deadline: typeof deadline?.result === 'string' ? deadline.result : undefined,
    };
    ctx.store.mutate(caseId, (r) => {
      r.triage = triage;
      r.pendingQuestion = undefined;
    });
    ctx.hub.emit({ type: 'triage', caseId, triage });
    if (summary) say(ctx, caseId, summary);
    return { result: { status: 'recommendation shown — the user decides (accept_pay or appeal_anyway)' }, endTurn: true };
  }

  if (!grounds.length) return { result: { error: 'APPEAL needs at least one ground that cites fact ids' }, isError: true };
  const missingContact = (['fullName', 'mailingAddress', 'email'] as const).filter((k) => !latestFact(c, k)?.value);
  if (missingContact.length) return { result: { error: `missing appellant details: ${missingContact.join(', ')} — ask the user with ask_user, then record_fact` }, isError: true };
  const reason = (DISPUTE_REASON_KEYS as readonly string[]).includes(str(a.dispute_reason)) ? (str(a.dispute_reason) as DisputeReason) : 'OTHER';
  const draft = await composeDraft(ctx, caseId, reason, grounds);
  ctx.store.mutate(caseId, (r) => {
    r.draft = draft;
    r.triage = { recommendation: 'APPEAL', summary, reasons: grounds };
    r.pendingQuestion = undefined;
  });
  if (ctx.store.must(caseId).state === 'INVESTIGATING') transition(ctx, caseId, 'READY_FOR_REVIEW', 'agent', `agent proposed APPEAL (${reason})`);
  ctx.hub.emit({ type: 'review.ready', caseId, preview: approvalPreview(ctx.store.must(caseId)) });
  if (summary) say(ctx, caseId, summary);
  return { result: { status: 'draft ready — the user is reviewing it' }, endTurn: true };
}
