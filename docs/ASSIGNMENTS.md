# 三人分工（2026-11-21 20:00 → 11-22 09:00）

| 人 | 负责 | 工具 |
|---|---|---|
| **A** | 拿到 Gemini API key 并交给 C；写 Devpost 并提交；彩排时做讲解 | 不写代码（agent 额度有限） |
| **B** | 前端 / 视觉：界面、三语、图片素材、视觉打磨、真机测试、演示视频 | Codex（推理强度调到最高） |
| **C** | 通用：接入 Gemini、服务器、手册、凭证接口、模拟门户 | Codex（推理强度调到最高） |

每个代码任务都附了可以直接粘贴给 Codex 的提示词。Codex 会自动读取仓库根目录的 `AGENTS.md`。

## 0. 开工前

**A**
1. 在 GitHub 仓库的 Settings → Collaborators 邀请 B 和 C。
2. 拿 Gemini API key，21:00 前私下发给 C。不要发到群里，也不要提交到仓库。

**B 和 C**（约 20 分钟）：

```bash
git clone https://github.com/Esbmango/AppealHero.git && cd AppealHero
npm install
npm run browsers          # 下载失败就在 .env 里设 BROWSER_CHANNEL=chrome，改用本机 Chrome
cp .env.example .env      # 只有 C 填 GEMINI_API_KEY；绝不能提交 .env
npm test                  # 应该是 52 个通过、53 个待办（todo）
npm start                 # 浏览器打开 http://localhost:4000 走一遍演示流程
```

每个任务都按这个流程走：
1. 从最新的 main 拉一个新分支，比如 `b1-i18n`、`c1-gemini`。
2. 开一个新的 Codex 会话，粘贴提示词。
3. 本地运行 `npm run format && npm run typecheck && npm test`。改了界面的话，再 `npm start` 并运行 `npm run smoke`。
4. 开 PR，等 CI 变绿，然后合并（squash）。

Codex 的沙箱如果跑不了浏览器测试，就在自己电脑上跑。CI 也会再跑一遍，是最后一道保险。

## 1. 路径归属（避免冲突）

| 谁 | 只改这些路径 |
|---|---|
| B | `apps/web/**`、`scripts/ui-smoke.mjs`、`scripts/make_ticket.py`、`apps/web/public/**`、`docs/DEMO.md` |
| C | `apps/server/**`、`apps/mock-portal/**`、`packages/shared/**`、`scripts/smoke-gemini.mjs`、`.env.example`、`README.md`、`docs/ARCHITECTURE.md`、`docs/PLAYBOOKS.md` |
| A | `docs/DEVPOST.md`（Devpost 草稿，可选） |

- `packages/shared` 是共用契约，只有 C 能改，而且只能增加。B 需要新字段时跟 C 说。
- C 改了接口返回的结构，要马上告诉 B。

## 2. 时间线和检查点

| 时间（EST） | A | B | C |
|---|---|---|---|
| 20:00–21:00 | 拿 API key → 交给 C | 开工前准备 → B1 | 开工前准备 → C2（不需要 key，先做） |
| 21:00–23:30 | 开始写 Devpost 草稿 | B1 三语界面 + 演示身份选择 | C1 接入真实 Gemini 并修复 |
| **22:00 检查点** | 根据 C 的结论决定演示模式 | — | C 报告 Gemini 能不能用、用哪个模型、Computer Use 行不行 |
| 23:30–03:00 | 继续写 Devpost | B2 演示图片 → B3 编辑界面 → B4 凭证页 | C3 三份手册 + 提示词 → C4 凭证接口 + trace |
| **00:00 检查点** | 三人对一下进度 | main 全绿；林同学主线在 fake 模式下中文、西语都能走通 | 同左 |
| 03:00–05:00 | Devpost 定稿（先用占位截图） | B5 视觉打磨 + iPhone 真机测试 | C5“帮我查”（可选，前面全绿才做） |
| **05:00 代码冻结** | — | 之后只修 bug | 之后只修 bug |
| 05:00–07:00 | 换上真实截图和视频 | 录 1 分钟视频、做封面图和截图 | 最后跑全部测试，更新 README 的“已验证” |
| 05:30 和 06:30 | 讲解 | 操作手机 | 盯控制台和后台 |
| 08:30 前 | **提交 Devpost**（官方截止 09:00） | — | — |

