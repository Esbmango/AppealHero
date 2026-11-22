import { DISPUTE_REASONS, PORTAL_FIELDS, US_STATES, type Scenario } from '@appealhero/shared';
import type { Appeal, Session } from './db';
import { EMBLEM_SVG } from './emblem';
import type { LookupQuery, LookupResult, TicketView } from './tickets';

export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const FONTS = `
@font-face{font-family:Oswald;font-weight:500;font-display:swap;src:url(/assets/fonts/oswald-latin-500-normal.woff2) format("woff2")}
@font-face{font-family:Oswald;font-weight:600;font-display:swap;src:url(/assets/fonts/oswald-latin-600-normal.woff2) format("woff2")}
@font-face{font-family:Lato;font-weight:400;font-display:swap;src:url(/assets/fonts/lato-latin-400-normal.woff2) format("woff2")}
@font-face{font-family:Lato;font-weight:700;font-display:swap;src:url(/assets/fonts/lato-latin-700-normal.woff2) format("woff2")}`;

const BASE = `
body{margin:0}
.sim{background:#b91c1c;color:#fff;padding:6px 12px;font:700 13px/1.3 system-ui,sans-serif;text-align:center;letter-spacing:.02em}
.err{color:#b91c1c;font-weight:700}
.badge{position:fixed;bottom:8px;right:8px;background:#111;color:#fff;font:12px ui-monospace,monospace;padding:4px 8px;border-radius:4px;opacity:.8}
.modal{position:fixed;inset:0;background:rgba(15,23,42,.6);display:flex;align-items:center;justify-content:center;z-index:10}
.modal>div{background:#fff;padding:26px;border-radius:14px;max-width:380px}
.captcha{border:1px solid #d1d5db;background:#f9fafb;padding:14px;margin-top:16px;border-radius:6px}
.inline{display:inline!important;font-weight:400!important} .cb{width:auto!important;margin-right:6px}
dl{display:grid;grid-template-columns:200px 1fr;gap:8px 14px} dt{font-weight:700} dd{margin:0;white-space:pre-wrap}`;

