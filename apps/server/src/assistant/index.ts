import type { Content, Part } from '@google/genai';
import {
  ListedTicketSchema,
  OFFICIAL_TICKET_LOOKUP_URL,
  PhotoTicketSchema,
  type AnalyzedPhotoTicket,
  type AnalyzedTicket,
  type PhotoTicket,
  type AssistantResponse,
  type AssistantTurn,
  type ListedTicket,
  type TicketCategory,
  type TicketListAnalysis,
} from '@appealhero/shared';
import { config } from '../core/config';
import { generate, inlinePart } from '../agent/llm';
import { readDemoTruth } from '../agent/perception/demoTruth';
import { RULE_SOURCES } from '../agent/rules/boston';

type Lang = 'zh' | 'es' | 'en';
const asLang = (value: string): Lang => (value === 'es' || value === 'en' ? value : 'zh');
const DAY = 86_400_000;

/** Today's date in Boston as YYYY-MM-DD. */
export const bostonToday = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(now);
const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);

/** Status text as printed on the results page → a category. Unknown wording stays OTHER (never guessed as paid). */
export function categorize(status: string, amountDue: number | null): TicketCategory {
  const s = status.toLowerCase();
  if (/appeal\w*\s*(accept|grant|approv|sustain)|dismiss|void|cancel/.test(s)) return 'APPEAL_ACCEPTED';
  if (/appeal\w*\s*(den|reject|declin)|liable/.test(s)) return 'APPEAL_DENIED';
  if (/appeal|hearing|pending|review|disput/.test(s)) return 'APPEAL_PENDING';
  if (/\bpaid\b|closed|satisfied/.test(s)) return 'PAID';
  if (/open|due|unpaid|outstanding|late|notice|overdue|balance/.test(s)) return 'OPEN';
  return amountDue === 0 ? 'OTHER' : 'OTHER';
}

/** Deterministic: sort newest first, 21-day pay-or-appeal deadline for open tickets (boston.gov parking-ticket FAQs). */
export function analyzeTickets(rows: ListedTicket[], today = bostonToday()): TicketListAnalysis {
  const tickets: AnalyzedTicket[] = [...rows]
    .sort((a, b) => b.issueDate.localeCompare(a.issueDate) || b.ticketNumber.localeCompare(a.ticketNumber))
    .map((row) => {
      const category = categorize(row.status, row.amountDue);
      if (category !== 'OPEN') return { ...row, category };
      const deadline = addDays(row.issueDate, 21);
      const daysLeft = daysBetween(today, deadline);
      return { ...row, category, deadline, daysLeft, overdue: daysLeft < 0 };
    });
  const open = tickets.filter((t) => t.category === 'OPEN' || (t.category === 'APPEAL_DENIED' && (t.amountDue ?? 0) > 0));
  return {
    today,
    tickets,
    latest: tickets[0],
    openCount: open.length,
    totalDue: Number(open.reduce((sum, t) => sum + (t.amountDue ?? 0), 0).toFixed(2)),
  };
}

/** Deterministic: printed PAY BY date when the ticket has one, otherwise ticket date + 21 days. */
export function analyzePhotoTicket(ticket: PhotoTicket, today = bostonToday()): AnalyzedPhotoTicket {
  const deadline = ticket.payBy ?? addDays(ticket.issueDate, 21);
  const daysLeft = daysBetween(today, deadline);
  return { ...ticket, today, deadline, deadlineSource: ticket.payBy ? 'printed' : 'rule', daysLeft, overdue: daysLeft < 0 };
}

