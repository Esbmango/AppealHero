import type { Locator, Page } from 'playwright';
import type { GoogleGenAI } from '@google/genai';
import { sameValue, type PortalField } from '@appealhero/shared';
import { VIEWPORT } from './browser';

/**
 * Tier T3 — Gemini Computer Use, used per FIELD only after semantic locators failed.
 * The model proposes actions; OUR code executes them after a policy check. Policy:
 *  - CU may click into inputs and type. It may not click buttons/links (navigation and submit are deterministic code).
 *  - No Enter key / press_enter (Enter submits forms). No navigation (excluded from the tool).
 *  - safety_decision.require_confirmation is never auto-acknowledged → hand off to the user.
 *  - The result is verified by reading the focused element's value back from the DOM.
 * File uploads are never done by CU (native file pickers) — see adapter.ts.
 */

export interface CuAction {
  id: string;
  name: string;
  args: Record<string, unknown>;
}
export interface CuResult {
  action: CuAction;
  ok: boolean;
  error?: string;
  url: string;
  png: Buffer | null;
}
export interface CuModel {
  readonly kind: 'gemini' | 'fake';
  start(goal: string, png: Buffer, url: string, page: Page): Promise<CuAction[]>;
  next(results: CuResult[], page: Page): Promise<CuAction[]>;
  usage(): { tokensIn: number; tokensOut: number };
}

export class CuHandoff extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export const toPx = (n: unknown, size: number) => Math.round((Math.min(Math.max(Number(n) || 0, 0), 999) / 1000) * size);
export const toNorm = (px: number, size: number) => Math.min(999, Math.max(0, Math.round((px / size) * 1000)));

const EXCLUDED = ['navigate', 'go_back', 'go_forward', 'drag_and_drop', 'hotkey', 'key_down', 'key_up', 'mouse_down', 'mouse_up', 'right_click', 'middle_click'];

const SYSTEM = [
  'You operate a web browser to fill exactly ONE form field on a simulated parking-ticket appeal form.',
  'Click into the correct input and type the value. Never press Enter. Never click buttons or links (Continue, Next, Submit). Never navigate.',
  'If a CAPTCHA, login or anything ambiguous appears, call yield_to_user. When the value is typed, call report_done.',
].join(' ');

/** Gemini Computer Use via the Interactions API (@google/genai ≥ 3). Verify on your key before relying on it. */
export class GeminiCuModel implements CuModel {
  readonly kind = 'gemini' as const;
  private prevId?: string;
  private tokens = { tokensIn: 0, tokensOut: 0 };
  constructor(
    private ai: GoogleGenAI,
    private model: string,
  ) {}

  private tools() {
    return [
      { type: 'computer_use' as const, environment: 'browser', excluded_predefined_functions: EXCLUDED },
      {
        type: 'function' as const,
        name: 'report_done',
        description: 'Call once the value has been typed into the correct field.',
        parameters: { type: 'object', properties: { note: { type: 'string' } } },
      },
      {
        type: 'function' as const,
        name: 'yield_to_user',
        description: 'Call if a human is required (CAPTCHA, login, ambiguous field).',
        parameters: { type: 'object', properties: { reason: { type: 'string' } }, required: ['reason'] },
      },
    ];
  }

  private parse(it: { id: string; steps?: unknown[]; usage?: { total_input_tokens?: number; total_output_tokens?: number; total_thought_tokens?: number } }): CuAction[] {
    this.prevId = it.id;
    this.tokens.tokensIn += it.usage?.total_input_tokens ?? 0;
    this.tokens.tokensOut += (it.usage?.total_output_tokens ?? 0) + (it.usage?.total_thought_tokens ?? 0);
    return (it.steps ?? [])
      .filter((s): s is { type: 'function_call'; id: string; name: string; arguments: Record<string, unknown> } => (s as { type?: string }).type === 'function_call')
      .map((s) => ({ id: s.id, name: s.name, args: s.arguments ?? {} }));
  }