/** Layout modelled on the real portal's structure (header, navy panels, condensed headings). No official marks. */
const V1 = `
.v1{--navy:#13202f;--blue:#3b6fb6;--link:#2f5f98;--cond:Oswald,"Roboto Condensed","Avenir Next Condensed","Arial Narrow",sans-serif;font:400 15px/1.45 Lato,"Helvetica Neue",Helvetica,Arial,sans-serif;color:#111;background:#fff}
.v1 a{color:var(--link);text-decoration:none} .v1 a:hover{text-decoration:underline}
.v1 .top{display:flex;align-items:stretch;min-height:124px;padding:0 0 0 34px;border-bottom:2px solid var(--navy);border-top:1px solid #e5e7eb}
.v1 .seal{display:flex;align-items:center;padding:12px 0} .v1 .emblem{width:86px;height:86px;display:block}
.v1 .bar{width:2px;background:var(--navy);margin:16px 20px 16px 18px}
.v1 .brand{display:flex;align-items:center;font:italic 400 27px/1.1 Georgia,"Times New Roman",serif;color:#1d2b3a;margin-right:30px;white-space:nowrap}
.v1 .brand:hover{text-decoration:none}
.v1 .top nav{display:flex;align-items:stretch}
.v1 .top nav a{display:flex;align-items:center;padding:0 15px;font:500 23px/1 var(--cond);text-transform:uppercase;color:var(--navy);letter-spacing:.01em}
.v1 .top nav a.on{background:var(--navy);color:#fff} .v1 .top nav a:hover{text-decoration:none}
.v1 main{max-width:1150px;margin:16px auto 40px;padding:0 20px}
.v1 .panel{border:1px solid var(--navy);border-radius:5px;overflow:hidden}
.v1 .ph{background:var(--navy);color:#fff;font:500 18px/1 var(--cond);text-transform:uppercase;padding:11px 16px}
.v1 .pb{padding:15px}
.v1 .sub{border:1px solid var(--navy);border-radius:5px;overflow:hidden;margin-bottom:6px}
.v1 .sub h2{margin:0;background:var(--navy);color:#fff;font:500 19px/1.25 var(--cond);text-transform:uppercase;padding:18px 16px}
.v1 .frm{display:grid;grid-template-columns:minmax(110px,34%) minmax(200px,268px) 1fr;gap:15px 30px;align-items:center;padding:30px 16px}
.v1 .frm label{grid-column:1;text-align:right;font-weight:400;margin:0}
.v1 .frm .ctl{grid-column:2} .v1 .frm button{grid-column:2;justify-self:start;margin:0}
.v1 .addon{display:flex} .v1 .addon span{display:flex;align-items:center;justify-content:center;width:33px;background:#eee;border:1px solid #ccc;border-right:0;border-radius:4px 0 0 4px;color:#555}
.v1 .addon input{border-radius:0 4px 4px 0}
.v1 input,.v1 select,.v1 textarea{width:100%;box-sizing:border-box;height:34px;padding:6px 12px;border:1px solid #ccc;border-radius:4px;font:inherit;color:#555;background:#fff}
.v1 textarea{height:auto;min-height:100px} .v1 input[type=file]{height:auto;padding:6px}
.v1 input:focus,.v1 select:focus,.v1 textarea:focus{outline:0;border-color:#66afe9;box-shadow:0 0 0 3px rgba(102,175,233,.35)}
.v1 button{background:var(--blue);color:#fff;border:1px solid #2e5f9f;border-radius:3px;padding:6px 13px;font:inherit;cursor:pointer;margin-top:18px}
.v1 button:disabled{background:#9aa9bd;border-color:#9aa9bd;cursor:not-allowed}
.v1 .crumbs{background:var(--navy);color:#fff;border-radius:5px;padding:9px 15px;margin-bottom:6px}
.v1 .crumbs a{color:#fff;text-decoration:underline}
.v1 h1{font:400 18px/1.3 Lato,"Helvetica Neue",Arial,sans-serif;margin:20px 0 10px}
.v1 h3{font:400 15px Lato,sans-serif;text-transform:uppercase;margin:26px 0 10px}
.v1 .std{max-width:600px} .v1 .std label{display:block;font-weight:700;margin-top:14px} .v1 .std input,.v1 .std select,.v1 .std textarea{margin-top:6px}
.v1 .tks{border:1px solid #ddd}
.v1 .tk{padding:9px 7px;border-bottom:1px solid #ddd;font-size:15px} .v1 .tk:last-child{border-bottom:0}
.v1 .tk>div{margin:3px 0} .v1 .tk .l1{display:flex;gap:14px;font-size:16px;margin-bottom:10px}
.v1 .tk .st{margin-left:auto} .v1 .tk .gap{margin-top:12px}
.v1 .tk .links a,.v1 .tk .links button{margin:0 12px 0 0} .v1 .tk .links button{margin-top:0;padding:2px 10px}
.v1 .msg{border-left:4px solid var(--blue);background:#f1f5fb;padding:10px 14px}
.v1 .foot{margin-top:18px;color:#444;font-size:14px}
@media (max-width:900px){.v1 .top{flex-wrap:wrap;padding:0 12px}.v1 .brand{font-size:21px}.v1 .top nav{width:100%}.v1 .top nav a{font-size:18px;padding:10px 12px}.v1 .frm{grid-template-columns:1fr}.v1 .frm label,.v1 .frm .ctl,.v1 .frm button{grid-column:1;text-align:left}}`;

/** "redesign" scenario: deliberately different markup and look, to test the executor's resilience. */
const V2 = `
.v2{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#f3f4f6;color:#111827}
.v2 header{background:linear-gradient(90deg,#0f766e,#1d4ed8);color:#fff;padding:14px 22px;font-size:20px}
.v2 main{max-width:920px;margin:22px auto;background:#fff;border-radius:18px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,.12)}
.v2 label{display:block;font-weight:600;margin-top:14px}
.v2 .grid{display:grid;grid-template-columns:1fr 1fr;gap:14px} .v2 .grid .wide{grid-column:1/-1}
.v2 input,.v2 select,.v2 textarea{width:100%;box-sizing:border-box;margin-top:6px;border-radius:12px;border:2px solid #cbd5e1;padding:12px;font:inherit}
.v2 textarea{min-height:110px}
.v2 button{margin-top:20px;border:0;color:#fff;font-size:15px;cursor:pointer;border-radius:999px;background:#0f766e;padding:12px 28px}`;

const CSS = FONTS + BASE + V1 + V2;

type NavKey = 'home' | 'faq' | 'contact' | 'none';
export interface LayoutOpts {
  /** navy panel title (v1) */
  panel?: string;
  /** breadcrumb bar: [label, href?] */
  crumbs?: [string, string?][];
  nav?: NavKey;
}

