/**
 * WP0: invariants from AGENTS.md, checked mechanically. Never weaken these to make a change pass —
 * change the code instead (or propose a contract change in docs/TASKS.md).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AGENT_STATES, CASE_STATES, FORBIDDEN_TOOL_NAME } from '@appealhero/shared';
import { TOOLS, TOOLSETS } from '../src/agent/tools';
import { HARD_BLOCK } from '../src/portal/browser/guard';
import { resolveAiMode } from '../src/core/config';

const SRC = fileURLToPath(new URL('../src', import.meta.url));
const walk = (dir: string): string[] =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : d.name.endsWith('.ts') ? [path.join(dir, d.name)] : []));
const rel = (f: string) => path.relative(SRC, f).split(path.sep).join('/');
const hits = (re: RegExp, allow: string[] = []) =>
  walk(SRC)
    .filter((f) => !allow.includes(rel(f)))
    .flatMap((f) =>
      fs
        .readFileSync(f, 'utf8')
        .split('\n')
        .map((line, i) => ({ f: rel(f), i: i + 1, line })),
    )
    .filter(({ line }) => re.test(line))
    .map(({ f, i, line }) => `${f}:${i}: ${line.trim()}`);

describe('wp0: invariants hold', () => {
  it('case state changes only inside core/fsm.ts (transition + crash recovery)', () => {
    expect(hits(/\.state\s*=[^=]/, ['core/fsm.ts'])).toEqual([]);
  });

  it('a fact becomes CONFIRMED only through user-facing endpoints', () => {
    // routes/cases.ts: POST /facts/confirm and the user's own profile at case creation · routes/jobs.ts: provide_info typed by the user
    expect(hits(/status\s*[:=]\s*'CONFIRMED'/, ['routes/cases.ts', 'routes/jobs.ts'])).toEqual([]);
  });

  it('no tool can submit, approve, confirm or pay — in any state', () => {
    expect(TOOLS.length).toBeGreaterThan(0);
    for (const t of TOOLS) expect(t.name).not.toMatch(FORBIDDEN_TOOL_NAME);
    expect(TOOLS.map((t) => t.name).sort()).toEqual(['analyze_evidence', 'ask_user', 'check_rule', 'propose_outcome', 'record_fact']);
  });

  it('tools are offered only while the agent may act', () => {
    for (const s of CASE_STATES) if (!AGENT_STATES.includes(s)) expect(TOOLSETS[s]).toEqual([]);
    for (const t of TOOLS) for (const s of t.stages) expect(AGENT_STATES).toContain(s);
  });

  it('the network guard hard-blocks real government portals', () => {
    for (const host of ['boston.gov', 'www.boston.gov', 'cityofboston.gov', 'www.cityofboston.gov', 'rmcpay.com', 'pay.rmcpay.com'])
      expect(
        HARD_BLOCK.some((r) => r.test(host)),
        host,
      ).toBe(true);
    for (const host of ['localhost', '127.0.0.1', 'example.com'])
      expect(
        HARD_BLOCK.some((r) => r.test(host)),
        host,
      ).toBe(false);
  });

  it('portal code never points at a real government system (only the guard names them)', () => {
    expect(hits(/boston\.gov|rmcpay/i, ['portal/browser/guard.ts']).filter((h) => h.startsWith('portal/'))).toEqual([]);
  });

  it('no key means fake mode; an explicit AI_MODE always wins', () => {
    expect(resolveAiMode('auto', undefined)).toBe('fake');
    expect(resolveAiMode('auto', '')).toBe('fake');
    expect(resolveAiMode('auto', 'key')).toBe('gemini');
    expect(resolveAiMode('fake', 'key')).toBe('fake');
    expect(resolveAiMode('gemini', undefined)).toBe('gemini');
  });
});
