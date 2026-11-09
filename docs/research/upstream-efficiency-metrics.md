# 上游效率口径复核：ponytail 用什么指标证明自己有效，本仓能照抄哪几条

> 对应票：`01 上游基准与效率口径复核：ponytail 到底用什么指标证明自己有效`（`.scratch/ponytail-efficiency/issues/01-*.md`）。
> 用途：给 `src/stats/baseline.ts` 定系数与来源链接，并明确哪些指标**不许**进 UI。
> 方法：直接拉上游仓库原文（不是转述）——`benchmarks/results/2026-10-07-agentic.md`、`benchmarks/agentic/README.md`、`benchmarks/loc.js`、`hooks/ponytail-statusline.sh`；本仓侧对照 `scripts/measure-prompt.mjs`、`src/prompt/prestep.ts`、`src/prompt/index.ts`。
> 拉取日期：2026-11-08。上游仓库 `github.com/DietrichGebert/ponytail`。

## 一、上游怎么测（可直接引用的五个事实）

1. **测量单位是「一个 headless Claude Code 会话」**，不是一次补全。`benchmarks/agentic/README.md`：「every cell is a **real headless Claude Code session** editing a **seeded codebase**, scored on the files it leaves behind」。
2. **规模与重复**：39 个任务 × 每任务 5 次 × 基线/ponytail/ponytail2 三臂 = 585 个会话（`2026-10-07-agentic.md` Setup → Runs）。
3. **模型与宿主钉死**：Opus 5.5、default effort、Claude Code CLI 2.1.288；技能用 `--plugin-dir` 加载，与真实用户装法一致；基线臂不加载任何东西。
4. **统计口径**：每个任务取 5 次运行的**中位数**，臂/基线求比值，再对任务求**几何平均**，给 95% bootstrap 区间；「X 个任务里更好」用符号检验。`-53%` 这类数字是几何平均，不是总和。
5. **隔离**：每个会话在 git 仓库外的临时目录、`CLAUDE.md` 与 auto memory 关闭、只装被测插件；Bash 全臂禁用（这条决定了「时间」测的是写代码的时间，不是调试时间）。

## 二、四个数字各自的采集方式

| 指标 | 上游怎么采 | 能否在 DSH 插件里复现 |
|---|---|---|
| 代码行数 | **后处理 git diff**：`benchmarks/loc.js` 的 `computeLoc` 去掉空行、`//`、`#`、块注释与 JSDoc 行；测试文件单独计、不算进 LOC | 不能自动。插件拿不到「本仓这次任务的 diff 语义」，还要判断测试文件排除规则 |
| 代码信息量（gzip） | 交付代码的 gzip 体积（`-41%`） | 不能自动。同上缺 diff 语义 |
| 输出 token | Claude Code CLI JSON 里的 usage 字段（telemetry），不是本地估算 | 不能。本仓 `scripts/measure-prompt.mjs` 已明确拒绝估算 token：「宿主没有对外暴露统一的 tokenizer……拿『4 字节≈1 token』糊弄，中文与代码混排误差可以到 2 倍」，`estimated_tokens` 恒为 `null` |
| 成本 | 同一份 CLI JSON 的 cost 字段（按 list price 折算） | 不能。插件拿不到 provider 账单；上游自己也标注「list price」 |
| 时间 | 同一份 CLI JSON 的 duration | 不能。插件不掌握单任务起止 |
| 轮次（turns） | 同一份 CLI JSON（`-22%`） | **部分可采**：本仓每次 `agent/pre-step` 就是一步，可数轮次——但那是「本仓自己的轮次数」，不是与无技能基线的比值 |

一句话：**上游四个主打数字全部来自「受控基准里两臂对照 + CLI telemetry」，本仓一个都复现不了；本仓能采的只有过程事实（轮次、注入、字节、切档、调用）。**

## 三、上游有没有单仓库/单会话口径

没有，而且上游**明令禁止**编一个。

- `2026-10-07-agentic.md` 全篇只有三臂对照的几何平均与逐任务中位数，没有「某仓库省了多少」的段落。
- 本仓 `skills/ponytail-gain/SKILL.md` 的「诚实边界」复述了这条约束：「**永远不要**打印某个仓库的省钱数字……没被写出来的那版从未存在，现场仓库里没有可相减的真实基线」。
- 上游唯一面向运行时的东西是 `hooks/ponytail-statusline.sh`：读 `~/.claude/.ponytail-active` 打印 `[PONYTAIL:FULL]`，**只显示当前档位，不显示任何统计**。这反证了「运行时收益数字」在上游是被刻意不做的。

### 反事实（counterfactual）怎么处理

上游的处理方式是**实验设计**而非推算：同一批任务跑两臂，基线是「同一个 agent 不带技能」，因此差值就是技能效应。它没有、也无法为「某一个具体会话」回答「如果没有 ponytail 会怎样」——那个平行宇宙不存在。本仓若要给百分比，只能承认它是**从基准平均值外推**，不是测量。

