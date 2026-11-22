import { DISPUTE_REASONS, PORTAL_FIELDS, US_STATES, type Scenario } from '@appealhero/shared';
import type { Appeal, Session } from './db';

export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const CSS = `
body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;margin:0;background:#f3f4f6;color:#111827}
.sim{background:#b91c1c;color:#fff;padding:6px 12px;font-size:13px;font-weight:700;text-align:center;letter-spacing:.02em}
header{background:#1f2937;color:#fff;padding:14px 22px;font-size:18px}
main{max-width:720px;margin:22px auto;background:#fff;padding:26px;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,.12)}
label{display:block;font-weight:600;margin-top:14px}
input,select,textarea{width:100%;padding:9px;margin-top:6px;border:1px solid #9ca3af;border-radius:4px;font-size:15px;box-sizing:border-box;font-family:inherit}
textarea{min-height:110px}
button{margin-top:20px;background:#1f2937;color:#fff;border:0;padding:11px 22px;border-radius:4px;font-size:15px;cursor:pointer}
.err{color:#b91c1c;font-weight:600}
.badge{position:fixed;bottom:8px;right:8px;background:#111;color:#fff;font:12px ui-monospace,monospace;padding:4px 8px;border-radius:4px;opacity:.8}
dl{display:grid;grid-template-columns:190px 1fr;gap:8px 14px} dt{font-weight:600} dd{margin:0;white-space:pre-wrap}
.inline{display:inline;font-weight:400} .cb{width:auto;margin-right:6px}
.v2 header{background:linear-gradient(90deg,#0f766e,#1d4ed8);font-size:20px}
.v2 main{max-width:920px;border-radius:18px;padding:32px}
.v2 .grid{display:grid;grid-template-columns:1fr 1fr;gap:14px} .v2 .grid .wide{grid-column:1/-1}
.v2 input,.v2 select,.v2 textarea{border-radius:12px;border:2px solid #cbd5e1;padding:12px}
.v2 button{border-radius:999px;background:#0f766e;padding:12px 28px}
.modal{position:fixed;inset:0;background:rgba(15,23,42,.6);display:flex;align-items:center;justify-content:center;z-index:10}
.modal>div{background:#fff;padding:26px;border-radius:14px;max-width:380px}
.captcha{border:1px solid #d1d5db;background:#f9fafb;padding:14px;margin-top:16px;border-radius:6px}
`;

