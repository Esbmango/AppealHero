/** A busy Gemini (503 "high demand") is retried, can fall back to another model, and is shown to users in plain words. */
import { afterEach, describe, expect, it } from 'vitest';
import { config } from '../src/core/config';
import { generate, isTransientGeminiError, setGeminiClientForTest } from '../src/agent/llm';
import { reportError, type Ctx } from '../src/core/ctx';
import { CaseStore, newCaseRecord } from '../src/core/store/cases';
import { JsonUserRepo } from '../src/core/store/users';
import { JsonAuditRepo } from '../src/core/store/audit';
import { EventHub } from '../src/core/hub';

const BUSY = new Error('{"error":{"code":503,"message":"This model is currently experiencing high demand.","status":"UNAVAILABLE"}}');
const saved = { key: config.geminiApiKey, delays: config.geminiRetryDelaysMs, fallback: config.geminiFallbackModel };
afterEach(() => {
  setGeminiClientForTest(null);
  Object.assign(config, { geminiApiKey: saved.key, geminiRetryDelaysMs: saved.delays, geminiFallbackModel: saved.fallback });
});

function fakeClient(outcomes: (Error | string)[]) {
  const models: string[] = [];
  setGeminiClientForTest({
    models: {
      generateContent: async (p: { model: string }) => {
        models.push(p.model);
        const next = outcomes.shift();
        if (next instanceof Error) throw next;
        return { text: next ?? 'ok' };
      },
    },
  });
  return models;
}

describe('Gemini retries', () => {
  it('classifies transient and permanent errors', () => {
    expect(isTransientGeminiError(BUSY)).toBe(true);
    expect(isTransientGeminiError(Object.assign(new Error('x'), { status: 429 }))).toBe(true);
    expect(isTransientGeminiError(new Error('fetch failed'))).toBe(true);
    expect(isTransientGeminiError(new Error('{"error":{"code":400,"status":"INVALID_ARGUMENT"}}'))).toBe(false);
    expect(isTransientGeminiError(new Error('API key not valid'))).toBe(false);
  });

  it('retries a 503 and succeeds; uses the fallback model only on the last attempt', async () => {
    Object.assign(config, { geminiApiKey: 'test', geminiRetryDelaysMs: [0, 0, 0], geminiFallbackModel: 'fallback-model' });
    let models = fakeClient([BUSY, BUSY, 'done']);
    expect((await generate({ model: 'main-model', contents: 'hi' })).text).toBe('done');
    expect(models).toEqual(['main-model', 'main-model', 'main-model']);
    models = fakeClient([BUSY, BUSY, BUSY, 'from fallback']);
    expect((await generate({ model: 'main-model', contents: 'hi' })).text).toBe('from fallback');
    expect(models).toEqual(['main-model', 'main-model', 'main-model', 'fallback-model']);
  });

  it('does not retry permanent errors and gives up after the last attempt', async () => {
    Object.assign(config, { geminiApiKey: 'test', geminiRetryDelaysMs: [0, 0, 0], geminiFallbackModel: undefined });
    let models = fakeClient([new Error('{"error":{"code":400}}')]);
    await expect(generate({ model: 'm', contents: 'hi' })).rejects.toThrow('400');
    expect(models).toHaveLength(1);
    models = fakeClient([BUSY, BUSY, BUSY, BUSY]);
    await expect(generate({ model: 'm', contents: 'hi' })).rejects.toThrow('high demand');
    expect(models).toHaveLength(4);
  });

  it('tells the user in their language that Gemini is busy instead of showing raw JSON', () => {
    const ctx: Ctx = { store: new CaseStore(null), hub: new EventHub(), users: new JsonUserRepo(null), audit: new JsonAuditRepo(null) };
    const c = newCaseRecord('zh');
    ctx.store.put(c);
    reportError(ctx, c.id, BUSY);
    const last = ctx.store.must(c.id).messages.at(-1)!;
    expect(last.text).toContain('Gemini 现在太忙');
    expect(last.text).not.toContain('"code"');
  });
});