const DATE = { type: 'string', description: 'converted to YYYY-MM-DD; empty string if not printed' };
const LIST_SCHEMA = {
  type: 'object',
  properties: {
    imageKind: {
      type: 'string',
      enum: ['ticket_list', 'ticket_photo', 'other'],
      description: 'ticket_list: a lookup results page listing tickets; ticket_photo: a photo of one paper parking ticket; other: anything else',
    },
    isTicketList: { type: 'boolean', description: 'true only if the image shows a list or detail of parking tickets' },
    photo: {
      type: 'object',
      description: 'only for ticket_photo: the values printed on the paper ticket',
      properties: {
        ticketNumber: { type: 'string', description: 'violation number, digits only' },
        issueDate: DATE,
        issueTime: { type: 'string', description: 'time as printed, e.g. 12:07 AM' },
        plate: { type: 'string' },
        plateState: { type: 'string', description: '2-letter state code' },
        violation: { type: 'string', description: 'violation code and description as printed' },
        location: { type: 'string' },
        amount: { type: 'number', description: 'fine / amount due; -1 if not printed' },
        payBy: DATE,
        lateAmount: { type: 'number', description: 'amount printed for after the pay-by date (THEREAFTER); -1 if not printed' },
      },
      required: ['ticketNumber', 'issueDate', 'issueTime', 'plate', 'plateState', 'violation', 'location', 'amount', 'payBy', 'lateAmount'],
    },
    tickets: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          ticketNumber: { type: 'string', description: 'digits only, without #' },
          amountDue: { type: 'number', description: 'amount shown next to the ticket number; use -1 if not shown' },
          violation: { type: 'string', description: 'violation code and description as printed' },
          issueDate: { type: 'string', description: 'issue date converted to YYYY-MM-DD' },
          plate: { type: 'string' },
          status: { type: 'string', description: 'status text as printed, e.g. Paid, Appeal Accepted, Open' },
        },
        required: ['ticketNumber', 'amountDue', 'violation', 'issueDate', 'plate', 'status'],
      },
    },
  },
  required: ['imageKind', 'isTicketList', 'tickets'],
};

type Upload = { path: string; mime: string };

/** Screenshot(s) of the official results page → validated rows. Fake mode reads only synthetic fixtures. */
type ImageReading = { rows: ListedTicket[]; isTicketList: boolean; photo?: PhotoTicket; tokens: number };
export async function readTicketList(images: Upload[]): Promise<ImageReading> {
  if (!images.length) return { rows: [], isTicketList: false, tokens: 0 };
  if (config.aiMode === 'fake') {
    const truths = images.map((image) => readDemoTruth(image.path));
    const rows = truths.flatMap((truth) => (truth?.kind === 'ticket_list' ? truth.tickets : []));
    const ticket = truths.find((truth) => truth?.kind === 'ticket');
    const photo: PhotoTicket | undefined =
      !rows.length && ticket?.kind === 'ticket'
        ? {
            ticketNumber: ticket.ticketNumber,
            issueDate: bostonToday(new Date(ticket.issuedAt)),
            issueTime: new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }).format(new Date(ticket.issuedAt)),
            plate: ticket.plateNumber,
            plateState: ticket.plateState,
            violation: ticket.violationDescription,
            location: ticket.location,
            amount: ticket.fineAmount,
            payBy: null,
            lateAmount: null,
          }
        : undefined;
    return { rows, isTicketList: rows.length > 0, photo, tokens: 0 };
  }
  const parts: Part[] = images.map((image) => inlinePart(image.path, image.mime));
  parts.push({
    text: [
      'The vehicle owner uploaded these images. Decide what they show (imageKind).',
      'ticket_list: a screenshot of a parking-ticket lookup results page. List every ticket exactly as printed in tickets. Never invent a ticket or a status.',
      'ticket_photo: a photo of ONE paper parking ticket. Fill photo with the printed values and leave tickets empty. Ticket printers often print the values slightly off, on top of the field labels: read the printed values (dates, plate, violation, amounts), not the label words. Never guess a ticket number; leave a field empty if it is unreadable.',
      'other: anything else; return isTicketList=false and an empty list.',
    ].join('\n'),
  });
  const res = await generate({
    model: config.geminiModel,
    contents: [{ role: 'user', parts }],
    config: {
      systemInstruction: 'You read parking-ticket lookup screenshots. Output JSON only.',
      responseMimeType: 'application/json',
      responseJsonSchema: LIST_SCHEMA,
    },
  });
  const raw = JSON.parse(res.text ?? '{}') as { imageKind?: string; isTicketList?: boolean; tickets?: unknown[]; photo?: Record<string, unknown> };
  const rows = (raw.tickets ?? []).flatMap((item) => {
    const row = item as Record<string, unknown>;
    const parsed = ListedTicketSchema.safeParse({
      ...row,
      ticketNumber: String(row.ticketNumber ?? '').replace(/\D/g, ''),
      amountDue: row.amountDue === -1 ? null : row.amountDue,
    });
    return parsed.success && parsed.data.ticketNumber ? [parsed.data] : [];
  });
  let photo: PhotoTicket | undefined;
  if (raw.imageKind === 'ticket_photo' && raw.photo) {
    const p = raw.photo;
    const date = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
    const amount = (v: unknown) => (typeof v === 'number' && v >= 0 ? v : null);
    const parsed = PhotoTicketSchema.safeParse({
      ticketNumber: String(p.ticketNumber ?? '').replace(/\D/g, ''),
      issueDate: date(p.issueDate) ?? '',
      issueTime: typeof p.issueTime === 'string' && p.issueTime ? p.issueTime : undefined,
      plate: String(p.plate ?? ''),
      plateState: String(p.plateState ?? ''),
      violation: String(p.violation ?? ''),
      location: String(p.location ?? ''),
      amount: amount(p.amount),
      payBy: date(p.payBy),
      lateAmount: amount(p.lateAmount),
    });
    if (parsed.success) photo = parsed.data;
  }
  const u = res.usageMetadata;
  return {
    rows,
    isTicketList: Boolean(raw.isTicketList) && rows.length > 0 && raw.imageKind !== 'ticket_photo',
    photo,
    tokens: (u?.promptTokenCount ?? 0) + (u?.candidatesTokenCount ?? 0),
  };
}