export function layout(title: string, body: string, scenario: Scenario) {
  const v2 = scenario === 'redesign';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="robots" content="noindex,nofollow"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · SIMULATED appeal portal</title><style>${CSS}</style></head>
<body class="${v2 ? 'v2' : 'v1'}">
<div class="sim">SIMULATED PORTAL FOR TESTING ONLY · NOT AFFILIATED WITH THE CITY OF BOSTON · DO NOT ENTER REAL DATA</div>
<header>${v2 ? 'Parking Help Center <small>(new design)</small>' : 'Parking Ticket Appeals — Simulation'}</header>
<main>${body}</main><div class="badge">scenario: ${esc(scenario)}</div></body></html>`;
}

const stateOptions = (selected = '') =>
  Object.entries(US_STATES)
    .map(([code, name]) => `<option value="${code}"${code === selected ? ' selected' : ''}>${esc(name)} (${code})</option>`)
    .join('');

const reasonOptions = (v2: boolean) => {
  const v2Text: Record<string, string> = {
    METER_NOT_IN_EFFECT: 'Meter not in effect',
    PAID: 'Paid / app receipt',
    SIGNAGE: 'Sign problem',
    VEHICLE_INFO: 'Wrong vehicle info',
    OTHER: 'Something else',
  };
  return `<option value="">— choose —</option>${Object.entries(DISPUTE_REASONS)
    .map(([k, label]) => `<option value="${k}">${esc(v2 ? v2Text[k] : label)}</option>`)
    .join('')}`;
};

export const landingPage = (scenario: Scenario) =>
  layout(
    'Home',
    `<h1>Appeal a parking ticket (simulation)</h1>
<p>This page exists so AppealHero's browser executor can be tested without touching real government systems.</p>
<p><a href="/appeal/start">Start an appeal</a> · <a href="/status">Check appeal status</a> · <a href="/inbox">Email receipts (simulated)</a></p>`,
    scenario,
  );

export function startPage(scenario: Scenario, error = '') {
  const err = error ? `<p class="err">${esc(error)}</p>` : '';
  if (scenario === 'redesign') {
    return layout(
      'Start',
      `<div class="modal" role="dialog" aria-modal="true" aria-label="We've redesigned"><div><h2>We've redesigned! ✨</h2>
<p>Our appeals experience has a new look.</p><button type="button" onclick="this.closest('.modal').remove()">Got it</button></div></div>
<h1>Dispute a citation</h1>${err}
<form method="post" action="/appeal/start" class="grid">
<input name="citation_no" placeholder="Citation #" required data-pii>
<input name="plate_no" placeholder="License plate" required data-pii>
<select name="reg_state" required>${stateOptions()}</select>
<div class="wide"><button type="submit">Next →</button></div></form>`,
      scenario,
    );
  }
  return layout(
    'Start',
    `<h1>Start an appeal</h1>${err}
<form method="post" action="/appeal/start">
<label for="ticketNumber">Ticket number</label><input id="ticketNumber" name="ticketNumber" required data-pii>
<label for="plateNumber">Plate number</label><input id="plateNumber" name="plateNumber" required data-pii>
<label for="plateState">Registration state</label><select id="plateState" name="plateState" required>${stateOptions()}</select>
<button type="submit">Continue</button></form>`,
    scenario,
  );
}

export function detailsPage(scenario: Scenario, s: Session, error = '') {
  const err = error ? `<p class="err">${esc(error)}</p>` : '';
  const missing = scenario === 'missing_field';
  if (scenario === 'redesign') {
    return layout(
      'Details',
      `<h1>About you</h1>${err}<form method="post" action="/appeal/details?sid=${s.sid}" class="grid">
<input type="hidden" name="sid" value="${s.sid}">
<input name="owner_name" placeholder="Name on registration" required data-pii>
<input name="notify_email" type="email" placeholder="Email for your receipt" required data-pii>
<textarea class="wide" name="mail_addr" placeholder="Address for mail" required data-pii></textarea>
<select class="wide" name="why" required>${reasonOptions(true)}</select>
<textarea class="wide" name="narrative" placeholder="Tell us what happened" maxlength="2000" required></textarea>
<div class="wide"><button type="submit">Next →</button></div></form>`,
      scenario,
    );
  }
  return layout(
    'Details',
    `<h1>Your details and dispute</h1>${err}<form method="post" action="/appeal/details?sid=${s.sid}">
<input type="hidden" name="sid" value="${s.sid}">
<label for="fullName">Full name</label><input id="fullName" name="fullName" required data-pii>
<label for="mailingAddress">Mailing address</label><textarea id="mailingAddress" name="mailingAddress" required data-pii></textarea>
<label for="email">Email</label><input id="email" name="email" type="email" required data-pii>
${missing ? '<label for="vehicleMake">Vehicle make</label><input id="vehicleMake" name="vehicleMake" required>' : ''}
<label for="disputeReason">Reason for dispute</label><select id="disputeReason" name="disputeReason" required>${reasonOptions(false)}</select>
<label for="statement">Statement</label><textarea id="statement" name="statement" maxlength="2000" required></textarea>
<button type="submit">Continue</button></form>`,
    scenario,
  );
}

export function evidencePage(scenario: Scenario, s: Session, error = '') {
  const err = error ? `<p class="err">${esc(error)}</p>` : '';
  const v2 = scenario === 'redesign';
  return layout(
    'Evidence',
    `<h1>${v2 ? 'Add photos' : 'Upload evidence'}</h1>${err}
<form method="post" action="/appeal/evidence?sid=${s.sid}" enctype="multipart/form-data">
<input type="hidden" name="sid" value="${s.sid}">
${v2 ? '<p>Attach photos (JPG, PNG or PDF)</p><input type="file" name="evidence" multiple accept=".jpg,.jpeg,.png,.pdf">' : '<label for="evidence">Upload evidence (JPG, PNG or PDF, up to 5 files)</label><input type="file" id="evidence" name="evidence" multiple accept=".jpg,.jpeg,.png,.pdf">'}
<button type="submit">${v2 ? 'Next →' : 'Continue'}</button></form>`,
    scenario,
  );
}

/** Review markup is intentionally stable across designs: it is what the executor reads back before submitting. */
export function reviewPage(scenario: Scenario, s: Session, error = '') {
  const err = error ? `<p class="err">${esc(error)}</p>` : '';
  const rows = PORTAL_FIELDS.map((f) => {
    const v = s.data[f.id] ?? '';
    const shown =
      f.id === 'disputeReason' ? (DISPUTE_REASONS[v as keyof typeof DISPUTE_REASONS] ?? v) : f.id === 'plateState' ? `${US_STATES[v] ?? v} (${v})` : v;
    const dataValue = f.id === 'disputeReason' || f.id === 'plateState' ? ` data-value="${esc(v)}"` : '';
    return `<dt>${esc(f.label)}</dt><dd data-review-field="${f.id}"${dataValue}>${esc(shown)}</dd>`;
  }).join('');
  const extra = s.data.vehicleMake ? `<dt>Vehicle make</dt><dd data-review-extra="Vehicle make">${esc(s.data.vehicleMake)}</dd>` : '';
  const ev =
    s.evidence
      .map((e) => `<li data-review-evidence data-filename="${esc(e.filename)}" data-bytes="${e.bytes}">${esc(e.filename)} (${e.bytes} bytes)</li>`)
      .join('') || '<li>No files</li>';
  const captcha =
    scenario === 'captcha'
      ? `<div class="captcha" data-captcha role="group" aria-label="Human verification"><input class="cb" type="checkbox" id="human" name="human"><label class="inline" for="human">I'm not a robot</label></div>`
      : '';
  return layout(
    'Review',
    `<h1>Review your appeal</h1>${err}<dl>${rows}${extra}</dl><h2>Evidence</h2><ul>${ev}</ul>
<form method="post" action="/appeal/submit"><input type="hidden" name="sid" value="${s.sid}">${captcha}
<p><input class="cb" type="checkbox" id="attest" name="attest" required><label class="inline" for="attest">I certify that the information provided is true and accurate to the best of my knowledge.</label></p>
<button type="submit" id="submitAppeal">Submit appeal</button></form>`,
    scenario,
  );
}