## 3. B 和 C 之间的约定：合成图片里的“真实值”

B2 生成的 PNG 在文本块 `appealhero:truth` 里写一段 JSON，C2 的 fake 感知读取它。这样不用 Gemini 也能稳定演示。两人照下面的格式各自实现：

```json
{"kind":"ticket","ticketNumber":"900000006","plateNumber":"KDT4821","plateState":"NY","violationDescription":"METER FEE UNPAID","issuedAt":"2026-11-17T10:05:00-05:00","location":"890 Commonwealth Ave, Boston","fineAmount":40}
{"kind":"receipt","plate":"KDT4821","paidFrom":"2026-11-17T09:30:00-05:00","paidUntil":"2026-11-17T10:30:00-05:00"}
```

---

## A：Gemini API key + Devpost

**API key（21:00 前）**
- 在 Google AI Studio 创建 API key，最好开通付费层。免费层限速更低，而且输入输出可能被用于改进产品。演示只用合成数据，所以免费层也能先用。
- 在 AI Studio 里看看有哪些模型可用，Computer Use 能不能用。代码默认的模型名 `gemini-3.8-flash` **还没验证过**，C 会用 API 再确认一次。
- 设一个预算提醒。
- 把 key 私下发给 C。

**Devpost（08:30 前提交）**
- 草稿可以从 `README.md` 和 `docs/PRODUCT_SPEC.md` 改写，结构为：
  - 解决什么问题
  - 怎么做到的
  - 技术栈
  - 遇到的困难
  - 下一步
- **诚实写明**：
  - 门户是模拟的
  - 和市政府没有合作，不是法律意见
  - 已验证和未验证的内容，以 C 更新后的 README 为准
- 素材找 B 要：1 分钟视频、3–5 张截图、封面图。
- 先在 Devpost 页面确认视频时长要求（1 分钟还是 30 秒）。
- 彩排时 A 负责讲解，台词按 `docs/DEMO.md`。

---

## B：前端 / 视觉

### B1 三语界面 + 演示身份选择（约 2.5 小时）
内容：所有界面文字改成中、西、英三语；首屏选语言和演示身份（林同学、María、Sam）；冒烟测试支持西语。

```text
Task B1 for AppealHero (read AGENTS.md first, then docs/TASKS.md §0.5 and the WP9/WP1 cards).
Owned paths: apps/web/src/**, apps/web/test/**, scripts/ui-smoke.mjs. Do not edit apps/server, apps/mock-portal or packages/shared.

1. Add a tiny i18n layer with NO new dependency: apps/web/src/i18n/index.ts exporting t(key, vars?), useLang() and setLang(),
   plus JSON dictionaries apps/web/src/i18n/locales/{zh,es,en}/{common,onboarding,intake,chat,review,filing}.json.
   Move every user-facing string in apps/web/src (PhoneFlow, ReviewCard, FactsReviewCard, Recorder, ui.tsx state labels and
   provenance badges, intake) into the dictionaries. Chinese is the source text. Write natural, short, plain Spanish and English
   (no legal jargon). The judge console (Console.tsx) stays English-only.
2. Demo Mode onboarding (no accounts): the first screen picks a language and a demo persona from DEMO_PERSONAS in
   @appealhero/shared (lin = zh, maria = es, sam = en), or lets the user type their own name/address/email. Store it in
   localStorage. The persona sets the UI language and fills profileName/profileAddress/profileEmail and lang when creating
   a case (existing POST /api/cases multipart fields). Add a compact language switch in the header.
3. Keep scripts/ui-smoke.mjs working and add `--lang zh|es` (default zh) so the same flow runs in Spanish.
4. Implement from apps/web/test/wp9-web.test.ts: "no hardcoded UI strings outside locale files" (scan .tsx files for CJK
   characters and obvious English UI literals outside the i18n folder and Console.tsx) and "phone-flow tap targets are at least 44px"
   (can be checked inside the smoke test).
Verify: npm run format && npm run typecheck && npm test; then npm start and run `npm run smoke` and `npm run smoke -- --lang es`.
Open a PR that includes screenshots from data/smoke.
```

