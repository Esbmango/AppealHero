import type { Ctx } from '../../core/ctx';

/** What every tool handler receives. */
export interface ToolCtx {
  ctx: Ctx;
  caseId: string;
  /** Supplied only by the explicit user selection endpoint. */
  selectedByUser?: string;
}
