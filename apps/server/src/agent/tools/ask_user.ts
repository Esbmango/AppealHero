import { z } from 'zod';
import { defineTool, type ToolResult } from '@appealhero/shared';
import type { ToolCtx } from './types';
import type { ChatMessage } from '@appealhero/shared';
import type { Ctx } from '../../core/ctx';
import { newId, now, str } from '../../core/util';

const params = z.object({
  question: z.string().min(1),
  question_en: z.string(),
  expects: z.enum(['text', 'photo', 'choice', 'yesno']),
  options: z.array(z.string()).max(6).optional(),
  why: z.string().describe('which missing fact this resolves'),
});

export const askUserTool = defineTool<ToolCtx, typeof params>({
  name: 'ask_user',
  description:
    'Ask the user exactly ONE short question in their language. Use expects=photo to request a photo (meter receipt, ParkBoston screenshot, street sign). Ends your turn.',
  stages: ['IDENTIFYING', 'INVESTIGATING'],
  params,
  run: (t, a) => askUser(t.ctx, t.caseId, a),
});

function askUser(ctx: Ctx, caseId: string, a: Record<string, unknown>): ToolResult {
  const question = str(a.question);
  if (!question) throw new Error('question is required');
  const expects = (['text', 'photo', 'choice', 'yesno'].includes(str(a.expects)) ? str(a.expects) : 'text') as ChatMessage['expects'];
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
