# AppealHero 申诉英雄 · 罚单手册（Playbooks v2 · 待评审）

> 手册是 AppealHero 的“专业知识层”：每种罚单该问什么、要什么证据、哪些申诉理由站得住、什么时候应该劝用户缴费。
> 官方资料核对日期：2026-11-21。标记：✅ 已对照官方来源 · ⚠️ 待核实 · 🆕 v2 新增。
> 交通规则条款（Traffic Rules and Regulations，2025-03-01 版 PDF）是通过网页摘要工具读取的，条款号在实现前要对照原文再核一次。
> **比赛版本先实现 §4.1 计时器、§4.2 居民许可、§4.4 消防栓（已确认）**；§4.3 街道清扫、§4.5 禁停保留设计，赛后实现。
> 罚款永远以罚单上印的金额为准，其次按具体违规描述查官方罚款表（同一大类的罚款可能不同，例如计时器故障类为 $25），绝不让模型猜。
> 本文不是法律意见。手册只帮用户整理事实和证据，从不承诺结果。

## 0. 三条原则

1. **规则型理由必须有官方来源**（`verified: true`）。例如“周日计时器免费”。没有核实的规则只能作为提示，不能自动生成申诉理由。
2. **事实型理由只陈述事实和证据**。例如“路牌被树枝遮挡，见照片”。这类理由不引用法规，也不下“罚单无效”的结论，由停车办公室判断。
3. **诚实优先**：证据和用户说法矛盾时直接指出；没有站得住的理由就建议缴费，并给出金额和截止日。

## 1. 接口

类型定义放在 `packages/shared/src/playbook.ts`（WP0 负责），实现放在 `apps/server/src/agent/playbooks/boston/<id>.ts`（WP4 负责）。

```ts
export type Lang = 'zh' | 'es' | 'en';
export type L10n = Record<Lang, string>;
export type Verdict = 'yes' | 'no' | 'unknown';

export interface PlaybookCtx {
  ticket: TicketInfo;                        // 罚单（OCR 或门户查询）
  facts: ReadonlyMap<FactKey, Fact>;         // 当前事实，含来源与确认状态
  rules: ReadonlyMap<RuleId, RuleResult>;    // 已运行的规则结果
  evidence: readonly Evidence[];
  vehicles: readonly Vehicle[];              // 账户里的车辆
  answers: Readonly<Record<string, string>>; // questionId → 用户回答
}

export interface Question {
  id: string;
  askIf: (c: PlaybookCtx) => boolean;        // false = 已知或无关，跳过
  expects: 'yesno' | 'choice' | 'photo' | 'text';
  options?: { value: string; label: L10n }[];
  text: L10n;                                // fake 驱动直接用；Gemini 驱动作为参考措辞
  why: L10n;                                 // 告诉用户为什么问
  records: FactKey;                          // 回答写进哪个事实
  evidenceTarget?: EvidenceTarget;           // 拍照题：analyze_evidence 要提取什么
}

export interface Defense {
  id: string;
  reason: DisputeReason;                     // 门户上的争议类型（§5）
  basis: 'rule' | 'evidence' | 'statement';
  verified: boolean;                         // basis=rule 时必须为 true 才能使用
  source?: string;                           // 官方来源 URL + 条款
  holds: (c: PlaybookCtx) => Verdict;
  needs: FactKey[];                          // 起草时必须引用的事实
  explain: L10n;                             // 给用户的解释
  draftHint: string;                         // 给 writer 的英文提示（只陈述事实）
}

export interface PayAdvice { fine: number; late: number; deadline: string; why: L10n }

export interface Playbook {
  id: string;                                // 'boston.meter'
  version: string;                           // 内容一改就升版本，写入审计
  title: L10n;
  match: (violation: string) => boolean;
  fines: { violation: string; fine: number; late: number }[];
  autoRules: RuleId[];                       // 进入 INVESTIGATING 时立即运行
  questions: Question[];                     // 按顺序；理想路径最多 3 个
  defenses: Defense[];                       // 按优先级排列
  recommendPay: (c: PlaybookCtx) => PayAdvice | null;
  notes?: { when: (c: PlaybookCtx) => boolean; text: L10n }[];  // 诚实提示
}
```

