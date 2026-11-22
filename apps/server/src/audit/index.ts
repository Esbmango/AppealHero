/**
 * Audit & proof (owner: WP8). WP0 already appends every state transition (core/fsm.ts → ctx.audit).
 * To do: append tool calls, executor steps, approvals and receipts; build GET /proof; scripts/verify-audit.mjs.
 */
export { GENESIS, hashAuditEvent, verifyChain } from '../core/store/audit';
