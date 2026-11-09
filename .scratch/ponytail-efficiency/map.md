<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-TITLE: Ponytail 效率面板：把「它到底生效了多少」变成可看的数字 -->
<!-- DSH-STATUS: closed -->
<!-- DSH-LABELS: wayfinder:map -->
<!-- DSH-IDEMPOTENCY-KEY: deck-plan-ponytail-efficiency-v1-map -->
<!-- DSH-CREATED: 2026-11-08T09:54:42.022Z -->

# Map：Ponytail 效率面板

## Destination

设置页 `Ponytail` 面板里出现一个「效率」区块：它只展示**可验证的计数事实**（受管轮次、注入次数、注入字节、切档次数、`shortcut:` 债务条数、`/ponytail-*` 调用次数），并把效率提升显示为**明确标注「基准推算」的预估区间**（系数来自上游公开基准，带来源链接）。同一份数据经 `/ponytail-gain` 命令以文字形式输出。计数在**本次宿主运行期内**累计（不落盘，重启清零），用户可清零。

一句话验收：打开设置页能在一屏内看懂「它管了我多少轮 / 真正说出口多少次 / 按基准大概省了多少」，且每个百分比都能追到出处。

## 已定的判断（三轮 grilling，用户全部同意）

| # | 判断 | 结论 |
|---|------|------|
| Q1 | 统计语义 | 只统计可验证事实；百分比标「基准推算」并给出处；不做模型自报 |
| Q2 | 持久化 | ~~落盘 `~/.dsh/ponytail-58fly/stats.json`~~ → 被 Q12′ 取代 |
| Q3 | 视觉 | 纯 SVG 内联图表，只用主题 CSS 变量，零新增依赖，3–8KB |
| Q4 | 落位 | 同一面板内新增「效率」区块（档位 → 诊断链 → 效率）；不做独立页签、不做 composer dock |
| Q5 | 措辞 | 「预估区间 + 基线来源 + 方法论链接」，用「比没用 ponytail 的情况（基准推算）」，永不写「你省了 X」 |
| Q6 | 口径 | 同时记「受管轮次」（每个 pre-step）与「注入次数」（真正注入 reminder 的步），分开显示 |
| Q7 | 维度 | 总数 + 按档位拆分（off/lite/full/ultra 各多少轮）；不按会话拆 |
| Q8 | 架构 | 新开叶子层 `src/stats/`，只依赖 l0；plugin 装配时接到 pre-step 与命令层 |
| Q9 | 系数 | `src/stats/baseline.ts` 纯数据表（系数 + 来源链接），UI 只做乘法与格式化 |
| Q10 | 重置 | 面板内「清零」+ 二次确认 |
| Q11 | 命令 | `/ponytail-gain` 从一次性技能正文升级为斜杠命令，直接打印真实统计 |
| Q12 | 落盘 | ~~内存 +1、30 秒合并写、退出 flush~~ → 被 Q12′ 推翻 |
| Q13 | 规范 | 新增 `docs/design/ponytail-efficiency-ui.md`（token 名、字阶、栅格、图表尺寸、空/错误态文案） |
| Q14 | 空态 | 「尚未产生数据」+ 指向让数据出现的具体动作 |
| Q15 | 统计到客户端（04 结论新增） | 走 `connection.rpc`：服务端 `ctx.connection.rpc.handle('/ponytail-stats', …)`，客户端 `ctx.get('connection').rpc.call('/ponytail-stats','snapshot', …)`；**不承诺实时刷新**，面板挂载拉一次 + 「刷新」按钮 |
| Q16 | 实时性（04 结论新增） | 实时推送不可用：`API_REMOTE_FORWARDED_EVENTS` 是硬编码白名单、`registerRemoteEvents` 每进程只允许一个源，第三方插件无法自建事件通道 |
| Q12′ | 持久化最终口径（02 结论，用户同意） | **不落盘**。`scripts/verify.mjs` 第 11 组「零垃圾承诺」禁止 `src/**` 出现任何写盘 API，`ctx.settings` 承载统计又会被 volatile `strip()` 抹掉；统计只在内存累计，宿主重启清零。代价：Destination 里「跨宿主重启累计」改成「本次运行累计」 |
| Q17 | 计数如何穿过分层（02 结论，用户同意） | **回调注入**：`prestep` 收 `onTurn` / `onInject` 回调，`plugin.ts` 把 `stats` 接上去；四层仍只依赖 l0，分层矩阵零改动 |
| Q18 | 切档次数挂点（02 结论，用户同意） | 挂在**写入成功处**（`runtime.setMode` 返回 `ok` 之后），不挂 `runtime.subscribe`——后者会把别的插件改配置引发的 re-describe 也算进去 |
| Q19 | 视觉方案（05 结论） | 主数字=受管轮次；环形注入率 + 按档位横向条；**不做迷你折线**（要按天分桶就得落盘，与 Q12′ 冲突）；基准只展示 outputTokens/cost/time 三行文字区间，不做区间条；与诊断链同级 `<h3>`，不套卡片 |
| Q20 | 客户端取数通道（**06 实测后修正**） | ~~`connection.rpc.handle` + `ctx.get('connection')`~~ → 宿主把自定义 RPC 通道交给静态 fallback（POST 405 / GET 404），且客户端 `connection` handle **没有 `fetch` 成员**。最终方案：服务端 `ctx.inject(['webServer','connection'])` 里 `connection.fetch.register({ path: '/api/ponytail-stats/snapshot', methods: ['POST'], requestBody: 'buffered', fetch })`；客户端用**页面全局 `fetch`** 打同一路径（同域自带会话 cookie），请求体字面量 `'reset'` 即清零；返回 `{snapshot, assumption}` |
| Q21 | prompt 层与 stats 层的关系（03 落地） | `prompt` 只 `import type { StatsSink }`（编译后擦除），`verify` 第 3 组给 prompt 放行 `stats`；`LAYERS` 加 `'stats'`、`ALLOWED_DEPENDENCIES` 加 `['stats', ['l0']]` |