规则也统一格式（`apps/server/src/agent/rules/boston/<id>.ts`）：

```ts
export interface RuleDef<I> {
  id: RuleId;
  verified: boolean;
  source: string;        // URL（+ 条款）
  checkedAt: string;     // '2026-11-21'
  run: (input: I) => { result: 'PASS' | 'FAIL' | 'UNKNOWN'; detail: string };
}
```

## 2. 两种驱动怎么用同一份手册

**fake 驱动**（`agent/fake`，没有 key 时使用，测试也用它）：
1. 运行通用检查和 `autoRules`，结果写成 RULE_VERIFIED 事实。
2. 如果已有规则型理由成立（例如周日），跳过提问，直接提议申诉。
3. 否则按顺序找第一个 `askIf` 为 true 的问题，用 `ask_user` 提问，一次只问一个。
4. 问题问完后按优先级检查 `defenses`：第一个结果为 `yes` 的理由 → 提议申诉（进入 FACTS_REVIEW）；都不成立 → `recommendPay`。
5. 用户选择“仍要申诉”时，理由为 OTHER，writer 只使用用户自己的陈述。

**Gemini 驱动**（`agent/runtime`）：
- 手册被转成文字指引放进上下文（要问什么、为什么、每个理由需要哪些事实），由模型决定措辞和顺序。
- 模型调用 `propose_outcome` 时，代码用同一份手册做校验：
  - 理由必须对应手册里的某个 defense，或者是 OTHER。
  - 这个 defense 的 `holds` 不能是 `no`。
  - `needs` 里的事实必须存在。
  - 规则型理由必须 `verified: true`。
- 校验失败时把原因回给模型，案件不推进。

- OTHER（用户自己的理由）只有在用户明确选择“仍要申诉”后，或在通用手册（没有专门手册的罚单类型）下才允许，而且必须引用用户自己的陈述。代码会拒绝模型自行提议的 OTHER。（✅ 已实现）

**所以模型可以帮忙问，但不能编造理由。**

## 3. 通用检查（所有手册先运行）

实现在 `playbooks/boston/common.ts`。

| 检查 | 做法 | 结果 | 依据 |
|---|---|---|---|
| 车辆一致 | 罚单车牌、州（以及车型、颜色，如果有）对比账户车辆 | 不一致 → VEHICLE_INFO 理由（事实型，计算得出） | 计算 ✅ |
| 截止日期 | 开票后 21 天内缴费或申诉；逾期仍可申诉，但加收滞纳金 | 提示，不是理由 | parking-ticket-faqs ✅ |
| 已缴费 | 门户查询显示已缴 | 告诉用户不需要申诉 | 门户数据 |
| 重复缴费 | 用户多缴或缴了两次 | 通过申诉申请退款，附缴费证明（理由 OTHER） | parking-ticket-faqs ✅ |
| 车辆故障等拖车 | 车坏了在等拖车时被开罚单 | 理由 OTHER，附拖车收据等材料 | FAQ 有此条目 ✅；所需材料清单 ⚠️ 实现前复核 |
| 车辆被盗 / 已出售 | 报警记录、过户或退牌凭证 | 理由 OTHER，只陈述事实 | ⚠️ 官方要求待查 |
| 罚单信息笔误 | 例如街道名写错 | 只作为事实陈述，不声称罚单因此无效 | ⚠️ 是否构成理由待查 |

## 4. 首批手册

### 4.1 计时器 `boston.meter`

**匹配**：METER FEE UNPAID、OVER METER LIMIT、METER VIOLATION ("OUT OF ORDER")

**罚款** ✅（fines-and-codes）
| 违规 | 罚款 | 滞纳金 |
|---|---|---|
| Meter Fee Unpaid | $40 | $8 |
| Over Meter Limit | $40 | $8 |
| Meter Violation ("Out of Order") | $25 | $8 |

**自动规则**：`meter_free_day`、`meter_hours_in_effect`、`appeal_deadline`、`fine_amount`

