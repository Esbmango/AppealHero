# 给 Gemini / GPT 的评审说明（可直接复制）

你是 AppealHero 申诉英雄（BostonHacks 2026，Track 3 Boundless Boston）的产品与架构评审。附件是完整文档包：PRODUCT_SPEC、ARCHITECTURE、PLAYBOOKS、TASKS、AGENTS、README、DEMO。

**仓库**：https://github.com/Esbmango/AppealHero（公开）
- `main` 分支：v2 地基（WP0）+ 第一轮 GPT / Gemini 评审的修订，可运行（fake 模式 + 模拟门户）。第一轮评审针对的旧版本在 tag `v0.3-reviewed`。
- 只想读一个文件：`docs/REVIEW_BUNDLE.md` 是全部文档的合并版（自动生成，内容以各单独文件为准）。

**背景**
- 3 人团队，用 Codex、Cursor 等多个 AI 编码代理并行开发；提交截止是 2026-11-22 09:00 EST。
- v2 地基和第一轮评审修订已合并（自动化测试 + UI 冒烟测试通过，fake 模式）。文档用 ✅（已实现）/ 🔧（需重构）/ 🆕（新增）区分。
- 演示只连仓库自带的模拟门户，不操作真实政府网站。
- 真实 Gemini 调用（对话、看图、Computer Use）按 SDK 类型定义编写，尚未用真 key 验证。

**请按顺序评审，并严格区分“已验证事实”“需要核实”“建议”：**
1. **需求覆盖**：PRODUCT_SPEC 的 F1–F12 是否完整覆盖了用户描述的流程（拍照或代查 → 针对性追问 → 证据 → 补充 → 确认事实 → 写申诉信 → 确认申诉信 → 自动提交 → 可验证）？有无遗漏或自相矛盾？
2. **架构风险**：状态机 v2、四道闸门、两次确认、提交与对账、崩溃恢复，有没有漏洞或过度设计？
3. **手册内容**：PLAYBOOKS 中的 Boston 规则和申诉理由是否准确？哪些必须查官方来源？请不要凭记忆断言法规，不确定就标“需要核实”。
4. **并行开发**：TASKS 的任务边界会不会让多个 AI 互相冲突？依赖顺序是否合理？验收标准是否可以自动测试？
5. **AI 编码规则**：AGENTS.md 是否足以防止 AI 编码代理破坏安全规则？还缺什么？
6. **演示**：DEMO 的 3 分钟脚本能否打动评委（评分项：Novelty、Impact、Nuance、Relevance、Polish、Presentation、General Impact）？有哪些现场风险？
7. **待拍板的 5 个决定**（PRODUCT_SPEC §8）：给出你的建议和理由。

**输出格式**
- 问题清单，按严重程度排序（阻断 / 重要 / 建议）。每条写：位置（文件 § 小节）→ 问题 → 为什么 → 具体修改建议。
- 最后一段：“如果只能改 3 处，改哪 3 处”。

**约束**
- 不要假设可以操作真实政府网站。
- 不要假设 Gemini Computer Use 已经在我们的账号上验证过。
- 不要重写整套代码；指出问题和修改方向即可。
