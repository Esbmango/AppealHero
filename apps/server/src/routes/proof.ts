import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { proof, tracePath } from '../audit/proof';
import { readPortalStatus } from '../portal/runner';
import type { Ctx } from '../core/ctx';
import { HttpError } from '../core/util';

/** Proof page data, trace download, read-only status check — owner WP8. Contract: ProofResponseSchema etc. */
export function registerProofRoutes(app: FastifyInstance, ctx: Ctx) {
  type Route = { Params: { id: string } };
  app.get<Route>('/api/cases/:id/proof', async (req) => proof(ctx, req.params.id));
  app.get<Route>('/api/cases/:id/trace', async (req, reply) => {
    const c = ctx.store.must(req.params.id);
    const file = tracePath(c.id);
    if (!c.approval?.traceReady || !fs.existsSync(file)) throw new HttpError(404, 'No completed browser recording is available.');
    return reply
      .header('cache-control', 'no-store')
      .header('content-disposition', 'attachment; filename="trace.zip"')
      .type('application/zip')
      .send(fs.createReadStream(file));
  });
  app.post<Route>('/api/cases/:id/status-check', async (req) => readPortalStatus(ctx, req.params.id));
}