**问题**
1. `paid`（choice）：你当时付停车费了吗？选项：用 ParkBoston app 付了 / 在计时器付了 / 挂着残障停车牌 / 没付 / 计时器坏了。只有当规则型理由不成立时才问。
2. `proof`（photo）：
   - 选了“付了”：上传付款截图或收据（提取 `paid_until`）。
   - 选了“残障停车牌”：上传停车牌挂在后视镜上的照片。

**申诉理由**（按优先级）
| 理由 | 门户类型 | 成立条件 | 依据 |
|---|---|---|---|
| 计时器不在运营时间 | METER_NOT_IN_EFFECT | 周日或市政假日；或周一至周六 8:00–20:00 以外 | 规则 ✅ contact/parking-clerk、parking-ticket-faqs、311 假日表 |
| 已付费 | PAID | 已确认的 `paid_until` 晚于开票时间 | 证据 + 计算 ✅ |
| 残障停车牌 | OTHER | 停车牌已展示（照片或用户确认） | 规则 ✅ FAQ：持牌者可在计时器停车，超时也不用付费或罚款；停车牌需挂在后视镜上 |
| 路牌时段不同 | SIGNAGE | 计时器或路牌上标注的时段不包含开票时间 | 证据 + 计算 |

**诚实提示**
- 免费日只免计时器费用，当天仍要遵守其他路牌（FAQ ✅）。所以如果是其他违规，这条理由不适用。
- **“计时器坏了”不是豁免理由。** 交通规则 Art. IV §4(6) 规定，除非另有标示，不得停在显示 "out of order" 的计时器前。如果是多车位计时器，要到同一街区的下一台付费（§5(4)）。罚款表里也有 "Out of Order" 这一项违规（$25）。
  - 遇到这种情况，Agent 告诉用户这一点，并建议通过 311 报修（Parking Clerk 页面 ✅）。
  - 用户坚持申诉时，申诉信只写用户自己的陈述。

**建议缴费**：没有任何理由成立时，建议缴 $40（逾期加 $8），并给出截止日。

**黄金测试**
| # | 语言 | 情况 | 期望 |
|---|---|---|---|
| G1 | es | María，2026-11-15（周日）14:32 | 0 个问题 → METER_NOT_IN_EFFECT |
| G2 | zh | 周二 10:05 开票；app 截图显示付到 10:30 | 2 个问题 → PAID |
| G3 | en | 周二 10:05 开票；收据只付到 9:50，用户坚称已付 | 指出矛盾 → 建议缴费 |
| G4 | zh | 用户说计时器坏了 | 显示诚实提示，不自动生成理由 → 建议缴费，可以仍要申诉 |
| G5 | en | 2026-11-26（感恩节）开票 | 0 个问题 → METER_NOT_IN_EFFECT |

### 4.2 居民许可 `boston.resident_permit`

**匹配**：RESIDENT PERMIT ONLY、NO VALID RESIDENT PARKING PERMIT/STICKER

**罚款** ✅
| 违规 | 罚款 | 滞纳金 |
|---|---|---|
| Resident Permit Only | $60 | $13 |
| No Valid Resident Parking Permit/Sticker | $100 | $33 |

**已核实的规则** ✅
- 在 "Resident Permit Parking Only" 路段停车，要展示有效的居民停车贴，并且停在贴纸所示的区域内。商用车办事时最多可停 3 小时。（Art. IV §1(21)）
- 贴纸要贴在后窗右下角或前排乘客侧车窗，始终可见。（§15(6)）
- 路牌顶部写有街区名，许可必须属于同一街区。路牌没写时段 = 全天有效；没写日期 = 每天有效。（resident-parking-permits 页面）
- 许可绑定具体车辆和车牌，不能换车使用；申请需要登记在 Boston 当前住址的马萨诸塞州车辆登记，所以外州车牌一般不能办理（有个别特殊项目例外）。（how-get-resident-parking-permit 页面）
- 居民亲友的车同样受限制。（resident-parking-permits 页面）
- 租车许可最长 30 天；办公时间结束后开出的租车罚单，可以凭居住证明和租车合同申诉。（how-get 页面，适用条件 ⚠️ 实现前复核）

