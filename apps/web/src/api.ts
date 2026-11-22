import { AssistantResponseSchema, ProofResponseSchema, StatusCheckResponseSchema, type CaseView, type Scenario } from '@appealhero/shared';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: Record<string, unknown>,
  ) {
    super(message);
  }
}

/** fired when the server's Demo Mode gate refuses a call (DEMO_KEY is set and this browser has no key) */
export const DEMO_KEY_EVENT = 'ah:demo-key-required';

async function j<T>(input: string, init?: RequestInit): Promise<T> {
  const r = await fetch(input, init);
  const body = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (r.status === 401) window.dispatchEvent(new Event(DEMO_KEY_EVENT));
  if (!r.ok) throw new ApiError(String(body.error ?? r.statusText), r.status, body);
  return body as T;
}
const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export const api = {
  // frozen
  createCase: (fd: FormData) => j<{ caseId: string; jobId: string }>('/api/cases', { method: 'POST', body: fd }),
  postMessage: (id: string, fd: FormData) => j<{ ok: true }>(`/api/cases/${id}/messages`, { method: 'POST', body: fd }),
  approve: (id: string, payloadHash: string, activeMs?: number) =>
    j<{ jobId: string; idempotent: boolean }>(
      `/api/cases/${id}/approve`,
      json({ payloadHash, activeMs: activeMs === undefined ? undefined : Math.min(Math.round(activeMs), 600_000) }),
    ),
  resume: (id: string, body: { action: 'retry' | 'reconcile' | 'back_to_review' | 'provide_info'; field?: string; value?: string }) =>
    j<unknown>(`/api/jobs/${id}/resume`, json(body)),
  // helpers
  assistant: async (fd: FormData) => AssistantResponseSchema.parse(await j('/api/assistant', { method: 'POST', body: fd })),
  getCase: (id: string) => j<CaseView>(`/api/cases/${id}`),
  listCases: () => j<CaseView[]>('/api/cases'),
  /** gate 1: done=true asks the server to move FACTS_REVIEW → DRAFTING (422 if anything is still unconfirmed) */
  confirmFacts: (id: string, confirm: string[], done = false) => j<CaseView>(`/api/cases/${id}/facts/confirm`, json({ confirm, edits: [], done })),
  selectTicket: (id: string, ticketNumber: string) => j<CaseView>(`/api/cases/${id}/select-ticket`, json({ ticketNumber })),
  proof: async (id: string) => ProofResponseSchema.parse(await j(`/api/cases/${id}/proof`)),
  checkStatus: async (id: string) => StatusCheckResponseSchema.parse(await j(`/api/cases/${id}/status-check`, json({}))),
  editStatement: (id: string, paragraphs: { text: string; factIds: string[] }[]) =>
    j<CaseView>(`/api/cases/${id}/statement`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ paragraphs }) }),
  editFact: (id: string, factId: string, value: string) => j<CaseView>(`/api/cases/${id}/facts/confirm`, json({ confirm: [], edits: [{ id: factId, value }] })),
  decide: (id: string, choice: 'accept_pay' | 'appeal_anyway') => j<unknown>(`/api/cases/${id}/decision`, json({ choice })),
  health: () => j<{ aiMode: 'gemini' | 'fake'; model: string; cuModel: string; tiers: string[]; headless: boolean }>('/api/health'),
  demoState: () => j<{ scenario: Scenario; appeals: unknown[] }>('/api/demo/state'),
  setScenario: (scenario: Scenario) => j<{ scenario: Scenario }>('/api/demo/scenario', json({ scenario })),
  resetDemo: () => j<{ ok: true }>('/api/demo/reset', json({})),
};
