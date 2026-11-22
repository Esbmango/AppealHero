import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  ADAPTER_VERSION,
  PORTAL_FIELDS,
  PORTAL_ID,
  canonicalize,
  type ApprovalPayload,
  type ApprovalPreview,
  type PortalFieldId,
} from '@appealhero/shared';
import type { CaseRecord } from '../core/types';
import { SUBMITTABLE, factsNeedingConfirmation, latestFact, validateGrounds } from '../agent/policy/facts';
import { sha256Hex } from '../core/util';

/** Which fact backs each portal field (null = comes from the draft). */
export const FIELD_FACT: Record<PortalFieldId, string | null> = {
  ticketNumber: 'ticketNumber',
  plateNumber: 'plateNumber',
  plateState: 'plateState',
  fullName: 'fullName',
  mailingAddress: 'mailingAddress',
  email: 'email',
  disputeReason: null,
  statement: null,
};

/**
 * The approval payload is the *form projection*: exactly what will be typed into the portal.
 * Hashing this (not abstract facts) is what makes DOM read-back verification possible.
 */
export function buildApprovalPayload(c: CaseRecord): ApprovalPayload {
  const fields = {} as Record<PortalFieldId, string>;
  for (const f of PORTAL_FIELDS) {
    const key = FIELD_FACT[f.id];
    fields[f.id] = key ? latestFact(c, key)?.value ?? '' : '';
  }
  fields.disputeReason = c.draft?.disputeReason ?? '';
  fields.statement = c.draft?.statementEn ?? '';
  const extra: Record<string, string> = {};
  for (const fact of c.facts) if (fact.key.startsWith('extra:') && fact.status === 'CONFIRMED') extra[fact.key.slice(6)] = fact.value;
  return {
    v: 1,
    caseId: c.id,
    portal: { id: PORTAL_ID, adapterVersion: ADAPTER_VERSION },
    fields,
    extra,
    evidence: c.evidence
      .filter((e) => e.submitToPortal)
      .map((e) => ({ sha256: e.sha256, filename: e.filename, mime: e.mime, bytes: e.bytes })),
    attestation: true,
  };
}

export const hashPayload = (p: ApprovalPayload) => sha256Hex(canonicalize(p));

export function approvalPreview(c: CaseRecord): ApprovalPreview {
  const payload = buildApprovalPayload(c);
  const fieldSources: ApprovalPreview['fieldSources'] = {};
  const unconfirmed = new Set<string>();
  const missing: string[] = [];
  for (const f of PORTAL_FIELDS) {
    const key = FIELD_FACT[f.id];
    const fact = key ? latestFact(c, key) : undefined;
    fieldSources[f.id] = fact ? { factId: fact.id, provenance: fact.provenance, status: fact.status } : {};
    if (key && !fact?.value) missing.push(f.label);
    else if (fact && !SUBMITTABLE.includes(fact.status)) unconfirmed.add(fact.id);
    if (f.maxLength && payload.fields[f.id].length > f.maxLength) missing.push(`${f.label} is longer than ${f.maxLength} characters`);
  }
  if (!c.draft) missing.push('Statement');
  else {
    missing.push(...validateGrounds(c.draft.paragraphs, c.facts));
    for (const id of factsNeedingConfirmation(c.draft.paragraphs, c.facts)) unconfirmed.add(id);
  }
  return {
    payload,
    payloadHash: hashPayload(payload),
    unconfirmedFactIds: [...unconfirmed],
    missing,
    statementUserLang: c.draft?.statementUserLang ?? '',
    fieldSources,
  };
}

// ---------------------------------------------------------------------------
// Approval token = base64url(claims) + "." + HMAC-SHA256(server secret, claims)
// A bare SHA-256 of the payload is a fingerprint, not a credential: anyone who knows the content can compute it.
// ---------------------------------------------------------------------------
interface Claims {
  cid: string;
  ph: string;
  av: string;
  exp: number;
  jti: string;
}

export function issueToken(secret: string, o: { caseId: string; payloadHash: string; adapterVersion: string; ttlMs: number }) {
  const claims: Claims = { cid: o.caseId, ph: o.payloadHash, av: o.adapterVersion, exp: Date.now() + o.ttlMs, jti: randomUUID() };
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const sig = createHmac('sha256', secret).update(body).digest('base64url');
  return { token: `${body}.${sig}`, expiresAt: new Date(claims.exp).toISOString(), jti: claims.jti };
}

export type TokenCheck = { ok: true; jti: string } | { ok: false; reason: string };

export function verifyToken(secret: string, token: string, expect: { caseId: string; payloadHash: string; adapterVersion: string }): TokenCheck {
  const [body, sig] = token.split('.');
  if (!body || !sig) return { ok: false, reason: 'malformed token' };
  const good = createHmac('sha256', secret).update(body).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== good.length || !timingSafeEqual(given, good)) return { ok: false, reason: 'bad signature' };
  let claims: Claims;
  try {
    claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Claims;
  } catch {
    return { ok: false, reason: 'malformed claims' };
  }
  if (claims.cid !== expect.caseId) return { ok: false, reason: 'token belongs to another case' };
  if (claims.ph !== expect.payloadHash) return { ok: false, reason: 'payload changed since approval' };
  if (claims.av !== expect.adapterVersion) return { ok: false, reason: 'portal adapter changed since approval' };
  if (Date.now() > claims.exp) return { ok: false, reason: 'approval expired' };
  return { ok: true, jti: claims.jti };
}

export const currentAdapterVersion = () => ADAPTER_VERSION;