**自动规则**：`appeal_deadline`、`fine_amount`；拿到路牌文字后运行 `time_within_posted_hours`；拿到许可信息后运行 `permit_area_match` 🆕

**问题**
1. `permit`（choice）：你有这个街区的居民停车许可吗？选项：有，贴在车上 / 有，但当时开的是租来的车 / 没有。
2. 根据回答三选一：
   - 有许可：拍一张贴纸照片（提取街区、车牌、是否可见）。
   - 租车：上传租车合同和居住证明。
   - 没有：从停车位置拍一张路牌（提取街区、时段、是否清晰）。
3. `photoContext`（text）：只在提交了路牌照片时问：照片是什么时候拍的？是在你停车的那个位置、朝向你的车位的那块路牌吗？
   - 照片只能证明**拍照那一刻**的状况。拍照时间离开票时间越近、位置越对得上，证明力越强；对不上时要标为“不确定”，申诉信里写明拍摄时间和位置，不夸大。

**申诉理由**
| 理由 | 门户类型 | 成立条件 | 依据 |
|---|---|---|---|
| 已展示有效许可 | PERMIT_DISPLAYED 🆕 | 许可街区与路牌一致，车牌一致，贴纸可见 | 规则 ✅ Art. IV §1(21)、§15(6) |
| 租车 + 下班后开票 | OTHER | 租车合同和居住证明都有，开票时间在办公时间以外 | 规则 ✅（适用条件 ⚠️） |
| 不在路牌时段内 | SIGNAGE | 开票时间不在路牌时段内 | 证据 + 计算 |
| 路牌缺失或看不清 | SIGNAGE | 照片显示路牌被遮挡或不存在，用户已确认，且拍摄时间和位置与开票情况对得上（对不上时标为不确定） | 事实型，只陈述事实，写明拍摄时间和位置 |

**建议缴费**：没有许可、路牌清晰、开票时间在时段内 → 建议缴 $60（逾期加 $13）。

**黄金测试**
| # | 语言 | 情况 | 期望 |
|---|---|---|---|
| G1 | zh | 林同学，NY `KDT4821`，没有许可，路牌照片显示被树枝遮挡 | 2 个问题 → SIGNAGE（事实型） |
| G2 | en | 有 Back Bay 许可，路牌是 Back Bay，贴纸清晰 | 2 个问题 → PERMIT_DISPLAYED |
| G3 | es | 有 Fenway 许可但停在 Back Bay | 区域不符，不成立 → 建议缴费 |
| G4 | zh | 没有许可，用户说“没看到路牌”，照片里路牌清晰 | 指出矛盾 → 建议缴费 |

### 4.3 街道清扫 `boston.street_cleaning`

**匹配**：STREET CLEANING、OVERNIGHT STREET CLEANING、SWEEP

**罚款** ✅
| 违规 | 罚款 | 滞纳金 |
|---|---|---|
| Street Cleaning | $40 | $13 |
| Overnight Street Cleaning (no tow) | $90 | $30 |
| Street Cleaning (Charlestown) | $90 | $30 |

被拖车另行收费：目前拖车 $132，存放每 24 小时 $35（street-cleaning 页面 ✅）。拖车费不在本手册的申诉范围内。

**已核实的规则** ✅（street-cleaning-boston、street-sweeping-city 页面）
- 白天清扫：大部分街区 4 月 1 日–11 月 30 日；North End、South End、Beacon Hill 为 3 月 1 日–12 月 31 日。
- 夜间清扫：主干道全年进行；路牌上没写月份 = 全年限制。
- 官网信息与现场路牌不一致时，以现场路牌为准。
- 部分市政假日白天不扫，但夜间照常扫。假日当天是否照常执法 ⚠️ 官方页面没有写明。
- 小雨不一定取消清扫，取消信息以 311 为准。

**所以判断依据是现场路牌，不是“全市季节”。** 季节只用来提醒用户检查路牌。

