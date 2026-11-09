<!-- DSH-IDEMPOTENCY-KEY: deck-plan-ponytail-efficiency-v1-child-S3 -->
<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-PARENT: 00 -->
<!-- DSH-LABELS: wayfinder:prototype -->
<!-- DSH-ASSIGNEES: lead -->
# 02: 统计层接口原型：StatsStore 的形状与计数点埋在哪里

Type: prototype

Status: resolved


## 维护者原话
出处：本会话（2026-11-08 18:59）
> > 全部同意
## Question

在不破坏分层矩阵的前提下，`src/stats/` 应该暴露什么形状的接口，计数的埋点落在哪几行？

要回答：
1. `StatsStore` 的公开面：`bump(kind, mode)` / `snapshot()` / `reset()` / `flush()` 是否够用；快照字段的精确名字与类型（受管轮次、注入次数、注入字节、切档次数、按档位轮次分布、`/ponytail-*` 调用次数、首次/最后计数时间）。
2. 计数点：`src/prompt/prestep.ts` 里「经过一次 pre-step」与「真正注入 reminder」分别落在哪行；档位切换能从哪里听到（`src/config/runtime.ts` 的 subscribe）；命令调用在 `src/commands/ponytail.ts` 的哪一处。每处给出插入位置 + 3 行以内示意。
3. 持久化：落盘格式（含版本字段的纯整数 JSON）、原子写（临时文件 + rename）、30 秒合并写的定时器放哪、`flush()` 在哪个生命周期钩子调——**必须查证宿主可用钩子并给出行号，不许猜**。
4. 自伤防护：写盘失败、文件损坏、版本不匹配时退化成内存态而不是让插件报错；给出具体降级返回。
5. 分层矩阵影响：`src/stats/` 只依赖 `src/l0/`；`plugin.ts` 装配顺序里插在第几步（现状 1 配置 / 2 LadderSource / 3 会话状态 / 3b PromptPorts / 4 installPrompt / 5 reminder+command / 6 skills / 7 settings）；`scripts/verify.mjs` 第 3 组矩阵是否要加一条边。

## 验证方式

票内贴一段 20 行以内的 `test/stats.test.mjs` 草稿（不要求入仓），证明：计数累加、reset 清零、坏文件不抛。

## 约束

- 只出形状与埋点，不写完整实现（实现是 03）。
- 任何宿主钩子/API 必须给出源码位置（`$A/...` 或 node_modules 路径 + 行号）。

## Comments

### local — 2026-11-08T10:33:08.665Z
## 需要你拍板（三项，全部同意推荐值即回复「全部同意」）

**Q12′ 持久化怎么办？**（这是本票唯一需要改主意的地方，其余都已实测定型）

- **A（推荐）不落盘**：进程内累计，宿主重启清零。理由：`scripts/verify.mjs` 第 11 组「零垃圾承诺」用正则扫 `src/**`，`writeFile`/`rename`/`mkdirSync` 全在禁用名单；而走 `ctx.settings` 那条路已被 04 实测否决（volatile 字段会被任何配置写入抹掉）。代价：地图 Destination 里「跨宿主重启累计」这句话要改成「本次运行累计」。
- **B 具名白名单**：改 verify 第 11 组，只允许 `src/stats/persist.ts` 写盘，并把理由写进注释。代价：动仓库硬约束，且接受卸载后残留 `~/.dsh/ponytail-58fly/stats.json`。
- **C 不落盘 + 导出**：内存累计，面板/命令支持导出 JSON 让用户自己存。代价：多一条导出路径，收益不明显。

**Q17 计数怎么穿过分层？**

- **A（推荐）回调注入**：`prestep` 收 `onTurn` / `onInject` 回调，`plugin.ts` 把 `stats` 接上去。四层仍然只依赖 l0，分层矩阵零改动。
- **B 直接依赖**：`prompt` 与 `commands` 的允许依赖从 `['l0']` 扩成 `['l0','stats']`。多一行 verify 配置，但代码更直白。

**Q18 切档次数挂在哪？**

- **A（推荐）写入成功处**：`runtime.setMode` 返回 `ok` 之后计数。量的是「用户真的切了档」。
- **B 挂 `runtime.subscribe`**：量的是「生效档位变了」，包含别的插件改配置引发的 re-describe，会多算。

## 进度

- 进度：100%（2026-11-08T19:00:10+08:00）：用户全同意推荐值，票关闭，转 03
- 进度：100%（2026-11-08T18:33:02+08:00）：原型跑通、埋点行号取全；持久化改判为不落盘待确认

- 100%：原型已写成可运行文件并跑通自检，埋点行号全部取到，持久化改判见 Answer 第 3 条。

## Answer

**原型资产：`.scratch/ponytail-efficiency/prototype-02-stats.ts`**（可直接跑：`node --experimental-strip-types` 去掉对 `src/l0` 的 import 后即可执行；自检脚本在 `/tmp/proto-02.test.mjs`，四组断言全过）。

