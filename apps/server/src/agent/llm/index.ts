import fs from 'node:fs';
import { GoogleGenAI, type GenerateContentParameters, type GenerateContentResponse, type Part } from '@google/genai';
import { config } from '../../core/config';
import { publishMetrics, type Ctx } from '../../core/ctx';

let client: GoogleGenAI | null = null;

export function gemini(): GoogleGenAI {
  if (!config.geminiApiKey) throw new Error('GEMINI_API_KEY is not set (AI_MODE=gemini)');
  client ??= new GoogleGenAI({ apiKey: config.geminiApiKey });
  return client;
}
/** Tests only: swap the client. */
export function setGeminiClientForTest(fake: unknown) {
  client = fake as GoogleGenAI | null;
}

/** Overload, rate limit, server and network errors: worth retrying. Bad requests and auth errors are not. */
export function isTransientGeminiError(err: unknown): boolean {
  const status = (err as { status?: number; code?: number } | undefined)?.status ?? (err as { code?: number } | undefined)?.code;
  if (typeof status === 'number' && [408, 429, 500, 502, 503, 504].includes(status)) return true;
  const text = err instanceof Error ? err.message : String(err);
  return /"code":\s*(408|429|500|502|503|504)\b|\b(UNAVAILABLE|RESOURCE_EXHAUSTED|DEADLINE_EXCEEDED|INTERNAL)\b|high demand|overloaded|ECONNRESET|ETIMEDOUT|fetch failed/i.test(
    text,
  );
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * generateContent with retries for transient errors (e.g. 503 "high demand"): waits 1.5 s, 4 s, 9 s.
 * If GEMINI_FALLBACK_MODEL is set, the last attempt uses it. Non-transient errors are thrown at once.
 */
export async function generate(params: GenerateContentParameters): Promise<GenerateContentResponse> {
  const delays = config.geminiRetryDelaysMs;
  for (let attempt = 0; ; attempt++) {
    const last = attempt >= delays.length;
    const model = last && config.geminiFallbackModel ? config.geminiFallbackModel : params.model;
    try {
      return await gemini().models.generateContent({ ...params, model });
    } catch (err) {
      if (last || !isTransientGeminiError(err)) throw err;
      await sleep(delays[attempt]);
    }
  }
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
  const res = await generate({
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