**自动规则**：`appeal_deadline`、`fine_amount`；拿到路牌文字后运行 `posted_schedule_applies` 🆕（第几个星期几、时段、月份）

**问题**
1. `sign`（photo）：拍一张离车最近的清扫告示牌（提取周次、星期、时段、月份、是否清晰）。
2. `sign2`（photo / yesno）：只在路牌看不清或不存在时问：附近还有别的清扫告示牌吗？
3. `cancel`（photo）：只在用户说当天取消了清扫时问：请上传取消通知（No-Tow 邮件或 311 截图）。

**申诉理由**
| 理由 | 门户类型 | 成立条件 | 依据 |
|---|---|---|---|
| 不在路牌时间内 | SIGNAGE | 开票日期或时间不符合路牌上的周次、时段或月份 | 证据 + 计算 ✅（以路牌为准） |
| 路牌缺失或看不清 | SIGNAGE | 照片显示没有路牌或路牌不可读，用户已确认 | 事实型 |
| 当天已通知取消 | OTHER | 有取消通知截图 | 事实型；旧版官网写明因天气取消时会通知 NO-TOW 订阅者 ⚠️ 需在现行页面复核 |
| 假日 | OTHER | — | ⚠️ 未核实，只作提示，不生成理由 |

**建议缴费**：路牌清晰、开票时间符合路牌 → 建议缴 $40（逾期加 $13）。

**黄金测试**
| # | 语言 | 情况 | 期望 |
|---|---|---|---|
| G1 | zh | 路牌 "1st & 3rd Tue 8AM–12PM, APR–NOV"，在第 2 个周二开票 | SIGNAGE |
| G2 | en | 同一路牌，在第 1 个周二 9:10 开票 | 建议缴费 |
| G3 | es | 路牌没写月份，12 月开票，用户以为冬天不扫 | 纠正误解（全年限制）→ 建议缴费 |
| G4 | zh | 路牌照片看不清 | 请重拍或拍附近另一块路牌 |

### 4.4 消防栓 `boston.hydrant`

**匹配**：HYDRANT

**罚款** ✅：Hydrant $100，滞纳金 $33。

**已核实的规则** ✅：禁止停在消防栓 10 英尺（约 3 米）以内，从离消防栓最近的路沿量起（Art. IV §1(6)）。311 的官方回复也写明 10 英尺，与旁边是否停有其他车无关。

**自动规则**：`vehicle_matches_account` 🆕、`appeal_deadline`、`fine_amount`

**问题**
1. `distance`（choice）：只在车辆信息一致时问：你的车离消防栓大约多远？选项：超过 10 英尺（约 3 米）/ 不到 10 英尺 / 不确定。
2. `photo`（photo）：只在选了“超过 10 英尺”时问：上传一张同时拍到消防栓和车的照片。照片估算距离不可靠，只作参考，最终以用户确认为准。

**申诉理由**
| 理由 | 门户类型 | 成立条件 | 依据 |
|---|---|---|---|
| 车辆信息不符 | VEHICLE_INFO | 通用检查发现不一致 | 计算 ✅ |
| 距离超过 10 英尺 | OTHER | 用户确认超过 10 英尺，并有照片 | 10 英尺规则 ✅；距离本身是用户陈述 |
| 消防栓被雪或植物遮挡 | OTHER | 用户陈述 + 照片 | 事实型；是否构成理由 ⚠️ |

**建议缴费**：车辆一致，且距离不到 10 英尺或没有证据 → 建议缴 $100（逾期加 $33）。这是 Sam 的演示路径。

**黄金测试**
| # | 语言 | 情况 | 期望 |
|---|---|---|---|
| G1 | en | Sam，`5NB302` 与账户一致，选“不到 10 英尺” | 建议缴费 → 接受 → CLOSED_NO_APPEAL |
| G2 | zh | 罚单车牌 `5NB320`，账户车牌 `5NB302` | 0 个问题 → VEHICLE_INFO |
| G3 | es | 选“超过 10 英尺”并上传照片 | OTHER（附距离证据）→ FACTS_REVIEW，不承诺结果 |