## Notes（已查过的材料）

- `docs/research/upstream-ponytail-source-audit.md` — 上游基准记分牌与「不打印某仓库省钱数字」的诚实边界。
- `docs/research/upstream-efficiency-metrics.md` — 一手复核：上游 39 任务 × 5 次 × 三臂、几何平均 + bootstrap、四数字全部来自 CLI telemetry（本仓一个都复现不了）；可采/可推算/不可采三列对照表；`baseline.ts` 的 7 字段系数表。
- `docs/research/ponytail-plugin-landscape.md` — 生态里有 usage dashboard 先例（session projection + Fetch 路由），本仓应做降级可选增强。
- `docs/research/dsh-client-ui-surface-0.2.2.md` — `slots.inject` 静默等待、`configForms` 为 unavailable 态时的降级语义；客户端入口唯一契约 `exports["./client"]`。
- `docs/design/ponytail-efficiency-ui.md` — 05 产出的 UI 规范（11 节：层级、图形选型、字阶栅格、基线呈现、三态文案、响应式、清零、给 06 的约束、验收 grep）。
- `scripts/measure-prompt.mjs` — 字节数精确、token 明确 `null`；效率统计应沿用这份诚实基线。
- `skills/ponytail-gain/SKILL.md` — 基准四元组：代码行数 -53%、输出 token -45%、成本 -26%、时间 -41%（39 任务 × 5 次，Claude Code + Opus 5.5）。
- 04 票 `## Answer` — 四条数据路的实测结论与源码行号（`configForms` 刷新语义、`connection.rpc` 契约、事件白名单、构建链与门禁）。
- `.scratch/ponytail-efficiency/prototype-02-stats.ts` — 02 票的可运行原型（`StatsStore` / `BASELINE` / `projectSavings`），03 直接照它落 `src/stats/`。
- `src/stats/{types,store,baseline,index}.ts` — 03 落地的计数层（`installStats(ctx)` 返回 `StatsHandle`）；`test/stats.test.mjs` 9 个用例。

## 迷雾（尚未能说清，靠这些票去清）

- `shortcut:` 债务条数在运行期不可得（需要读磁盘扫仓），是否改成「面板打开时点一次扫描」而不是自动统计？