const SIM_BANNER = '<div class="sim">SIMULATED PORTAL FOR TESTING ONLY · NOT AFFILIATED WITH THE CITY OF BOSTON · DO NOT ENTER REAL DATA</div>';

function head(title: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="robots" content="noindex,nofollow"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · SIMULATED parking portal</title><style>${CSS}</style></head>`;
}

const crumbBar = (crumbs: [string, string?][]) =>
  `<nav class="crumbs" aria-label="Breadcrumb">${crumbs.map(([label, href]) => (href ? `<a href="${esc(href)}">${esc(label)}</a>` : esc(label))).join(' / ')}</nav>`;

export function layout(title: string, body: string, scenario: Scenario, opts: LayoutOpts = {}) {
  if (scenario === 'redesign') {
    return `${head(title)}<body class="v2">${SIM_BANNER}<header>Parking Help Center <small>(new design)</small></header>
<main>${body}</main><div class="badge">scenario: ${esc(scenario)}</div></body></html>`;
  }
  const nav = opts.nav ?? 'none';
  const link = (key: NavKey, href: string, label: string) => `<a href="${href}"${nav === key ? ' class="on" aria-current="page"' : ''}>${label}</a>`;
  return `${head(title)}<body class="v1">${SIM_BANNER}
<header class="top"><a class="seal" href="/">${EMBLEM_SVG}</a><span class="bar" aria-hidden="true"></span>
<a class="brand" href="/">Pahk the Cah</a>
<nav aria-label="Main">${link('home', '/', 'Home')}${link('faq', '/faq', 'FAQ')}${link('contact', '/contact', 'Contact Us')}</nav></header>
<main><section class="panel"><div class="ph">${esc(opts.panel ?? title)}</div><div class="pb">${opts.crumbs ? crumbBar(opts.crumbs) : ''}${body}</div></section></main>
${scenario === 'normal' ? '' : `<div class="badge">scenario: ${esc(scenario)}</div>`}</body></html>`;
}

const stateOptions = (selected = '') =>
  Object.entries(US_STATES)
    .map(([code, name]) => `<option value="${code}"${code === selected ? ' selected' : ''}>${esc(name)} (${code})</option>`)
    .join('');

const stateNameOptions = (selected = 'MA') =>
  Object.entries(US_STATES)
    .map(([code, name]) => `<option value="${code}"${code === selected ? ' selected' : ''}>${esc(name)}</option>`)
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

// ---------- find / lookup (read-only, GET only) ----------

const ticketForm = (value = '') => `<form id="lookup-ticket-form" class="frm" method="get" action="/lookup">
<label for="lk-ticket">Ticket Number</label><input class="ctl" id="lk-ticket" name="ticketNumber" inputmode="numeric" autocomplete="off" value="${esc(value)}">
<button type="submit">Search</button></form>`;

export function findPage(scenario: Scenario, q: LookupQuery = {}, error = '') {
  return layout(
    'Find your ticket',
    `${error ? `<p class="err">${esc(error)}</p>` : ''}
<section class="sub"><h2>If you know your ticket number, enter it here:</h2>${ticketForm(q.ticketNumber)}</section>
<section class="sub"><h2>To see all open tickets for your vehicle, enter your license plate number and state here:</h2>
<form id="lookup-plate-form" class="frm" method="get" action="/lookup">
<label for="lk-plate">License Plate</label><div class="ctl addon"><span>#</span><input id="lk-plate" name="plate" autocomplete="off" value="${esc(q.plate)}"></div>
<label for="lk-state">Select State</label><select class="ctl" id="lk-state" name="state">${stateNameOptions(q.state || 'MA')}</select>
<button type="submit">Search</button></form></section>
<section class="sub"><h2>To see all open tickets for your vehicle, enter your VIN number here:</h2>
<form id="lookup-vin-form" class="frm" method="get" action="/lookup">
<label for="lk-vin">VIN</label><div class="ctl addon"><span>#</span><input id="lk-vin" name="vin" autocomplete="off" value="${esc(q.vin)}"></div>
<button type="submit">Search</button></form></section>
<p class="foot">Already appealed? <a href="/status">Check appeal status</a> · <a href="/inbox">Email receipts (simulated)</a> · Know your ticket details? <a href="/appeal/start">Start an appeal</a></p>`,
    scenario,
    { panel: 'Find your ticket', nav: 'home' },
  );
}

/** Kept for callers of the v0.2 name. */
export const landingPage = (scenario: Scenario) => findPage(scenario);

/** "2026-11-15T14:32:00-05:00" → "11/15/2026" (the local date as printed on the ticket). */
export const usDate = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : iso;
};
export const usTime = (iso: string) => {
  const m = /T(\d{2}):(\d{2})/.exec(iso);
  if (!m) return '';
  const h = Number(m[1]);
  return `${((h + 11) % 12) + 1}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
};
export const money = (n: number) => `$${n.toFixed(2)}`;

