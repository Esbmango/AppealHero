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
  if (!['meter', 'permit', 'hydrant'].includes(arg)) throw new Error('Choose meter, permit, hydrant or --models.');
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
  const fd = new FormData();
  const bytes = await readFile(new URL('../apps/web/public/sample-ticket-' + arg + '.png', import.meta.url));
  fd.append('ticket', new Blob([bytes], { type: 'image/png' }), 'synthetic-ticket.png');
  for (const [k, v] of Object.entries({ lang: 'en', profileName: 'Sam Demo', profileEmail: 'sam@example.com', profileAddress: '1 Example St, Boston, MA' }))
    fd.append(k, v);
  const start = Date.now();
  const { caseId } = await json('/api/cases', { method: 'POST', body: fd });
  console.log('Local synthetic case', caseId, 'using', health.model);
  for (;;) {
    const c = await json('/api/cases/' + caseId);
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
            elapsedMs: Date.now() - start,
            modelCalls: c.metrics.llmCalls,
            estimatedUsd: c.metrics.costUsd,
          },
          null,
          2,
        ),
      );
      return;
    }
    if (Date.now() - start > 120000) throw new Error('Timed out waiting for a question or a review; last state ' + c.state);
    await delay(500);
  }
}
main().catch((e) => {
  console.error(e.message.replaceAll(process.env.GEMINI_API_KEY || '\u0000', '[redacted]'));
  process.exitCode = 1;
});
