<!-- DSH-IDEMPOTENCY-KEY: deck-plan-ponytail-efficiency-v1-child-S1 -->
<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-PARENT: 00 -->
<!-- DSH-LABELS: wayfinder:research -->
<!-- DSH-ASSIGNEES: lead -->
# 01: 上游基准与效率口径复核：ponytail 到底用什么指标证明自己有效

Type: research

Status: resolved
## Question

上游原仓库（Wenaixi/ponytail 一系，以及更上游的发行版）用什么**具体参数**检验效率？本仓要照抄哪些指标、必须放弃哪些指标？

要回答：
1. 上游基准怎么测：任务集规模、每任务重复次数、模型、宿主、测量窗口（只算输出 token？含重试？）。
2. 四个数字（代码行数、输出 token、成本、时间）各自的**采集方式**：diff 行数、token 计数，还是 API 计费字段？哪几个能在 DSH 插件里真实复现。
3. 上游有无「单仓库/单会话」维度的测量口径（非基准平均）；有的话它怎么处理反事实（counterfactual）问题。
4. 哪些参数本仓不能采：无统一 tokenizer、拿不到未写出的那版代码、拿不到真实账单。
5. 产出「可采 / 可推算 / 不可采」三列对照表，作为 `src/stats/baseline.ts` 的数据来源。

## 已查过的材料

- `docs/research/upstream-ponytail-source-audit.md`：上游 v5.6.2 审计，含基准记分牌与「诚实边界」原话。
- `skills/ponytail-gain/SKILL.md`：基准四元组与出处声明。
- `scripts/measure-prompt.mjs`：本仓已有的诚实基线（字节数精确、token 给 `null`）。

## 约束

- 只读调查；结论写回本票 `## Answer`。需要长表格就落到 `docs/research/` 新笔记并在 Answer 回填路径。
- 结论要能直接决定 `baseline.ts` 放哪几个系数、每个系数的来源链接写什么。

## 进度

## Answer

结论落在新笔记 `docs/research/upstream-efficiency-metrics.md`（一手材料：直接拉上游 `benchmarks/results/2026-10-07-agentic.md`、`benchmarks/agentic/README.md`、`benchmarks/loc.js`、`hooks/ponytail-statusline.sh`）。

### 回答一：上游怎么测

测量单位是「一个 headless Claude Code 会话」而不是一次补全；39 个任务 × 每任务 5 次 × 三臂（无技能 / ponytail v4.13 / ponytail 5）= 585 个会话；Opus 5.5 + default effort + Claude Code CLI 2.1.288，技能用 `--plugin-dir` 装入；每任务取 5 次中位数、臂/基线求比值、对任务取**几何平均**并给 95% bootstrap 区间；Bash 全臂禁用（所以「时间」不含调试）。

### 回答二：四个数字的采集方式与可复现性

| 指标 | 上游采集 | 本仓能否复现 |
|---|---|---|
| 代码行数 −53% [−63,−41] | 后处理 `git diff`，`benchmarks/loc.js` 的 `computeLoc` 去空行/注释/JSDoc，测试文件单独计 | 不能：插件不知道模型写了什么 |
| 代码信息量 gzip −41% | 交付代码的 gzip 体积 | 不能 |
| 输出 token −45% [−54,−35] | Claude Code CLI JSON 的 usage 字段 | 不能：`scripts/measure-prompt.mjs` 已明确拒绝估算（无统一 tokenizer，中文/代码混排误差可达 2 倍），`estimated_tokens` 恒 `null` |
| 成本 −26% [−36,−16] | 同一份 CLI JSON 的 cost（list price） | 不能：拿不到账单 |
| 时间 −41% [−49,−32] | 同一份 CLI JSON 的 duration | 不能：无任务起止 |
| 轮次 −22% | 同一份 CLI JSON | **部分可采**：本仓每次 `agent/pre-step` 就是一步，可数，但不是与基线的比值 |

### 回答三：有无单仓库/单会话口径

没有，且被明令禁止：方法学文件全篇只有三臂对照与逐任务中位数；`skills/ponytail-gain/SKILL.md`「诚实边界」写明永不打印某仓库的省钱数字（反事实不存在）。上游唯一面向运行时的产物是 `hooks/ponytail-statusline.sh`，读 `~/.claude/.ponytail-active` 只打印 `[PONYTAIL:FULL]`，**不显示任何统计**——这反证「运行时收益数字」在上游是刻意不做的。反事实靠实验设计解决（同批任务跑两臂），不能靠推算解决。

### 回答四：本仓不能采的清单

token 与成本（无 tokenizer、无账单）；代码行数与信息量（无任务级 diff 语义）；时间（无起止）；隐藏检查通过率 87/90、注入 bug 捕获率 66%、回复盲评 110:67（需基准任务集 + 执行沙箱 + 盲评模型）；债务条数（`/ponytail-debt` 是按需扫仓，不是运行期计数器）；会话身份级聚合（与「不存会话身份」冲突）。

### 回答五：可采 / 可推算 / 不可采 三列对照表

- **可采**（UI 主数字的唯一来源）：受管轮次（每次 `agent/pre-step`，按档位分桶）、注入次数（`applyModeUpdate` 走非空分支）、注入字节数（`Buffer.byteLength(..., 'utf8')`，与 `measure-prompt.mjs` 同口径）、切档次数（`config/runtime.ts` 的 `subscribe` 仅当 `effective` 真变化）、`/ponytail-*` 调用次数（按命令名分桶）、按档位轮次分布。
- **可推算（只给区间，必须挂来源）**：节省的代码行数 / 输出 token，只能按基准系数外推，且默认折叠在「方法论」里；本项目连自身 token 都拿不到，token 一行建议只显示「未测量」。
- **不可采（不出现数字，只出现「为什么没有」）**：成本、时间、隐藏检查通过率、回复质量、债务条数。

### 给 `src/stats/baseline.ts` 的系数表（只许这七个字段）

| 字段 | 数值 | 区间 | 来源 |
|---|---|---|---|
| `loc` | −0.53 | [−0.63, −0.41] | `2026-10-07-agentic.md` Results 第 1 行 |
| `codeInformationGzip` | −0.41 | [−0.51, −0.30] | Results 第 2 行 |
| `outputTokens` | −0.45 | [−0.54, −0.35] | Results 第 3 行 |
| `cost` | −0.26 | [−0.36, −0.16] | Results 第 4 行 |
| `time` | −0.41 | [−0.49, −0.32] | Results 第 5 行 |
| `turns` | −0.22 | 未给区间 | Results 第 6 行 |
| `cheaperOnTasks` | 30 / 38 | — | Results 第 7 行 |

必带限定语：这是 Claude Code + Opus 5.5 的测量，不能迁移到 DSH 的模型循环与 prompt 组装；引用时必须带「基准平均值，不是本仓库的数字」。

### 三条硬结论（喂给 02 / 05 / 07）

1. UI 主数字必须是可采事实，百分比只作副标题里的区间 + 来源链接且默认折叠；「你省了 X」句式一律不出现。
2. `baseline.ts` 只需一张 7 字段常量表（值 + 区间 + 来源），UI 侧硬编码数字算缺陷。
3. 「时间 −41%」不能单独展示：本仓连自身耗时都没有，单列它等于把基准当实测；最多出现在方法论折叠区的对照表里。

研究结论已落在 docs/research/upstream-efficiency-metrics.md，Answer 段给出 upstream 口径、四数字采集方式、可采/可推算/不可采三列表与 baseline.ts 7 字段系数表
