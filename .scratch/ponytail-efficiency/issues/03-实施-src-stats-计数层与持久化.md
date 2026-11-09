<!-- DSH-IDEMPOTENCY-KEY: deck-plan-ponytail-efficiency-v1-child-S5 -->
<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-PARENT: 00 -->
<!-- DSH-LABELS: wayfinder:task -->
<!-- DSH-BLOCKED-BY: 02 -->
<!-- DSH-ASSIGNEES: lead -->
# 03: 实施：src/stats 计数层与持久化

Type: task

Blocked by: 02

Status: resolved

## Question

按 02 定下的形状落地 `src/stats/`：

1. 新文件：`src/stats/types.ts`（快照类型）、`src/stats/store.ts`（`installStats(ctx)` 返回 store）、`src/stats/baseline.ts`（01 的系数表 + 来源链接）、必要时 `src/stats/persist.ts`（读写原子文件）。
2. 埋点接线：`src/prompt/prestep.ts` 记受管轮次与注入次数/字节；`src/commands/ponytail.ts` 记 `/ponytail-*` 调用；`src/config/runtime.ts` 的 subscribe 记切档次数（或由 plugin 装配层订阅转发，避免 config 依赖 stats）。
3. 持久化：路径经 `l0/paths.ts` 解析（无现成解析就加一个纯函数并在票里说明）、原子写、30 秒合并写、退出 flush、坏文件退化内存态。
4. `src/plugin.ts` 按 02 结论插入装配步骤。
5. `test/stats.test.mjs`：累加、reset、坏文件不抛、并发 bump 不丢数。

## 验收

- `pnpm typecheck` 与 `pnpm test` 全绿；`pnpm verify` 的分层矩阵组通过。
- 手工验证：写一次档位切换 + 发两步消息后，`stats.json` 里出现对应增量（票内贴出实际文件内容）。
- 统计层的任何失败都不能让 pre-step 抛错（异常路径仍走「本步按原样继续」）。

## Answer

**与票面的偏差（两处，均已由 02 的 Q12′/Q17/Q18 定案，用户 2026-11-08 同意）**

1. 第 1 项的 `src/stats/persist.ts` **不建**，第 3 项「原子写 / 30 秒合并写 / 退出 flush / 坏文件退化」**整条作废**：`scripts/verify.mjs:838` 第 11 组「零垃圾承诺」禁 `src/**` 任何写盘 API。统计只在本次宿主运行期内累计，重启清零。
2. 第 2 项的切档次数**不挂** `runtime.subscribe`，改挂命令层写入成功处（`outcome.ok === true` 之后）——`subscribe` 的触发源含 re-describe，别的插件改配置也会通知，会把「我没切过档」记成切过。

### 实际落地的文件

- `src/stats/types.ts` — `CounterKey`（managedTurns / injections / injectedBytes / commandCalls / modeSwitches）、`StatsSnapshot`（9 字段）、`StatsView`（快照 + revision）、`StatsSink`（`onTurn(mode)` / `onInject(text)`）。
- `src/stats/store.ts` — `StatsStore.bump(key, {mode, bytes})` / `snapshot()` / `reset()`。`bump` 全走数值运算与边界钳制，**物理上永不抛**；未知档位落 `full`（丢一轮比记错档更糟），NaN/负数/小数按 0/0/向下取整。
- `src/stats/baseline.ts` — `BASELINE` 七字段常量表（含 `cheaperOnTasks: 30/38`）、`BASELINE_CAVEAT = '这是上游基准，不是本机测量。'`、`ASSUMED_TOKENS_PER_TURN = 800`、`projectSavings(stats, tokensPerTurn)`。只算非 off 轮次，返回 `{activeTurns, tokensPerTurn, outputTokens, cost, time}` 每行带 `center/from/to/source`。
- `src/stats/index.ts` — `installStats(ctx): StatsHandle`，暴露 `sink / snapshot / reset / bumpCommand / bumpSwitch`；所有记数经 `bump()` 包 try，抛错只记一条 warn。
- `src/prompt/prestep.ts` — `ReminderOptions` 增可选 `stats?: StatsSink`；受管轮次在 `const current = options.ports.mode;` 之后记（拒绝步 `decision.kind !== 'enter'` 已提前 return，不计数），注入次数与字节在 `renderModeUpdate` 之后、造消息之前记。
- `src/commands/ponytail.ts` — `run(runtime, rawInput, stats?)` 首行 `stats.bumpCommand()`；切档次数在 `if (!outcome.ok) return ...` 之后记；`installPonytailCommand(ctx, runtime, stats?)`。
- `src/plugin.ts` — 装配顺序插入「3a) 效率统计」（会话状态之后、PromptPorts 之前）`const stats = installStats(ctx)`；`installModeReminder(ctx, { ports, source, stats: stats.sink })`、`installPonytailCommand(ctx, runtime, stats)`；新增 `attachStatsChannel(ctx, stats)` 走 `ctx.inject(['webServer','connection'])`，注册 `connection.rpc.handle('/ponytail-stats', handler)`，handler 在 payload 为字面量 `'reset'` 时先清零再返回 `{snapshot, assumption: BASELINE_CAVEAT}`。
  - 刻意**不 import** 宿主包的类型（`@deepseek-ai/dsh-client-connection` 不在本仓 devDependencies，且宿主 profile 里才是它真正的家），改用本地最小契约 `StatsHostScope` + `readConnection(scope)` 运行时收窄；`verify` 第 6 组禁 `as unknown as`、禁非空断言，这里都避开了（只保留一次普通的 `as { connection?: ... }` 收窄）。
