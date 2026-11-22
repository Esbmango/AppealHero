import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import formbody from '@fastify/formbody';
import multipart from '@fastify/multipart';
import { EVIDENCE_LIMITS, SCENARIOS, type Scenario } from '@appealhero/shared';
import { checkTicket, db, newConfirmation, newSid, resetDb, type Appeal, type EvidenceFile, type Session } from './db';
import { findTicket, lookup, norm, view, type LookupQuery } from './tickets';
import {
  alreadyOnFilePage,
  confirmationPage,
  contactPage,
  detailsPage,
  evidencePage,
  faqPage,
  findPage,
  inboxPage,
  messagePage,
  resultsPage,
  reviewPage,
  startPage,
  statusPage,
  ticketPage,
} from './views';

/**
 * SIMULATED Boston parking-ticket portal. Field-faithful to boston.gov's published requirements; the layout follows
 * the real portal's flow (find ticket → results → appeal) but carries no seal, official names or wordmarks, and every
 * page shows the SIMULATED banner. Lookup pages are read-only (GET). Scenarios inject the failures the executor must survive.
 */

const require = createRequire(import.meta.url);
/** Self-hosted OFL fonts (no network at demo time). */
const FONT_FILES: Record<string, string> = Object.fromEntries(
  ['oswald-latin-400-normal', 'oswald-latin-500-normal', 'oswald-latin-600-normal', 'lato-latin-400-normal', 'lato-latin-700-normal'].map((f) => [
    `${f}.woff2`,
    require.resolve(`@fontsource/${f.split('-')[0]}/files/${f}.woff2`),
  ]),
);

/** Closed tickets in the portal's registry can't be appealed online (seeded plate mismatches are caught by checkTicket). */
function closedTicketProblem(ticket: string, plate: string): string | null {
  const t = findTicket(ticket);
  if (!t) return null;
  if (norm(t.plate) !== norm(plate)) return 'The plate number does not match this ticket.';
  return t.status === 'OPEN' ? null : `This ticket is closed (${view(t).statusText}) and cannot be appealed online.`;
}

// Redesigned (v2) form uses different field names; normalize them to the canonical ids.
const V2_NAMES: Record<string, string> = {
  citation_no: 'ticketNumber',
  plate_no: 'plateNumber',
  reg_state: 'plateState',
  owner_name: 'fullName',
  mail_addr: 'mailingAddress',
  notify_email: 'email',
  why: 'disputeReason',
  narrative: 'statement',
};
const canon = (body: unknown) => {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries((body ?? {}) as Record<string, unknown>)) out[V2_NAMES[k] ?? k] = String(v ?? '').trim();
  return out;
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms).unref());

