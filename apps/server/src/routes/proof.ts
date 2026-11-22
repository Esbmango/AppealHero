import type { FastifyInstance } from 'fastify';
import { V2_API } from '@appealhero/shared';
import type { Ctx } from '../core/ctx';
import { HttpError } from '../core/util';

/** Proof page data, trace download, read-only status check — owner WP8. Contract: ProofResponseSchema etc. */
export function registerProofRoutes(app: FastifyInstance, ctx: Ctx) {
  const todo = (what: string) => async (req: { params: unknown }) => {
    ctx.store.must((req.params as { id: string }).id);
    throw new HttpError(501, `${what} is not implemented yet (WP8)`);
  };
  app.get('/api/cases/:id/proof', todo(V2_API.proof));
  app.get('/api/cases/:id/trace', todo(V2_API.trace));
  app.post('/api/cases/:id/status-check', todo(V2_API.statusCheck));
}
