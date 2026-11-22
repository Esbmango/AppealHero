import type { Page } from 'playwright';
import {
  PORTAL_FIELDS,
  fieldsForStep,
  normalizeText,
  sameValue,
  type ApprovalPayload,
  type PortalField,
  type PortalFieldId,
  type Tier,
} from '@appealhero/shared';
import { config, type ExecTier } from '../../../core/config';
import type { Ctx } from '../../../core/ctx';
import { gemini, recordUsage } from '../../../agent/llm';
import { snap } from '../../browser/shots';
import { CuHandoff, FakeCuModel, GeminiCuModel, locateByHints, runCuFill, type CuModel } from '../../cu';

/** Adapter for the SIMULATED Boston appeal portal. A real portal needs its own adapter + permission. */
export const SUBMIT_PATH = /\/appeal\/submit\/?$/;

export class NeedsUserError extends Error {
  constructor(
    public code: string,
    message: string,
    public field?: string,
  ) {
    super(message);
  }
}
export class BlockedError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface ReviewReadback {
  fields: Record<PortalFieldId, string>;
  extra: Record<string, string>;
  evidence: { filename: string; bytes: number }[];
  captcha: boolean;
}

export interface SessionHooks {
  ctx: Ctx;
  caseId: string;
  tiers: ExecTier[];
  step: (step: string, status: 'start' | 'ok' | 'fail' | 'blocked' | 'info', tier?: Tier, detail?: string) => void;
  tier: (tier: Tier) => void;
  cuStep: () => void;
}

export function createCuModel(field: PortalField, value: string): CuModel {
  return config.aiMode === 'gemini' ? new GeminiCuModel(gemini(), config.cuModel) : new FakeCuModel(field, value);
}

export class PortalSession {
  constructor(
    private page: Page,
    private base: string,
    private h: SessionHooks,
  ) {}

  private snap(label: string) {
    return snap(this.h.ctx, this.h.caseId, this.page, label);
  }

  async checkStatus(ticket: string): Promise<{ found: boolean; confirmationNumber?: string }> {
    await this.page.goto(`${this.base}/status?ticket=${encodeURIComponent(ticket)}`);
    const el = this.page.locator('[data-appeal-status]');
    await el.waitFor();
    const status = await el.getAttribute('data-appeal-status');
    const conf = (await el.getAttribute('data-confirmation')) ?? undefined;
    this.h.step('status-check', 'info', 'T1', status === 'RECEIVED' ? `appeal already on file: ${conf}` : 'no appeal on file for this ticket');
    return { found: status === 'RECEIVED', confirmationNumber: conf };
  }

  /** Start page is navigated to directly; later pages are reached by the portal's own redirects (session id in URL). */
  async stepStart(p: ApprovalPayload) {
    this.h.step('start', 'start');
    await this.page.goto(`${this.base}/appeal/start`);
    await this.dismissOverlays();
    await this.snap('start');
    for (const f of fieldsForStep('start')) await this.fill(f, p.fields[f.id]);
    await this.assertNoMissingRequired();
    await this.clickContinue(/\/appeal\/details/);
    this.h.step('start', 'ok');
  }

  async stepDetails(p: ApprovalPayload) {
    this.h.step('details', 'start');
    await this.dismissOverlays();
    for (const f of fieldsForStep('details')) await this.fill(f, p.fields[f.id]);
    for (const [label, value] of Object.entries(p.extra)) await this.fillExtra(label, value);
    await this.assertNoMissingRequired();
    await this.snap('details-filled');
    await this.clickContinue(/\/appeal\/evidence/);
    this.h.step('details', 'ok');
  }

  /** File inputs are always deterministic — Computer Use cannot drive native file pickers. */
  async stepEvidence(files: { name: string; mimeType: string; buffer: Buffer }[]) {
    this.h.step('evidence', 'start');
    let input = this.page.getByLabel(/upload evidence/i);
    let tier: Tier = 'T1';
    if ((await input.count()) !== 1) {
      input = this.page.locator('input[type=file]');
      tier = 'FILE';
      if ((await input.count()) !== 1) throw new NeedsUserError('UPLOAD_NOT_FOUND', 'Could not find the evidence upload control on the portal');
    }
    await input.setInputFiles(files);
    this.h.tier(tier);
    await this.snap('evidence');
    await this.clickContinue(/\/appeal\/review/);
    this.h.step('evidence', 'ok', tier, `${files.length} file(s) uploaded`);
  }

