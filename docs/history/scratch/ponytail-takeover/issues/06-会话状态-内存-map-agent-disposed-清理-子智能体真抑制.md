<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-PARENT: 00 -->
<!-- DSH-LABELS: wayfinder:task -->
<!-- DSH-IDEMPOTENCY-KEY: deck-plan-ponytail-takeover-v1-child-T5 -->
<!-- DSH-CREATED: 2026-11-07T03:34:34.157Z -->
<!-- DSH-BLOCKED-BY: 03 -->
# 06: 会话状态：内存 Map + agent/disposed 清理 + 子智能体真抑制

Type: task

Blocked by: 03

Status: resolved
## Question

把会话状态压到最小，并让子智能体抑制真正生效。

## 要做的事

1. **内存 Map<SessionKey, {baselineMode}>**，键从 `agent` 反推（`agent/pre-step` payload 里**没有 sessionId**，只有 `agent`，这是上游 `resolveSessionId` 存在的原因）。**0.2.2 的 payload 是六项：`{agent, messages, signal, step, modelSelection}`**（`modelSelection` 是 0.2.2 新增的纯增益字段，0.2.1 只有五项；`agent/pre-step` 与 `agent/created` 签名本身未变，#09 已逐字节核实）。
2. **生命周期清理**：`ctx.on('agent/disposed', ({ agent }) => store.delete(key(agent)))`。替代上游的 LRU 100 + `session-states.json` 持久化（约 180 行 + 175 行自愈链）。
3. **子智能体抑制做成真判定**：`PONYTAIL_SUBAGENT_MATCHER` 编译成正则后，**真的决定 section 文本是否为空**，而不是只打一条 warn 日志（上游 S1-2 缺陷）。对齐 @maci0 的 `isEligibleAgent(agent)`。
4. **无会话上下文时的行为**：`section` 的 `text` 回调可能在没有会话的情况下被调用（单测、外部直读）。要有明确的单例出口，不能抛。
5. **重启语义写进文档**：重启后会话状态回默认，这是设计选择不是缺陷。

## 硬约束

- 不写任何磁盘持久化。若将来要持久化，那时再单独开票并带持久化验收（@mengyuly 的 4 进程 + SIGKILL 口径）。
- 清理必须真的释放：写一条测试断言 `agent/disposed` 后 Map 里没有残留。

## 验收

- 100+ 会话并发不涨内存（无上限但有清理）。
- `agent/disposed` 后无残留（有断言）。
- matcher 不匹配时 section 为空且有 debug 日志；匹配时为完整正文。

## Answer

先查后问已完成，**本票无必须问用户的开放题**：五条待决点是设计取舍，均已按「可机器验证」的判据收敛成决策，每条带 0.2.2 宿主包内的 `file:line` 证据。

### 已查阅范围（一句话）

本票正文与 `map.md` 全文；`src/{plugin.ts,state/sessions.ts,l0/mode.ts,l0/paths.ts,prompt/index.ts,config/schema.ts}`；`test/{composition,l0}.test.mjs`；`docs/research/upstream-ponytail-source-audit.md`（S1-2 / H-05 / P10 / A7）；`docs/research/_peer-report-backup.md:94-95`；仓库内 `node_modules/@deepseek-ai/{dsh-agent,dsh-session}` 的类型与实现；本机 App 内 `@deepseek-ai/dsh-subagent` 源码（只作旁证，不作兼容性依据，见 D1 注记）。

### 既有笔记复用（只记路径与结论，不贴全文）

| 路径 | 就本票而言的一句话结论 |
|---|---|
| `docs/research/upstream-ponytail-source-audit.md` | S1-2 子智能体匹配器是空壳（`ponytail.ts:403-427` 只 `logger.debug`）；H-05/P10 判它「装饰性功能换真实 ReDoS 面」，整改方向是删或加长度上限——本票选加护栏，因为删掉会丢功能。 |
| `docs/research/_peer-report-backup.md:94-95` | 对齐目标 `isEligibleAgent(agent)` 的语义是「不匹配则 section 文本返回空串」，这是真判定与日志的唯一分野。 |
| `docs/research/dsh-0.2.2-compat-and-peer-range.md` | 0.2.2 的 `agent/pre-step` 六项 payload 已核实；`CONTEXT_ORDERS` 与 section 槽位不受本票影响。 |

