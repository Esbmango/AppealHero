import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, '../../../..');
try {
  process.loadEnvFile(path.join(REPO_ROOT, '.env'));
} catch {
  /* .env is optional */
}

export type ExecTier = 'T1' | 'T2' | 'T3';

const Env = z.object({
  PORT: z.coerce.number().default(4000),
  HOST: z.string().default('0.0.0.0'),
  MOCK_PORTAL_URL: z.string().default('http://localhost:4100'),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-3.8-flash'),
  GEMINI_FALLBACK_MODEL: z.string().optional(),
  GEMINI_CU_MODEL: z.string().default('gemini-3.8-flash'),
  AI_MODE: z.enum(['auto', 'gemini', 'fake']).default('auto'),
  APPROVAL_SECRET: z.string().optional(),
  APPROVAL_TTL_MS: z.coerce.number().default(15 * 60_000),
  EXEC_TIERS: z.string().default('T1,T2'),
  HEADLESS: z.string().default('true'),
  BROWSER_CHANNEL: z.string().optional(),
  SLOW_MO_MS: z.coerce.number().default(0),
  SUBMIT_TIMEOUT_MS: z.coerce.number().default(8000),
  MASK_PII: z.string().default('false'),
  PRICE_IN_PER_M: z.coerce.number().default(0.75),
  PRICE_OUT_PER_M: z.coerce.number().default(3.75),
  DATA_DIR: z.string().default('data'),
  DEMO_KEY: z.string().optional(),
});
const env = Env.parse(process.env);

/** No key → fake mode (the whole flow still runs offline). An explicit AI_MODE always wins. */
export function resolveAiMode(mode: 'auto' | 'gemini' | 'fake', key: string | undefined): 'gemini' | 'fake' {
  if (mode !== 'auto') return mode;
  return key ? 'gemini' : 'fake';
}

/** Mutable on purpose: tests override fields before building the server. Always read config.x at call time. */
export const config = {
  port: env.PORT,
  host: env.HOST,
  mockPortalUrl: env.MOCK_PORTAL_URL.replace(/\/$/, ''),
  geminiApiKey: env.GEMINI_API_KEY || undefined,
  geminiModel: env.GEMINI_MODEL,
  /** used for the last retry when GEMINI_MODEL keeps failing with transient errors */
  geminiFallbackModel: env.GEMINI_FALLBACK_MODEL || undefined,
  geminiRetryDelaysMs: [1500, 4000, 9000] as number[],
  cuModel: env.GEMINI_CU_MODEL,
  aiMode: resolveAiMode(env.AI_MODE, env.GEMINI_API_KEY),
  approvalSecret: env.APPROVAL_SECRET || randomBytes(32).toString('hex'),
  approvalTtlMs: env.APPROVAL_TTL_MS,
  execTiers: env.EXEC_TIERS.split(',')
    .map((s) => s.trim())
    .filter((s): s is ExecTier => s === 'T1' || s === 'T2' || s === 'T3'),
  headless: env.HEADLESS !== 'false',
  browserChannel: env.BROWSER_CHANNEL || undefined,
  slowMoMs: env.SLOW_MO_MS,
  submitTimeoutMs: env.SUBMIT_TIMEOUT_MS,
  maskPii: env.MASK_PII === 'true',
  priceInPerM: env.PRICE_IN_PER_M,
  priceOutPerM: env.PRICE_OUT_PER_M,
  dataDir: path.resolve(REPO_ROOT, env.DATA_DIR),
  /** Demo Mode gate for public tunnels: when set, /api/* needs the key (open the app once with ?key=…). */
  demoKey: env.DEMO_KEY || undefined,
  persist: true,
};
export type Config = typeof config;