export async function buildPortal(opts: { hangMs?: number } = {}) {
  const hangMs = opts.hangMs ?? Number(process.env.MOCK_HANG_MS ?? 30_000);
  const app = Fastify({ logger: false, forceCloseConnections: true });
  await app.register(formbody);
  await app.register(multipart, { limits: { fileSize: EVIDENCE_LIMITS.maxBytes, files: EVIDENCE_LIMITS.maxFiles } });

  const html = (reply: FastifyReply, body: string, code = 200) => reply.code(code).type('text/html; charset=utf-8').send(body);
  const session = (req: FastifyRequest): Session | undefined => {
    const q = req.query as { sid?: string };
    const b = (req.body ?? {}) as { sid?: string };
    return db.sessions.get(q.sid ?? b.sid ?? '');
  };
  const expired = (reply: FastifyReply) => html(reply, messagePage(db.scenario, 'Session expired', 'Please start your appeal again.'), 440);

  app.get('/', (_req, reply) => html(reply, findPage(db.scenario)));

  // ---- read-only lookup (GET only; the executor's one-shot submit interlock is unaffected) ----
  app.get('/lookup', (req, reply) => {
    const q = req.query as LookupQuery;
    const r = lookup(q);
    return r.kind === 'none'
      ? html(reply, findPage(db.scenario, q, 'Please enter a ticket number, a license plate and state, or a VIN.'))
      : html(reply, resultsPage(db.scenario, q, r));
  });
  app.get<{ Params: { n: string } }>('/ticket/:n', (req, reply) => {
    const t = findTicket(req.params.n);
    return t ? html(reply, ticketPage(db.scenario, view(t))) : html(reply, messagePage(db.scenario, 'Not found', 'No ticket with this number.'), 404);
  });
  app.get<{ Params: { n: string } }>('/ticket/:n/hearing', (_req, reply) =>
    html(reply, messagePage(db.scenario, 'Request hearing', 'Hearing requests are not part of this simulation.')),
  );
  app.get('/faq', (_req, reply) => html(reply, faqPage(db.scenario)));
  app.get('/contact', (_req, reply) => html(reply, contactPage(db.scenario)));
  app.get<{ Params: { file: string } }>('/assets/fonts/:file', (req, reply) => {
    const file = FONT_FILES[req.params.file];
    if (!file) return reply.code(404).send();
    return reply.header('cache-control', 'public, max-age=86400').type('font/woff2').send(readFileSync(file));
  });

  app.get('/appeal/start', (req, reply) => {
    const q = req.query as { ticket?: string; plate?: string; state?: string };
    return html(reply, startPage(db.scenario, '', { ticket: q.ticket, plate: q.plate, state: q.state }));
  });
  app.post('/appeal/start', (req, reply) => {
    const b = canon(req.body);
    const problem =
      !b.ticketNumber || !b.plateNumber || !b.plateState
        ? 'All fields are required.'
        : (checkTicket(b.ticketNumber, b.plateNumber) ?? closedTicketProblem(b.ticketNumber, b.plateNumber));
    if (problem) return html(reply, startPage(db.scenario, problem), 422);
    const existing = db.appeals.get(b.ticketNumber);
    if (existing) return html(reply, alreadyOnFilePage(db.scenario, existing), 409);
    const sid = newSid();
    db.sessions.set(sid, {
      sid,
      createdAt: Date.now(),
      data: { ticketNumber: b.ticketNumber, plateNumber: b.plateNumber.toUpperCase(), plateState: b.plateState },
      evidence: [],
    });
    return reply.redirect(`/appeal/details?sid=${sid}`, 303);
  });

  app.get('/appeal/details', (req, reply) => {
    const s = session(req);
    return s ? html(reply, detailsPage(db.scenario, s)) : expired(reply);
  });
  app.post('/appeal/details', (req, reply) => {
    const s = session(req);
    if (!s) return expired(reply);
    const b = canon(req.body);
    const required = ['fullName', 'mailingAddress', 'email', 'disputeReason', 'statement', ...(db.scenario === 'missing_field' ? ['vehicleMake'] : [])];
    const missing = required.filter((k) => !b[k]);
    if (missing.length) return html(reply, detailsPage(db.scenario, s, `Missing: ${missing.join(', ')}`), 422);
    if (b.statement.length > 2000) return html(reply, detailsPage(db.scenario, s, 'Statement is limited to 2,000 characters.'), 422);
    for (const k of required) s.data[k] = b[k];
    return reply.redirect(`/appeal/evidence?sid=${s.sid}`, 303);
  });

  app.get('/appeal/evidence', (req, reply) => {
    const s = session(req);
    return s ? html(reply, evidencePage(db.scenario, s)) : expired(reply);
  });
  app.post('/appeal/evidence', async (req, reply) => {
    const files: EvidenceFile[] = [];
    let sid = (req.query as { sid?: string }).sid ?? '';
    for await (const part of req.parts()) {
      if (part.type === 'file') {
        const buf = await part.toBuffer();
        if (!buf.length) continue;
        if (!EVIDENCE_LIMITS.mimeTypes.includes(part.mimetype))
          return html(reply, messagePage(db.scenario, 'Upload rejected', `${part.filename}: only JPG, PNG or PDF files are accepted.`), 415);
        files.push({ filename: part.filename, bytes: buf.length, sha256: createHash('sha256').update(buf).digest('hex'), mime: part.mimetype });
      } else if (part.fieldname === 'sid') sid = String(part.value);
    }
    const s = db.sessions.get(sid);
    if (!s) return expired(reply);
    s.evidence = files;
    return reply.redirect(`/appeal/review?sid=${s.sid}`, 303);
  });

  app.get('/appeal/review', (req, reply) => {
    const s = session(req);
    return s ? html(reply, reviewPage(db.scenario, s)) : expired(reply);
  });

  app.post('/appeal/submit', async (req, reply) => {
    const s = session(req);
    if (!s) return expired(reply);
    const b = (req.body ?? {}) as Record<string, string>;
    if (b.attest !== 'on') return html(reply, reviewPage(db.scenario, s, 'Please confirm the certification.'), 422);
    if (db.scenario === 'captcha' && b.human !== 'on') return html(reply, reviewPage(db.scenario, s, 'Please complete the human verification.'), 422);
    const existing = db.appeals.get(s.data.ticketNumber);
    if (existing) return html(reply, alreadyOnFilePage(db.scenario, existing), 409);

    if (db.scenario === 'submit_timeout_before_record' && db.timeoutArmed) {
      db.timeoutArmed = false;
      await sleep(hangMs); // request "lost": nothing recorded
      return html(reply, messagePage(db.scenario, 'Gateway timeout', 'Please try again.'), 504);
    }
    const appeal: Appeal = {
      confirmationNumber: newConfirmation(),
      ticketNumber: s.data.ticketNumber,
      plateNumber: s.data.plateNumber,
      plateState: s.data.plateState,
      fullName: s.data.fullName,
      mailingAddress: s.data.mailingAddress,
      email: s.data.email,
      disputeReason: s.data.disputeReason,
      statement: s.data.statement,
      extra: s.data.vehicleMake ? { 'Vehicle make': s.data.vehicleMake } : {},
      evidence: s.evidence,
      createdAt: new Date().toISOString(),
    };
    db.appeals.set(appeal.ticketNumber, appeal);
    db.inbox.push({
      to: appeal.email,
      subject: `Appeal received (${appeal.confirmationNumber})`,
      confirmationNumber: appeal.confirmationNumber,
      at: appeal.createdAt,
    });
    db.sessions.delete(s.sid);
    if (db.scenario === 'submit_timeout_after_record' && db.timeoutArmed) {
      db.timeoutArmed = false;
      await sleep(hangMs); // recorded, but the client never sees the confirmation
    }
    return reply.redirect(`/appeal/confirmation/${appeal.confirmationNumber}`, 303);
  });

  app.get<{ Params: { conf: string } }>('/appeal/confirmation/:conf', (req, reply) => {
    const a = [...db.appeals.values()].find((x) => x.confirmationNumber === req.params.conf);
    return a ? html(reply, confirmationPage(db.scenario, a)) : html(reply, messagePage(db.scenario, 'Not found', 'Unknown confirmation number.'), 404);
  });

  app.get('/status', (req, reply) => {
    const ticket = String((req.query as { ticket?: string }).ticket ?? '').trim();
    return html(reply, statusPage(db.scenario, ticket, ticket ? db.appeals.get(ticket) : undefined));
  });

  app.get('/inbox', (req, reply) => {
    const email = String((req.query as { email?: string }).email ?? '')
      .trim()
      .toLowerCase();
    return html(
      reply,
      inboxPage(
        db.scenario,
        email,
        db.inbox.filter((m) => !email || m.to.toLowerCase() === email),
      ),
    );
  });

  // ---- admin (demo switches + test oracle) ----
  app.get('/admin/state', async () => ({
    scenario: db.scenario,
    timeoutArmed: db.timeoutArmed,
    sessions: db.sessions.size,
    appeals: [...db.appeals.values()],
  }));
  app.post('/admin/scenario', async (req, reply) => {
    const scenario = (req.body as { scenario?: string } | undefined)?.scenario as Scenario;
    if (!SCENARIOS.includes(scenario)) return reply.code(400).send({ error: `scenario must be one of ${SCENARIOS.join(', ')}` });
    db.scenario = scenario;
    db.timeoutArmed = true;
    return { scenario: db.scenario };
  });
  app.post('/admin/reset', async () => {
    resetDb();
    return { ok: true };
  });

  return app;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const app = await buildPortal();
  const port = Number(process.env.MOCK_PORTAL_PORT ?? 4100);
  await app.listen({ port, host: '0.0.0.0' });
  console.log(`SIMULATED appeal portal on http://localhost:${port} (scenario: ${db.scenario})`);
}