### B2 演示图片：工作日计时器罚单 + 模拟付款截图（约 45 分钟，C2 合并后再做）
内容：主演示线用的两张合成图，写入第 3 节约定的真实值；对话里加“使用示例截图”按钮，演示时不用真的拍照。

```text
Task B2 for AppealHero (read AGENTS.md and docs/ASSIGNMENTS.md §3 first). Owned paths: scripts/make_ticket.py, apps/web/public/**,
apps/web/src/** (only the intake sample button and the composer button). Prerequisite: C2 is merged (ticket 900000006 exists in packages/shared/src/demo.ts).

1. Extend scripts/make_ticket.py with `meter_weekday` (ticket 900000006, same synthetic style as the others, keep the
   "Synthetic data for AppealHero tests" line, no city seal or branding) and `receipt`: a generic mobile parking-payment
   screenshot that is clearly labeled "SIMULATED RECEIPT" and uses NO real app name, logo or colors (do not imitate ParkBoston).
   It shows plate KDT4821, zone, and "paid 9:30 AM – 10:30 AM, Nov 17, 2026".
2. Write the ground truth from docs/ASSIGNMENTS.md §3 into a PNG tEXt chunk named "appealhero:truth" in both images (PIL PngInfo).
3. Save apps/web/public/sample-ticket-meter-weekday.png and apps/web/public/sample-receipt.png. Make the intake sample button use the
   weekday meter ticket (keep the others reachable), and when the agent asks for a photo (expects === 'photo') show a
   "use sample screenshot" button (translated) in the composer that uploads sample-receipt.png as the photo.
Verify: the script runs; npm run format && npm run typecheck && npm test; npm start, then walk the Lin path:
ticket → "did you pay?" → sample receipt → PAID ground → confirm facts → statement → approve → SUBMITTED. PR with screenshots.
```

### B3 事实逐条修改 + 申诉信段落编辑（约 1.5 小时）

```text
Task B3 for AppealHero (read AGENTS.md, docs/ARCHITECTURE.md §1 and §4.9). Owned paths: apps/web/src/**.
1. FactsReviewCard: inline edit for each pending fact (api.editFact → POST /api/cases/:id/facts/confirm with edits). After an edit the
   server stays in or returns to FACTS_REVIEW; show the updated value and its badge.
2. ReviewCard (STATEMENT_REVIEW): show the English statement as paragraphs. Tapping a paragraph shows the facts it cites
   (draft.paragraphs[].factIds → facts). Add "edit paragraph" (api.editStatement → PUT /api/cases/:id/statement with all paragraphs);
   label user-written paragraphs. After any edit, the approve button must use the NEW preview.payloadHash.
3. Explain in the UI that a chat message during statement review goes back to fact confirmation (one short line).
All strings through the B1 i18n layer. Verify: npm run format && npm run typecheck && npm test; npm start; npm run smoke (zh and es). PR.
```

### B4 凭证页（约 1 小时，C4 合并后再做）

```text
Task B4 for AppealHero (read AGENTS.md, docs/ARCHITECTURE.md §6.2). Owned paths: apps/web/src/**. Prerequisite: C4 merged.
Build a proof screen from GET /api/cases/:id/proof (ProofResponseSchema in packages/shared/src/api.ts): approved payload hash vs
read-back hash with a clear match ✓, confirmation number and email-receipt check, a timeline of executor steps with their screenshots,
the audit chain head (explain in one line: "if this record changes later, the hash will not match"), a "check status again" button
(POST /api/cases/:id/status-check) and a trace download link. Open it from the SUBMITTED card. Trilingual via the i18n layer.
Verify as usual; add the proof screen to the smoke test (open it after SUBMITTED). PR with screenshots.
```

### B5 视觉打磨 + iPhone 真机测试（约 2 小时）

