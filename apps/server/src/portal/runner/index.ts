import fs from 'node:fs';
import path from 'node:path';
import { readLookup } from '../adapters/mockBoston/lookup';
import { tracePath } from '../../audit/proof';
import type { BrowserContext } from 'playwright';
import { ADAPTER_VERSION, type TicketQuery, type ApprovalPayload, type Receipt, type Tier } from '@appealhero/shared';
import { config } from '../../core/config';
import { buildApprovalPayload, hashPayload, verifyToken } from '../../approval';
import { publishMetrics, reportError, type Ctx } from '../../core/ctx';
import { transition } from '../../core/fsm';
import type { CaseRecord } from '../../core/types';
import { HttpError, newId, now } from '../../core/util';
import { exclusive, isHeld } from '../../core/locks';
import { BlockedError, NeedsUserError, PortalSession, SUBMIT_PATH, type ReviewReadback, type SessionHooks } from '../adapters/mockBoston';
import { VIEWPORT, getBrowser } from '../browser/browser';
import { Interlock, installNetworkGuard } from '../browser/guard';

const execKey = (caseId: string) => `exec:${caseId}`;
/** A job or reconcile currently holds this case's browser lock. */
export const isExecBusy = (caseId: string) => isHeld(execKey(caseId));
const MAX_ATTEMPTS = 2;
/** Status page did not show the appeal after an unknown result: pause for the user (no automatic resubmission). */
export const NOT_FOUND_CODE = 'NOT_FOUND_AFTER_UNKNOWN';

function hooks(ctx: Ctx, caseId: string): SessionHooks {
  return {
    ctx,
    caseId,
    tiers: config.execTiers,
    step: (step, status, tier, detail) => ctx.hub.emit({ type: 'exec.step', caseId, step, status, tier, detail }),
    tier: (tier: Tier) =>
      ctx.store.mutate(caseId, (c) => {
        c.metrics.tiers[tier] = (c.metrics.tiers[tier] ?? 0) + 1;
      }),
    cuStep: () =>
      ctx.store.mutate(caseId, (c) => {
        c.metrics.cuSteps += 1;
      }),
  };
}

async function newGuardedPage(ctx: Ctx, caseId: string, interlock: Interlock) {
  const browser = await getBrowser();
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, locale: 'en-US' });
  await installNetworkGuard(context, {
    allowedOrigin: new URL(config.mockPortalUrl).origin,
    submitPath: SUBMIT_PATH,
    interlock,
    onBlocked: (url, why) => ctx.hub.emit({ type: 'exec.step', caseId, step: 'network-guard', status: 'blocked', detail: `${why}: ${url}` }),
  });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  // Known overlays are dismissed explicitly at each step (PortalSession.dismissOverlays) rather than with
  // page.addLocatorHandler: the handler only fires on locator actions, never on Computer Use mouse events.
  return { context, page };
}

export async function lookupTickets(ctx: Ctx, caseId: string, query: TicketQuery) {
  const g = await newGuardedPage(ctx, caseId, new Interlock());
  try {
    await g.context.route('**/*', (route) => (route.request().method() === 'GET' ? route.fallback() : route.abort('blockedbyclient')));
    return await readLookup(g.page, config.mockPortalUrl, query);
  } finally {
    await g.context.close();
  }
}

function readbackPayload(approved: ApprovalPayload, review: ReviewReadback): ApprovalPayload {
  const shownByName = new Map(review.evidence.map((e) => [e.filename, e.bytes]));
  const evidenceMatches = review.evidence.length === approved.evidence.length && approved.evidence.every((e) => shownByName.get(e.filename) === e.bytes);
  return {
    ...approved,
    fields: review.fields,
    extra: review.extra,
    evidence: evidenceMatches ? approved.evidence : review.evidence.map((e) => ({ sha256: 'NOT-MATCHED', filename: e.filename, mime: '?', bytes: e.bytes })),
  };
}

function diff(a: ApprovalPayload, b: ApprovalPayload): string[] {
  const out: string[] = [];
  for (const k of Object.keys(a.fields) as (keyof ApprovalPayload['fields'])[]) if (a.fields[k] !== b.fields[k]) out.push(k);
  if (JSON.stringify(a.extra) !== JSON.stringify(b.extra)) out.push('extra fields');
  if (JSON.stringify(a.evidence) !== JSON.stringify(b.evidence)) out.push('evidence');
  return out;
}

