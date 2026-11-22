import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import Fastify, { type FastifyError } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { ZodError } from 'zod';
import { REPO_ROOT, config } from './config';
import type { Ctx } from './ctx';
import { TransitionError } from './fsm';
import { EventHub } from './hub';
import { CaseStore } from './store';
import { HttpError } from './util';
import { closeBrowser } from './executor/browser';
import { registerCaseRoutes } from './routes/cases';
import { registerJobRoutes } from './routes/jobs';
import { registerDemoRoutes } from './routes/demo';

export async function buildServer() {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });
  await app.register(cors, { origin: true });
  await app.register(multipart, { limits: { fileSize: 12 * 1024 * 1024, files: 8 } });

  const store = new CaseStore(config.persist ? path.join(config.dataDir, 'cases.json') : null);
  for (const note of store.load()) app.log.warn(`[crash recovery] ${note}`);
  const ctx: Ctx = { store, hub: new EventHub() };

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

  app.addHook('onClose', async () => {
    await closeBrowser();
    store.flush();
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
}