三份笔记合起来已回答「上游怎么错的」「宿主给什么」「判据是什么」，**不需要新开 /research**。

### 宿主事实（逐条带证据）

- **D1 · 子 agent 可稳定识别**：`@deepseek-ai/dsh-session/lib/types/types.d.ts:86` `readonly origin?: 'subagent'`；`:92` `readonly delegationDepth?: number`；`:76` `readonly parentSession?: SessionId`。注释原文（`:77-81`）：「Direct creator of a subagent Session. Ordinary forks omit this field; historical ordinary forks may retain their source id here. **Presence alone does not classify a Session as a subagent; use `origin` for that distinction.**」
  → 判定**必须**用 `origin === 'subagent'`，**绝不能**用 `parentSession !== undefined`（后者会把历史普通 fork 误判成子智能体，把正文整段吞掉）。
  本机 `dsh-subagent/lib/index.js:347-358 childSessionMeta()` 写入点为 `{ parentSession: parentHeader.id, isSeeded, origin: "subagent", delegationDepth: childDepth }`。**注记：该文件来自 App 打包树（本机被 63 处 `.dshpurge.bak` 打补丁的环境），只作「宿主确实这样写」的旁证；兼容性结论只依据仓库 `node_modules` 里 0.2.2-rc.1 的类型声明。**

### 决策

- **D2 · 匹配器不是「用户可控正则」，而是「意图词汇表 + 字符串到字符串的映射」**（第一性原理：可选的自由形态过滤器 = 不给值时全开、给值时不做任何事、只让过滤变成削减；而「抑制子智能体」本身就是削减，所以词表恰好落在所需能力上）。
  - 形态：逗号分隔的**子串词汇表**（保留环境变量名 `PONYTAIL_SUBAGENT_MATCHER` 便于迁移，语义从「正则」降级为「逗号分隔子串」）。
  - 匹配文本：`agentPreset ?? ''`（`agent.session.header.agentPreset`，`types.d.ts:99`）。**不用 `cwd`**：父会话必然继承同一 `cwd`，用它匹配会把该 cwd 下全部会话一起吞掉。
  - 语义：条目出现在匹配文本中 → 抑制（section 为空）；词汇表为空／未设／全空 → 不抑制（默认全开，与上游「设了环境变量才生效」一致）。大小写不敏感。
  - **护栏（替掉 H-05 的 ReDoS 面）**：条目 ≤ 32 个、单条 ≤ 64 字符、总长 ≤ 1024；超限丢弃超出部分并 `debug` 记一条，**绝不因为越界输入改变判定结果**；非字符串输入一律视为未配置。
  - 判定实现是 `terms.some(t => haystack.includes(t))`，**零正则、零回溯**，ReDoS 面在构造上消失。

- **D3 · 「无会话上下文」分两种，出口不同**（状态容器只有两种情形：还没拿到会话 → 不缓存、无状态可读；拿到了但本会话被抑制 → 返回 `null` 作为抑制信号，而**不是**档位取值域里的 `'off'`——`'off'` 是 #07 的「用户选择了关闭」渲染语义，混用会让日志与客户端档位带说谎）。
  - **能力缺失**（`ctx.get('agents')` === undefined 或 `agent.session` 读不到）：**fail-open，降级为不抑制**。本插件在该宿主上本应全开；只因读不到元数据就让所有会话静默失去正文，代价高于「子智能体多带一段正文」。
  - **外部直读／单测**：走 `_fromProbe({ suppressed })` 注入口，不经过宿主。

