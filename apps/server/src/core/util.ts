import { createHash, randomBytes } from 'node:crypto';
import type { Metrics } from '@appealhero/shared';

export const now = () => new Date().toISOString();
export const newId = (prefix: string) => `${prefix}_${randomBytes(5).toString('hex')}`;
export const sha256Hex = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
export const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
export const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const emptyMetrics = (): Metrics => ({
  llmCalls: 0,
  tokensIn: 0,
  tokensOut: 0,
  costUsd: 0,
  cuSteps: 0,
  userActiveMs: 0,
  agentMs: 0,
  execMs: 0,
  questionsAsked: 0,
  tiers: {},
});