const appealHref = (t: TicketView) =>
  `/appeal/start?ticket=${encodeURIComponent(t.ticketNumber)}&plate=${encodeURIComponent(t.plate)}&state=${encodeURIComponent(t.state)}`;

/** Row markup = the /lookup contract (docs/TASKS.md §6): adapters read the row's data-* attributes. */
function ticketRow(t: TicketView) {
  const links = [
    `<a href="/ticket/${esc(t.ticketNumber)}">View More Information</a>`,
    t.canAppeal ? `<a href="${esc(appealHref(t))}" data-action="appeal">Appeal Ticket</a>` : '',
    t.machineStatus === 'PAID' ? `<a href="/ticket/${esc(t.ticketNumber)}/hearing">Request Hearing</a>` : '',
    t.canAppeal ? `<button type="button" disabled title="Payments are not part of this simulation">Pay</button>` : '',
  ].join('');
  return `<article class="tk" data-ticket-row data-ticket-number="${esc(t.ticketNumber)}" data-plate="${esc(t.plate)}" data-state="${esc(t.state)}"
 data-violation="${esc(t.violation)}" data-issued-at="${esc(t.issuedAt)}" data-location="${esc(t.location)}" data-fine="${t.fine.toFixed(2)}"
 data-amount-due="${t.amountDue.toFixed(2)}" data-status="${t.machineStatus}"${t.decision ? ` data-decision="${t.decision}"` : ''}>
<div class="l1"><span data-field="ticketNumber">#${esc(t.ticketNumber)}</span><span data-field="amountDue">${money(t.amountDue)}</span><span class="st" data-field="status">${esc(t.statusText)}</span></div>
<div data-field="violation">${esc(t.violationText)}</div>
<div class="gap">Issue Date <span data-field="issuedAt">${usDate(t.issuedAt)}</span></div>
<div>Plate <span data-field="plate">${esc(t.plate)}</span></div>
<div class="links">${links}</div></article>`;
}

const MESSAGES: Record<string, string> = {
  missing_query: 'Please enter a ticket number, a license plate and state, or a VIN.',
  plate_lookup_ma_only: 'Only Massachusetts license plates can be searched by plate number. For a plate from another state, please search by ticket number.',
  not_found: 'No tickets were found for the information entered.',
};

export function resultsPage(scenario: Scenario, q: LookupQuery, r: LookupResult) {
  const message = r.message
    ? `<p class="msg" data-lookup-message="${r.message}">${esc(MESSAGES[r.message])}</p>${r.message === 'plate_lookup_ma_only' ? `<section class="sub"><h2>Search by ticket number:</h2>${ticketForm()}</section>` : ''}`
    : '';
  const list = r.tickets.length
    ? `<h1>Select Ticket to Pay or Appeal</h1>
<p>The following ticket(s) were found for the information entered. Please verify the tickets you would like to pay or appeal and select options.</p>
<h3>Tickets</h3>`
    : '';
  return layout(
    'Ticket results',
    `${message}${list}<div class="tks" data-lookup-results data-query="${esc(r.kind)}"${r.tickets.length ? '' : ' hidden'}>${r.tickets.map(ticketRow).join('')}</div>
<p class="foot"><a href="/">New search</a></p>`,
    scenario,
    { panel: 'Ticket results', crumbs: [['Search', '/'], ['Step 1']] },
  );
}