## Decisions so far

- 统计层独立成 `src/stats/` 叶子模块，不进 `ConfigRuntime` 快照 — 避免配置与观测耦合，且不破分层矩阵。
- 基线系数集中在 `src/stats/baseline.ts` 的数据表里，UI 不出现裸数字 — 系数可被单测钉住，改基准只改一处。
- 面板区块顺序定为 档位 → 诊断链 → 效率 — 用户先看「我在用哪档」再看「这档干了多少」。
- [上游基准与效率口径复核：ponytail 到底用什么指标证明自己有效](issues/01-上游基准与效率口径复核-ponytail-到底用什么指标证明自己有效.md): 上游四数字全来自受控基准 + Claude Code CLI telemetry，本仓一个都复现不了，只能采过程事实；`baseline.ts` 定为 7 字段常量表（loc −53% [−63,−41]、gzip −41%、outputTokens −45%、cost −26%、time −41%、turns −22%、cheaperOnTasks 30/38），百分比只作区间 + 来源，永不写「你省了 X」。结论落在 `docs/research/upstream-efficiency-metrics.md`。
- [宿主侧数据面调查：面板快照能否承载统计、客户端产物如何重编译](issues/04-宿主侧数据面调查-面板快照能否承载统计-客户端产物如何重编译.md): 统计走 `connection.rpc` 一次性拉取 + 面板「刷新」按钮，**不承诺实时刷新**；`configForms` 不能承载（volatile 字段会被任何配置写入抹掉、且只在配置文档变化时刷新）；实时推送不可用（事件白名单全局唯一）；构建链新增文件自动进包、无体积门禁，但新层要登记进 `scripts/verify.mjs` 的 LAYERS，且第 11 组禁写盘与 Q12 冲突（交 02 拍板）。
- [统计层接口原型：StatsStore 的形状与计数点埋在哪里](issues/02-统计层接口原型-statsstore-的形状与计数点埋在哪里.md): 公开面定为 `bump(key, {mode,bytes})` / `snapshot()` / `reset()`（**不要 `flush`**），快照 9 字段直接当 UI 字段名；埋点落 `prestep.ts:68-78`（受管轮次）、`prestep.ts:86`（注入次数+字节）、`ponytail.ts:112`（命令调用与切档成功处，**不挂 `runtime.subscribe`**）；**持久化改判为不落盘**（verify 第 11 组禁写盘、`ctx.settings` 会被 volatile `strip()` 抹掉），改为回调注入穿过分层（矩阵零改动，`LAYERS` 只需加 `'stats'`）；原型 `.scratch/ponytail-efficiency/prototype-02-stats.ts` 已跑通四组断言。
- [效率区块的视觉与信息架构：一屏内的图形化表达](issues/05-效率区块的视觉与信息架构-一屏内的图形化表达.md): 规范落 `docs/design/ponytail-efficiency-ui.md`（11 节）；主数字=受管轮次，副=注入次数/切档/命令调用/注入字节；**环形注入率 + 按档位横向条要做，迷你折线不做**（按天桶需落盘，与 Q12′ 冲突）；基准只印 outputTokens −45% [−54,−35]、cost −26% [−36,−16]、time −41% [−49,−32] 三行文字区间（不做区间条、不印 loc/gzip/turns），同行必带「这是上游基准，不是本机测量」；与诊断链同级 `<h3>` 不套卡片；环形 `viewBox 0 0 64 64` r=28 周长 175.93，横向条用 div；三态文案逐字定稿（空态「还没开始计数」≠ 错误态「统计暂时读不到」）；清零走 Modal 二次确认；06 需同步扩 `client-wiring.test.mjs` 的 STUB_MODULES，`connection` 用结构化断言不加依赖。
- [实施：src/stats 计数层与持久化](issues/03-实施-src-stats-计数层与持久化.md): 计数层已落地并全绿（typecheck / build / test 265 / verify）；公开面是 `installStats(ctx) → {sink, snapshot, reset, bumpCommand, bumpSwitch}`，`sink` 只暴露 `onTurn(mode)` / `onInject(text)` 两个回调穿过分层；`bump` 物理上永不抛（未知档位落 full、坏字节当 0）；切档只记 `setMode` 成功那一次；不落盘（Q12′）；`/ponytail-stats` RPC 通道已在 `plugin.ts` 的 `attachStatsChannel` 接好，payload 传字符串 `'reset'` 即清零，返回 `{snapshot, assumption}`；`verify` 第 3 组加 `stats` 层并给 `prompt` 放行统计**类型**。
- [实施：效率区块 SVG 图表与面板接线](issues/06-实施-效率区块-svg-图表与面板接线.md): 代码与三条本地验收全部落地；「真实宿主截图」这一条被宿主装载机制挡住了，原因是宿主侧而非本票代码，处置见第 6 节。
- [实施：/ponytail-gain 命令与技能文案改指向真实统计](issues/07-实施-ponytail-gain-命令与技能文案改指向真实统计.md): 五项全部落地，本地门禁全绿；唯一没过的是「在桌面宿主交互里敲一次」，那道门槛与 06 共用一次宿主重启（原因见下）。

