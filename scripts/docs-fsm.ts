/**
 * Keeps docs/ARCHITECTURE.md in sync with the state machine in packages/shared/src/states.ts.
 *   npm run docs:fsm              print the generated block
 *   npm run docs:fsm -- --write   replace the block between the fsm markers in ARCHITECTURE.md
 *   npm run docs:fsm -- --check   exit 1 if ARCHITECTURE.md is out of date (CI + wp0 test)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CASE_STATES, TERMINAL_STATES, TRANSITION_TABLE } from '../packages/shared/src/states';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ARCH_FILE = path.join(ROOT, 'docs/ARCHITECTURE.md');
const BEGIN = '<!-- fsm:begin — generated from packages/shared/src/states.ts by `npm run docs:fsm -- --write`; do not edit by hand -->';
const END = '<!-- fsm:end -->';

export function renderFsmBlock(): string {
  const edges = TRANSITION_TABLE.map(([f, t, a]) => `  ${f} --> ${t}: ${a.join(' / ')}`);
  const rows = TRANSITION_TABLE.map(([f, t, a, note]) => `| ${f} | ${t} | ${a.join(' / ')} | ${note ?? ''} |`);
  return [
    BEGIN,
    '```mermaid',
    'stateDiagram-v2',
    `  [*] --> ${CASE_STATES[0]}`,
    ...edges,
    ...TERMINAL_STATES.map((s) => `  ${s} --> [*]`),
    '```',
    '',
    '| 从 | 到 | 谁能触发 | 说明 |',
    '|---|---|---|---|',
    ...rows,
    END,
  ].join('\n');
}

export function extractBlock(doc: string): string | null {
  const i = doc.indexOf(BEGIN);
  const j = doc.indexOf(END);
  return i >= 0 && j > i ? doc.slice(i, j + END.length) : null;
}

export function checkDocs(file = ARCH_FILE): { ok: boolean; reason?: string } {
  const block = extractBlock(fs.readFileSync(file, 'utf8'));
  if (!block) return { ok: false, reason: 'fsm markers not found' };
  return block === renderFsmBlock() ? { ok: true } : { ok: false, reason: 'ARCHITECTURE.md state machine is out of date — run `npm run docs:fsm -- --write`' };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const arg = process.argv[2];
  if (arg === '--check') {
    const r = checkDocs();
    console.log(r.ok ? 'docs:fsm OK' : `docs:fsm FAILED: ${r.reason}`);
    process.exit(r.ok ? 0 : 1);
  } else if (arg === '--write') {
    const doc = fs.readFileSync(ARCH_FILE, 'utf8');
    const block = extractBlock(doc);
    if (!block) throw new Error('fsm markers not found in ARCHITECTURE.md');
    fs.writeFileSync(ARCH_FILE, doc.replace(block, renderFsmBlock()));
    console.log('docs:fsm wrote ARCHITECTURE.md');
  } else console.log(renderFsmBlock());
}
