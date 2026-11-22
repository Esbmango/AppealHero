import type { Ctx } from '../../core/ctx';

/** What every tool handler receives. */
export interface ToolCtx {
  ctx: Ctx;
  caseId: string;
}
