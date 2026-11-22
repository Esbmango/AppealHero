import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { ScenarioSchema } from '@appealhero/shared';
import { config } from '../core/config';
import { isExecBusy } from '../portal/runner';
import { HttpError } from '../core/util';
import type { Ctx } from '../core/ctx';

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
    if (ctx.store.list().some((c) => isExecBusy(c.id))) throw new HttpError(409, 'Wait for the current portal operation before resetting the demo.');
    fs.rmSync(path.join(config.dataDir, 'traces'), { force: true, recursive: true });
    ctx.store.reset();
    ctx.users.reset();
    ctx.audit.reset();
    ctx.hub.clear();
    await portal('/admin/reset', { method: 'POST' }).catch(() => null);
    return { ok: true };
  });
}