const SOURCES = [RULE_SOURCES.deadline, RULE_SOURCES.plateLookup, 'https://www.boston.gov/departments/parking-clerk'];

const SYSTEM = (lang: Lang, today: string) =>
  [
    'You are the AppealHero assistant. You help people with City of Boston parking tickets. Answer in the user language: ' +
      { zh: 'Simplified Chinese', es: 'Spanish', en: 'English' }[lang] +
      '.',
    `Today in Boston is ${today}.`,
    'Facts you may state (checked on boston.gov on 2026-11-21): pay or appeal within 21 days of the ticket date; after that a late fee is added but an appeal is still possible; tickets can be appealed online, by mail or at a hearing; the Parking Clerk is at 617-635-4410 (Mon–Fri 9:00–16:30) and parking@boston.gov. Do not state other rules as facts.',
    `You cannot open or search any website. To see a driver's tickets, ask them to search the official site ${OFFICIAL_TICKET_LOOKUP_URL} themselves (by ticket number, or by plate and state) and upload a screenshot of the results here.`,
    'When a TICKET_ANALYSIS block is present, it was computed by code from the screenshot. Use its numbers, dates and categories exactly; do not recompute them. Start with the most recent ticket, then anything still open (deadline, days left or overdue, amount), then a one-line summary of the rest.',
    'When a PHOTO_TICKET block is present, the user photographed one paper ticket; the block was read from the photo and its deadline computed by code. Explain the ticket in plain words: number, date and time, place, violation, amount; then the deadline exactly as given (if overdue: by how many days, the late amount if printed, and that an appeal is still possible). Then tell them they can start an appeal with this photo using the button below your answer. Use the block values exactly.',
    'For an open ticket, offer to prepare an appeal in AppealHero. Never promise an outcome, never say you are a lawyer, and never ask for passwords or card numbers.',
    'Be brief and concrete: at most 6 short sentences or a short list. Plain text, no markdown tables.',
  ].join('\n');

