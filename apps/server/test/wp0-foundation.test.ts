/**
 * WP0 acceptance (docs/TASKS.md). These keep the foundation honest while many agents work in parallel:
 * docs match the state machine, every card's acceptance test exists, and the whole repo typechecks.
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkDocs } from '../../../scripts/docs-fsm';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const walk = (dir: string): string[] =>
  !fs.existsSync(dir)
    ? []
    : fs
        .readdirSync(dir, { withFileTypes: true })
        .flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : /\.test\.tsx?$/.test(d.name) ? [path.join(dir, d.name)] : []));

const testFiles = () => ['apps', 'packages'].flatMap((top) => fs.readdirSync(path.join(ROOT, top)).flatMap((pkg) => walk(path.join(ROOT, top, pkg, 'test'))));

/** Every describe/it/it.todo title in the repo's test files. */
function testTitles(): Set<string> {
  const re = /\b(?:describe|it|test)(?:\.(?:todo|skip|only))?\(\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1/g;
  const out = new Set<string>();
  for (const f of testFiles()) for (const m of fs.readFileSync(f, 'utf8').matchAll(re)) out.add(m[2].replace(/\\(.)/g, '$1'));
  return out;
}

const acceptanceNames = () => [...fs.readFileSync(path.join(ROOT, 'docs/TASKS.md'), 'utf8').matchAll(/^- `(wp\d+: [^`]+)`$/gm)].map((m) => m[1]);

describe('WP0 foundation', () => {
  it('wp0: npm run typecheck && npm test pass on the v2 flow', () => {
    // `npm test` is this suite itself (e2e.test.ts runs the v2 two-gate flow); here we make sure every workspace typechecks.
    expect(() => execSync('npm run typecheck', { cwd: ROOT, stdio: 'pipe', timeout: 110_000 })).not.toThrow();
    const e2e = fs.readFileSync(path.join(ROOT, 'apps/server/test/e2e.test.ts'), 'utf8');
    for (const s of ['FACTS_REVIEW', 'DRAFTING', 'STATEMENT_REVIEW']) expect(e2e).toContain(s);
  });

  it('wp0: docs:fsm --check matches ARCHITECTURE.md', () => {
    expect(checkDocs()).toEqual({ ok: true });
  });

  it('wp0: every WP1–WP9 acceptance test exists as it.todo', () => {
    const names = acceptanceNames();
    expect(names.length).toBeGreaterThan(40);
    const titles = testTitles();
    const missing = names.filter((n) => !titles.has(n));
    expect(missing).toEqual([]);
  });
});
