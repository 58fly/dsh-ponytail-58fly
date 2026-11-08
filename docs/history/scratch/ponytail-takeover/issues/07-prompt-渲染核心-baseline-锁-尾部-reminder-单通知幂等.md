<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-PARENT: 00 -->
<!-- DSH-LABELS: wayfinder:task -->
<!-- DSH-IDEMPOTENCY-KEY: deck-plan-ponytail-takeover-v1-child-T2 -->
<!-- DSH-CREATED: 2026-11-07T03:34:34.157Z -->
<!-- DSH-BLOCKED-BY: 02, 03, 04, 06 -->
<!-- DSH-ASSIGNEES: lead -->
# 07: prompt 渲染核心：baseline 锁 + 尾部 reminder + 单通知幂等 + 围栏过滤 + 进程内缓存

Type: task

Blocked by: 02, 03, 04, 06

Status: resolved
## Question

实现插件的核心：让同一会话的 system prompt 前缀逐字节不变，同时档位切换立刻生效。

## 要做的事

0. **切档入口改用官方 `ctx.commands.register`（0.2.2 已内建，已实测）**：`{name:/^[a-z][a-z0-9_-]*$/, description, handler(invocation)=>{kind:'success',text?}|{kind:'error',text}, input?:{hint}}`，返回 disposer；`dsh-client-ui-commands` 自动进斜杠菜单，自带 `command/run`/`command/done` 生命周期。**据此删除**上游 `ponytail-commands.ts` 的 `parsePonytailCommand` / `dispatchMessages`，以及「在 `agent/pre-step` 里扒 `user/message` 文本」的监听。命令前缀仍为 `/ponytail`。
1. **baseline 锁**：会话诞生时把当时的档位记成 `baselineMode`，**终身不变**。顶层 section 只渲染它。会话关闭即释放（内存，见 #06）。
2. **尾部 reminder**：切档时不在前缀改字，而在 `agent/pre-step` waterfall 里给最新轮次追加 `<system-reminder>` 包裹的**完整 ladder 正文**（不是摘要）。**阶梯正文统一说六阶**（上游三处同文，见 #08），不用七阶；`order: 50` 在 0.2.2 的 `SECTION_ORDERS`（共 34 项）里落**第 3 槽**：`harness:identity`(-1000) → `deployment:persona-prefix`(0) → **`ponytail`(50)** → `plan:policy`(500) → 第 7 起工具段。作者注释「位于 persona 与工具之间」成立，**但上游 ADR-0012 的「约第 200 token」不成立**（#09）。渲染时 `.filter(text => text.length > 0)` 会丢弃空 section → mode=off 时整槽消失，这是预期行为不是 bug。
3. **单通知幂等**：用 `msgs.findIndex(m => m.source?.kind === 'ponytail-mode-update')` 定位旧通知**原地替换**，不累积；且仅在 `downstream.kind === 'enter'` 后才标记已发射。
4. **围栏感知过滤（#02 定案：锁定 B2 形状状态机）**：40 行渲染 + 27 行 FENCE 判定、零依赖。硬件要求：17 条形状变体全部正确、围栏内误删 0（对比 A 方案——纯行形状匹配——会误删围栏内 14 行）、真实 6 份技能正文零回归。**废除两条候选**：「显式分档文件 `SKILL.lite.md`」与「显式标记区块 `<!-- ponytail:lite -->`」——它们要求正文重构，而正文是上游移植的内容资产，不能为过滤机制改写（#02）。
5. **进程内缓存**：上游每轮至少 3 次 `readFileSync`。改成按 `(skillDir, mode, mtimeMs)` 缓存渲染结果，mtime 变了才重读。
6. **waterfall 不断链**：任何异常都必须 `catch` 后照常 `next()`，绝不拦截用户请求。

## 硬约束

- **前缀不变必须被证明**，不是被声称。验收方式：同一会话内切档前后各抓一次完整 system prompt，逐字节 `=== ` 比对，输出 diff 为空。
- 当轮多出的 token 要能测（上游自称约 180 token）。用 `measure-prompt` 式的脚本给出真实字节数，**拒绝伪造 token 估算**（没有统一 tokenizer 时给 `null` 并写明原因）。
- 不留 `catch { /* ignore */ }` 式的静默吞异常：要么记 warn 日志，要么有明确降级路径并在诊断里可见。
- **两个入口都要有**：`/ponytail <mode>` 命令（给人用）与 `settings` 的 `defaultMode`（给配置用），二者落到同一个 `coerceMode` 写入口，不允许两条路径各自归一化。**`coerceMode` 由 #03 的 L0 归一化模块产出（本票只 import，不得就地再写一份）**。

## 验收

- 前缀逐字节比对通过（有脚本、有输出）。
- `/ponytail lite` 走官方 commands 生效，且斜杠菜单里能看到该命令（不是自造解析）。
- 4 档（off/lite/full/ultra）切换后当轮 reminder 内容正确、不累积、不重复。
- 断链测试：让 handler 主动抛错，验证请求仍然通过。

