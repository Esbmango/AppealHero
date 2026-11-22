import type { FastifyInstance } from 'fastify';
import { V2_API } from '@appealhero/shared';
import type { Ctx } from '../core/ctx';
import { HttpError } from '../core/util';

/** Accounts & demo personas — owner WP1 (docs/TASKS.md). Contract: V2_API + packages/shared/src/api.ts. */
export function registerUserRoutes(app: FastifyInstance, _ctx: Ctx) {
  const todo = (what: string) => async () => {
    throw new HttpError(501, `${what} is not implemented yet (WP1)`);
  };
  app.get('/api/me', todo(V2_API.me));
  app.put('/api/me', todo(V2_API.updateMe));
  app.post('/api/me/vehicles', todo(V2_API.addVehicle));
  app.delete('/api/me/vehicles/:id', todo(V2_API.deleteVehicle));
  app.post('/api/session/persona', todo(V2_API.persona));
}
