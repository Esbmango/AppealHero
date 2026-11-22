import { z } from 'zod';
import { defineTool, type ToolResult } from '@appealhero/shared';
import type { ToolCtx } from './types';
import { publishFacts, type Ctx } from '../../core/ctx';
import type { CaseRecord } from '../../core/types';
import { isObj, str } from '../../core/util';
import { latestFact, upsertFact } from '../policy/facts';
import { RULE_LABELS, RULE_NAMES, runRule, type RuleInput, type RuleName } from '../rules/boston';

const params = z.object({
  rule: z.enum(RULE_NAMES),
  input: z.object({ isMaResident: z.boolean().optional(), hasPlacard: z.boolean().optional(), over65: z.boolean().optional() }).optional(),
});

export const checkRuleTool = defineTool<ToolCtx, typeof params>({
  name: 'check_rule',
  description:
    'Run a deterministic Boston rule with an official source. Never compute dates, meter rules, fines or deadlines yourself. Ticket facts (issuedAt, plateState, violationType, paidUntil) are filled in from the case automatically.',
  stages: ['INVESTIGATING'],
  params,
  run: (t, a) => checkRule(t.ctx, t.caseId, a),
});

/** Ticket facts always override model-supplied inputs, so the model cannot "choose" a convenient date. */
function ruleInputFromCase(c: CaseRecord, modelInput: Record<string, unknown>): RuleInput {
  const known: RuleInput = {
    issuedAt: latestFact(c, 'issuedAt')?.value,
    plateState: latestFact(c, 'plateState')?.value,
    violationType: c.violationType,
    violationDescription: latestFact(c, 'violation')?.value,
    printedFine: Number(latestFact(c, 'fineAmount')?.value) || undefined,
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

function checkRule(ctx: Ctx, caseId: string, a: Record<string, unknown>): ToolResult {
  const rule = str(a.rule) as RuleName;
  if (!RULE_NAMES.includes(rule)) throw new Error(`unknown rule ${rule}`);
  const c = ctx.store.must(caseId);
  const r = runRule(rule, ruleInputFromCase(c, isObj(a.input) ? a.input : {}));
  let factId = '';
  ctx.store.mutate(caseId, (rec) => {
    factId = upsertFact(rec, {
      key: `rule:${rule}`,
      label: RULE_LABELS[rule],
      value: r.detail,
      provenance: 'RULE',
      status: 'RULE_VERIFIED',
      sourceRef: r.source,
    }).id;
  });
  publishFacts(ctx, caseId);
  return { result: { ...r, factId } };
}