## Answer

六件事全部落地，验收四项全绿：`npm test` 155/155 pass、`pnpm run verify` 通过（24 源文件 / 89 产物）、`node scripts/measure-prompt.mjs` exit 0。

### 0. 切档入口：删掉自造解析，改用官方 commands

`src/commands/ponytail.ts` 走 `ctx.inject(['commands'], scope => scope.commands.register({ name: 'ponytail', input: { hint: '[off|lite|full|ultra]', attachments: false }, handler }))`。上游 `parsePonytailCommand` / `dispatchMessages` / `session/event` 扒用户文本三条路径**整条删除**。空参数时报告当前档位 + 用法 + 可选值；非法值走 #03 的 l0 `coerceMode` 返回 null，再转 `{ kind: 'error', text }`。handler 抛错由宿主兜住并结算成 error（见契约笔记 §8.1）。

### 1. baseline 锁

`src/state/sessions.ts` 的 `SessionStore.ensure(id, resolve)`：首次建档时调一次 `resolve()` 定下 `baselineMode`，此后终身不变，并返回活引用。段正文在 `src/prompt/index.ts` 里读 `ports.ensure(agent.id, () => ports.mode).baselineMode`。

**关键取证**：`AssembleContext` 的类型只声明 `{ scope?, signal? }`（`dsh-system-prompt/lib/types/index.d.ts:37-45`），但实装 `dsh-agent/lib/index.js:407-413` 的 `assembleContextFor()` 返回 `{ agent, scope: agent, ... }`，调用点 `dsh-agent-loop/lib/index.js:685`。读不到 agent（子代理拿根 ctx 装配、或宿主将来改形状）就降级成全局活档位——不抛错，也不让段消失。

### 2. 尾部 reminder

`src/prompt/prestep.ts` 挂 `agent/pre-step`：`await next()` → 只认 `enter` → `source.refresh()` → 档位没变就把批次里的残留通知剔掉、变了就原位替换或追加。

文案在 `src/prompt/ladder.ts`：off 档说「已关闭 + 按标准工程实践执行」；其它档说「已切换为 X + 本指令集取代此前任何档位说明 + 完整正文」。**用替换式措辞表达语义幂等，不回去改历史**——与宿主 `renderCatalogUpdate` 的做法同款。

### 3. 单通知幂等

`src/prompt/notice.ts` 的 `applyModeUpdate(decision, update)` 覆盖四种情形：有旧通知则原位替换、无则追加；update 为 null 时剔除残留、没有残留则原样返回；`decision.kind !== 'enter'` 无条件原样返回。幂等对象是 `decision.messages`（本步要送进模型的批次），历史里已有的通知**不碰**。

实现细节：`announcedMode` **先标记、后返回**。`applyModeUpdate` 是纯函数，不会失败；若反过来先返回后标记，中途抛错会让下一步重复注入同一条。

### 4. 围栏过滤

`src/prompt/fence.ts` 的 `scanFenceLines()` 逐行判「这一行在不在围栏里」，开/闭围栏行本身算边界不算内容。删除条件收敛成三条同时成立：**围栏外 + 是合法档位标签 + 不等于当前档位**。围栏内一律保留——上游的纯行形状匹配会误删围栏内 14 行（inside code block 里的示例档位行）。

### 5. 缓存

`src/prompt/source.ts`：指纹是 `mtimeMs + size`，刻意不用内容哈希（哈希要读完整个文件，而要省掉的正是那次读）；变了才 `readFile` + `stripFrontmatter`；读失败只记 `problem` 并保留上一份正文，不清空。

另有 `primeSync()`：`PromptSection.text` 是同步签名，而第一次 `assemble` 可能早于第一次 `pre-step`——不预先同步读一次，首轮段正文就是空的。

### 6. 不断链

任何异常 → `ctx.logger('ponytail-58fly').warn(...)` → 返回 downstream 原 decision。断链测试在 `test/prestep.test.mjs`：让 `source.refresh()` 抛错，断言仍返回原 decision，并留下恰好 1 条含「模拟读盘失败」的 warn。

prompt 渲染核心落地并验收：前缀逐字节 3005/3005 不变、`/ponytail` 走官方 commands、四档切换单通知幂等、围栏感知过滤（围栏内误删 0）、stat 指纹缓存、pre-step 异常不断链；155/155 测试通过、verify 通过。

## 验收实测

| 项 | 结果 |
|---|---|
| 前缀逐字节 | 3005 / 3005 字节，`逐字节相同：true`（`node scripts/measure-prompt.mjs`，exit 0）|
| ponytail 段字节 | 2955 / 2955 |
| 切档 reminder 字节 | 3167 |
| `/ponytail lite` | 走官方 `commands.register`，返回 `{ kind: 'success' }`，斜杠菜单由宿主自动收录 |
| 4 档切换 | off/lite/full/ultra 每步恰好 1 条、文案对；下一步 0 条 |
| 断链 | 抛错仍返回原 decision + 1 条 warn |
| 全量测试 | 155 / 155 pass（1909 ms）|
| `pnpm run verify` | 通过（24 源文件 / 89 产物，1 条提醒）|