### 1. `StatsStore` 公开面（原型已实现并通过断言）

```ts
bump(key: CounterKey, options?: { mode?: RuntimeMode; bytes?: number }): void
snapshot(): StatsSnapshot & { readonly revision: number }
reset(): void
```

- **不要 `flush()`**：见第 3 条，落盘方案被改判为「不落盘」，`flush` 没有对象。
- `bump` 合并成一个键参数，而不是四个方法：埋点调用处只多一行 `stats.bump('managedTurns', { mode })`，不会在 pre-step 里堆四行样板。
- 快照形状（字段名即 UI 字段名，避免 06 再翻译一轮）：

```ts
interface StatsSnapshot {
  version: 1;
  managedTurns: number;            // pre-step 决定 enter 的步数
  injections: number;              // 真正注入 reminder 的步数（≤ managedTurns）
  injectedBytes: number;           // reminder 正文 UTF-8 字节和
  turnsByMode: Record<RuntimeMode, number>;  // 四档恒在，缺省 0
  modeSwitches: number;            // 切档成功次数
  commandCalls: number;            // /ponytail* 调用次数
  firstAt: number | null;          // 首次计数时间戳
  lastAt: number | null;           // 最后计数时间戳
  revision: number;                // 单调递增；客户端判断快照新旧的唯一依据
}
```

- 实测行为（自检脚本输出）：三档各计一次 → `{off:1,lite:0,full:1,ultra:1}`；脏档位 `'bogus'` 落到 `full`；`bytes: NaN / -5 / 3.7` → 计 `0 / 0 / 3`。
- **`bump` 物理上不可能抛**：纯数值 + `switch`，没有 I/O、没有宿主服务、没有可能为 undefined 的属性链。这是硬约束——埋点在 `src/prompt/prestep.ts` 的 try 块里，抛出去会被 catch 成「档位提醒注入失败」并**跳过后面的注入**，用户会看到一条与统计毫无关系的警告。

### 2. 计数点（行号已核）

| 计数 | 文件:行 | 插入方式 |
|---|---|---|
| 受管轮次（含档位分布） | `src/prompt/prestep.ts:68` `if (decision.kind !== 'enter') return decision;` 之后 | `const current = options.ports.mode;`（现有 `:78`）拿到后一行：`stats.bump('managedTurns', { mode: current });` |
| 注入次数 + 字节 | `src/prompt/prestep.ts:86` `const text = renderModeUpdate(...)` 之后 | `stats.bump('injections', { bytes: utf8Bytes(text) });`（`utf8Bytes` 放 `src/stats/bytes.ts`，`Buffer.byteLength(text, 'utf8')` 一行） |
| 切档次数 | **不要**挂在 `runtime.subscribe` | `subscribe`（`src/config/runtime.ts:259`）的触发源包含「别的插件改配置导致的 re-describe」，不是切档行为本身。改挂在写入成功处：`src/commands/ponytail.ts:112` 的 handler 里 `outcome.ok === true` 之后，以及面板 `writeMode` 成功后（同一个 `runtime.setMode` 返回点，两处共用一处判断） |
| 命令调用 | `src/commands/ponytail.ts:112` `handler: (invocation) => run(runtime, invocation.rawInput)` | 改成 `handler: (invocation) => { stats.bump('commandCalls'); return run(runtime, invocation.rawInput, stats); }` |

注意 `managedTurns` 与 `injections` 的差值就是「档位没变、本步没注入」的轮次数 —— 这正好是面板要显示的两个数字，不要试图合并。

### 3. 持久化：**改判为不落盘**（推翻 Q12，需要你点头）

- Q12 原定 `~/.dsh/ponytail-58fly/stats.json` + 30 秒合并写 + 原子 rename。**`scripts/verify.mjs:831-850` 的第 11 组「零垃圾承诺」用正则扫 `src/**`，`writeFile`/`rename`/`mkdirSync` 全在 `WRITE_APIS` 名单里，任何一处都会让 `pnpm verify` 报红。** 这一条不是风格偏好，是仓库的硬门禁，理由是「插件的持久状态一律交给 `ctx.settings`，自己写盘会留下卸载残渣」。
- 而 `ctx.settings` 这条路已被 04 实测否决（volatile 字段会被任何配置写入抹掉）。
- 三个选项与代价：
  - **(a) 不落盘（推荐）**：进程内累计，宿主重启清零。零门禁冲突、零残渣、零跨进程陈旧态。代价：地图 Destination 里「跨宿主重启累计」这句话要改。
  - **(b) 具名白名单**：把第 11 组改成「只允许 `src/stats/persist.ts` 使用写盘 API」并写明理由。代价：改动仓库的硬约束，且要接受「卸载后残留 `~/.dsh/ponytail-58fly/stats.json`」。
  - **(c) 不落盘但导出**：内存累计 + 面板/命令支持「导出 JSON」，用户自己存。代价：多一条导出路径，收益不明。