- [收口验收：文案诚实性、零依赖、分层矩阵与全量测试](issues/08-收口验收-文案诚实性-零依赖-分层矩阵与全量测试.md): 六项全过——文案诚实性逐条可追到 `src/stats/baseline.ts` 的 `source`、零新增依赖（`lib/client.js` 16322 B → 39304 B、gzip 4575 B → 8950 B）、分层矩阵与 271 项测试全绿、`CHANGELOG.md` 增 `[Unreleased]` 且设计文档补 §12 实现台账、`scripts/verify.mjs` 新增第 10b 组「效率面板的诚实卡口」（写死颜色 / 「实时」/「你省了」）并做了负向注入验证与 20/20 selftest。

## Notes

- 当前 frontier（2026-11-09 11:15 复算）：08 已关闭 → **frontier = ∅**，八张子票全部关闭，地图到了终点。
- 完成核对（2026-11-09 11:15）：不信进度数字，逐票核状态与依赖边、逐条对结论落点、现场复跑门禁（verify 通过 / 271 pass / selftest 20/20）→ 结论是「改动已在路线上做完」，不需要 /to-spec 与 /to-tickets，地图直接关闭。详见 `## 探索结论`。
- 06/07 的收尾证据在票内：06 第 6/7 节（真实宿主端点 200 + 面板 innerText + 截图路径 + 一次客户端契约修正）、07 第 6 节（宿主实时快照的 `/ponytail-gain` 原文）。

## 探索结论

**这张地图走完了，而且是「改动已经在路上做完」的那一种：不需要 /to-spec，也不需要拆实施票。**

核对做法（不信数字，逐条复验）：

| 核对项 | 怎么查的 | 结果 |
|--------|----------|------|
| 八张子票真的都结案 | `deck_issue_list(effort=ponytail-efficiency, state=all)`，再逐票 grep `DSH-STATUS` / `Status:` / `Blocked by:` | 9 行：map 本体 open + 01–08 全部 `closed`（`Status: resolved`）；依赖边 03←02、06←04,05,03、07←03、08←03,06,07 全部指向已关票，**没有断链、没有环** |
| 结论不只在票里、也在仓里 | 逐条对 `Decisions so far` 的落点 | 全部落成文件：`docs/research/upstream-efficiency-metrics.md`、`docs/design/ponytail-efficiency-ui.md`、`src/stats/`、`src/client/charts.tsx`、`src/commands/gain.ts`、`.scratch/ponytail-efficiency/prototype-02-stats.ts` |
| 诚实卡口没有腐坏 | 读 `scripts/verify.mjs` 第 10b 组（`UI_SURFACE` / `HEX_COLOR` / `HONESTY_PHRASES` / `LIVE_CLAIM`），确认自检用例在场 | 在；`node scripts/verify.mjs --selftest` → **20/20**，「效率面板卡口认出写死颜色与『你省了』」✓ |
| 门禁此刻仍然绿 | 现场复跑 | `pnpm verify` → `verify 通过（32 个源文件，117 个产物文件，1 条提醒）`；`pnpm test` → **271 pass / 0 fail** |
| 真实宿主里真的生效过 | 06 第 6/7 节、07 第 6 节的现场记录 | 端点 `POST /api/ponytail-stats/snapshot` 200 且 `managedTurns` 递增（24→36→43→65→67）；面板效率区块截图 `/Users/sunkai/Downloads/ponytail-efficiency-panel-2.png`；`/ponytail-gain` 打出真实快照原文 |