async function finishSubmitted(ctx: Ctx, caseId: string, receipt: Omit<Receipt, 'at'>) {
  const full: Receipt = { ...receipt, at: now() };
  transition(
    ctx,
    caseId,
    'SUBMITTED',
    'executor',
    `receipt ${receipt.confirmationNumber} via ${receipt.source}${receipt.alreadyOnFile ? ' (already on file)' : ''}`,
    (r) => {
      r.receipt = full;
    },
  );
  ctx.hub.emit({ type: 'receipt', caseId, receipt: full });
}

function toNeedsUser(ctx: Ctx, caseId: string, code: string, reason: string, field?: string) {
  transition(ctx, caseId, 'NEEDS_USER', 'executor', reason, (r) => {
    r.needsUser = { code, reason, resumeTo: 'FILLING', field };
  });
}

/**
 * Executor job: verify approval → FILLING → read-back gate → SUBMITTING (one shot) → VERIFYING → SUBMITTED.
 * Timeouts after the click never retry blindly: UNKNOWN_RESULT → reconcile via the status page.
 */
export async function runJob(ctx: Ctx, caseId: string): Promise<void> {
  let goReconcile = false;
  const ran = await exclusive(execKey(caseId), async () => {
    goReconcile = await runJobNow(ctx, caseId);
  });
  if (ran && goReconcile) await reconcile(ctx, caseId);
}

