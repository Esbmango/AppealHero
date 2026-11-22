# WP0 交付说明（v2 地基）

状态：✅ 已完成，连同评审修订一起合并到 `main`；契约在 commit `5737d46` 冻结。WP1–WP9 从 main 拉分支并行开发。

## 交付内容

**`packages/shared`：契约 v2（合并后冻结，只允许增量修改）**
- 状态机 v2：`TRANSITION_TABLE` 是唯一来源，默认拒绝，每条转移都写明谁能触发。
- 新实体：User、Vehicle、TicketInfo、AuditEvent、DraftParagraph（作者 + revision）。
- 新增枚举：来源 PORTAL_LOOKUP、申诉理由 PERMIT_DISPLAYED。
- 新事件：`facts.review`、`lookup.results`。
- 接口结构：V2_API 全部接口的请求和响应结构。
- `playbook.ts`、`tool.ts`（`defineTool` 拒绝 submit/approve/confirm/pay 类工具名）、`adapter.ts`。
- 演示数据：5 张合成罚单和 3 个演示身份。

**`apps/server`**
- 已按 v2 目录迁移（ARCHITECTURE §10）。
- 两次确认流程：
  - 第一道门：事实确认，未确认就请求 `done` 会返回 422。
  - 写作：DRAFTING。
  - 第二道门：签名批准。
  - 修改申诉信：PUT 接口或聊天消息都会生成新版本，旧批准随即作废。
- 工具注册表：每个工具一个文件，参数用 Zod 定义，只在 IDENTIFYING / INVESTIGATING 阶段开放。
- 账户和审计都有仓储接口和 JSON 实现。每次状态转移都写入审计哈希链。
- 崩溃恢复 v2，和状态转移放在同一个文件里。
- 桩接口（返回 501）：`/api/me` 系列（WP1）；`/proof`、`/trace`、`/status-check`（WP8）。

**`apps/web`**：适配两次确认，是最小改动。新增事实确认卡片，DRAFTING 阶段显示提示，STATEMENT_REVIEW 阶段沿用原来的核对卡。路由和多语言由 WP9 完成。

**测试与工具链**
- 35 个测试通过，覆盖：
  - 状态机
  - 审批门禁
  - 端到端 10 个场景，包括修改申诉信后旧批准失效、聊天修改走 DRAFTING
  - AGENTS.md 中的不变量
  - WP0 元测试
- 53 个验收测试以 `it.todo` 形式写好，名字与 TASKS.md 完全一致。WP0 元测试会检查每个名字都存在。
- UI 冒烟测试已改为两步确认流程，并在手机视口跑通（正常场景和改版场景都通过），桌面控制台也正常。
- `npm run docs:fsm`：ARCHITECTURE §1.1 的完整转移表由代码生成，CI 会检查文档与代码一致。
- Prettier 已对全部代码格式化一次；`npm run format` / `format:check`。
- CI：`.github/workflows/ci.yml`。

## 评审修订（GPT / Gemini，2026-11-21 19:34 确认）

| 问题 | 修改 | 测试 |
|---|---|---|
| 确认事实后，新事实能绕过确认 | 申诉信依据只认 CONFIRMED / RULE_VERIFIED；聊天修改和事实修改都回到事实确认；批准时不允许任何未确认事实 | e2e 2 个 + 单元 1 个 |
| 崩溃时可能重复提交 | 状态转移同步写盘，提交记录在点击前落盘；结果不明只读对账，查不到就暂停由用户决定；门户“已在案”页面被识别为已提交 | e2e 2 个 + 单元 3 个 |
| 并发 | 同一案件的 Agent 回合排队；执行器与对账互斥，忙时返回 409 | 单元 3 个 |
| 罚款按大类 | 以罚单金额为准，其次查具体违规描述 | 单元 3 个 |
| 模型自行提议 OTHER | 只在用户选择“仍要申诉”或通用手册下允许，且必须引用用户陈述 | 单元 3 个 |
| 小修 | 重置后手机回到首页；附件最多 5 个；已结案不能改事实；SSE 重启后回放；`DEMO_KEY` | 单元 2 个 |

## 刻意留给其他任务卡的

| 内容 | 任务卡 |
|---|---|
| 账户、会话、演示身份切换 | WP1 |
| 代查罚单、get_profile / lookup_tickets / select_ticket 工具、手册渲染进上下文 | WP2 |
| 多张照片识别、新的证据提取目标、合成素材 | WP3 |
| 5 份手册与规则文件、通用 fake 驱动、黄金测试 | WP4 |
| 真正的修改器（“写短一点”真的变短）、诚实检查、对照翻译更新 | WP5 |
| mockBoston 适配器、查询、trace、新场景处理 | WP6 |
| `/lookup` 页面、新场景、校准页 | WP7 |
| 凭证页、工具调用和执行步骤写入审计链、verify-audit 脚本 | WP8 |
| 路由、三语界面、完整的事实核对和申诉信编辑界面 | WP9 |

## 怎么验证

```bash
npm install
npm run browsers                       # 或者用本机 Chrome：BROWSER_CHANNEL=chrome
npm run typecheck
npm test                               # 35 个通过，53 个待办
npm run docs:fsm -- --check
npm start                              # 另开一个终端运行：npm run smoke
```