  async readReview(): Promise<ReviewReadback> {
    await this.page.locator('[data-review-field]').first().waitFor();
    await this.snap('review');
    const fields = {} as Record<PortalFieldId, string>;
    for (const f of PORTAL_FIELDS) {
      const el = this.page.locator(`[data-review-field="${f.id}"]`);
      fields[f.id] = normalizeText((await el.getAttribute('data-value')) ?? (await el.textContent()) ?? '');
    }
    const extra: Record<string, string> = {};
    for (const el of await this.page.locator('[data-review-extra]').all()) {
      const label = (await el.getAttribute('data-review-extra')) ?? '';
      extra[label] = normalizeText((await el.textContent()) ?? '');
    }
    const evidence = await this.page
      .locator('[data-review-evidence]')
      .evaluateAll((els) => els.map((e) => ({ filename: e.getAttribute('data-filename') ?? '', bytes: Number(e.getAttribute('data-bytes') ?? 0) })));
    const captcha = (await this.page.locator('[data-captcha]').count()) > 0;
    return { fields, extra, evidence, captcha };
  }

  /** Called only after the read-back gate passed and the interlock is armed. Classifies conservatively. */
  async submit(timeoutMs: number): Promise<{ kind: 'confirmed'; confirmationNumber: string } | { kind: 'unknown'; detail: string }> {
    await this.page.getByLabel(/I certify/i).check();
    const byId = this.page.locator('#submitAppeal');
    const button = (await byId.count()) === 1 ? byId : this.page.getByRole('button', { name: /submit appeal/i });
    this.h.step('submit', 'start', 'T1', 'one-shot interlock armed — submitting exactly once');
    try {
      await Promise.all([this.page.waitForURL(/\/appeal\/confirmation\//, { timeout: timeoutMs }), button.click({ timeout: timeoutMs })]);
    } catch (err) {
      this.h.step('submit', 'fail', undefined, `no confirmation within ${timeoutMs} ms — result unknown`);
      return { kind: 'unknown', detail: String((err as Error).message ?? err).slice(0, 160) };
    }
    const conf = ((await this.page.locator('[data-confirmation]').first().textContent()) ?? '').trim();
    await this.snap('confirmation');
    this.h.step('submit', 'ok', undefined, `confirmation ${conf}`);
    return { kind: 'confirmed', confirmationNumber: conf };
  }

  async checkInbox(email: string, confirmationNumber: string): Promise<boolean> {
    await this.page.goto(`${this.base}/inbox?email=${encodeURIComponent(email)}`);
    const found = (await this.page.locator(`[data-receipt][data-confirmation="${confirmationNumber}"]`).count()) > 0;
    this.h.step('email-receipt', found ? 'ok' : 'info', 'T1', found ? 'email receipt found' : 'email receipt not found (yet)');
    return found;
  }

  // -------------------------------------------------------------- internals
  private async dismissOverlays() {
    const dlg = this.page.getByRole('dialog');
    if ((await dlg.count()) && (await dlg.first().isVisible())) {
      await this.snap('unexpected-modal');
      await dlg.first().getByRole('button').first().click();
      this.h.step('overlay', 'info', 'T1', 'dismissed an unexpected modal deterministically (no AI needed)');
    }
  }

  private async clickContinue(next: RegExp) {
    const btn = this.page.getByRole('button', { name: /^(continue|next)/i }).first();
    await Promise.all([this.page.waitForURL(next), btn.click()]);
  }

  private async assertNoMissingRequired() {
    const missing = await this.page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLInputElement>('input[required], textarea[required], select[required]'))
        .filter((el) => el.type !== 'checkbox' && el.type !== 'file' && !el.value.trim())
        .map((el) => (el.labels?.[0]?.textContent || el.getAttribute('aria-label') || el.placeholder || el.name || 'unknown field').trim()),
    );
    if (missing.length) {
      await this.snap('missing-field');
      throw new NeedsUserError('MISSING_FIELD', `The portal requires information we don't have: ${missing.join(', ')}`, missing[0]);
    }
  }

  private async fill(f: PortalField, value: string) {
    const ladder: (ExecTier | 'T1b')[] = f.kind === 'select' ? ['T1', 'T1b'] : this.h.tiers;
    for (const tier of ladder) {
      let ok = false;
      try {
        if (tier === 'T1') ok = await t1Fill(this.page, f.label, f.kind, value);
        else if (tier === 'T1b') ok = await selectByOption(this.page, value);
        else if (tier === 'T2') ok = await t2Fill(this.page, f, value);
        else ok = await this.t3Fill(f, value);
      } catch (err) {
        if (err instanceof CuHandoff) throw new NeedsUserError(err.code, err.message, f.label);
        ok = false;
      }
      if (ok) {
        this.h.tier(tier);
        this.h.step(`fill:${f.id}`, 'ok', tier);
        return;
      }
      if (tier === 'T1') this.h.step(`fill:${f.id}`, 'fail', 'T1', `label "${f.label}" not found`);
    }
    await this.snap(`not-found-${f.id}`);
    throw new NeedsUserError('FIELD_NOT_FOUND', `Could not find the "${f.label}" field on the portal`, f.label);
  }

  private async fillExtra(label: string, value: string) {
    if (await t1Fill(this.page, label, 'text', value)) {
      this.h.tier('T1');
      this.h.step(`fill:${label}`, 'ok', 'T1', 'extra field approved by the user');
      return;
    }
    throw new NeedsUserError('FIELD_NOT_FOUND', `Could not find the "${label}" field on the portal`, label);
  }

  private async t3Fill(f: PortalField, value: string): Promise<boolean> {
    const model = createCuModel(f, value);
    this.h.step(`fill:${f.id}`, 'start', 'T3', `Computer Use fallback (${model.kind === 'gemini' ? config.cuModel : 'FAKE model — DOM-derived coordinates'})`);
    await this.snap(`cu-${f.id}-before`);
    const ok = await runCuFill(this.page, model, f, value, {
      allowedOrigin: new URL(this.base).origin,
      maxSteps: 6,
      onAction: (a, blocked) => {
        this.h.cuStep();
        this.h.step(`cu:${a.name}`, blocked ? 'blocked' : 'info', 'T3', blocked ?? JSON.stringify({ ...a.args, text: a.args.text ? '…' : undefined }));
      },
    });
    const u = model.usage();
    if (u.tokensIn || u.tokensOut) recordUsage(this.h.ctx, this.h.caseId, u.tokensIn, u.tokensOut);
    await this.snap(`cu-${f.id}-after`);
    return ok;
  }
}

export async function t1Fill(page: Page, label: string, kind: string, value: string): Promise<boolean> {
  const loc = page.getByLabel(label, { exact: true });
  if ((await loc.count()) !== 1) return false;
  if (kind === 'select') await loc.selectOption(value);
  else await loc.fill(value);
  return sameValue(await loc.inputValue(), value);
}

/** T1b: the unique <select> that offers this exact option value (robust to relabelled selects). */
export async function selectByOption(page: Page, value: string): Promise<boolean> {
  const sel = page.locator(`select:has(option[value="${value.replace(/"/g, '\\"')}"])`);
  if ((await sel.count()) !== 1) return false;
  await sel.selectOption(value);
  return sameValue(await sel.inputValue(), value);
}

/** T2: heuristic DOM match by placeholder / aria-label (cheap, deterministic, no AI). */
export async function t2Fill(page: Page, f: PortalField, value: string): Promise<boolean> {
  const loc = await locateByHints(page, f);
  if (!loc) return false;
  await loc.fill(value);
  return sameValue(await loc.inputValue(), value);
}