/** Returns true when the result is unknown and the status page must be checked. */
async function runJobNow(ctx: Ctx, caseId: string): Promise<boolean> {
  const t0 = Date.now();
  let context: BrowserContext | null = null;
  let goReconcile = false;
  let tracing = false;
  async function closeJobBrowser() {
    if (!context) return;
    await finishTrace();
    await context.close().catch(() => {});
    context = null;
  }
  async function finishTrace() {
    if (!context || !tracing) return;
    tracing = false;
    const file = tracePath(caseId);
    const tmp = path.join(path.dirname(file), newId('job') + '.zip');
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      await context.tracing.stop({ path: tmp });
      if (fs.existsSync(file)) fs.renameSync(file, path.join(path.dirname(file), newId('previous') + '.zip'));
      fs.renameSync(tmp, file);
      ctx.store.mutate(caseId, (r) => {
        if (r.approval) r.approval.traceReady = true;
      });
    } catch (err) {
      ctx.hub.emit({ type: 'exec.step', caseId, step: 'trace', status: 'fail', detail: 'Browser recording could not be saved.' });
    }
  }
  try {
    const c0 = ctx.store.must(caseId);
    // Defense in depth: re-derive the payload from current state and verify the signed approval against it.
    const payload = buildApprovalPayload(c0);
    const ph = hashPayload(payload);
    const check = c0.approval ? verifyToken(config.approvalSecret, c0.approval.token, { caseId, payloadHash: ph, adapterVersion: ADAPTER_VERSION }) : null;
    if (!check?.ok) {
      const reason = `approval invalid (${check ? check.reason : 'no approval'}) — please review and approve again`;
      if (c0.state === 'UNKNOWN_RESULT')
        transition(ctx, caseId, 'NEEDS_USER', 'system', reason, (r) => {
          r.needsUser = { code: 'REAPPROVE', reason, resumeTo: 'STATEMENT_REVIEW' };
        });
      else
        transition(ctx, caseId, 'STATEMENT_REVIEW', 'system', reason, (r) => {
          r.approval = undefined;
        });
      return false;
    }
    const attempts = c0.approval!.attempts;
    if (attempts >= MAX_ATTEMPTS || (attempts >= 1 && c0.approval!.lastReconcile !== 'NOT_FOUND')) {
      const reason = 'A previous submission attempt was not proven to have failed — not retrying automatically.';
      if (c0.state === 'UNKNOWN_RESULT')
        transition(ctx, caseId, 'NEEDS_USER', 'system', reason, (r) => {
          r.needsUser = { code: 'ATTEMPTS_EXHAUSTED', reason };
        });
      else reportError(ctx, caseId, new Error(reason));
      return false;
    }
    transition(ctx, caseId, 'FILLING', 'executor', c0.state === 'APPROVED' ? 'executor started' : `retry from ${c0.state}`);

    const interlock = new Interlock();
    const g = await newGuardedPage(ctx, caseId, interlock);
    context = g.context;
    await context.tracing.start({ screenshots: true, snapshots: true });
    tracing = true;
    ctx.store.mutate(caseId, (r) => {
      r.approval!.traceReady = false;
      r.approval!.readbackHash = undefined;
      r.approval!.readbackMatches = undefined;
    });
    const portal = new PortalSession(g.page, config.mockPortalUrl, hooks(ctx, caseId));

    // 0) Duplicate pre-check — never file twice for the same ticket.
    const pre = await portal.checkStatus(payload.fields.ticketNumber);
    if (pre.found && pre.confirmationNumber) {
      await closeJobBrowser();
      await finishSubmitted(ctx, caseId, { confirmationNumber: pre.confirmationNumber, source: 'status_page', alreadyOnFile: true });
      return false;
    }

    await portal.stepStart(payload);
    await portal.stepDetails(payload);
    const files = ctx.store
      .must(caseId)
      .evidence.filter((e) => e.submitToPortal)
      .map((e) => ({ name: e.filename, mimeType: e.mime, buffer: fs.readFileSync(e.path) }));
    await portal.stepEvidence(files);
    const review = await portal.readReview();
    if (review.captcha)
      throw new BlockedError(
        'CAPTCHA',
        'The portal asks for human verification. AppealHero never bypasses CAPTCHAs — finish it yourself using the manual filing pack.',
      );

    // 1) Read-back gate: what the portal shows must hash to exactly what the user approved.
    const rb = readbackPayload(payload, review);
    const rbHash = hashPayload(rb);
    ctx.store.mutate(caseId, (r) => {
      r.approval!.readbackHash = rbHash;
      r.approval!.readbackMatches = rbHash === ph;
    });
    ctx.audit.append({ caseId, type: 'readback', actor: 'executor', data: { approvedPayloadHash: ph, readbackHash: rbHash, match: rbHash === ph } });
    if (rbHash !== ph)
      throw new NeedsUserError(
        'READBACK_MISMATCH',
        `The portal shows different values than you approved (${diff(payload, rb).join(', ')}). Nothing was submitted.`,
      );
    ctx.hub.emit({
      type: 'exec.step',
      caseId,
      step: 'read-back',
      status: 'ok',
      detail: `portal values hash ${rbHash.slice(0, 12)}… = approved ${ph.slice(0, 12)}…`,
    });

    // 2) Submit exactly once.
    // Write-ahead: the attempt is on disk (transition() flushes synchronously) BEFORE the interlock is armed and the
    // button is clicked, so a crash at any point after this line recovers to UNKNOWN_RESULT → reconcile, never "safe to retry".
    transition(ctx, caseId, 'SUBMITTING', 'executor', `read-back verified (${rbHash.slice(0, 12)}…) — submitting once`, (r) => {
      r.approval!.attempts += 1;
      r.approval!.lastReconcile = undefined;
      r.submission = { attemptId: newId('sub'), payloadHash: ph, startedAt: now() };
    });
    interlock.armOnce();
    const outcome = await portal.submit(config.submitTimeoutMs);
    interlock.disarm();

    if (outcome.kind === 'confirmed') {
      transition(
        ctx,
        caseId,
        'VERIFYING',
        'executor',
        `confirmation page shows ${outcome.confirmationNumber}${outcome.alreadyOnFile ? ' (already on file)' : ''}`,
      );
      const emailVerified = await portal.checkInbox(payload.fields.email, outcome.confirmationNumber).catch(() => false);
      await closeJobBrowser();
      await finishSubmitted(ctx, caseId, {
        confirmationNumber: outcome.confirmationNumber,
        source: 'confirmation_page',
        emailVerified,
        alreadyOnFile: outcome.alreadyOnFile,
      });
    } else {
      transition(ctx, caseId, 'UNKNOWN_RESULT', 'executor', 'no confirmation before timeout — checking the status page before doing anything else');
      goReconcile = true;
    }
  } catch (err) {
    await closeJobBrowser();
    handleError(ctx, caseId, err);
    if (ctx.store.get(caseId)?.state === 'UNKNOWN_RESULT') goReconcile = true;
  } finally {
    await closeJobBrowser();
    ctx.store.mutate(caseId, (c) => {
      c.metrics.execMs += Date.now() - t0;
    });
    publishMetrics(ctx, caseId);
  }
  return goReconcile;
}

function handleError(ctx: Ctx, caseId: string, err: unknown) {
  const c: CaseRecord | undefined = ctx.store.get(caseId);
  if (!c) return;
  const msg = err instanceof Error ? err.message : String(err);
  if (c.state === 'FILLING') {
    if (err instanceof BlockedError)
      transition(ctx, caseId, 'BLOCKED', 'executor', msg, (r) => {
        r.needsUser = { code: err.code, reason: msg, resumeTo: 'FILLING' };
      });
    else if (err instanceof NeedsUserError) toNeedsUser(ctx, caseId, err.code, msg, err.field);
    else toNeedsUser(ctx, caseId, 'EXEC_ERROR', `Automation error before submission (nothing was submitted): ${msg}`);
  } else if (c.state === 'SUBMITTING' || c.state === 'VERIFYING') {
    transition(ctx, caseId, 'UNKNOWN_RESULT', 'executor', `error during submission: ${msg}`);
  } else {
    reportError(ctx, caseId, err);
  }
}