export function ticketPage(scenario: Scenario, t: TicketView) {
  const back = t.state === 'MA' ? `/lookup?plate=${encodeURIComponent(t.plate)}&state=MA` : `/lookup?ticketNumber=${encodeURIComponent(t.ticketNumber)}`;
  const appeal = t.appeal
    ? `<dt>Appeal</dt><dd data-confirmation="${esc(t.appeal.confirmationNumber)}">Received ${esc(usDate(t.appeal.createdAt))} · Confirmation number ${esc(t.appeal.confirmationNumber)}</dd>`
    : '';
  return layout(
    `Ticket ${t.ticketNumber}`,
    `<h1>Ticket #${esc(t.ticketNumber)}</h1>
<dl data-ticket-detail data-ticket-number="${esc(t.ticketNumber)}" data-status="${t.machineStatus}">
<dt>Status</dt><dd>${esc(t.statusText)}</dd>
<dt>Violation</dt><dd>${esc(t.violationText)}</dd>
<dt>Fine</dt><dd>${money(t.fine)}</dd>
<dt>Amount due</dt><dd>${money(t.amountDue)}</dd>
<dt>Issue date</dt><dd>${usDate(t.issuedAt)}</dd>
<dt>Issue time</dt><dd>${usTime(t.issuedAt)}</dd>
<dt>Location</dt><dd>${esc(t.location)}</dd>
<dt>Plate</dt><dd>${esc(t.plate)} (${esc(t.state)})</dd>${appeal}
</dl>
<p class="foot">${t.canAppeal ? `<a href="${esc(appealHref(t))}">Appeal Ticket</a> · ` : ''}<a href="${esc(back)}">Back to results</a></p>`,
    scenario,
    { panel: 'Ticket information', crumbs: [['Search', '/'], ['Step 1', back], [`#${t.ticketNumber}`]] },
  );
}

export const faqPage = (scenario: Scenario) =>
  layout(
    'FAQ',
    `<h1>Frequently asked questions (simulation)</h1>
<h3>What is this site?</h3><p>A simulated parking-ticket portal used to test AppealHero's browser agent. Every ticket, plate and person here is synthetic. It is not affiliated with the City of Boston.</p>
<h3>Which tickets can I find?</h3><p>Synthetic tickets whose numbers start with 9. Massachusetts plates can be searched by plate and state; for other states, search by ticket number. The seeded vehicles can also be found by VIN.</p>
<h3>Can I pay here?</h3><p>No. Payments are not part of this simulation, and nothing here charges money.</p>
<h3>How does an appeal work here?</h3><p>Fill in the four-step form. You get a confirmation number right away and a simulated email receipt, and the <a href="/status">status page</a> shows the appeal as received.</p>
<h3>I have a real ticket.</h3><p>Use the City of Boston's official parking ticket website, not this one.</p>`,
    scenario,
    { panel: 'FAQ', nav: 'faq' },
  );

export const contactPage = (scenario: Scenario) =>
  layout(
    'Contact us',
    `<h1>Contact (simulation)</h1><p>This simulated portal has no staff and no phone line.</p>
<p><a href="/status">Appeal status</a> · <a href="/inbox">Email receipts (simulated)</a></p>`,
    scenario,
    { panel: 'Contact us', nav: 'contact' },
  );

// ---------- appeal flow (executor markup: labels, names, ids and data-* stay stable) ----------

const appealOpts = (step: string): LayoutOpts => ({ panel: 'Appeal a ticket', crumbs: [['Search', '/'], ['Appeal'], [step]] });