### 4.5 禁停 `boston.no_stopping`

**匹配**：NO STOPPING OR STANDING、NO PARKING、TOW ZONE

**罚款** ✅
| 违规 | 罚款 | 滞纳金 |
|---|---|---|
| No Stopping or Standing | $90 | $25 |
| No Parking (Zone A) | $90 | $18 |
| No Parking (Zone B) | $55 | $8 |

**已核实的规则** ✅（交通规则 Art. IX、Art. IV §20(5)）
- 施工或活动用的临时禁停牌，要在限制生效前设置：商业区至少 24 小时，住宅区至少 48 小时。（Art. IX(4)）
- 临时牌要写明生效日期和预计结束日期；如果不是全天限制，还要写明时段。（Art. IX(1)(3)）
- 每个街区至少一块临时牌。（Art. IX(2)）
- 临时牌优先于该街区其他路牌和计时器。（Art. IV §20(5)）

**自动规则**：`appeal_deadline`、`fine_amount`；拿到路牌文字后运行 `time_within_posted_hours`；临时牌情况运行 `temp_sign_notice` 🆕（停车时间 vs 设牌时间 vs 生效时间）

**问题**
1. `signType`（choice + photo）：罚单位置是永久禁停牌还是临时牌（施工、活动、搬家）？请拍一张。
2. 根据回答二选一：
   - 临时牌：你什么时候停的车？那时临时牌已经在了吗？有没有带时间的照片？
   - 永久牌：从照片提取时段（看不清时请重拍）。

**申诉理由**
| 理由 | 门户类型 | 成立条件 | 依据 |
|---|---|---|---|
| 临时牌设置太晚 | SIGNAGE | 车停好之后才设牌，且设牌到生效不足 48 小时（住宅区）或 24 小时（商业区） | 规则 ✅ Art. IX(4)；停车和设牌时间来自用户陈述和证据 |
| 临时牌缺少必要信息 | SIGNAGE | 照片显示没有日期或时段 | 规则 ✅ Art. IX(1)(3) |
| 不在路牌时段内 | SIGNAGE | 开票时间不在时段内 | 证据 + 计算 |
| 路牌缺失或看不清 | SIGNAGE | 照片 + 用户确认 | 事实型 |

**建议缴费**：路牌清晰、在时段内、临时牌设置合规 → 建议缴 $90（逾期加 $25）。

**黄金测试**
| # | 语言 | 情况 | 期望 |
|---|---|---|---|
| G1 | zh | 住宅区，周五 18:00 停车；周六 7:00 生效的临时牌周五 20:00 才出现（有带时间的照片） | SIGNAGE（设牌太晚） |
| G2 | en | 永久牌 "No Stopping 7–9 AM"，8:15 开票 | 建议缴费 |
| G3 | es | 同一永久牌，9:30 开票 | SIGNAGE（时段外） |

### 4.6 通用 `boston.generic`

- 匹配不到任何手册时使用。
- 只运行通用检查，然后请用户用自己的话说明情况并上传证据。
- 能成立的理由只有通用检查里的几种。其他情况理由为 OTHER，申诉信只写用户陈述。
- Agent 要明确告诉用户：“这类罚单我们还没有专门手册，我只会用你的陈述来写，不会替你编理由。”
- 不主动建议缴费，但显示罚款表里查到的金额和截止日，由用户决定。

## 5. 申诉理由与门户选项

| 理由 | 模拟门户选项文字 | 状态 |
|---|---|---|
| METER_NOT_IN_EFFECT | Meter rules were not in effect (Sunday, holiday, or outside meter hours) | ✅ |
| PAID | I paid for parking (meter or ParkBoston app) | ✅ |
| SIGNAGE | Signs were missing, unclear, or did not apply | ✅ |
| VEHICLE_INFO | The ticket has wrong vehicle or plate information | ✅ |
| PERMIT_DISPLAYED | I had a valid resident permit displayed | 🆕 需要改 `packages/shared/src/portal.ts`（WP0）和模拟门户下拉框（WP7） |
| OTHER | Other | ✅ |

真实门户的选项未核实；模拟门户的选项是我们自己定义的。