## 五条真发现

1. **「段里拿不到 agent」在类型层成立、在运行时是假的**。靠 `assembleContextFor()` 塞进去的 `agent` 才能实现 baseline 锁，且必须写降级分支；这条不在任何公开文档里。
2. **`off` 档的断言不能打在 `sections` 上**：段对象仍在（`text: ''`），真正丢弃空段的是 `renderPrompt` 的 `.filter(text => text.length > 0)`（`dsh-system-prompt/lib/index.js:119-121`）。
3. **「不累积」的正确对象是 `decision.messages`**，不是会话历史。两个官方范本（`dsh-tool-skill` 目录摘要、`dsh-plan-mode` 意图旁述）都是这么做的，并用**替换式措辞**代替改写历史。
4. **中文正文的字节数不等于上游的 token 口径**：段正文 2955 字节，上游「约 180 token」是英文原文口径。本仓只报可复现的字节数，token 给 `null` 并写明宿主没有统一 tokenizer——不做伪估算。
5. **分层矩阵会逼出依赖倒置**：prompt 需要 config 的活档位与 state 的 baseline，但矩阵规定四层互不可见。解法是新增 `src/prompt/port.ts` 只声明形状、`src/plugin.ts` 造适配器，并把 `describeError` 下沉到 `src/l0/errors.ts`。适配器里的 `mode` **必须是 getter**，写成字段会冻结成构造时的快照，之后切档不生效而面板显示正常。

## 与上游的分歧（全部有意）

- 不解析用户文本、不伪造会话事件：`session/event` 扒消息整条删除，改由官方命令层。
- 段正文不按当轮档位重渲染（上游 `renderPromptSection` 每轮重渲染 → 前缀抖动、KV cache 作废）。
- 正文按围栏感知过滤，不做行形状直删。
- 每轮至多一次 `stat`，不做上游那样至少 3 次 `readFileSync`。
- 文案改为中文，但保留 `PONYTAIL 已启用 · 档位：X` 这个英文锚点便于 grep 与断言。

## 遗留

- 斜杠菜单的可见性由宿主 `dsh-client-ui-commands` 负责，本仓只保证 `register` 成功；真机 UI 验证留给 #11 整机验收。
- `recordInput` 沿用默认 `true`（命令进会话记录），未提供开关。

## Comments

### local — 2026-11-07T07:45:56.498Z
解票完成。**六件事全部落地**：

| 件事 | 落点 | 证据 |
|---|---|---|
| 官方命令层 | `src/commands/ponytail.ts` | `commands.register` + `hint:'[off\|lite\|full\|ultra]'`；上游 parsePonytailCommand / dispatchMessages 删除 |
| baseline 锁 | `src/state/sessions.ts` + `src/prompt/index.ts` | `ensure()` 首次定档后终身不变；读宿主实装塞进来的 `agent` |
| 尾部 reminder | `src/prompt/prestep.ts` + `ladder.ts` | 只认 `enter`；档位变才注入，文案带「取代此前任何档位说明」 |
| 单通知幂等 | `src/prompt/notice.ts` | 四种情形覆盖；幂等对象是 `decision.messages` |
| 围栏感知过滤 | `src/prompt/fence.ts` + `ladder.ts` | 删除条件三条同时成立；围栏内误删 0 |
| 进程内缓存 | `src/prompt/source.ts` | `mtimeMs+size` 指纹；失败保留上一份正文 |

**验收四项**：前缀 3005/3005 字节逐字节相同（`node scripts/measure-prompt.mjs` exit 0）；`/ponytail lite` 走官方注册；四档切换当轮恰好 1 条、下一步 0 条；`refresh()` 抛错时仍返回原 decision + 1 条 warn。

**两条硬发现**：① `AssembleContext` 类型无 `agent`、实装有（`dsh-agent/lib/index.js:407-413`），baseline 锁必须写降级分支；② `off` 档的段对象仍在 `sections` 里（`text:''`），真正丢弃空段的是 `renderPrompt` 的 filter——断言要打在那里。

**架构副产物**：分层矩阵逼出依赖倒置，新增 `src/prompt/port.ts`（只声明形状），`describeError` 下沉 `src/l0/errors.ts`，`verify` 从 5 项违规归零。

契约笔记补齐第八章（9 小节）：命令契约精确签名、pre-step 两个 messages 的区别、幂等对象、自定义 source kind 的合法性、`renderPrompt` 丢空段、`agent` 未声明字段、依赖倒置、前缀测量口径、本仓落点表。

## 进度

- 2026-11-07：六件事全部落地，验收四项全绿。详见 Answer。
