import type { Part } from '@google/genai';
import { DEMO_TICKETS } from '@appealhero/shared';
import { config } from '../config';
import type { Ctx } from '../ctx';
import type { EvidenceRecord, TicketExtraction } from '../types';
import { generateJson, inlinePart } from './llm';

const EXTRACTION_SCHEMA = {
  type: 'object',
  properties: {
    ticketNumber: { type: 'string' },
    plateNumber: { type: 'string' },
    plateState: { type: 'string', description: '2-letter US state code' },
    violationDescription: { type: 'string' },
    issuedAt: { type: 'string', description: 'ISO 8601 with the America/New_York UTC offset' },
    location: { type: 'string' },
    fineAmount: { type: 'number' },
    confidence: { type: 'number', description: '0..1' },
    userStatement: {
      type: 'object',
      properties: {
        original: { type: 'string', description: 'verbatim, in the original language' },
        language: { type: 'string' },
        english: { type: 'string', description: 'faithful English translation' },
      },
      required: ['original', 'language', 'english'],
    },
  },
  required: ['ticketNumber', 'plateNumber', 'plateState', 'violationDescription', 'issuedAt', 'location', 'confidence'],
};

/** Photo (+ optional voice note / typed text) → structured ticket in ONE multimodal call. No separate STT service. */
export async function extractTicket(
  ctx: Ctx,
  caseId: string,
  input: { ticket: EvidenceRecord; audio?: EvidenceRecord; text?: string; lang: string },
): Promise<TicketExtraction> {
  if (config.aiMode === 'fake') return fakeExtraction(input.text, input.lang, Boolean(input.audio));
  const parts: Part[] = [inlinePart(input.ticket.path, input.ticket.mime)];
  if (input.audio) parts.push(inlinePart(input.audio.path, input.audio.mime));
  parts.push({
    text: [
      'Extract the fields of this City of Boston parking ticket photo.',
      'If a field is unreadable return an empty string and lower the confidence. Never guess a ticket number.',
      input.audio
        ? 'An audio note from the vehicle owner is attached: transcribe it verbatim in its original language into userStatement.original, name the language, and translate it into English.'
        : '',
      input.text ? `The owner also typed (language "${input.lang}"): """${input.text}""" — include it in userStatement.` : '',
    ]
      .filter(Boolean)
      .join('\n'),
  });
  return generateJson<TicketExtraction>(ctx, caseId, parts, EXTRACTION_SCHEMA, 'You extract structured data from parking tickets. Output JSON only.');
}

/** Follow-up voice messages: transcribe + translate in one call. */
export async function transcribeAudio(ctx: Ctx, caseId: string, audio: EvidenceRecord, lang: string) {
  if (config.aiMode === 'fake') return { original: '（语音消息 · fake 模式不转写）', language: lang, english: '(voice message — not transcribed in fake mode)' };
  return generateJson<{ original: string; language: string; english: string }>(
    ctx,
    caseId,
    [inlinePart(audio.path, audio.mime), { text: `Transcribe verbatim (expected language: ${lang}) and translate to English.` }],
    {
      type: 'object',
      properties: { original: { type: 'string' }, language: { type: 'string' }, english: { type: 'string' } },
      required: ['original', 'language', 'english'],
    },
    'You transcribe short voice notes about a parking ticket. Output JSON only.',
  );
}

/** Deterministic stand-in so the whole pipeline runs without a key. Picks a demo ticket from keywords. */
export function fakeExtraction(text = '', lang = 'zh', hasAudio = false): TicketExtraction {
  const t = text.toLowerCase();
  const base = /hydrant|消防栓/.test(t) ? DEMO_TICKETS.hydrant : /permit|resident|居民|许可|路牌/.test(t) ? DEMO_TICKETS.permit : DEMO_TICKETS.meter;
  const original = text || (hasAudio ? '（语音 · fake 模式不转写）' : '');
  return {
    ...base,
    confidence: 0.99,
    userStatement: original ? { original, language: lang, english: `[fake mode — not translated] ${original}` } : undefined,
  };
}