  async start(goal: string, png: Buffer, url: string): Promise<CuAction[]> {
    const it = await this.ai.interactions.create({
      model: this.model,
      system_instruction: SYSTEM,
      tools: this.tools(),
      generation_config: { thinking_level: 'low' },
      input: [
        { type: 'text', text: `${goal}\nCurrent URL: ${url}` },
        { type: 'image', data: png.toString('base64'), mime_type: 'image/png' },
      ],
    });
    return this.parse(it);
  }

  async next(results: CuResult[]): Promise<CuAction[]> {
    const input = results.map((r) => ({
      type: 'function_result' as const,
      name: r.action.name,
      call_id: r.action.id,
      result: [
        { type: 'text' as const, text: JSON.stringify({ url: r.url, ...(r.error ? { error: r.error } : {}) }) },
        ...(r.png ? [{ type: 'image' as const, data: r.png.toString('base64'), mime_type: 'image/png' }] : []),
      ],
    }));
    const it = await this.ai.interactions.create({
      model: this.model,
      system_instruction: SYSTEM,
      tools: this.tools(),
      previous_interaction_id: this.prevId,
      input,
    });
    return this.parse(it);
  }

  usage() {
    return this.tokens;
  }
}

/**
 * Fake CU for runs without a key: finds the field from the DOM (cheating) but then goes through the SAME
 * normalized-coordinate actions, policy guard and read-back as the real model. Labelled "fake" in every event.
 */
export class FakeCuModel implements CuModel {
  readonly kind = 'fake' as const;
  private phase = 0;
  constructor(
    private field: PortalField,
    private value: string,
  ) {}
  async start(_goal: string, _png: Buffer, _url: string, page: Page): Promise<CuAction[]> {
    const loc = await locateByHints(page, this.field);
    const box = loc ? await loc.boundingBox() : null;
    if (!box) return [{ id: 'fake-1', name: 'yield_to_user', args: { reason: `could not find "${this.field.label}"` } }];
    return [
      { id: 'fake-1', name: 'click', args: { x: toNorm(box.x + box.width / 2, VIEWPORT.width), y: toNorm(box.y + Math.min(box.height / 2, 18), VIEWPORT.height), intent: `focus ${this.field.label}` } },
      { id: 'fake-2', name: 'type', args: { text: this.value, intent: `type ${this.field.label}` } },
    ];
  }
  async next(): Promise<CuAction[]> {
    return this.phase++ === 0 ? [{ id: 'fake-3', name: 'report_done', args: {} }] : [];
  }
  usage() {
    return { tokensIn: 0, tokensOut: 0 };
  }
}

