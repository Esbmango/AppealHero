import type { FunctionDeclaration } from '@google/genai';
import { CASE_STATES, FORBIDDEN_TOOL_NAME, type CaseState, type DefinedTool, type ToolResult } from '@appealhero/shared';
import type { Ctx } from '../../core/ctx';
import type { ToolCtx } from './types';
import { lookupTicketsTool, selectTicketTool } from './lookup';
import { askUserTool } from './ask_user';
import { analyzeEvidenceTool } from './analyze_evidence';
import { checkRuleTool } from './check_rule';
import { recordFactTool } from './record_fact';
import { proposeOutcomeTool } from './propose_outcome';

/**
 * Tool registry (owner: WP2). One file per tool, parameters defined once in Zod (defineTool).
 * Note what is absent: no tool submits, approves or confirms anything — in any state.
 * WP2 adds: get_profile, lookup_tickets, select_ticket.
 */
export type ToolOutcome = ToolResult;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const TOOLS: readonly DefinedTool<ToolCtx, any>[] = [
  lookupTicketsTool,
  selectTicketTool,
  askUserTool,
  analyzeEvidenceTool,
  checkRuleTool,
  recordFactTool,
  proposeOutcomeTool,
];

for (const t of TOOLS) if (FORBIDDEN_TOOL_NAME.test(t.name)) throw new Error(`forbidden tool registered: ${t.name}`);
const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

/** Which tools each case state offers (derived from each tool's `stages`). */
export const TOOLSETS: Readonly<Record<CaseState, readonly string[]>> = Object.fromEntries(
  CASE_STATES.map((s) => [s, TOOLS.filter((t) => t.stages.includes(s)).map((t) => t.name)]),
) as unknown as Record<CaseState, readonly string[]>;

export const toolsFor = (state: CaseState) => TOOLS.filter((t) => t.stages.includes(state));

export const declarationsFor = (state: CaseState): FunctionDeclaration[] =>
  toolsFor(state).map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: t.jsonSchema }));

/** Validate → check the stage → run. Invalid arguments go back to the model as an error and change nothing. */
export async function runTool(ctx: Ctx, caseId: string, name: string, args: Record<string, unknown>, selectedByUser?: string): Promise<ToolOutcome> {
  const t0 = Date.now();
  let out: ToolOutcome;
  try {
    const tool = BY_NAME.get(name);
    const state = ctx.store.must(caseId).state;
    if (!tool) out = { result: { error: `unknown tool ${name}` }, isError: true };
    else if (!tool.stages.includes(state)) out = { result: { error: `${name} is not available while the case is ${state}` }, isError: true };
    else {
      const parsed = tool.params.safeParse(args);
      out = parsed.success
        ? await tool.run({ ctx, caseId, selectedByUser }, parsed.data)
        : {
            result: {
              error: 'invalid arguments',
              issues: parsed.error.issues.map((i: { path: PropertyKey[]; message: string }) => `${i.path.map(String).join('.') || '(root)'}: ${i.message}`),
            },
            isError: true,
          };
    }
  } catch (err) {
    out = { result: { error: (err as Error).message ?? String(err) }, isError: true };
  }
  ctx.hub.emit({ type: 'agent.tool', caseId, name, args, result: out.result, ms: Date.now() - t0 });
  return out;
}
