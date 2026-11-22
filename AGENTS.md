# AGENTS.md — rules for AI coding agents (Codex, Cursor, Gemini, …)

AppealHero is a human-in-the-loop agent that helps people appeal Boston parking tickets in their own language and files the appeal on a **simulated** portal with a verifiable record.

Before changing anything: read this file, your task card in `docs/TASKS.md`, and the relevant section of `docs/ARCHITECTURE.md`.

> Paths below follow the v2 layout created by WP0. Until WP0 lands, use the v0.2 → v2 map in `docs/ARCHITECTURE.md` §10.

## Non-negotiable invariants (each one has a test — never weaken the test to make your change pass)

1. **The LLM never gets a tool that submits, approves, or confirms facts.** Tools live in `apps/server/src/agent/tools/`; the registry rejects anything else.
2. **Case state changes only through `transition()`** (`apps/server/src/core/fsm.ts`). Never assign `case.state` directly. The transition table and actor rules live in `packages/shared/src/states.ts`.
3. **Only the user can set a fact to `CONFIRMED`** (via `POST /api/cases/:id/facts/confirm`). Agent-recorded facts are `USER_STATEMENT`; OCR / photo / lookup facts start as `NEEDS_CONFIRMATION`.
4. **Approval = HMAC-signed hash of the exact form payload.** Any change to what will be typed invalidates it. Never skip `verifyToken()` or the read-back gate before submitting.
5. **Keep the network guard** (`apps/server/src/portal/browser/guard.ts`): hard-block real government hosts, allow one portal origin, one-shot submit interlock.
6. **Never send requests to boston.gov, rmcpay.com, or any real government system. Never bypass a CAPTCHA.**
7. **Unknown submit result → reconcile via the portal status page.** Never blind-retry a submit.
8. **Fake mode must keep working.** `AI_MODE=fake` runs the whole flow with no key and no network; all tests run in fake mode.

## Contracts

- `packages/shared` (Zod) is the single source of truth for types, API payloads, events and states. Changes are **additive only** and go through the WP0 owner: write a "Contract change request" at the end of your task card instead of editing shared files yourself.
- The 5 frozen endpoints (jobId === caseId):
  `POST /api/cases` · `POST /api/cases/:id/messages` · `POST /api/cases/:id/approve` · `GET /api/cases/:id/stream` · `POST /api/jobs/:id/resume`

## Where things go

| Area | Path |
|---|---|
| Contracts | `packages/shared/src/` |
| State machine, storage, SSE | `apps/server/src/core/` |
| Agent loop / context / fake driver | `apps/server/src/agent/{runtime,context,fake}/` |
| Ticket-type playbooks | `apps/server/src/agent/playbooks/boston/` (one file per type) |
| Deterministic rules (with sources) | `apps/server/src/agent/rules/boston/` |
| Tools | `apps/server/src/agent/tools/` (one file per tool) |
| Perception / writer / policy | `apps/server/src/agent/{perception,writer,policy}/` |
| Approval | `apps/server/src/approval/` |
| Portal adapters, browser, CU, runner | `apps/server/src/portal/{adapters,browser,cu,runner}/` |
| Audit + proof | `apps/server/src/audit/` |
| Accounts | `apps/server/src/users/` |
| Simulated portal | `apps/mock-portal/` |
| Web app features / i18n | `apps/web/src/features/*`, `apps/web/src/i18n/locales/{zh,es,en}/` |

## Workflow

- Edit only the paths your task card owns.
- Before you finish: `npm run typecheck && npm test` must pass. Add tests for new behavior: golden conversation tests for playbooks, e2e scenarios for portal changes.
- No new dependencies without a one-line justification in the PR.
- All user-facing strings go through i18n. Never hardcode UI text.
- Every rule or legal claim in a playbook needs an official source URL. Unverified rules must be marked `verified: false` and are never used to auto-generate appeal grounds.
- TypeScript strict, Zod at every boundary, small functions, Prettier formatting.

## Gemini specifics

- Use `@google/genai`. Append the model's returned `content` to history verbatim — Gemini 3 requires thought signatures to be sent back during function calling.
- Tool parameters are defined once in Zod; generate the JSON Schema from it and validate model arguments with it.
- Computer Use goes through the Interactions API. Coordinates are normalized 0–999. Our code executes every action after a policy check; never auto-acknowledge `safety_decision: require_confirmation`.
- Record token usage for every model call (cost meter).

## Don'ts

- Don't add React Native / Expo, Next.js, ORMs, Redux, LangChain or multi-agent frameworks.
- Don't describe the simulated portal as a "1:1 replica" — it is field-faithful, not pixel-faithful.
- Don't promise outcomes or call the product a lawyer.