/** Shared by tier T2 and the fake CU: find a unique visible text input by placeholder / aria-label hints. */
export async function locateByHints(page: Page, f: PortalField): Promise<Locator | null> {
  for (const hint of f.hints) {
    const h = hint.replace(/"/g, '');
    const loc = page.locator(
      [
        `input:not([type=hidden]):not([type=file]):not([type=checkbox])[placeholder*="${h}" i]`,
        `textarea[placeholder*="${h}" i]`,
        `input:not([type=hidden]):not([type=file]):not([type=checkbox])[aria-label*="${h}" i]`,
        `textarea[aria-label*="${h}" i]`,
      ].join(', '),
    );
    if ((await loc.count()) === 1 && (await loc.isVisible())) return loc;
  }
  return null;
}

/** Returns a reason string if the action must be blocked. */
export async function guardAction(page: Page, a: CuAction, allowedOrigin: string): Promise<string | null> {
  const decision = (a.args.safety_decision as { decision?: string } | undefined)?.decision;
  if (decision === 'require_confirmation' || decision === 'blocked') return `model safety decision "${decision}" requires a human`;
  switch (a.name) {
    case 'click':
    case 'double_click':
    case 'triple_click': {
      const target = await page.evaluate(
        ([x, y]) => {
          const el = document.elementFromPoint(x, y) as HTMLElement | null;
          if (!el) return null;
          const clickable = el.closest('button, a, [role=button], input[type=submit], input[type=button], input[type=image]') as HTMLElement | null;
          return clickable ? { tag: clickable.tagName.toLowerCase(), text: (clickable.innerText || (clickable as HTMLInputElement).value || '').trim().slice(0, 60) } : null;
        },
        [toPx(a.args.x, VIEWPORT.width), toPx(a.args.y, VIEWPORT.height)] as const,
      );
      return target ? `CU may not click buttons or links ("${target.text || target.tag}") — navigation and submission are deterministic code` : null;
    }
    case 'type':
      return a.args.press_enter ? 'press_enter could submit the form' : null;
    case 'press_key':
      return /enter|return/i.test(String(a.args.key)) ? 'Enter could submit the form' : null;
    case 'navigate':
      try {
        return new URL(String(a.args.url)).origin === allowedOrigin ? null : 'navigation outside the allowlisted portal';
      } catch {
        return 'invalid url';
      }
    default:
      return null;
  }
}

export async function execAction(page: Page, a: CuAction) {
  const { width, height } = VIEWPORT;
  switch (a.name) {
    case 'click':
      return page.mouse.click(toPx(a.args.x, width), toPx(a.args.y, height));
    case 'double_click':
      return page.mouse.dblclick(toPx(a.args.x, width), toPx(a.args.y, height));
    case 'triple_click':
      return page.mouse.click(toPx(a.args.x, width), toPx(a.args.y, height), { clickCount: 3 });
    case 'type': {
      // Docs sample clears with Meta+A (macOS only); ControlOrMeta works on Linux VMs too.
      await page.keyboard.press('ControlOrMeta+A');
      await page.keyboard.press('Backspace');
      const text = String(a.args.text ?? '');
      return text.length > 40 ? page.keyboard.insertText(text) : page.keyboard.type(text, { delay: 8 });
    }
    case 'scroll': {
      const m = Number(a.args.magnitude_in_pixels ?? 300);
      const dir = String(a.args.direction ?? 'down');
      await page.mouse.move(toPx(a.args.x ?? 500, width), toPx(a.args.y ?? 500, height));
      return page.mouse.wheel(dir === 'left' ? -m : dir === 'right' ? m : 0, dir === 'up' ? -m : dir === 'down' ? m : 0);
    }
    case 'press_key':
      return page.keyboard.press(String(a.args.key));
    case 'wait':
      return page.waitForTimeout(Math.min(5, Number(a.args.seconds ?? 1)) * 1000);
    case 'take_screenshot':
      return;
    default:
      throw new Error(`unsupported action ${a.name}`);
  }
}

export async function runCuFill(
  page: Page,
  model: CuModel,
  field: PortalField,
  value: string,
  o: { allowedOrigin: string; maxSteps: number; onAction: (a: CuAction, blocked: string | null) => void },
): Promise<boolean> {
  const goal = `Fill the field for "${field.label}" (it may be labelled ${field.hints.map((h) => `"${h}"`).join(', ')}). Click into it and type exactly: ${JSON.stringify(value)}`;
  const shot = () => page.screenshot({ type: 'png' });
  let actions = await model.start(goal, await shot(), page.url(), page);
  for (let step = 0; step < o.maxSteps && actions.length; step++) {
    const results: CuResult[] = [];
    let done = false;
    for (const a of actions) {
      if (a.name === 'report_done') {
        done = true;
        continue;
      }
      if (a.name === 'yield_to_user') throw new CuHandoff('CU_YIELD', String(a.args.reason ?? 'Computer Use asked for a human'));
      const blocked = await guardAction(page, a, o.allowedOrigin);
      o.onAction(a, blocked);
      if (blocked) {
        if (a.args.safety_decision) throw new CuHandoff('CU_SAFETY', blocked);
        results.push({ action: a, ok: false, error: `BLOCKED_BY_POLICY: ${blocked}`, url: page.url(), png: await shot() });
        continue;
      }
      try {
        await execAction(page, a);
        results.push({ action: a, ok: true, url: page.url(), png: await shot() });
      } catch (err) {
        results.push({ action: a, ok: false, error: String(err), url: page.url(), png: await shot() });
      }
    }
    if (done) break;
    actions = await model.next(results, page);
  }
  const typed = await page.evaluate(() => {
    const el = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
    return el && 'value' in el ? el.value : null;
  });
  return typed !== null && sameValue(typed, value);
}
