# WP0 进度：未完成（2026-11-21 19:05 暂停）

这是 WP0（v2 地基）做到一半的快照，位于分支 `wp0-foundation`。设计评审请看 `main` 分支（v0.2 可运行代码 + v2 设计文档）。

## 已完成（共享包 10 个 + 服务器 15 个测试通过）

**`packages/shared`：契约 v2**
- 状态机 v2：`TRANSITION_TABLE` 是唯一来源，默认拒绝；包含 AGENT_TRANSITIONS 和崩溃恢复表 RECOVERY。
- 新实体：User、Vehicle、TicketInfo、AuditEvent、DraftParagraph（作者 + revision）。
- 新增数据：来源 PORTAL_LOOKUP、申诉理由 PERMIT_DISPLAYED、事件 `facts.review` 和 `lookup.results`。
- v2 接口结构：V2_API、CreateCaseFields、ConfirmFacts（增加 `done`）、StatementEdit、Me/Vehicle/Persona、Proof/StatusCheck；另外预留了 3 个新场景名。
- 新文件：`playbook.ts`、`tool.ts`（`defineTool` 拒绝 submit/approve/confirm/pay 类工具）、`adapter.ts`。
- 演示数据：5 张合成罚单和 3 个演示身份（lin / maria / sam）。

**`apps/server`**
- 已按 v2 目录迁移：`core/`、`approval/`、`agent/{runtime,context,fake,tools,rules,perception,writer,policy,llm,playbooks}`、`portal/{adapters/mockBoston,browser,cu,runner}`、`audit/`、`users/`、`routes/`。
- 两次确认流程：
  - INVESTIGATING → FACTS_REVIEW
  - 用户确认全部事实后（`done=true`，否则返回 422）→ DRAFTING → STATEMENT_REVIEW
  - 签名批准 → APPROVED
- 修改申诉信有两种方式：
  - `PUT /api/cases/:id/statement`：修改后的段落作者记为 user，revision 加一，旧批准作废。
  - 在 STATEMENT_REVIEW 阶段发聊天消息：作为修改请求，经 DRAFTING 生成新版本。
- 工具注册表：每个工具一个文件，参数用 Zod 定义，只在对应状态开放，参数不合法时把错误回给模型。
- 账户和审计存储都是 JSON 实现。审计是哈希链，所有状态转移都已写入。
- 桩接口（返回 501）：`/api/me` 系列（WP1）、`/proof`、`/trace`、`/status-check`（WP8）。
- 崩溃恢复 v2 与状态转移放在同一个文件（`core/fsm.ts`）。
- `npm run docs:fsm`：ARCHITECTURE §1.1 的完整转移表由代码生成；加 `--check` 检查文档是否与代码一致。

## 未完成（按顺序）

1. **前端还没适配新状态。**
   - 现状：`npm run typecheck` 在 apps/web 报 5 个错误；手机流程会停在事实确认这一步。
   - 要做：
     - 更新状态名称（`ui.tsx`）
     - 新增事实确认卡片（调用 `confirmFacts(..., done: true)`）
     - DRAFTING 阶段显示“正在撰写”
     - STATEMENT_REVIEW 阶段沿用原来的 ReviewCard
     - `api.confirmFacts` 增加 `done` 参数
2. `scripts/ui-smoke.mjs` 改成两步确认的流程。
3. 测试骨架：
   - `invariants.test.ts`
   - WP1–WP10 的 `it.todo` 验收测试，名字与 TASKS.md 一致
   - wp0 元测试
4. CI（`.github/workflows/ci.yml`）和 Prettier。
5. `git init`、基线提交、打 tag `contracts-v2`。
6. 更新 TASKS.md 里 WP0 的状态。

## 怎么跑测试

```bash
npm install
npm run browsers                         # 或者用本机 Chrome：BROWSER_CHANNEL=chrome
BROWSER_CHANNEL=chrome npx vitest run    # 共享包 + 服务器：25 个测试
npm run docs:fsm -- --check
```