- **D4 · `baselineMode` 的唯一裁决点是 `agent/created`，且必须在同一同步 tick 内写完**（这是「零缓存破坏」在会话层的落地：前缀必须在第一次 assemble 之前就是同一个值，`#07` 的逐字节断言兜底）。
  - `agent/pre-step` 是 waterfall（`runtime-types.d.ts:330-339`，带 `next()` 与 `turn/step`），`agent/created` / `agent/disposed` 是 `@mode serial/emit`（`:252`、`:265`）。**只在 `created` 写、在 `pre-step` 只读**，消灭「首步慢一拍」这种只在并发下现形的 bug。
  - 代价（如实写进文档，不夸大）：`created` 时 `config.defaultMode` 已由 `apply` 读成**常量**，上游「全局档在运行期被外部改动后下个会话生效」的语义会丢失。**裁决：接受**——该语义本就只对下个会话生效且依赖磁盘轮询；`#04` 的优先级链接回来后，由 `#07` 让每次 created 重新 determine。
  - 形状：`installSessionStore(ctx, { resolveBaseline })` → `ctx.on('agent/created', ({ agent }) => store.set(agent.id, { baselineMode: resolveBaseline() }))`（纯同步、返回 `undefined`）+ `ctx.on('agent/disposed', ({ agent }) => store.delete(agent.id))`。
  - `serial` 监听器**不得** `await agent.whenIdle()` 或等自身 owner 释放（宿主注释 `:245-247` 原文），所以监听器必须同步函数。

- **D5 · 验收怎么测**（沿用 #03：`ctx.plugin()` 返回 thenable Fiber，`assert.rejects` 用不了；真 Cordis 组合测试用 `new Context()` + `ctx.plugin()`，**不能伪造 `agent`**，`agent/created` 要真 `Agent`）。
  1. **单元（无需宿主）**：`SessionStore` 纯 Map——`set/get/delete/size`；`_fromProbe({suppressed:true})` 的条目可被 `delete`；同 `id` 覆盖写不涨 `size`。
  2. **清理（对应硬约束「必须真的释放」）**：`agent/disposed` 是 `@mode emit` 且 `this: Scoped<Agent>`，跨域手工 `ctx.emit` 打不进去。**改为**把 `installSessionStore` 对 `ctx.on` 的调用解耦成 `bindLifecycle(ctx, store, hooks)`，测试直接调 `hooks.onDisposed({ agent: fakeAgent })` 断言 `store.size === 0`；真生命周期那条在 `#07` 的组合测试用真 agent 补。**这条取舍写在票里，防止后来人以为「生命周期已经不测了」。**
  3. **100+ 会话不涨内存**：循环 200 个 `{id}` 键（只测 Map 语义），每 10 个删一批，断言 `size` 与存活数相等；并断言产物无 `fs` 导入（零磁盘持久化）。
  4. **matcher**：`{terms:'explore,plan'}` × `agentPreset` 取 `'Explore'` / `'codex'` / `undefined` 三格；超限输入（33 条、65 字符、总长 1030）不改变默认全开；非字符串（`undefined`/`null`/`42`）一律不抑制。

- **D6 · 文档**（第 5 条）：README 行为节加三行——会话档位活在内存、重启回全局档、这是设计语义不是缺陷；子智能体抑制的判定条件与护栏数字（32/64/1024）；能力缺失时 fail-open。

### 写面与边界

- 写面：`src/state/sessions.ts`（+ 新增 `src/state/subagent.ts`）+ `test/state.test.mjs` + README 一节。
- **不动** `src/prompt/render.ts` / `src/prompt/index.ts` 的渲染语义（`#07` 的活）；本票只提供 `snapshot(agent)` 与 `suppressed(agent)` 两个读出口。
- **不动** `src/plugin.ts` 的 PK 顺序（`installSessionStore` 已在首位），只补 `resolveBaseline` 参数。
- `PONYTAIL_SUBAGENT_MATCHER` 从「模块顶层读 `process.env`」改为「接注入的解析函数」，单测可注入。

### 下一步