const T = {
  zh: {
    lookup: `我不会替你访问官网（官网不允许自动程序访问）。请这样做：\n1. 打开官方查询网站 ${OFFICIAL_TICKET_LOOKUP_URL}\n2. 输入罚单号，或者车牌和州，点 Search\n3. 把结果页截图，点下面的“从相册选”上传\n我会读出每张罚单的状态，告诉你最近一次是什么时候、有没有过期。`,
    deadline: '规则是：开罚单后 21 天内缴费或申诉；超过 21 天会加收滞纳金，但仍然可以申诉。（来源：boston.gov 停车罚单 FAQ）',
    help: `我可以帮你：\n· 看看你最近的罚单：在官网 ${OFFICIAL_TICKET_LOOKUP_URL} 查询后上传截图，我来读\n· 解释期限、罚款和申诉方式\n· 为还没处理的罚单准备申诉`,
    notList: '这张图看起来不是罚单查询结果页。请在官网查询后，截取列出罚单的那一页再上传。',
    none: '截图里没有找到罚单。',
    latest: (t: AnalyzedTicket) => `最近一次罚单是 ${t.issueDate}（#${t.ticketNumber}，${t.violation}），状态：${t.status}，金额 ${money(t.amountDue)}。`,
    open: (t: AnalyzedTicket) =>
      t.overdue
        ? `#${t.ticketNumber} 还没处理，截止日期 ${t.deadline} 已经过了 ${-t.daysLeft!} 天，会加收滞纳金，但仍然可以申诉。`
        : `#${t.ticketNumber} 还没处理，请在 ${t.deadline} 前缴费或申诉（还剩 ${t.daysLeft} 天）。`,
    allClear: '其余罚单都已经缴清或处理完，没有需要你现在处理的。',
    offer: '需要的话，我可以帮你为还没处理的罚单准备申诉。',
    photo: (p: AnalyzedPhotoTicket) =>
      [
        `这是一张停车罚单：#${p.ticketNumber || '（看不清）'}，${p.issueDate}${p.issueTime ? ' ' + p.issueTime : ''} 开在 ${p.location || '（看不清）'}，违章：${p.violation || '（看不清）'}，金额 ${money(p.amount)}。`,
        p.overdue
          ? `缴费或申诉的截止日期是 ${p.deadline}，已经过了 ${-p.daysLeft} 天${p.lateAmount !== null ? `，现在应缴 ${money(p.lateAmount)}` : '，会加收滞纳金'}，但仍然可以申诉。`
          : `请在 ${p.deadline} 前缴费或申诉（还剩 ${p.daysLeft} 天）。`,
        '想申诉的话，点下面的“用这张罚单申诉”。',
      ].join('\n'),
  },
  es: {
    lookup: `No accedo al sitio oficial por ti (no permite programas automáticos). Haz esto:\n1. Abre el sitio oficial ${OFFICIAL_TICKET_LOOKUP_URL}\n2. Escribe el número de multa, o la matrícula y el estado, y pulsa Search\n3. Haz una captura de la página de resultados y súbela con «Elegir de la galería»\nLeeré el estado de cada multa y te diré cuál es la más reciente y si está vencida.`,
    deadline:
      'La regla: paga o apela dentro de 21 días desde la fecha de la multa; después se suma un recargo, pero todavía puedes apelar. (Fuente: preguntas frecuentes de boston.gov)',
    help: `Puedo ayudarte a:\n· Revisar tus multas recientes: búscalas en ${OFFICIAL_TICKET_LOOKUP_URL} y sube una captura\n· Explicar plazos, montos y formas de apelar\n· Preparar una apelación para una multa pendiente`,
    notList: 'La imagen no parece una página de resultados de multas. Busca en el sitio oficial y sube la captura de la lista.',
    none: 'No encontré multas en la captura.',
    latest: (t: AnalyzedTicket) =>
      `Tu multa más reciente es del ${t.issueDate} (#${t.ticketNumber}, ${t.violation}). Estado: ${t.status}. Monto: ${money(t.amountDue)}.`,
    open: (t: AnalyzedTicket) =>
      t.overdue
        ? `La #${t.ticketNumber} está pendiente y su plazo (${t.deadline}) venció hace ${-t.daysLeft!} días: se suma un recargo, pero aún puedes apelar.`
        : `La #${t.ticketNumber} está pendiente: paga o apela antes del ${t.deadline} (quedan ${t.daysLeft} días).`,
    allClear: 'Las demás multas están pagadas o resueltas; no hay nada que hacer ahora.',
    offer: 'Si quieres, preparo una apelación para la multa pendiente.',
    photo: (p: AnalyzedPhotoTicket) =>
      [
        `Es una multa de estacionamiento: #${p.ticketNumber || '(ilegible)'}, del ${p.issueDate}${p.issueTime ? ' ' + p.issueTime : ''} en ${p.location || '(ilegible)'}. Infracción: ${p.violation || '(ilegible)'}. Monto: ${money(p.amount)}.`,
        p.overdue
          ? `El plazo para pagar o apelar era el ${p.deadline} y venció hace ${-p.daysLeft} días${p.lateAmount !== null ? `; ahora se deben ${money(p.lateAmount)}` : '; se suma un recargo'}, pero aún puedes apelar.`
          : `Paga o apela antes del ${p.deadline} (quedan ${p.daysLeft} días).`,
        'Si quieres apelar, pulsa «Apelar con esta multa» abajo.',
      ].join('\n'),
  },
  en: {
    lookup: `I don't access the official site for you (it doesn't allow automated programs). Here's how:\n1. Open the official lookup site ${OFFICIAL_TICKET_LOOKUP_URL}\n2. Enter the ticket number, or the plate and state, and press Search\n3. Take a screenshot of the results page and upload it with “Choose from library”\nI'll read each ticket's status and tell you the latest one and whether it's overdue.`,
    deadline:
      'The rule: pay or appeal within 21 days of the ticket date; after that a late fee is added, but you can still appeal. (Source: boston.gov parking ticket FAQs)',
    help: `I can help you:\n· Check your recent tickets: search ${OFFICIAL_TICKET_LOOKUP_URL} and upload a screenshot\n· Explain deadlines, fines and how to appeal\n· Prepare an appeal for an open ticket`,
    notList: "That image doesn't look like a ticket results page. Search the official site and upload a screenshot of the list.",
    none: "I couldn't find any tickets in the screenshot.",
    latest: (t: AnalyzedTicket) =>
      `Your most recent ticket is from ${t.issueDate} (#${t.ticketNumber}, ${t.violation}). Status: ${t.status}. Amount: ${money(t.amountDue)}.`,
    open: (t: AnalyzedTicket) =>
      t.overdue
        ? `#${t.ticketNumber} is still open; its deadline (${t.deadline}) passed ${-t.daysLeft!} days ago, so a late fee is added, but you can still appeal.`
        : `#${t.ticketNumber} is still open: pay or appeal by ${t.deadline} (${t.daysLeft} days left).`,
    allClear: 'Everything else is paid or resolved; nothing needs your attention now.',
    offer: 'If you like, I can prepare an appeal for the open ticket.',
    photo: (p: AnalyzedPhotoTicket) =>
      [
        `This is a parking ticket: #${p.ticketNumber || '(unreadable)'}, issued ${p.issueDate}${p.issueTime ? ' ' + p.issueTime : ''} at ${p.location || '(unreadable)'}. Violation: ${p.violation || '(unreadable)'}. Amount: ${money(p.amount)}.`,
        p.overdue
          ? `The pay-or-appeal deadline was ${p.deadline}, ${-p.daysLeft} days ago${p.lateAmount !== null ? `; ${money(p.lateAmount)} is due now` : '; a late fee is added'}, but you can still appeal.`
          : `Pay or appeal by ${p.deadline} (${p.daysLeft} days left).`,
        'To appeal, tap “Appeal with this ticket” below.',
      ].join('\n'),
  },
};
const money = (amount: number | null) => (amount === null ? '—' : `$${amount.toFixed(2)}`);