## 6. 黄金对话测试

位置：`apps/server/test/golden/<playbook>.test.ts`，在 fake 模式下运行，计入 `npm test`。

```ts
golden({
  name: 'meter · María · Sunday → zero questions',
  persona: 'maria', ticket: 'meter', lang: 'es',
  script: [],                               // 用户按顺序给出的回答；拍照题写合成图文件名
  expect: {
    state: 'FACTS_REVIEW', reason: 'METER_NOT_IN_EFFECT',
    maxQuestions: 0, rulesRun: ['meter_free_day'],
    factsCited: ['issuedAt'],
  },
});
```

- 每份手册至少 3 条：理想申诉、建议缴费、证据矛盾。至少一条用中文或西语。
- 拍照题使用 `scripts/make_ticket.py` 生成的合成图。真实值写在 PNG 文本块里，fake 感知直接读取（WP3）。
- 设置 `GOLDEN_LIVE=1` 时，用真 Gemini 跑同样的脚本（手动运行，不进 CI）。只比较最终状态和理由，不比较措辞。

## 7. 新增一份手册的步骤

1. 新建 `apps/server/src/agent/playbooks/boston/<id>.ts`，导出 `definePlaybook({...})`。
2. 在 `playbooks/boston/index.ts` 注册。
3. 需要的新规则放进 `agent/rules/boston/<rule>.ts`，写上 `source`、`verified`、`checkedAt`。
4. 在 `packages/shared/src/demo.ts`、模拟门户数据和 `scripts/make_ticket.py` 里各加一张合成罚单（票号 9 开头）。
5. 写至少 3 条黄金测试。
6. 在本文 §8 补充来源，在 §9 补充待核实事项。

## 8. 来源（2026-11-21 核对）

| 内容 | 来源 |
|---|---|
| 计时器运营时间 | https://www.boston.gov/contact/parking-clerk |
| 周日与市政假日免费；21 天期限与滞纳金；残障停车牌；重复缴费退款；车辆故障 | https://www.boston.gov/departments/parking-clerk/parking-ticket-faqs |
| 市政假日表 | https://www.boston.gov/departments/311/city-boston-holidays |
| 罚款与滞纳金 | https://www.boston.gov/departments/parking-clerk/parking-ticket-fines-and-codes |
| 申诉所需信息、在线申诉即时邮件回执、被驳回后 10 天内缴费或申请听证 | https://www.boston.gov/departments/parking-clerk/how-appeal-parking-ticket |
| 只有 MA 车牌可在线按车牌查询 | https://www.boston.gov/departments/parking-clerk/how-pay-parking-ticket |
| 居民许可规则 | https://www.boston.gov/departments/parking-clerk/resident-parking-permits · https://www.boston.gov/departments/parking-clerk/how-get-resident-parking-permit |
| 街道清扫季节、以路牌为准、假日、拖车费 | https://www.boston.gov/departments/public-works/street-cleaning-boston · https://www.boston.gov/departments/public-works/street-sweeping-city |
| 交通规则：消防栓 Art. IV §1(6)；居民许可 §1(21)、§15(6)；故障计时器 §4(6)、§5(4)；临时禁停牌 Art. IX；临时牌优先 §20(5) | https://www.boston.gov/sites/default/files/file/2025/01/City%20of%20Boston%20Traffic%20Rules%20and%20Regulations%203.1.2025.pdf |
| 报修故障计时器走 311 | https://www.boston.gov/departments/parking-clerk |

## 9. 仍待核实

- 街道清扫：市政假日当天是否照常执法；现行页面是否仍写明天气原因取消时会通知。
- 访客停车许可细则（交通规则 Section 12C 尚未读到）。
- 车辆被盗、已出售、车辆故障三种情况分别需要哪些材料。
- 罚单信息写错是否足以构成申诉理由。
- 消防栓被雪或植物遮挡是否构成申诉理由。
- 真实门户的争议类型选项（比赛中不接入真实门户）。
- 交通规则各条款号：要对照 PDF 原文再核一次（本次通过摘要工具读取）。