落地的五件事（细节都住在各自的票里，这里只留指针）：

1. 只信一手口径：上游四个百分数全部来自受控基准 + Claude Code CLI telemetry，本仓复现不了 → 只采过程事实，百分比一律「区间 + 来源 + 这是上游基准，不是本机测量」——[上游基准与效率口径复核：ponytail 到底用什么指标证明自己有效](issues/01-上游基准与效率口径复核-ponytail-到底用什么指标证明自己有效.md)。
2. 统计层是独立叶子模块 `src/stats/`，回调注入穿过分层，不落盘、重启清零——[统计层接口原型：StatsStore 的形状与计数点埋在哪里](issues/02-统计层接口原型-statsstore-的形状与计数点埋在哪里.md)、[实施：src/stats 计数层与持久化](issues/03-实施-src-stats-计数层与持久化.md)。
3. 数据从宿主到面板的路：服务端 `connection.fetch.register` + 客户端页面全局 `fetch`（原定的 `connection.rpc` 两次实测都不通，这条修正是本 effort 唯一一次推翻既有决定）——[宿主侧数据面调查：面板快照能否承载统计、客户端产物如何重编译](issues/04-宿主侧数据面调查-面板快照能否承载统计-客户端产物如何重编译.md)、[实施：效率区块 SVG 图表与面板接线](issues/06-实施-效率区块-svg-图表与面板接线.md)。
4. 视觉与措辞定稿：主数字=受管轮次、环形注入率 + 按档位横条、不做迷你折线；三态文案逐字定稿——[效率区块的视觉与信息架构：一屏内的图形化表达](issues/05-效率区块的视觉与信息架构-一屏内的图形化表达.md)、`docs/design/ponytail-efficiency-ui.md`。
5. 文字版出口与纪律红灯：`/ponytail-gain` 打真实数字；「写死颜色 / 实时 / 你省了」三条变成 `pnpm verify` 的红灯——[实施：/ponytail-gain 命令与技能文案改指向真实统计](issues/07-实施-ponytail-gain-命令与技能文案改指向真实统计.md)、[收口验收：文案诚实性、零依赖、分层矩阵与全量测试](issues/08-收口验收-文案诚实性-零依赖-分层矩阵与全量测试.md)。

**明确不做的（不是遗漏）**：跨宿主重启累计（`verify` 第 11 组禁 `src/**` 写盘，Q12′ 定案）、迷你折线（按天分桶要落盘）、独立页签与 composer dock（Q4）、`shortcut:` 债务条数的运行期统计（要扫盘，唯一一条迷雾，没有毕业成票）。

## Not yet specified

## Out of scope

## 收尾记录

### 2026-11-09 11:15 · 完成核对（结论：改动已在路线上做完，不走 /to-spec）

这张地图走完了，属于「不需要接着做」的那一类 —— 不生成规格，也不拆实施票。

核对（不看进度数字，逐条复验）：

- 九行票（map 本体 + 01–08）全部结案：`deck_issue_list(effort=ponytail-efficiency, state=all)` 回 9 行、九行全是 `closed`；逐票 grep `Status:` 也都是 `resolved`。
- 依赖边：03 ← 02；06 ← 04,05,03；07 ← 03；08 ← 03,06,07 —— 全部指向已关票，**没有断链、没有绕圈**。
- 每条决定都有文件落点（`docs/research/upstream-efficiency-metrics.md`、`docs/design/ponytail-efficiency-ui.md`、`src/stats/`、`src/client/charts.tsx`、`src/commands/gain.ts`、`.scratch/ponytail-efficiency/prototype-02-stats.ts`），不是只在票里写着。
- 现场复跑：`pnpm verify` 通过（32 源文件 / 117 产物 / 1 提醒）、`pnpm test` 271 pass 0 fail、`node scripts/verify.mjs --selftest` 20/20（含「效率面板卡口认出写死颜色与『你省了』」）。
- 真实宿主证据：06 第 6/7 节（端点 200、受管轮次 24→36→43→65→67、截图 `/Users/sunkai/Downloads/ponytail-efficiency-panel-2.png`）、07 第 6 节（`/ponytail-gain` 真实输出原文）。