1. 本票状态：**决策已齐，可直接开工**。`wayfinder:task` 票的产出是决策；跨票的「section 逐字节不变」断言由 `#07` 承载，本票只交 `state/` 层与它的单测。
2. 开工顺序：`subagent.ts`（纯函数，先写测试）→ `sessions.ts` 改写 → `plugin.ts` 传参 → README 三行 → `test/state.test.mjs`。
3. 遗留判断（不影响开工）：`agent/created` 在 `@mode serial` 下若更早的监听器抛错，我方 `baselineMode` 会写不进去（宿主 `:303` 原文「A throw or rejection fails creation and skips later listeners」）；但**该会话本身也建不出来**，不会留下「无 baseline 却在跑」的会话——无需额外防御。

wayfinder:task 解析完成——五条待决点定案（origin==='subagent' 判定、子串词表替正则以消 ReDoS、agent/created 同步写 baseline、无上下文 fail-open、hooks 解耦测清理），写面与下一步已写入正文 Answer，可开工。

## Comments

### local — 2026-11-07T06:13:52.785Z
按 wayfinder 推进：先查后问完成，五条待决点全部收敛为可机器验证的决策（子会话判定用 origin==='subagent'、匹配器降级为带护栏的子串词表、baseline 在 agent/created 同步写、无上下文 fail-open）。详见正文 Answer。

### local — 2026-11-07T06:14:06.845Z
补分类：这半是设计决策，就位置而言归属 #06 正文 Answer（跑完写入）；deck_issue_patch 的 body 与 comment 同传时只有 comment 落地，body 需单独一次调用。

### local — 2026-11-07T06:15:34.107Z
### resolution — 票 06（wayfinder:task）

**结论一句话**：会话状态收敛为「一个 Map + 两个生命周期钩子 + 一个零正则词表」，五条待决点全部定案，宿主证据逐条钉在正文 Answer 的 D1–D6。

**定案清单（供开工直接照做）**

1. **D1 子会话判定** = `session.header.origin === 'subagent'`（`@deepseek-ai/dsh-session/lib/types/types.d.ts:86`）。**不得**用 `parentSession !== undefined`——宿主注释 `:77-81` 明说历史普通 fork 会残留该字段。
2. **D2 匹配器** = 逗号分隔子串词汇表（保留环境变量名 `PONYTAIL_SUBAGENT_MATCHER`），匹配文本 `agentPreset ?? ''`，大小写不敏感，护栏 32 条 / 64 字符 / 总长 1024，越界只截断不改判定，实现 `terms.some(t => haystack.includes(t))`——**零正则，H-05 的 ReDoS 面从构造上消失**。
3. **D3 无上下文出口**：能力缺失 → fail-open（不抑制）；被抑制 → 返回 `null`（**不是** `'off'`，那是 #07 的用户选择语义）；单测走 `_fromProbe({ suppressed })`。
4. **D4 baseline 唯一裁决点** = `agent/created`，同步 tick 内写完；`agent/created`/`agent/disposed` 是 `@mode serial/emit`（`runtime-types.d.ts:252`、`:265`），`agent/pre-step` 只读。`serial` 监听器不得 `await`（宿主注释 `:245-247`）。
5. **D5 测试策略**：`bindLifecycle(ctx, store, hooks)` 解耦，`hooks.onDisposed` 直调断言 `size === 0`；真生命周期留给 #07 的组合测试。
6. **D6 文档**：README 三行（内存语义 / 护栏数字 / fail-open）。

**写面**：`src/state/sessions.ts`、新增 `src/state/subagent.ts`、`test/state.test.mjs`、README 一节。**不碰** `src/prompt/*`（#07）与 `src/plugin.ts` 的 PK 顺序（只补 `resolveBaseline` 参数）。

**下一步（不在本票内）**：开工顺序 `subagent.ts`（先测试）→ `sessions.ts` → `plugin.ts` 传参 → README → `test/state.test.mjs`；随后 #07 可解冻。

## 进度
