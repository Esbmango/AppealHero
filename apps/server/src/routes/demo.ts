import type { FastifyInstance } from 'fastify';
import { ScenarioSchema } from '@appealhero/shared';
import { config } from '../config';
import type { Ctx } from '../ctx';

/** Demo-only helpers: flip mock-portal scenarios from the desktop console, reset between judge visits. */
export function registerDemoRoutes(app: FastifyInstance, ctx: Ctx) {
  const portal = (p: string, init?: RequestInit) => fetch(`${config.mockPortalUrl}${p}`, init).then((r) => r.json());

  app.get('/api/health', async () => ({
    ok: true,
    aiMode: config.aiMode,
    model: config.geminiModel,
    cuModel: config.cuModel,
    tiers: config.execTiers,
    portal: config.mockPortalUrl,
    headless: config.headless,
  }));

  app.get('/api/demo/state', async () => portal('/admin/state'));

  app.post('/api/demo/scenario', async (req) => {
    const scenario = ScenarioSchema.parse((req.body as { scenario?: string } | undefined)?.scenario);
    return portal('/admin/scenario', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scenario }) });
  });

  app.post('/api/demo/reset', async () => {
    ctx.store.reset();
    ctx.hub.clear();
    await portal('/admin/reset', { method: 'POST' }).catch(() => null);
    return { ok: true };
  });
}
