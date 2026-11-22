import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import Fastify, { type FastifyError } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { ZodError } from 'zod';
import { REPO_ROOT, config } from './core/config';
import type { Ctx } from './core/ctx';
import { TransitionError } from './core/fsm';
import { EventHub } from './core/hub';
import { CaseStore } from './core/store/cases';
import { JsonUserRepo } from './core/store/users';
import { JsonAuditRepo } from './core/store/audit';
import { HttpError } from './core/util';
import { closeBrowser } from './portal/browser/browser';
import { registerCaseRoutes } from './routes/cases';
import { registerJobRoutes } from './routes/jobs';
import { registerDemoRoutes } from './routes/demo';
import { registerUserRoutes } from './routes/users';
import { recordProofEvents } from './audit/proof';
import { registerProofRoutes } from './routes/proof';
import { registerAssistantRoutes } from './routes/assistant';

export async function buildServer() {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });
  await app.register(cors, { origin: true });
  await app.register(multipart, { limits: { fileSize: 12 * 1024 * 1024, files: 8 } });

  const store = new CaseStore(config.persist ? path.join(config.dataDir, 'cases.json') : null);
  for (const note of store.load()) app.log.warn(`[crash recovery] ${note}`);
  const users = new JsonUserRepo(config.persist ? path.join(config.dataDir, 'users.json') : null);
  const audit = new JsonAuditRepo(config.persist ? path.join(config.dataDir, 'audit.json') : null);
  const ctx: Ctx = { store, hub: new EventHub(), users, audit };

  const stopRecording = recordProofEvents(ctx);
  for (const dir of ['uploads', 'shots']) fs.mkdirSync(path.join(config.dataDir, dir), { recursive: true });
  await app.register(fastifyStatic, { root: path.join(config.dataDir, 'uploads'), prefix: '/api/files/', decorateReply: false });
  await app.register(fastifyStatic, { root: path.join(config.dataDir, 'shots'), prefix: '/api/shots/', decorateReply: false });

  // Single-origin demo: serve the built web app too (one tunnel URL for phone + laptop).
  const webDist = path.join(REPO_ROOT, 'apps/web/dist');
  if (fs.existsSync(path.join(webDist, 'index.html'))) {
    // wildcard: true → files from a rebuild are served without restarting the API
    await app.register(fastifyStatic, { root: webDist, prefix: '/', wildcard: true });
    app.setNotFoundHandler((req, reply) =>
      req.method === 'GET' && !req.url.startsWith('/api/') ? reply.sendFile('index.html') : reply.code(404).send({ error: 'not found' }),
    );
  }

  // Demo Mode gate (review P0.3): single-tenant demo with synthetic data, not a multi-user deployment.
  // When DEMO_KEY is set (always set it before opening a public tunnel), every /api call needs the key.
  if (config.demoKey) {
    const key = config.demoKey;
    app.addHook('onRequest', async (req, reply) => {
      const q = (req.query ?? {}) as { key?: string };
      const hasCookie = (req.headers.cookie ?? '').split(';').some((p) => p.trim() === `ah_demo=${key}`);
      if (q.key === key && !hasCookie) reply.header('set-cookie', `ah_demo=${key}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`);
      const ok = hasCookie || q.key === key || req.headers['x-demo-key'] === key;
      if (!ok && req.url.startsWith('/api/') && !req.url.startsWith('/api/health'))
        return reply.code(401).send({ error: 'demo key required — open the app with ?key=…' });
    });
  }

  app.setErrorHandler((err: FastifyError | Error, _req, reply) => {
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message, ...(err.body ?? {}) });
    if (err instanceof ZodError) return reply.code(400).send({ error: 'invalid request', issues: err.issues });
    if (err instanceof TransitionError) return reply.code(409).send({ error: err.message });
    app.log.error(err);
    return reply.code((err as FastifyError).statusCode ?? 500).send({ error: err.message });
  });

  registerCaseRoutes(app, ctx);
  registerJobRoutes(app, ctx);
  registerDemoRoutes(app, ctx);
  registerAssistantRoutes(app);
  registerUserRoutes(app, ctx);
  registerProofRoutes(app, ctx);

  app.addHook('onClose', async () => {
    await closeBrowser();
    stopRecording();
    store.flush();
    users.flush();
    audit.flush();
  });
  return { app, ctx };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const { app } = await buildServer();
  await app.listen({ port: config.port, host: config.host });
  app.log.info(
    `AppealHero API on :${config.port} — AI mode: ${config.aiMode}${config.aiMode === 'fake' ? ' (set GEMINI_API_KEY for the real agent)' : ` (${config.geminiModel})`}, tiers: ${config.execTiers.join(',')}, portal: ${config.mockPortalUrl}`,
  );
  // DEMO_KEY gates every /api call, localhost included: print the link that sets the key cookie
  if (config.demoKey) console.log(`\n  DEMO_KEY is on. Open the app with:  http://localhost:${config.port}/?key=${encodeURIComponent(config.demoKey)}\n`);
}
