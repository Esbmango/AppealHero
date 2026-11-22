import { z } from 'zod';
import type { CaseState } from './states';

/**
 * Agent tools: parameters are defined ONCE in Zod. The same schema produces the JSON Schema sent to
 * Gemini (parametersJsonSchema) and validates whatever arguments the model sends back.
 * The model never gets a tool that submits, approves or confirms — defineTool refuses such names,
 * and apps/server/test/invariants.test.ts checks the registry.
 */
export interface ToolResult {
  result: unknown;
  /** stop the agent loop and wait for the user */
  endTurn?: boolean;
  isError?: boolean;
}

export interface ToolSpec<Ctx, P extends z.ZodType> {
  name: string;
  description: string;
  /** the only case states in which the tool is offered */
  stages: readonly CaseState[];
  params: P;
  run(ctx: Ctx, args: z.infer<P>): Promise<ToolResult> | ToolResult;
}

export interface DefinedTool<Ctx, P extends z.ZodType = z.ZodType> extends ToolSpec<Ctx, P> {
  /** JSON Schema for Gemini function declarations */
  jsonSchema: Record<string, unknown>;
}

export const FORBIDDEN_TOOL_NAME = /submit|approve|confirm|pay(?!load)/i;

export function toolJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const js = z.toJSONSchema(schema, { unrepresentable: 'any' }) as Record<string, unknown>;
  delete js.$schema;
  return js;
}

export function defineTool<Ctx, P extends z.ZodType>(spec: ToolSpec<Ctx, P>): DefinedTool<Ctx, P> {
  if (!/^[a-z][a-z0-9_]{1,40}$/.test(spec.name)) throw new Error(`invalid tool name "${spec.name}"`);
  if (FORBIDDEN_TOOL_NAME.test(spec.name)) throw new Error(`tool "${spec.name}" is not allowed: the model never gets submit/approve/confirm/pay tools`);
  if (!spec.stages.length) throw new Error(`tool "${spec.name}" must list the stages it is offered in`);
  return { ...spec, jsonSchema: toolJsonSchema(spec.params) };
}
