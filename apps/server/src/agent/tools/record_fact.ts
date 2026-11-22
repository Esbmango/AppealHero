import { z } from 'zod';
import { defineTool, type ToolResult } from '@appealhero/shared';
import type { ToolCtx } from './types';
import { publishFacts, type Ctx } from '../../core/ctx';
import { str } from '../../core/util';
import { latestFact, upsertFact } from '../policy/facts';

const params = z.object({
  key: z.string().regex(/^[a-zA-Z][\w-]{0,40}$/),
  label: z.string(),
  value: z.string().min(1),
  english: z.string().optional().describe('English translation if the value is not in English'),
  provenance: z.enum(['USER_TEXT', 'USER_VOICE']),
});

export const recordFactTool = defineTool<ToolCtx, typeof params>({
  name: 'record_fact',
  description:
    'Record something the user told you (status USER_STATEMENT). You can never mark a fact CONFIRMED — only the user can, on the review screen. Keys: fullName, mailingAddress, email, userAccount, vehicleMatches, …',
  stages: ['INVESTIGATING'],
  params,
  run: (t, a) => recordFact(t.ctx, t.caseId, a),
});

const TICKET_KEYS = ['ticketNumber', 'plateNumber', 'plateState', 'issuedAt', 'location', 'violation', 'fineAmount'];

function recordFact(ctx: Ctx, caseId: string, a: Record<string, unknown>): ToolResult {
  const key = str(a.key);
  if (!/^[a-zA-Z][\w-]{0,40}$/.test(key)) throw new Error('key must be camelCase letters/digits');
  if (TICKET_KEYS.includes(key)) throw new Error(`${key} comes from the ticket and is confirmed by the user on the review screen — do not overwrite it`);
  const value = str(a.value).trim();
  if (!value) throw new Error('value is required');
  const c = ctx.store.must(caseId);
  const existing = latestFact(c, key);
  if (existing && existing.value === value && existing.status === 'CONFIRMED') return { result: { factId: existing.id, status: 'already confirmed' } };
  let id = '';
  ctx.store.mutate(caseId, (r) => {
    id = upsertFact(r, {
      key,
      label: str(a.label) || key,
      value,
      note: str(a.english) || undefined,
      provenance: a.provenance === 'USER_VOICE' ? 'USER_VOICE' : 'USER_TEXT',
      status: 'USER_STATEMENT',
    }).id;
  });
  publishFacts(ctx, caseId);
  return { result: { factId: id, status: 'USER_STATEMENT — the user confirms it on the review screen' } };
}