/** UNKNOWN_RESULT (or a paused NOT_FOUND) → read-only look at the portal's status page. Found → SUBMITTED. Not found → NEEDS_USER. */
export async function reconcile(ctx: Ctx, caseId: string): Promise<void> {
  // Shares the executor key: a job and a reconcile (or two reconciles) never drive browsers on the same case at once.
  await exclusive(execKey(caseId), () => reconcileNow(ctx, caseId));
}

export async function readPortalStatus(ctx: Ctx, id: string) {
  const ticket = ctx.store.must(id).ticket?.ticketNumber;
  if (!ticket) throw new HttpError(409, 'Identify a ticket before checking its status.');
  let result: { found: boolean; confirmationNumber?: string; checkedAt: string } | undefined;
  const ran = await exclusive(execKey(id), async () => {
    const g = await newGuardedPage(ctx, id, new Interlock());
    try {
      // Status checks only need GET. Deny any write even if the simulated page changes.
      await g.context.route('**/*', (route) => (['GET', 'HEAD'].includes(route.request().method()) ? route.fallback() : route.abort('blockedbyclient')));
      const session = new PortalSession(g.page, config.mockPortalUrl, hooks(ctx, id));
      result = { ...(await session.checkStatus(ticket)), checkedAt: now() };
    } finally {
      await g.context.close();
    }
  });
  if (!ran || !result) throw new HttpError(409, 'A portal check or filing is in progress.');
  return result;
}

async function reconcileNow(ctx: Ctx, caseId: string): Promise<void> {
  const c = ctx.store.must(caseId);
  if (c.state !== 'UNKNOWN_RESULT' && !(c.state === 'NEEDS_USER' && c.needsUser?.code === NOT_FOUND_CODE)) return;
  let context: BrowserContext | null = null;
  try {
    const g = await newGuardedPage(ctx, caseId, new Interlock()); // interlock never armed: no submit possible here
    context = g.context;
    const portal = new PortalSession(g.page, config.mockPortalUrl, hooks(ctx, caseId));
    const ticket = buildApprovalPayload(c).fields.ticketNumber;
    const st = await portal.checkStatus(ticket);
    if (st.found && st.confirmationNumber) {
      ctx.store.mutate(caseId, (r) => {
        if (r.approval) r.approval.lastReconcile = 'FOUND';
      });
      await finishSubmitted(ctx, caseId, { confirmationNumber: st.confirmationNumber, source: 'status_page' });
      return;
    }
    ctx.store.mutate(caseId, (r) => {
      if (r.approval) r.approval.lastReconcile = 'NOT_FOUND';
    });
    // Conservative by design: "not on the status page" does not prove "never submitted" (portals can lag).
    // We pause and let the user decide; a retry is safe because the portal accepts one appeal per ticket.
    const canRetry = (ctx.store.must(caseId).approval?.attempts ?? MAX_ATTEMPTS) < MAX_ATTEMPTS;
    const code = canRetry ? NOT_FOUND_CODE : 'STILL_UNKNOWN';
    const reason = canRetry
      ? 'The portal does not show this appeal yet. It may not have gone through, or the portal may be slow. Check again, or retry (the portal accepts only one appeal per ticket, so a retry cannot create a duplicate).'
      : 'Still no appeal on file after the retry. Check your email for a receipt, or file manually with the pack below.';
    ctx.hub.emit({
      type: 'exec.step',
      caseId,
      step: 'reconcile',
      status: 'info',
      detail: 'status page: not found → paused for the user (no automatic resubmission)',
    });
    const needsUser = { code, reason, resumeTo: canRetry ? ('FILLING' as const) : undefined };
    if (ctx.store.must(caseId).state === 'UNKNOWN_RESULT')
      transition(ctx, caseId, 'NEEDS_USER', 'system', reason, (r) => {
        r.needsUser = needsUser;
      });
    else {
      ctx.store.mutate(caseId, (r) => {
        r.needsUser = needsUser;
      });
      ctx.hub.emit({ type: 'needs_user', caseId, needsUser });
    }
  } catch (err) {
    reportError(ctx, caseId, err); // state unchanged; the user can resume → reconcile again
  } finally {
    if (context) await context.close().catch(() => {});
  }
}
