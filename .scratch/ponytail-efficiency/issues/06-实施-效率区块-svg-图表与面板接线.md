<!-- DSH-IDEMPOTENCY-KEY: deck-plan-ponytail-efficiency-v1-child-S6 -->
<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-PARENT: 00 -->
<!-- DSH-LABELS: wayfinder:task -->
<!-- DSH-BLOCKED-BY: 04, 05, 03 -->
<!-- DSH-ASSIGNEES: lead -->
# 06: 实施：效率区块 SVG 图表与面板接线

Status: resolved
## Comments

### local — 2026-11-09T02:33:55.366Z
收尾（2026-11-09 10:34）：

- 真实宿主验证完成：`POST /api/ponytail-stats/snapshot` → 200，managedTurns 24→36→43→65→67 递增；面板效率区块完整渲染（43 轮受管 / 0 注入 / 0 切档 / 0 B / 0% 注入率 / 档位条 full 43 / 基准三行 / 清零按钮）。
- 截图：`/Users/sunkai/Downloads/ponytail-efficiency-panel-2.png`（1668×873，弹层已关，窄栏不溢出）。
- 补记第 7 节契约修正：客户端 `connection` handle 无 `fetch` 成员（`dsh-client-connection/lib/client.browser.js:1421-1496`），改用页面全局 `fetch`；`ctx.inject` 收成 `['configForms']`；测试桩同步；typecheck ✓ / build 39304 B / test 271 passed / verify 通过。

## 进度

- 进度：100%（2026-11-09T10:33:55+08:00）：真实宿主截图与端点证据已补齐，票内 Answer 第 6/7 节更新，可以关闭
- 进度：100%（2026-11-09T10:30:00+08:00）：三条本地验收 + 真实宿主截图全部拿到，已关闭

Type: task

Blocked by: 04, 05, 03

Status: resolved
## Question

按 05 的视觉规范与 04 的数据通道，实现「效率」区块：

1. `src/client/charts.tsx`（或按 05 定的文件名）：`<Ring>`、`<BarList>` 等纯 SVG 组件，`viewBox` 固定、宽度自适应、颜色全部取自主题变量；无第三方图表库。
2. `src/client/panel.tsx`：在诊断链之后插入效率区块；保持「不写死颜色、不出现 `#hex`」文件头约束；新增「清零」按钮（二次确认）与空态/错误态/降级态。
3. `src/client/index.ts`：按 04 结论把统计快照接到面板 props（`form` 扩展或读通道），并保留 `configForms` unavailable 时的降级。
4. 文案严格取自 05 的文案表：预估一律写「比没用 ponytail 的情况（基准推算）」并带来源链接；禁止出现「你省了 X」。
5. `test/client-wiring.test.mjs` 增补：效率区块的接线断言（快照为空时渲染空态、`configForms` 缺席时不抛）。

## 验收

- `pnpm build && pnpm test` 全绿；`lib/client.js` 增量 ≤ 8KB，仍以 `window.__ModuleLoader__.load({...})` 开头。
- 面板源码内 `grep -nE '#[0-9a-fA-F]{3,8}'` 无命中。
- 在真实宿主里打开设置页截图（票内贴路径）：数据非零时三个图形都正确渲染，窄栏不溢出。

## Answer

代码与三条本地验收全部落地；「真实宿主截图」这一条被宿主装载机制挡住了，原因是宿主侧而非本票代码，处置见第 6 节。

### 1. 新增 `src/client/charts.tsx`（零依赖纯 SVG）

- 常量：`RING_RADIUS = 28`、`RING_STROKE = 8`、`RING_CIRCUMFERENCE = 175.93`。
- `<Ring value total label>`：64×64 `viewBox="0 0 32 32"`，底环 `stroke="var(--dsw-alias-border-l3)"`，进度弧 `stroke="var(--dsw-alias-state-business-primary)"`、`strokeDasharray={ratio * 175.93 + ' 175.93'}`、`transform="rotate(-90 32 32)"`、`strokeLinecap="round"`；`ratio === 0` 时不画进度弧（避免 0 长度圆头出现一个点）；中心 `<text>` 16px / w600 / `tabular-nums`。
- `<BarList rows label>`：div 条，标签列 36px、槽 `flex:1` 高 8px `--dsw-radius-sm`、数值列 28px 右对齐，宽度按 `value / max * 100`。

### 2. `src/client/panel.tsx`

- 新增导出 `StatsStatus = 'loading' | 'ready' | 'error'`、`StatsPanelPort { snapshot: StatsView | null; status: StatsStatus; refresh(): void; reset(): Promise<WriteOutcome> }`；`PonytailPanelProps` 增加 `readonly stats: StatsPanelPort`。
- 文件尾新增 `STATS_TEXT`（05 §7 逐字文案）、`BAR_LABEL`、`group`、`formatBytes`、`clockOf`、`Metric`、`BaselineRows`、`EfficiencySection`。
- `EfficiencySection`：`borderTop: '0.5px solid var(--dsw-alias-border-l3)'` + `paddingTop: 12`（不套卡片）；头部「效率」`<h3>` + 「数据截至 HH:MM」+ [刷新]；错误态「统计暂时读不到（宿主没提供这个通道，或插件刚重启）。」+ [重试]；空态标题 + 正文；图表区 `<Ring>` + `<BarList>`；基准三行 `Tag tone="quiet"` 标「基准推算」+ `<a href={BASELINE.outputTokens.source} target="_blank" rel="noreferrer">` 方法论链接 + `BASELINE_CAVEAT`；清零「清零统计」→ 行内二次确认「清零本机统计？」+ 05 §9 正文 + 取消/清零。
- 面板末尾渲染 `<EfficiencySection port={props.stats} />`。零新增 `#hex`。

