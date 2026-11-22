import fs from 'node:fs';
import { GoogleGenAI, type Part } from '@google/genai';
import { config } from '../../core/config';
import { publishMetrics, type Ctx } from '../../core/ctx';

let client: GoogleGenAI | null = null;

export function gemini(): GoogleGenAI {
  if (!config.geminiApiKey) throw new Error('GEMINI_API_KEY is not set (AI_MODE=gemini)');
  client ??= new GoogleGenAI({ apiKey: config.geminiApiKey });
  return client;
}

/** Accumulate token usage and the cost meter shown in the console. */
export function recordUsage(ctx: Ctx, caseId: string, tokensIn: number, tokensOut: number, cuStep = false) {
  ctx.store.mutate(caseId, (c) => {
    c.metrics.llmCalls += 1;
    c.metrics.tokensIn += tokensIn;
    c.metrics.tokensOut += tokensOut;
    if (cuStep) c.metrics.cuSteps += 1;
    c.metrics.costUsd = Number(((c.metrics.tokensIn * config.priceInPerM + c.metrics.tokensOut * config.priceOutPerM) / 1e6).toFixed(5));
  });
  publishMetrics(ctx, caseId);
}

/** One-shot structured call (extraction, photo analysis, drafting). */
export async function generateJson<T>(ctx: Ctx, caseId: string, parts: Part[], schema: object, system: string): Promise<T> {
  const res = await gemini().models.generateContent({
    model: config.geminiModel,
    contents: [{ role: 'user', parts }],
    config: { systemInstruction: system, responseMimeType: 'application/json', responseJsonSchema: schema },
  });
  const u = res.usageMetadata;
  recordUsage(ctx, caseId, u?.promptTokenCount ?? 0, (u?.candidatesTokenCount ?? 0) + (u?.thoughtsTokenCount ?? 0));
  const text = res.text ?? '';
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Gemini returned non-JSON output: ${text.slice(0, 160)}`);
  }
}

export function inlinePart(filePath: string, mimeType: string): Part {
  return { inlineData: { mimeType, data: fs.readFileSync(filePath).toString('base64') } };
}
