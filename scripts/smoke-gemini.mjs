import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { GoogleGenAI } from '@google/genai';

try {
  process.loadEnvFile('.env');
} catch (err) {
  if (err.code !== 'ENOENT') throw err;
}

async function main() {
  if (!process.env.GEMINI_API_KEY) throw new Error('Set GEMINI_API_KEY in the local .env to run live verification.');
  const arg = process.argv[2] ?? 'meter';
  if (arg === '--models') {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    for await (const m of await ai.models.list()) console.log(m.name, (m.supportedActions ?? []).join(', '));
    return;
  }
  const existing = /^case_[0-9a-f]{10}$/.test(arg);
  if (!existing && !['meter', 'permit', 'hydrant'].includes(arg)) throw new Error('Choose meter, permit, hydrant, an existing case ID or --models.');
  const base = 'http://127.0.0.1:' + (process.env.PORT || '4000');
  async function json(path, init = {}) {
    const res = await fetch(base + path, {
      ...init,
      headers: process.env.DEMO_KEY ? { 'x-demo-key': process.env.DEMO_KEY } : {},
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(path + ' returned HTTP ' + res.status);
    return res.json();
  }
  const health = await json('/api/health');
  if (health.aiMode !== 'gemini') throw new Error('Start the local API in AI_MODE=gemini first.');
  let caseId = arg;
  if (!existing) {
    const fd = new FormData();
    const bytes = await readFile(new URL('../apps/web/public/sample-ticket-' + arg + '.png', import.meta.url));
    fd.append('ticket', new Blob([bytes], { type: 'image/png' }), 'synthetic-ticket.png');
    for (const [k, v] of Object.entries({ lang: 'en', profileName: 'Sam Demo', profileEmail: 'sam@example.com', profileAddress: '1 Example St, Boston, MA' }))
      fd.append(k, v);
    caseId = (await json('/api/cases', { method: 'POST', body: fd })).caseId;
  }
  console.log('Watching local case', caseId, 'using', health.model);
  const deadline = Date.now() + 15 * 60_000;
  let progress;
  for (;;) {
    const c = await json('/api/cases/' + caseId);
    const checkpoint = c.state + '/' + c.metrics.llmCalls;
    if (checkpoint !== progress) {
      progress = checkpoint;
      console.log(c.state, '— completed model calls:', c.metrics.llmCalls);
    }
    const errors = c.messages.filter((m) => m.role === 'system' && m.text.startsWith('⚠'));
    if (errors.length || c.state === 'FAILED') throw new Error('Live processing failed. Inspect the local case ' + caseId + ' for details.');
    if (c.pendingQuestion || c.triage || c.state === 'FACTS_REVIEW') {
      if (!c.metrics.llmCalls || !c.ticket?.ticketNumber) throw new Error('No successful model extraction was recorded.');
      const questions = c.messages.filter((m) => m.questionId).map((m) => m.text);
      console.log(
        JSON.stringify(
          {
            caseId,
            model: health.model,
            states: ['NEW', ...c.stateHistory.map((h) => h.to)],
            questions,
            elapsedMs: Date.now() - Date.parse(c.createdAt),
            modelCalls: c.metrics.llmCalls,
            estimatedUsd: c.metrics.costUsd,
          },
          null,
          2,
        ),
      );
      return;
    }
    if (Date.now() >= deadline) throw new Error(`Still in ${c.state}. Resume this check with npm run smoke:gemini -- ${caseId}`);
    await delay(1000);
  }
}
main().catch((e) => {
  console.error(e.message.replaceAll(process.env.GEMINI_API_KEY || '\u0000', '[redacted]'));
  process.exitCode = 1;
});