- 原型的代码两种都能接：`bump/snapshot/reset` 不认识存储，落盘方案只是外面套一层。**默认按 (a) 写 03，若你要 (b)，03 只多一个文件加一处 verify 例外。**
- 宿主生命周期钩子（若将来走 (b)，用这个）：`ctx.effect(() => () => flush())` 的卸载回调**支持返回 Promise 且会被 await**（`$H/cordis/lib/index.js:463 effect()`，见 `:473-478` 收集 thenable）；`fiber.dispose()` 在 `:389` 被 `Promise.resolve(...).catch(...)` 包裹。**不要**去监听 `process.on('exit')` 之类的 Node 全局钩子——插件卸载路径已经够用了。

### 4. 自伤防护（原型已验证）

- 脏档位 → 归一到 `full`（不丢弃这一轮，否则「受管轮次」与 pre-step 次数对不上，是更糟的谎）。
- 脏字节（`NaN` / 负数 / 小数）→ `0` / `0` / 向下取整。
- `firstAt` 只在第一次计数时写，`reset()` 后回到 `null`。
- 若将来走落盘：读文件失败 / JSON 坏 / `version !== 1` 一律当成空计数器，不抛、不警告（一次 `logger.warn` 即可，绝不 `throw`）。

### 5. 分层矩阵影响

- 新建 `src/stats/`，内部四文件：`types.ts`（类型 + `CounterKey`）、`store.ts`（`StatsStore`）、`baseline.ts`（7 字段常量表，数值由 01 票定）、`projection.ts`（乘系数 + 区间）。
- 依赖方向：`src/stats/*` 只 import `src/l0/mode.js`（`RuntimeMode` / `RUNTIME_MODES`），符合「新层只可依赖 l0」。
- **必须登记**：`scripts/verify.mjs:386` 的 `LAYERS` 数组加 `'stats'`，`ALLOWED_DEPENDENCIES` 加 `['stats', ['l0']]`。不登记的话 `layerOf()` 会把它判成 `root` 层并被 `continue` 跳过——静默漏检，正是这条检查存在的理由。
- 谁依赖 `stats`：`prompt`（prestep 埋点）、`commands`（命令埋点）+ `plugin.ts` 装配。**这意味着 `prompt` 与 `commands` 的允许依赖要从 `['l0']` 扩成 `['l0','stats']`** —— 这是本票唯一会改到分层矩阵的地方，请留意它是否可接受；替代方案是把计数回调作为参数注入（`prestep` 收一个 `onTurn` / `onInject` 回调，由 `plugin.ts` 接到 `stats`），这样四层仍然只依赖 l0。**推荐后者，矩阵零改动。**
- 装配位置：插在现状 3（会话状态）之后、3b（PromptPorts）之前，成为 **3a) 统计层**，因为 `installModeReminder` 与 `installPonytailCommand` 都要拿到它；`plugin.ts:147-148` 那两行改为传入 `stats`（或回调）。

### 6. 测试草稿（`test/stats.test.mjs`，21 行）

```js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { StatsStore } from '../lib/stats/store.js';

test('累加与按档位分布', () => {
  const s = new StatsStore();
  s.bump('managedTurns', { mode: 'full' });
  s.bump('managedTurns', { mode: 'off' });
  s.bump('injections', { bytes: 120 });
  const snap = s.snapshot();
  assert.equal(snap.managedTurns, 2);
  assert.equal(snap.injections, 1);
  assert.equal(snap.injectedBytes, 120);
  assert.deepEqual(snap.turnsByMode, { off: 1, lite: 0, full: 1, ultra: 0 });
});

test('reset 清零且 revision 归零', () => {
  const s = new StatsStore();
  s.bump('commandCalls');
  s.reset();
  const snap = s.snapshot();
  assert.equal(snap.managedTurns, 0);
  assert.equal(snap.firstAt, null);
  assert.equal(snap.revision, 0);
});

test('脏输入不抛', () => {
  const s = new StatsStore();
  assert.doesNotThrow(() => {
    s.bump('managedTurns', { mode: 'bogus' });
    s.bump('injections', { bytes: Number.NaN });
    s.bump('injections', { bytes: -1 });
  });
  assert.equal(s.snapshot().turnsByMode.full, 1);
  assert.equal(s.snapshot().injectedBytes, 0);
});
```

### 7. 给 03 的一句话交接

按「不落盘 + 四文件 + 回调注入（矩阵零改动）+ `LAYERS` 加 `'stats'`」实施；若用户选落盘方案 (b)，只多一个 `persist.ts` 与 verify 一处例外。

三项拍板全部按推荐值定案（Q12′ 不落盘 / Q17 回调注入 / Q18 写入成功处），原型跑通、埋点行号取全，转 03 实施。