- `scripts/verify.mjs` — 第 3 组 `LAYERS` 加 `'stats'`，`ALLOWED_DEPENDENCIES` 加 `['stats', ['l0']]` 并把 `prompt` 放行 `stats`（只为一处 `import type { StatsSink }`，编译后擦除）；注释与报错文案（`:385`、`:459`）同步。
- `test/stats.test.mjs` — 9 个用例：按档位累加、快照是副本、脏输入不抛、reset 全零、一万次 bump 不丢、`projectSavings` 只算非 off 且区间正确、零数据/全 off 不出负数、基准表恰好 7 字段且都带 https 出处、`installStats` 的 sink 不抛且中文按 UTF-8 记 12 字节。

### 验证（实跑）

- `pnpm typecheck` 通过；`pnpm build` 通过（`lib/client.js` 仍 16322 字节，客户端未动）；`pnpm test` **265 passed / 0 failed**；`pnpm verify` **通过（30 个源文件，113 个产物文件，1 条提醒）**。
- pre-step 真实接线冒烟（用 `lib/prompt/prestep.js` + 假 ctx 跑三步 + 一步 reject）：
  `{"managedTurns":3,"injections":1,"injectedBytes":203,"turnsByMode":{"off":0,"lite":0,"full":1,"ultra":2}}` —— 证明「档位没变不注入但计轮次」「切档那步计注入」「reject 步不计」三件事同时成立。
- 异常降级冒烟（`ports.mode` 抛错 + `sink.onTurn` 抛错）：输出 `decision: enter 0 logs: 1 档位提醒注入失败，本步按原样继续：x`，本步照常推进。
- 命令层冒烟：三次调用（空参 / `ultra` / `bogus`）后 `{"commandCalls":3,"modeSwitches":1}` —— 失败切换不计切档。
- 统计快照实样：
  `{"version":1,"managedTurns":3,"injections":1,"injectedBytes":55,"turnsByMode":{"off":1,"lite":0,"full":2,"ultra":0},"modeSwitches":1,"commandCalls":1,"firstAt":1794136046583,"lastAt":1794136046583,"revision":6}`
- 票面第 2 条验收「`stats.json` 里出现对应增量」按 Q12′ 改为**内存快照**：不落盘，所以没有 `stats.json`，改为贴上面的 `snapshot()` 输出。

### 给下游的接口约定

- 06（面板）与 07（命令）都只读 `StatsHandle.snapshot()` 的字段名，不许自己再算一遍；百分比一律走 `projectSavings`，分母 `activeTurns` 必须与百分比一起显示。
- 客户端取数：`connection.rpc.call('/ponytail-stats', 'snapshot', payload)`；payload 为字符串 `'reset'` 时清零。通道名在 `src/plugin.ts` 与（06 要写的）`src/client/index.ts` 各一份，改一处必须改两处。

## 进度

- 2026-11-08 19:08：计数层、埋点、装配、RPC 通道、测试全部落地；typecheck / build / test(265) / verify 全绿；三组冒烟实跑通过。票关闭，转 06 与 07。
