/**
 * Portal adapter contract (docs/ARCHITECTURE.md §5.1). One adapter per portal; WP6 turns the v0.2
 * PortalSession into the 'mock-boston' adapter. Generic over the browser page type so this package
 * does not depend on Playwright.
 */
import type { ApprovalPayload, TicketInfo } from './schemas';

export interface UploadFile {
  filename: string;
  mime: string;
  /** absolute path on the server */
  path: string;
  sha256: string;
}

export interface ReviewReadback {
  fields: Record<string, string>;
  extra: Record<string, string>;
  evidence: { filename: string; bytes?: number }[];
}

export interface AdapterHooks {
  step: (name: string, status: 'start' | 'ok' | 'fail' | 'blocked' | 'info', detail?: string) => void;
  screenshot: (label: string) => Promise<void>;
}

export type SubmitOutcome = { kind: 'confirmed'; confirmationNumber: string } | { kind: 'unknown'; detail: string };

export interface PortalAdapter<Page = unknown> {
  /** e.g. 'mock-boston' */
  id: string;
  /** part of the approval fingerprint: changing the adapter invalidates old approvals */
  version: string;
  /** the network guard allows only this origin */
  origin: string;
  /** requests matching this pass the one-shot submit interlock at most once */
  submitPath: RegExp;
  /** read-only (GET) lookup; out-of-state plates need a ticket number */
  lookup(
    page: Page,
    q: { plate?: string; state?: string; ticketNumber?: string },
  ): Promise<{ tickets: TicketInfo[]; message?: 'plate_lookup_ma_only' | 'not_found' }>;
  fillToReview(page: Page, payload: ApprovalPayload, files: UploadFile[], hooks: AdapterHooks): Promise<ReviewReadback>;
  submit(page: Page, timeoutMs: number): Promise<SubmitOutcome>;
  checkStatus(page: Page, ticketNumber: string): Promise<{ found: boolean; confirmationNumber?: string }>;
  checkInbox?(page: Page, email: string, confirmationNumber: string): Promise<boolean>;
}