依据：Destination 要求的「一屏内可验证的计数事实 + 标『基准推算』的预估区间」已经落地并被门禁盯住；剩下的都是明确不做的事（跨宿主重启累计因 `verify` 第 11 组禁写盘、迷你折线要按天落盘、独立页签与 composer dock、`shortcut:` 债务条数运行期扫描）。

交接：**/to-spec 与 /to-tickets 都不需要**（没有要接着施工的东西）。

### 2026-11-09 11:15 · 关闭动作（诚实记录：deck 工具没能关这张）

- `deck_issue_patch(close: true)` 对 map 本体**打空**：`items[0].reason = "issue 00 not-found"`、`reason = "backend-unsupported"`。原因是 deck 的本地后端只按 `.scratch/<slug>/issues/` 扫子票，**map 本体不在它扫的路径里**；同一个后端连"读这张票的阻塞边"都回了 `issue 00 not-found`（`deck_issue_get` 的提示原话）。所以 map 的关闭动作在这个后端上没有人接。
- 结论评论也走同一条路，同样 `not-found`；按 `docs/agents/issue-tracker.md` 的约定（评论追加到文件底部），结论与依据改记在**这一段正文**里，作为这张地图的总结评论。
- 于是按「本地 Markdown 后端」的落地形态收尾：`map.md` 顶部标记改为 `DSH-STATUS: closed`，正文这一节即总结评论。子票 01–08 早已由 deck 正常关闭，不受影响。

## 进度

- 01 上游基准与口径复核 — 已关（结论在票内 Answer + `docs/research/upstream-efficiency-metrics.md`）。
- 04 宿主侧数据面调查 — 已关（结论在票内 Answer）。
- 02 统计层接口原型 — 已关（原型 `.scratch/ponytail-efficiency/prototype-02-stats.ts`；Q12′/Q17/Q18 三项按推荐值定案）。
- 05 效率区块视觉与信息架构 — 已关（规范 `docs/design/ponytail-efficiency-ui.md`；Q19 定案）。
- 03 计数层实施 — 已关（`src/stats/` 四个文件 + 埋点 + 统计通道 + 9 个单测；全绿）。
- 06 效率区块实施 — 已关（`src/client/charts.tsx` + 面板效率区块 + 真实宿主截图 `/Users/sunkai/Downloads/ponytail-efficiency-panel-2.png`；`lib/client.js` 39304 B，增量 7.3 KB ≤ 8KB；271 passed）。**取数契约已修正**：客户端 `connection` handle 没有 `fetch` 成员（`dsh-client-connection/lib/client.browser.js:1421-1496`），改为页面全局 `fetch` 打 `POST /api/ponytail-stats/snapshot`，`ctx.inject` 收成 `['configForms']`。
- 07 /ponytail-gain 命令 — 已关（`src/commands/gain.ts` + 技能/README 文案；宿主实时快照输出已贴票内；check:skills / check:readme / verify 全绿）。
- 08 收口验收 — 已关（六项全过；`scripts/verify.mjs` 第 10b 组新增并负向验证；`CHANGELOG.md` [Unreleased] 与设计文档 §12 补齐；体积 16322 B → 39304 B / gzip 4575 B → 8950 B）。
- 地图本体 00 — 已核对并收尾（2026-11-09 11:15）：八票全关、依赖边无断链无环、门禁现场复跑全绿 → 结论「改动已在路线上做完」，不走 /to-spec 与 /to-tickets；关闭动作由 deck 后端拒绝（map 本体不在其扫描路径），按本地 Markdown 约定落 `DSH-STATUS: closed` + 正文「收尾记录」。