export function startPage(scenario: Scenario, error = '', prefill: { ticket?: string; plate?: string; state?: string } = {}) {
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
<form method="post" action="/appeal/start" class="std">
<label for="ticketNumber">Ticket number</label><input id="ticketNumber" name="ticketNumber" required data-pii value="${esc(prefill.ticket)}">
<label for="plateNumber">Plate number</label><input id="plateNumber" name="plateNumber" required data-pii value="${esc(prefill.plate)}">
<label for="plateState">Registration state</label><select id="plateState" name="plateState" required>${stateOptions(prefill.state)}</select>
<button type="submit">Continue</button></form>`,
    scenario,
    appealOpts('Step 1 of 4: Ticket'),
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
    `<h1>Your details and dispute</h1>${err}<form method="post" action="/appeal/details?sid=${s.sid}" class="std">
<input type="hidden" name="sid" value="${s.sid}">
<label for="fullName">Full name</label><input id="fullName" name="fullName" required data-pii>
<label for="mailingAddress">Mailing address</label><textarea id="mailingAddress" name="mailingAddress" required data-pii></textarea>
<label for="email">Email</label><input id="email" name="email" type="email" required data-pii>
${missing ? '<label for="vehicleMake">Vehicle make</label><input id="vehicleMake" name="vehicleMake" required>' : ''}
<label for="disputeReason">Reason for dispute</label><select id="disputeReason" name="disputeReason" required>${reasonOptions(false)}</select>
<label for="statement">Statement</label><textarea id="statement" name="statement" maxlength="2000" required></textarea>
<button type="submit">Continue</button></form>`,
    scenario,
    appealOpts('Step 2 of 4: Your details'),
  );
}

export function evidencePage(scenario: Scenario, s: Session, error = '') {
  const err = error ? `<p class="err">${esc(error)}</p>` : '';
  const v2 = scenario === 'redesign';
  return layout(
    'Evidence',
    `<h1>${v2 ? 'Add photos' : 'Upload evidence'}</h1>${err}
<form method="post" action="/appeal/evidence?sid=${s.sid}" enctype="multipart/form-data" class="std">
<input type="hidden" name="sid" value="${s.sid}">
${v2 ? '<p>Attach photos (JPG, PNG or PDF)</p><input type="file" name="evidence" multiple accept=".jpg,.jpeg,.png,.pdf">' : '<label for="evidence">Upload evidence (JPG, PNG or PDF, up to 5 files)</label><input type="file" id="evidence" name="evidence" multiple accept=".jpg,.jpeg,.png,.pdf">'}
<button type="submit">${v2 ? 'Next →' : 'Continue'}</button></form>`,
    scenario,
    appealOpts('Step 3 of 4: Evidence'),
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
    `<h1>Review your appeal</h1>${err}<dl>${rows}${extra}</dl><h3>Evidence</h3><ul>${ev}</ul>
<form method="post" action="/appeal/submit"><input type="hidden" name="sid" value="${s.sid}">${captcha}
<p><input class="cb" type="checkbox" id="attest" name="attest" required><label class="inline" for="attest">I certify that the information provided is true and accurate to the best of my knowledge.</label></p>
<button type="submit" id="submitAppeal">Submit appeal</button></form>`,
    scenario,
    appealOpts('Step 4 of 4: Review and submit'),
  );
}

export const confirmationPage = (scenario: Scenario, a: Appeal) =>
  layout(
    'Received',
    `<h1>Appeal received</h1><p>Confirmation number: <strong data-confirmation>${esc(a.confirmationNumber)}</strong></p>
<p>An email receipt was sent to <span data-email>${esc(a.email)}</span>. A decision is usually mailed within 7–10 business days (simulated).</p>
<p class="foot"><a href="/ticket/${esc(a.ticketNumber)}">View ticket</a> · <a href="/status?ticket=${esc(a.ticketNumber)}">Check appeal status</a> · <a href="/">New search</a></p>`,
    scenario,
    appealOpts('Done'),
  );

export const alreadyOnFilePage = (scenario: Scenario, a: Appeal) =>
  layout(
    'Already on file',
    `<h1>An appeal for this ticket is already on file</h1><p data-already-on-file data-confirmation="${esc(a.confirmationNumber)}">Confirmation number: ${esc(a.confirmationNumber)}</p>`,
    scenario,
    { panel: 'Appeal a ticket', crumbs: [['Search', '/'], ['Appeal']] },
  );

export function statusPage(scenario: Scenario, ticket: string, a: Appeal | undefined) {
  const result = ticket
    ? a
      ? `<div class="msg" data-appeal-status="RECEIVED" data-confirmation="${esc(a.confirmationNumber)}">Appeal received on ${esc(a.createdAt)}. Confirmation number: <strong>${esc(a.confirmationNumber)}</strong></div>`
      : `<div class="msg" data-appeal-status="NONE">No appeal on file for ticket ${esc(ticket)}.</div>`
    : '';
  return layout(
    'Status',
    `<h1>Check appeal status</h1><form method="get" action="/status" class="frm"><label for="ticket">Ticket number</label><input class="ctl" id="ticket" name="ticket" value="${esc(ticket)}"><button type="submit">Check status</button></form>${result}`,
    scenario,
    { panel: 'Appeal status', crumbs: [['Search', '/'], ['Appeal status']] },
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
    { panel: 'Email receipts (simulated)', crumbs: [['Search', '/'], ['Email receipts']] },
  );

export const messagePage = (scenario: Scenario, title: string, text: string) =>
  layout(title, `<h1>${esc(title)}</h1><p class="err">${esc(text)}</p>`, scenario, { crumbs: [['Search', '/'], [title]] });