/** Offline replies: same facts, fixed wording. */
export function fakeReply(lang: Lang, text: string, analysis?: TicketListAnalysis, notTicketList = false, photoTicket?: AnalyzedPhotoTicket): string {
  const t = T[lang];
  if (photoTicket) return t.photo(photoTicket);
  if (notTicketList) return t.notList;
  if (analysis) {
    if (!analysis.latest) return t.none;
    const open = analysis.tickets.filter((x) => x.category === 'OPEN');
    return [t.latest(analysis.latest), ...open.map(t.open), open.length ? t.offer : t.allClear].join('\n');
  }
  if (/多久|期限|几天|过期规则|deadline|how long|days|plazo|cuánto tiempo|cuantos días/i.test(text)) return t.deadline;
  if (/最近|上一次|上次|罚单|过期|欠|latest|last|recent|my ticket|expired|overdue|owe|última|reciente|mis multas|vencid|debo/i.test(text)) return t.lookup;
  return t.help;
}

export async function assistantReply(input: { lang: string; history: AssistantTurn[]; text: string; images: Upload[] }): Promise<AssistantResponse> {
  const lang = asLang(input.lang);
  const today = bostonToday();
  const list = await readTicketList(input.images);
  const analysis = list.isTicketList ? analyzeTickets(list.rows, today) : undefined;
  const photoTicket = !analysis && list.photo ? analyzePhotoTicket(list.photo, today) : undefined;
  const notTicketList = input.images.length > 0 && !analysis && !photoTicket;
  if (config.aiMode === 'fake')
    return {
      reply: fakeReply(lang, input.text, analysis, notTicketList, photoTicket),
      analysis,
      photoTicket,
      notTicketList,
      sources: SOURCES,
      aiMode: 'fake',
    };

  const contents: Content[] = input.history.slice(-12).map((turn) => ({ role: turn.role === 'user' ? 'user' : 'model', parts: [{ text: turn.text }] }));
  const latest: Part[] = [{ text: input.text || (input.images.length ? '(screenshot uploaded)' : '') }];
  if (notTicketList) latest.push({ text: 'NOTE: the uploaded image is neither a ticket results page nor a parking ticket photo.' });
  if (photoTicket) latest.push({ text: `PHOTO_TICKET (read from the photo; deadline computed by code, use exactly): ${JSON.stringify(photoTicket)}` });
  if (analysis) latest.push({ text: `TICKET_ANALYSIS (computed by code, use exactly): ${JSON.stringify(analysis)}` });
  contents.push({ role: 'user', parts: latest });
  const res = await generate({ model: config.geminiModel, contents, config: { systemInstruction: SYSTEM(lang, today) } });
  const reply = (res.text ?? '').trim() || fakeReply(lang, input.text, analysis, notTicketList, photoTicket);
  return { reply, analysis, photoTicket, notTicketList, sources: SOURCES, aiMode: 'gemini' };
}
