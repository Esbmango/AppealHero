import type { Content, Part } from '@google/genai';
import { config } from '../../core/config';
import { publishMetrics, say, type Ctx } from '../../core/ctx';
import { gemini, recordUsage } from '../llm';
import { declarationsFor, runTool, type ToolOutcome } from '../tools';
import { buildSystemPrompt } from '../context';
import { fakeTurn } from '../fake';

export type TurnInput = { kind: 'start' } | { kind: 'user'; text: string; evidenceIds: string[] } | { kind: 'decision'; choice: 'appeal_anyway' };

/** One agent turn. Gemini decides inside the INVESTIGATING state; code owns every transition. */
export async function investigate(ctx: Ctx, caseId: string, input: TurnInput) {
  const t0 = Date.now();
  try {
    if (config.aiMode === 'gemini') await geminiTurn(ctx, caseId, input);
    else await fakeTurn(ctx, caseId, input);
  } finally {
    ctx.store.mutate(caseId, (c) => {
      c.metrics.agentMs += Date.now() - t0;
    });
    publishMetrics(ctx, caseId);
  }
}

// ---------------------------------------------------------------- Gemini driver
const MAX_STEPS = 8;

function userTurnText(input: TurnInput): string {
  if (input.kind === 'start') return 'The ticket has been extracted. Start the investigation.';
  if (input.kind === 'decision')
    return 'The user chose to appeal anyway despite your recommendation. Prepare an honest appeal using only facts they stated; if they have not stated a reason, ask for it. Never invent grounds.';
  return `User: ${input.text || '(no text)'}${input.evidenceIds.length ? `\n(Uploaded photo evidence: ${input.evidenceIds.join(', ')})` : ''}`;
}

async function geminiTurn(ctx: Ctx, caseId: string, input: TurnInput) {
  ctx.store.mutate(caseId, (c) => {
    const last = c.llm.contents.at(-1);
    // Merge into the previous user content (function responses) instead of sending two user turns in a row.
    if (last?.role === 'user') last.parts = [...(last.parts ?? []), { text: userTurnText(input) }];
    else c.llm.contents.push({ role: 'user', parts: [{ text: userTurnText(input) }] });
  });
  for (let step = 0; step < MAX_STEPS; step++) {
    const c = ctx.store.must(caseId);
    const res = await gemini().models.generateContent({
      model: config.geminiModel,
      contents: c.llm.contents,
      config: { systemInstruction: buildSystemPrompt(c), tools: [{ functionDeclarations: declarationsFor(c.state) }] },
    });
    const u = res.usageMetadata;
    recordUsage(ctx, caseId, u?.promptTokenCount ?? 0, (u?.candidatesTokenCount ?? 0) + (u?.thoughtsTokenCount ?? 0));
    const content: Content | undefined = res.candidates?.[0]?.content;
    if (!content) {
      say(ctx, caseId, c.lang === 'zh' ? '我没能处理这一步，请再发一次。' : 'I could not process that — please try again.');
      return;
    }
    // Append the model content verbatim: Gemini 3 requires its thought signatures back on the next call.
    ctx.store.mutate(caseId, (r) => r.llm.contents.push(content));
    const calls = res.functionCalls ?? [];
    if (!calls.length) {
      const text = res.text?.trim();
      if (text) say(ctx, caseId, text);
      return;
    }
    const parts: Part[] = [];
    let endTurn = false;
    for (const call of calls) {
      const out: ToolOutcome = await runTool(ctx, caseId, call.name ?? '', (call.args ?? {}) as Record<string, unknown>);
      parts.push({ functionResponse: { id: call.id, name: call.name, response: out.isError ? { error: out.result } : { result: out.result } } });
      if (out.endTurn) endTurn = true;
    }
    ctx.store.mutate(caseId, (r) => r.llm.contents.push({ role: 'user', parts }));
    if (endTurn) return;
  }
  say(
    ctx,
    caseId,
    ctx.store.must(caseId).lang === 'zh' ? '这一步我需要你的帮助：请补充一下情况。' : 'I need your help to continue — could you add some detail?',
  );
}