export const confirmationPage = (scenario: Scenario, a: Appeal) =>
  layout(
    'Received',
    `<h1>Appeal received</h1><p>Confirmation number: <strong data-confirmation>${esc(a.confirmationNumber)}</strong></p>
<p>An email receipt was sent to <span data-email>${esc(a.email)}</span>. A decision is usually mailed within 7–10 business days (simulated).</p>`,
    scenario,
  );

export const alreadyOnFilePage = (scenario: Scenario, a: Appeal) =>
  layout(
    'Already on file',
    `<h1>An appeal for this ticket is already on file</h1><p data-already-on-file>Confirmation number: ${esc(a.confirmationNumber)}</p>`,
    scenario,
  );

export function statusPage(scenario: Scenario, ticket: string, a: Appeal | undefined) {
  const result = ticket
    ? a
      ? `<div data-appeal-status="RECEIVED" data-confirmation="${esc(a.confirmationNumber)}">Appeal received on ${esc(a.createdAt)}. Confirmation number: <strong>${esc(a.confirmationNumber)}</strong></div>`
      : `<div data-appeal-status="NONE">No appeal on file for ticket ${esc(ticket)}.</div>`
    : '';
  return layout(
    'Status',
    `<h1>Check appeal status</h1><form method="get" action="/status"><label for="ticket">Ticket number</label><input id="ticket" name="ticket" value="${esc(ticket)}"><button type="submit">Check status</button></form>${result}`,
    scenario,
  );
}

export const inboxPage = (scenario: Scenario, email: string, items: { to: string; subject: string; confirmationNumber: string; at: string }[]) =>
  layout(
    'Inbox',
    `<h1>Simulated email receipts${email ? ` for ${esc(email)}` : ''}</h1><ul>${
      items.map((m) => `<li data-receipt data-confirmation="${esc(m.confirmationNumber)}">${esc(m.at)} — To: ${esc(m.to)} — ${esc(m.subject)}</li>`).join('') ||
      '<li>No messages</li>'
    }</ul>`,
    scenario,
  );

export const messagePage = (scenario: Scenario, title: string, text: string) =>
  layout(title, `<h1>${esc(title)}</h1><p class="err">${esc(text)}</p>`, scenario);