## 四、本仓不能采的清单

- token 与成本：无统一 tokenizer、无账单（依据：`scripts/measure-prompt.mjs` 文件头注释）。
- 代码行数/信息量：无任务级 diff 语义（`loc.js` 需要 git diff 与「测试文件排除」判定，本仓只知道自己注入了什么，不知道模型写了什么）。
- 时间：无任务起止。
- 「隐藏检查通过率」「注入 bug 捕获率」「回复盲评胜负」：这三项上游分别是 87/90、66%、110:67，都需要基准任务集 + 执行沙箱 + 盲评模型，插件运行期完全不可得。
- 债务条数：上游也没采；本仓 `/ponytail-debt` 是「扫仓数注释」，属于按需扫描，不是运行期计数器（见 05 期讨论）。
- 会话身份级别的聚合：与「不存会话身份」的已定判断冲突，不做。

## 五、可采 / 可推算 / 不可采 三列对照表（`baseline.ts` 的数据来源）

| 指标 | 分类 | 本仓怎么得到 | 进 UI 的方式 |
|---|---|---|---|
| 受管轮次（每个 `agent/pre-step`） | **可采** | `src/prompt/prestep.ts` 监听器每次进入即 +1，按当前档位分桶 | 直接显示整数，不折算 |
| 注入次数（真正追加 reminder 的步） | **可采** | 同上，`applyModeUpdate(decision, message)` 走非空分支时 +1 | 整数 + 注入率 = 注入次数 / 受管轮次 |
| 注入字节数 | **可采** | `Buffer.byteLength(rendered, 'utf8')`（与 `measure-prompt.mjs` 同一口径），按 UTF-8 精确 | 整数（B/KB），标「UTF-8 字节，非 token」 |
| 切档次数 | **可采** | `config/runtime.ts` 的 `subscribe` 回调，仅当 `effective` 真变化时 +1 | 整数 |
| `/ponytail-*` 调用次数 | **可采** | 命令处理函数入口，按命令名分桶 | 整数 + 分命令明细 |
| 按档位轮次分布 | **可采** | 受管轮次的 mode 分桶（off/lite/full/ultra） | 环形或条形图的唯一真实数据源 |
| 「节省的代码行数」 | **可推算（区间）** | 不可测，只能按基准系数外推：`LOC 基准 −53%`，区间 [−63, −41]（见下节） | 只能写成「按基准推算 ≈X 行」并挂来源，且**默认不展示**，折叠在「方法论」里 |
| 「节省的输出 token」 | **可推算（区间）** | 同上，基准为 −45% [−54, −35]；但本仓连自身 token 都拿不到，只能按字节数换算区间，误差大 | 同上一行；建议只显示「未测量」 |
| 「节省的成本 / 时间」 | **不可采** | 无账单、无 duration | 不出现数字，只出现「为什么没有」的一句说明 |
| 隐藏检查通过率、回复质量、债务条数 | **不可采** | 需要基准任务集/沙箱/盲评/扫仓 | 不出现 |

## 六、给 `src/stats/baseline.ts` 的系数表（照抄这七个字段，不许发明第八个）

来源一律 `2026-10-07-agentic.md`（Opus 5.5 / Claude Code 2.1.288 / 39 任务 × 5 次，几何平均，括号内为 95% bootstrap 区间）：

| 字段 | 数值 | 区间 | 出处行 |
|---|---|---|---|
| `loc` | −0.53 | [−0.63, −0.41] | Results 第 1 行 |
| `codeInformationGzip` | −0.41 | [−0.51, −0.30] | Results 第 2 行 |
| `outputTokens` | −0.45 | [−0.54, −0.35] | Results 第 3 行 |
| `cost` | −0.26 | [−0.36, −0.16] | Results 第 4 行 |
| `time` | −0.41 | [−0.49, −0.32] | Results 第 5 行 |
| `turns` | −0.22 | （文中未给区间） | Results 第 6 行 |
| `cheaperOnTasks` | 30 / 38 | — | Results 第 7 行 |

必带的限定语（照抄 `ponytail-plugin-landscape.md:37` 的结论）：**这是 Claude Code + Opus 5.5 的测量，不能迁移到 DSH 的模型循环与 prompt 组装**；引用时必须带「基准平均值，不是本仓库的数字」。

## 七、对本次设计的三条硬结论

1. **UI 的主数字必须是可采事实**（轮次、注入率、字节、切档、调用），百分比只能作为**副标题里的区间 + 来源链接**，且默认折叠。凡是「你省了 X」的句式一律不出现（与已定 Q5 一致）。
2. **`baseline.ts` 只需一张 7 字段常量表**，每个字段带 `source` 与 `range`；任何 UI 侧硬编码的数字都算缺陷（可被单测钉住）。
3. **「时间 −41%」不能单独展示**：本仓连自身耗时都没有，展示它等于把基准当成实测。最多出现在方法论折叠区里的一张对照表中。