```text
Task B5 for AppealHero (read AGENTS.md and docs/DEMO.md). Owned paths: apps/web/src/**, apps/web/public/**, docs/DEMO.md.
Polish the phone flow for judges without changing behavior: consistent spacing and type scale, a two-step progress indicator
(① confirm facts ② approve statement → filing), clear state colors, a visible "SIMULATED portal" notice on the filing screen,
and a simple original AppealHero 申诉英雄 wordmark (no third-party marks). Keep tap targets ≥ 44px and the smoke test green.
Then test on a real iPhone: set DEMO_KEY in .env, npm start, `cloudflared tunnel --url http://localhost:4000`, open https://…/?key=…,
try camera upload and a voice note (the app converts to 16 kHz WAV). Fix what breaks and note results in docs/DEMO.md.
```

### B 收尾（05:00 以后）
- 录 1 分钟视频，按 `docs/DEMO.md` 的分镜：手机画面加控制台，真实运行，不剪辑造假。
- 把 3–5 张截图和封面图交给 A。
- 彩排时操作手机。

---

## C：通用

### C1 接入真实 Gemini 并修复（约 2 小时；拿到 A 给的 key 后最优先）

```text
Task C1 for AppealHero (read AGENTS.md first; GEMINI_API_KEY is in my local .env — never print or commit it).
Owned paths: apps/server/**, packages/shared/src/tool.ts, scripts/smoke-gemini.mjs, .env.example, README.md.

1. List the models available to this key (ai.models.list in @google/genai) and set the defaults for GEMINI_MODEL and GEMINI_CU_MODEL
   in apps/server/src/core/config.ts and .env.example to models that exist and support function calling / Computer Use.
2. Run the app with AI_MODE=gemini and walk the three demo cases (meter, permit, hydrant) end to end. Fix every real-API problem in
   agent/llm, agent/runtime, agent/perception, agent/writer and agent/tools: JSON Schema keywords Gemini rejects (strip them in
   toolJsonSchema in packages/shared/src/tool.ts), thought-signature handling (history must be appended verbatim), structured output,
   audio input. Keep usage/cost metering working.
3. Run the "redesign" portal scenario with EXEC_TIERS=T1,T3 against real Computer Use. If CU is unavailable or unreliable, make
   EXEC_TIERS=T1,T2 the default and make sure the T2 heuristic fills the redesigned form; e2e tests must stay green in fake mode.
4. Add scripts/smoke-gemini.mjs + `npm run smoke:gemini`: creates one case through the API with the real key and prints the state
   path, questions asked, latency and cost.
5. Update README "Verified so far" with what actually works (model names, CU yes/no). Report results to A and B by 22:00.
Verify: npm run format && npm run typecheck && npm test (fake mode) + npm run smoke:gemini. PR.
```

### C2 演示罚单 + fake 感知读取图片真实值（约 45 分钟；不需要 key，先做）

```text
Task C2 for AppealHero (read AGENTS.md and docs/ASSIGNMENTS.md §3). Owned paths: packages/shared/src/demo.ts, apps/server/**, apps/mock-portal/**.
1. Add DEMO_TICKETS.meterWeekday: 900000006, plate KDT4821, state NY, "METER FEE UNPAID", 2026-11-17T10:05:00-05:00 (a Tuesday),
   "890 Commonwealth Ave, Boston", $40. Set DEMO_PERSONAS.lin.ticket = 'meterWeekday'. The mock portal must seed it.
2. Fake perception: when an uploaded image has a PNG tEXt chunk "appealhero:truth" (format in docs/ASSIGNMENTS.md §3), the fake
   extractor uses it (kind "ticket") instead of keyword guessing, and fake analyze_evidence paid_until uses the receipt's paidUntil
   (kind "receipt"). Keep the keyword fallback. Implement the wp3 acceptance test "fake perception reads ground truth from the PNG
   text chunk" with a PNG built in the test.
3. Add an e2e test: weekday meter ticket + receipt (paid until 10:30) → PAID ground → FACTS_REVIEW → STATEMENT_REVIEW → SUBMITTED;
   and a receipt that ends before 10:05 → PAY recommendation.
Verify: npm run format && npm run typecheck && npm test. PR. Tell B when it is merged (B2 depends on it).
```

### C3 三份手册 + 写进 Gemini 提示词（约 2 小时）

```text
Task C3 for AppealHero (read AGENTS.md, docs/PLAYBOOKS.md §1, §2, §4.1, §4.2, §4.4). Owned paths: apps/server/src/agent/**, apps/server/test/**.
1. Implement boston.meter, boston.resident_permit and boston.hydrant as data with definePlaybook (packages/shared/src/playbook.ts)
   in apps/server/src/agent/playbooks/boston/ (one file each + common.ts), register them, and set case.playbookId when the ticket is identified.
2. agent/context: renderPlaybook(playbook, case, lang) — questions with why, defenses with the facts they need, honesty notes
   (e.g. a broken meter is not an exemption), pay advice — and include it in the Gemini system prompt.
3. propose_outcome validation (agent/tools/propose_outcome.ts): for an APPEAL the reason must map to a defense of the matched playbook
   whose holds() is not 'no' and whose needs exist; rule-based defenses must use verified rules. Keep the existing OTHER rules.
4. Do NOT rewrite the fake driver (agent/fake); it already handles these three types.
5. Implement the wp4 acceptance tests that apply to these three playbooks; golden tests may call the playbook functions directly.
Verify: npm run format && npm run typecheck && npm test (+ npm run smoke:gemini on one case). PR.
```

### C4 凭证接口 + Playwright trace（约 1 小时）

```text
Task C4 for AppealHero (read AGENTS.md, docs/ARCHITECTURE.md §6). Owned paths: apps/server/**, packages/shared/** (additive only).
1. In the runner, store on the case when the read-back gate passes: readbackHash and readbackMatches; persist executor steps and
   screenshot URLs per case (they are currently only SSE events).
2. GET /api/cases/:id/proof returning ProofResponseSchema (packages/shared/src/api.ts) — approved payload + hash, statementUserLang,
   read-back hash/match, steps with screenshots, receipt, audit head + count, trace URL.
3. Record a Playwright trace per job (context.tracing start/stop → data/traces/<caseId>/trace.zip); GET /api/cases/:id/trace downloads it.
4. POST /api/cases/:id/status-check: read-only status lookup through the adapter (must never submit; reuse the exec lock).
5. Append approvals, receipts and executor steps to the audit chain (ctx.audit). Implement the wp8 acceptance tests except verify-audit.
Verify as usual. PR. Tell B when it is merged (B4 depends on it).
```

### C5“帮我查”（可选，约 2 小时，只在 03:00 前一切全绿时做）

```text
Task C5 for AppealHero (read AGENTS.md, docs/TASKS.md §6 /lookup markup contract, WP2/WP6/WP7 cards).
Owned paths: apps/mock-portal/**, apps/server/**, packages/shared/** (additive).
1. Mock portal GET /lookup (read-only, exactly the markup contract), seeds include a plate with two tickets; banner SIMULATED + noindex.
2. adapter lookup in portal/adapters/mockBoston; tools lookup_tickets and select_ticket (stage IDENTIFYING) with Zod params.
3. POST /api/cases with mode=lookup (+ plate/state or ticketNumber) → IDENTIFYING → list tickets (lookup.results event) → the user
   picks one → INVESTIGATING. MA plates can be looked up by plate; other states need a ticket number (say so honestly).
4. Implement the wp6/wp7 lookup acceptance tests. Then tell B the API so B can add a "help me find my ticket" button.
```

### C 收尾（05:00 以后）
- 最后跑一遍 `npm test` 和 `npm run smoke`。
- 合并所有分支，保证 main 是绿的。
- 把 README 的“已验证 / 未验证”更新成真实结果，交给 A 写 Devpost。
- 彩排时盯控制台和后台。

---

## 4. 规则（所有人和 Codex 都要遵守）

- 永远不碰真实政府网站，不绕过验证码；演示只用合成数据。
- 不削弱任何测试。`AI_MODE=fake` 必须一直能跑完全流程，这是演示的保底方案：Gemini 不稳定时就用它，并如实说明。
- 现有的安全门禁不能动：
  - 两次确认
  - 签名批准
  - 读回比对
  - 网络闸门
  - 结果未知不自动重新提交
- 05:00 之后只修 bug，不加功能。
- 出问题先看 CI 日志和 `docs/ARCHITECTURE.md` §12 已知坑；卡住超过 30 分钟就砍掉这个功能，保住主线。