### 3. `src/client/index.ts`

- `const STATS_PATH = '/api/ponytail-stats/snapshot'`、`const STATS_RESET = 'reset'`。
- `ctx.inject(['configForms'], …)`（**修正过一次**：原先带 `connection`，见第 7 节）；`type StatsTransport = (request: Request) => Promise<Response>`，`requestStats(transport, payload)` 用页面全局 `fetch`：`transport(new Request(new URL(STATS_PATH, base), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }))`；`readStatsReply(response)` 先 `if (!response.ok) throw` 再剥 `{snapshot}` 信封、验 `snapshot.managedTurns` 是 number。
- `statsPort`：`refresh()` 重新拉、`reset()` 传 `'reset'`；首次读取失败置 `status='error'` + warn「效率统计读取失败：」。
- 注册注入面 `inject: () => ({ hooks: { snapshot: form, statsStore }, writeMode, resetMode, stats: statsPort })`。
- `configForms` 缺席时行为不变（一个槽位都不注册）。

### 4. `test/client-wiring.test.mjs`

- 断言为 `[['configForms']]`、`Object.keys(face.hooks) = ['snapshot', 'statsStore']`。
- 新增用例「效率读接口挂在 hooks 上，且首次读取失败时不假装有数据」：`globalThis.fetch` 桩（`try/finally` 还原）抛 `channel offline` → `status === 'error'`、`snapshot === null`；`reset()` 后 `managedTurns === 0`；`calls` 记录 `[pathname, method, payload]`，payload 依次为 `null`、`'reset'`。

### 5. 门禁实测

| 项 | 结果 |
| --- | --- |
| `pnpm typecheck` | 通过 |
| `pnpm build` | `lib/client.js` **39337 B** / gzip 8853，id `dsh-ponytail-58fly`，external 仅 primitives / react / jsx-runtime |
| 体积增量 | 基线（剥掉统计接线后单独打包）raw 31536 / gzip 7834 → **+7475 B（7.3 KB）/+1019 B gzip**，满足 ≤8KB |
| `pnpm test` | **271 passed / 0 failed** |
| `pnpm verify` | 通过（32 源文件 / 117 产物 / 1 提醒） |
| `grep -nE '#[0-9a-fA-F]{3,8}' src/client/panel.tsx src/client/charts.tsx` | 0 命中 |
| `grep -rn '你省了' src/client` | 0 命中 |

外壳仍是 `window.__ModuleLoader__.load({ id: 'dsh-ponytail-58fly', factory })`（`verify` 第 2 组通过）。

### 6. 真实宿主验证（2026-11-09 补齐）

宿主两次重启后，设置页 → Ponytail 面板实测：

- `POST /api/ponytail-stats/snapshot`（带页面会话 cookie）→ **200**，返回 `{"snapshot":{"version":1,"managedTurns":65,…,"turnsByMode":{"off":0,"lite":0,"full":65,"ultra":0},"firstAt":1794191009748,"lastAt":1794191489575,"revision":65},"assumption":"这是上游基准，不是本机测量。"}`。计数在真实累积：24 → 36 → 43 → 65 → 67。
- 面板 `section.dsh-ponytail-58fly-panel` 的 innerText 已含「效率」整块：`43 轮 受管 / 0 次 注入 / 0 次 切档 / 0 次 命令调用 / 0 B 注入字节 / 0% 注入率 · 0/43`，按档位横向条 `off 0 / lite 0 / full 43 / ultra 0`，基准三行 `输出 token 约 -45% [-54%,-35%] / 成本 约 -26% [-36%,-16%] / 耗时 约 -41% [-49%,-32%]`，尾注「基线：上游 39 任务 × 5 次 × 三臂，Claude Code + Opus 5.5 · 方法论 · 这是上游基准，不是本机测量。」，末尾「清零统计」按钮。
- 截图：`/Users/sunkai/Downloads/ponytail-efficiency-panel-2.png`（1668×873；弹层已关，效率区块完整可见，窄栏不溢出）。第一张 `ponytail-efficiency-panel.png` 被宿主「用户须知」弹层挡住，作废。

### 7. 一次契约修正：`connection.fetch` 根本不存在

第一版第 6 节记录的「必须重启」只解释了一半。重启后端点通了、面板仍停在错误态「统计暂时读不到」，根因在客户端契约：

- 宿主客户端 `dsh-client-connection/lib/client.browser.js:1421-1496` 里 `ctx.provide("connection", handle)` 的 handle 只有 `interactions / openWebSocket / isLoopback / generation / state / rpc / reconnect / registerGenerationSource / start`，**没有 `fetch` 成员**。原写法 `connection.fetch.fetch(...)` 每次必抛 `TypeError`。
- 修法：改吃页面全局 `fetch`（同域请求自带会话 cookie），`ctx.inject` 从 `['configForms','connection']` 收成 `['configForms']`，`StatsConnection` 接口换成 `type StatsTransport = (request: Request) => Promise<Response>`。文件头写明「为什么不用 connection.fetch」与源码行号。
- 门禁复跑：`pnpm typecheck` ✓、`pnpm build` → `lib/client.js` **39304 B**、`pnpm test` **271 passed**。

三条本地验收 + 真实宿主截图与端点证据全部拿到；补记了一次客户端契约修正（connection.fetch 不存在 → 页面全局 fetch）。
