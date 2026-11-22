import fs from 'node:fs';
import path from 'node:path';
import type { FastifyRequest } from 'fastify';
import { EVIDENCE_LIMITS, type Evidence } from '@appealhero/shared';
import { config } from '../core/config';
import type { CaseRecord, EvidenceRecord } from '../core/types';
import { newId, now, sha256Hex } from '../core/util';

export interface UploadedFile {
  field: string;
  filename: string;
  mime: string;
  buffer: Buffer;
}

/** Accepts multipart (phone uploads) or JSON (tests / curl). */
export async function readForm(req: FastifyRequest): Promise<{ fields: Record<string, string>; files: UploadedFile[] }> {
  const fields: Record<string, string> = {};
  const files: UploadedFile[] = [];
  if (!req.isMultipart()) {
    for (const [k, v] of Object.entries((req.body ?? {}) as Record<string, unknown>)) if (typeof v === 'string' || typeof v === 'number') fields[k] = String(v);
    return { fields, files };
  }
  for await (const part of req.parts()) {
    if (part.type === 'file') files.push({ field: part.fieldname, filename: part.filename || 'upload', mime: part.mimetype, buffer: await part.toBuffer() });
    else fields[part.fieldname] = String(part.value ?? '');
  }
  return { fields, files };
}

const EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/heic': '.heic',
  'application/pdf': '.pdf',
  'audio/wav': '.wav',
  'audio/wave': '.wav',
  'audio/x-wav': '.wav',
  'audio/webm': '.webm',
  'audio/mp4': '.m4a',
  'audio/mpeg': '.mp3',
};

/** Store a file under data/uploads/<case>/ with a sha256. Portal filenames are normalized ASCII names. */
export function saveEvidence(c: CaseRecord, f: UploadedFile, kind: Evidence['kind']): EvidenceRecord {
  const id = newId('ev');
  const ext = EXT[f.mime] ?? (path.extname(f.filename) || '.bin');
  const dir = path.join(config.dataDir, 'uploads', c.id);
  fs.mkdirSync(dir, { recursive: true });
  const diskName = `${id}${ext}`;
  const filePath = path.join(dir, diskName);
  fs.writeFileSync(filePath, f.buffer);
  const n = c.evidence.filter((e) => e.kind === kind).length + 1;
  const portalName = kind === 'ticket_photo' ? `ticket${ext}` : kind === 'audio' ? `voice-${n}${ext}` : `evidence-${n}${ext}`;
  const submitToPortal = kind !== 'audio' && EVIDENCE_LIMITS.mimeTypes.includes(f.mime) && f.buffer.length <= EVIDENCE_LIMITS.maxBytes;
  const ev: EvidenceRecord = {
    id,
    kind,
    filename: portalName,
    mime: f.mime,
    bytes: f.buffer.length,
    sha256: sha256Hex(f.buffer),
    url: `/api/files/${c.id}/${diskName}`,
    submitToPortal,
    createdAt: now(),
    path: filePath,
  };
  c.evidence.push(ev);
  return ev;
}
