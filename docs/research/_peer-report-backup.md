# 上游源码级质量审计：@wenaixi/dsh-ponytail 5.6.2

> 采集时间：2026-11-07。对象：https://github.com/Wenaixi/dsh-ponytail（commit 7223820，version 5.6.2，MIT）。
> 方法：clone 到本地逐文件通读 src/ 全部 9 个文件（2709 行）、scripts/ 5 个脚本（3595 行）、skills/ 6 个 SKILL.md、docs/adr/ 18 篇、lib/client.js 579 行、package.json、cordis.patch.yml，并在本机 DSH 0.2.2-rc.1 上核对宿主契约。
> 交叉引用：同类插件对比见 [ponytail-plugin-landscape.md](./ponytail-plugin-landscape.md)。

## 0. 一句话结论

**这是 ponytail 移植生态里工程质量最高的实现，也是复杂度最高、与宿主耦合最深、最不可维护的一份。**
它的核心资产（零缓存破坏架构）是真实有效的设计；它的主要债务是"用一个自研的存储/配置/自愈/协调四层中间件，去支撑一条本质上只有两段文本的规则"。

接管建议：**保留架构判断，重写实现。** 保留 ADR-0012 的零缓存破坏与 ADR-0002 的零 tool；放弃 17 篇 ADR 中关于"配置自愈引擎"与"会话状态持久化"的 6 篇所描述的机制，用宿主原生能力替代。

---

## 1. 体量与自相矛盾

| 维度 | 数字 | 判断 |
|---|---|---|
| 宿主侧 TS 源码 | 9 文件 / 2709 行 | 对一个"往 system prompt 塞一段话 + 读一个 flag"的插件，超重 3–5 倍 |
| 构建与测试脚本 | 5 文件 / 3595 行 | behavior.test.mjs 单文件 2496 行，是全仓最大的文件 |
| 架构决策记录 | 18 篇 ADR | 其中 6 篇（0005/0006/0007/0009/0017/0018）描述的是自研配置层，可从根上消除 |
| 客户端 | lib/client.js 579 行，由 build-client.mjs（629 行）字符串模板生成 | 产物入库（.gitignore 注释："lib/ 已提交到 Git，保证 GitHub 直装无需现场构建"） |
| 运行时依赖 | 仅 yaml ^2.4.2 | 依赖纪律良好 |

**自指矛盾（最重要的一条）**：这个插件的全部主张是 YAGNI 与"删减优先"，但它自己用 2709 行 TS + 3595 行脚本 + 18 篇 ADR 实现一个纯文本注入器。这不是讽刺，是**它自己规则的反例**——接管时若照抄结构，等于承认"规则只管用户代码，不管插件自己"。

---

## 2. 架构骨架（哪些是真的深模块）

作者在 CONTEXT.md 里自评了模块深度。实测复核：

| 模块 | 行数 | 是否名副其实 | 依据 |
|---|---|---|---|
| `ponytail-commands.ts` | 332 | ✅ 真深模块 | 对外只暴露 `createTurnCoordinator` 一个入口，内部封装指令解析、waterfall 穿透、变动比对、通知原地替换、发射标记五件事。6 条不变量写成注释（:245-252），且每一条都能在 :256-315 找到对应实现 |
| `ponytail-instructions.ts` | 157 | ✅ 真深模块 | 提示词唯一出口。路径解析 / review 短路 / 读盘 / 按档裁剪 / 失败兜底全部内聚，自身绝不抛，满足 section 的同步 text 契约 |
| `ponytail-priority.ts` | 105 | ✅ 真深模块 | 纯函数零 I/O，产出恒 3 项诊断链，每项带 label/location/value/hit/shadowed/problem。最好测的一个模块 |
| `ponytail-state.ts` | 434 | ⚠️ 深但过载 | 会话状态 + flag 读写 + LRU + 损坏自愈 + 正则抢救，五件事塞进一个文件。LRU 100 且用"循环找首个非默认键淘汰"的写法防止首键死锁（:346-352），说明作者踩过坑 |
| `ponytail-settings.ts` | 510 | ❌ 名义深模块，实为工具箱 | 文件里住了 11 个导出：sink 工厂、原子写、损坏备份、JSON 语法修补、字段抢救、磁盘读写、重置。`safeAtomicWriteFile` 与 `salvageConfig` 之间没有共享抽象 |
| `ponytail.ts` | 450 | ❌ 上帝入口 | 手搓 resolved config、探测 settings、读 patch、装配 7 个子模块、注册 section、注册 provider、注册 remote、命令面板快照。全仓 6 处 `as` 断言全在这里 |
| `ponytail-skills.ts` | 404 | ✅ 深模块 | frontmatter 解析、invocation 策略、provider 协议、双语描述全内聚，且**正确处理了 `disable-model-invocation`**（:146-153） |

---

## 3. 缺陷清单（按严重度）

### S0 — 会让插件在目标宿主上完全不可用

**S0-1 版本区间已越界。** `package.json` 声明 `engines.dsh: ">=0.2.0-rc.1 <=0.2.1"`，peer 里 `dsh-skill` / `dsh-typert-protocol` 同样是 `<=0.2.1`。本机是 0.2.2-rc.1。
宿主判定逻辑在 `dsh-plugin-manager/lib/index.js:491/513-514/1479/1493-1494`：只读 `engines` 与 `peerDependencies`，命中即产出 `incompatible-version` 拒绝安装。**插件自建的 `dsh.compatibility.dshReleases` 字段宿主根本不读**（gongyijie85 那份矩阵是无效的自建元数据）。
现成补丁：上游 issue #4 与 PR #5（把区间放到 `<=0.2.2`）**至今 open 未合并**。

**S0-2 本机宿主已被第三方补丁改写。** 本机 `@deepseek-ai/` 下有 **60 个 `*.dshpurge.bak`** 备份（dsh-system-prompt / dsh-settings / dsh-agent-loop / dsh-client-ui-conversation 等）。实例差异：`dsh-system-prompt/lib/index.js:230` 现行 `includeHarnessIdentity ?? false`，备份是 `?? true`。
→ 任何"在本机跑一遍看行为"的结论都不可直接外推为官方 0.2.2 语义。做兼容性验收必须用干净 profile 或对照 .bak 逐处 diff。

### S1 — 会造成静默错误行为

**S1-1 模式过滤不是围栏感知的（已实测复现）。** `filterSkillBodyForMode`（ponytail-instructions.ts:6）只有两条行首正则：`| **label** |` 与 `- label: "…"`，没有任何代码围栏状态机。

实测（复刻其正则后喂入夹具）。输入正文：

````md
| **lite** | terse |
| **full** | normal |
| **ultra** | maximal |

Example of the table syntax:
```
| **lite** | terse |
| **ultra** | maximal |
```
````

按 `lite` 过滤后输出：

````md
| **lite** | terse |

Example of the table syntax:
```
| **lite** | terse |
```
````

围栏块内的 `| **ultra** | maximal |` **被删掉了** —— 围栏内本应是字面量示例，被当成了规则表行。

**当前状态：潜伏未触发。** 实测 `grep -c '^```' skills/ponytail/SKILL.md` = **0**，上游 6 个技能正文里一个围栏块都没有，所以今天不发作。但 `config.skillDir` 是公开配置项（`render(skillDir, mode)` 显式接收），**任何把 skillDir 指向自带代码示例的正文就会踩中**。我们重写后的正文大概率带示例，这是接管后必须立刻修的缺陷。

对比 @maci0 的 `src/modes.ts`：显式维护 FENCE 状态机，注释写明"围栏内是字面量，围栏内的 mode 形状行是语法示例而不是规则表行"。

**这是本次审计中唯一一个"行为错误"级别的缺陷**，其余都是工程问题。

**S1-2 子智能体匹配器是空壳。** `ponytail.ts:403-427` 读 `PONYTAIL_SUBAGENT_MATCHER`、编译成正则、在子智能体创建时**只打一条 warn 日志**，从未用正则去抑制 section。也就是说：只要 agentPreset 存在，环境变量设成什么都无效果。
对照 @maci0 的 `isEligibleAgent(agent)` 是真判定（不匹配则 section 文本返回空串）。

**S1-3 热路径每轮读盘。** `render()` → `readFileSync(skillDir/ponytail/SKILL.md)`，而 `renderPromptSection` 是 section 的 `text` 回调，**每次组装 system prompt 都调用**。加上 `state.reloadDisabledSkills()`（另一个 readFileSync）与 `state.syncFromFile()`（又一次读盘），一次 prompt 组装至少 3 次同步文件读。
作者在 CONTEXT.md 里称"按需读盘 0.22ms"——单次数值可信，但**每轮 3 次 × 每次会话每步**，在高频多会话场景下是无收益的固定开销。且读盘失败会静默降级到 `getFallbackInstructions`（硬编码英文），用户看不到任何提示。

### S2 — 可维护性债

**S2-1 静默吞异常密度过高。** `grep -c catch`：ponytail-settings 17、ponytail.ts 12、ponytail-state 9、ponytail-skills 7、config/instructions 各 2。合计 49 处。
其中大量是 `catch { /* ignore */ }`（settings.ts:169/186/194/225/230/235 连续 6 个）。**这是最贵的债**：配置写失败、flag 读失败、自愈失败全部无声，用户只会看到"档位没变"，没有任何可诊断信息。

**S2-2 LRU 100 是错误的问题模型。** 官方有 `agent/disposed` 生命周期事件（@mengyuly 用了：`ctx.on('agent/disposed', ({agent}) => store.clear(sessionKey(agent)))`），按生命周期清理比按容量淘汰更精确，且不需要持久化 `session-states.json`。
上游把 100 个会话状态持久化到磁盘，制造了整个 `salvageConfig` / `repairJsonSyntax` / 正则抢救链（ponytail-state.ts:128-179 + settings.ts:243-296）。**这条链存在的原因是"持久化了不该持久化的东西"。**

**S2-3 重复导出。** `readSkillMeta` / `readSkillDescriptions` 在 `ponytail-skills.ts` 与 `ponytail-remote.ts` 各定义一次（remote 侧是纯委托的 shim）。作者注释说是"遵守单一真源"，但实际是转出层，增加了一层无信息的间接。

**S2-4 手搓 config 装配。** `apply()` 里为绕过 Schemastery 的 `.volatile()` 语义，手工逐字段重建 resolved Config，产生全仓仅有的 6 处 `as` 断言。

### S3 — 风格与可读性

- `ponytail.ts` 用 `(ctx as unknown as { skills: {...} })` 三重断言拿服务，而非从 `@deepseek-ai/dsh-skill` 导入类型。根因：npm 包**不发布 .d.ts**（`files` 写了 `lib/types/**/*.d.ts` 但目录不存在），插件作者只能靠手写类型。接管时应自己维护一份宿主类型 shim。
- `build-client.mjs` 用字符串模板拼 React 代码（`function PonytailConfigPanel(props)` 内联在 :380），无 JSX、无 TS 检查、无 IDE 补全。产物 `lib/client.js` 入库并进 `files`。

---

## 4. 真实资产（必须保留的部分）

### A1 零缓存破坏架构（ADR-0012）—— 全生态唯一

设计三层，逐层实测确认：

1. **baseline 锁**：`SessionModeState.baselineMode` 在会话诞生时锁定，**终身不变**。顶层 section 只渲染它（`renderPromptSection` :111-118）。因此同一会话内 system prompt 前缀逐字节恒定。
2. **尾部 reminder**：切档时不在前缀改字，而在 `agent/pre-step` waterfall 里给**最新轮次**追加 `<system-reminder>` 包裹的**完整 ladder 正文**（不是摘要），利用近因偏差当轮生效（`renderModeUpdate` :130-157）。
3. **单通知幂等**：`msgs.findIndex(m => m.source?.kind === 'ponytail-mode-update')` 定位旧通知**原地替换**，不累积（`ponytail-commands.ts:290-300`）。且仅在 `downstream.kind === 'enter'` 后才标记已发射（:280-285），避免空转轮浪费标记。

**为什么这条值钱**：section 的 order:50 位于 prompt 前段（作者估约第 200 token），任何字符变化会让其后全部工具声明 + 运行时上下文 + 历史 cache miss。所以其余 5 个实现（mac i0 / kb1sl / mengyuly / gongyijie / njuptlzf）**每切一次档就全量 prefill 一次**。上游是唯一不付这个代价的。

**代价诚实**：当轮多约 180 token（ladder 全文重复一遍）。这是可接受的。

### A2 零 tool 注册（ADR-0002）

`grep` 全仓确认：没有任何 `registerTool` / tool schema 注册。全部能力经 6 个 Skill 暴露。
对照 @maci0 直接注册 `ponytail` tool 让模型自切档——功能更强，但每轮多一份 tool schema，与缓存保护的初衷冲突。

**判断**：零 tool 应保留。模型自切档的收益（更聪明的自主性）远小于代价（常驻 schema + 破坏 tool 声明区稳定性）。

### A3 配置优先级诊断链（ponytail-priority.ts）

env > profile 补丁 > 内置兜底，恒 3 项，每项带 `hit` / `shadowed` / `problem`。纯函数零 I/O，最好测。
**这是"配置困惑"的唯一正确解法**——用户问"为什么我改了没用"时，面板能指出是哪一层盖住了。其余 5 个实现全都没有。

### A4 Schema 不给默认值

`defaultMode: Schema.union([...]).volatile()` 刻意不写 `.default()`。理由（注释原文）："Cordis 校验会把缺省 fill 成显式配置，补丁'配过/没配过'不可区分，诊断面板会说谎。"
**这是全仓最精细的一处工程设计**，接管时必须原样保留。

### A5 原子写 + 损坏自愈

`safeAtomicWriteFile`（:165）：mkdtemp 前缀 → 写 tmp（含 pid + Date.now + rand4）→ renameSync 原子替换 → Windows rename 失败降级为直接 writeFileSync。失败清 tmp 返回 false。
**这个函数本身应该保留**，但应该独立成包或独立模块，不该和 config salvage 挤在一个文件里。

### A6 行为测试的真实性

`scripts/behavior.test.mjs`：**113 个 test()、430 处 assert.***，`grep -c 'skip\|todo\|assert.ok(true)'` = **0**。无假测试。
覆盖：parsePonytailCommand 全分支、render 裁剪、Config schema 无默认值、state 归一去重、priority 三级链、provider 过滤、profile 隔离、崩溃自愈。
**局限**：全部是纯函数级单测，**没有一次真实 Cordis 组合测试**（没有 `new Context()` + `ctx.plugin()`）。这是相对 @maci0 `tests/composition.test.ts` 的明确差距。

---

## 5. 必须抛弃的包袱

| 包袱 | 位置 | 为什么该抛 |
|---|---|---|
| 配置自愈引擎（repairJsonSyntax + salvageConfig + backupCorruptedFile 三件套） | settings.ts:207-382，约 175 行 | 存在的唯一原因是"把会话状态持久化成了 JSON"。改用 `agent/disposed` 生命周期 + 不持久化会话状态，这 175 行整体消失 |
| `session-states.json` + LRU 100 | state.ts:203-380，约 180 行 | 同上。内存 Map + disposed 清理即可 |
| `.ponytail-active` flag 文件 | state.ts:104-110 | 单值状态，宿主 profile 补丁已经能承载；双通道（补丁 + flag）是 6 篇 ADR 的来源 |
| 手搓 resolved config + 6 处 as 断言 | ponytail.ts apply() | 改用 `ctx.inject(['settings'], cb)` 可选注入（@mengyuly 的写法更正统，效果等价但无断言） |
| 字符串模板生成 client.js | build-client.mjs 629 行 | 改用真实 .tsx + tsdown/esbuild（@NOirBRight 的做法），得到 TS 检查 + IDE 补全 + 可测组件 |
| lib/ 入库 | .gitignore | 与"源码级重构"目标冲突。发布走 prepublish 构建 + tarball 校验（@mengyuly check-bundle） |

---

## 6. 重构优先级（按 ROI 排序）

| 顺位 | 动作 | 收益 | 成本 |
|---|---|---|---|
| 1 | 放宽 `engines.dsh` 到 `>=0.2.0-rc.1 <0.3.0`，peer 同步放宽，配真实宿主矩阵 CI | 解决 S0-1，插件才装得上 | 低 |
| 2 | 模式过滤改围栏感知状态机 + 单测 | 解决唯一的行为错误 S1-1 | 低 |
| 3 | 会话状态改内存 + `agent/disposed` 清理，删掉持久化与自愈链 | 净删约 350 行 + 6 篇 ADR | 中 |
| 4 | 子智能体抑制做成真判定（对齐 @maci0 isEligibleAgent） | 解决 S1-2，环境变量从装饰变功能 | 低 |
| 5 | section 文本加进程内缓存（按 mode + mtime 失效） | 消除每轮 3 次读盘 | 低 |
| 6 | 补真实 Cordis 组合测试（`new Context()` + `ctx.plugin()` 断言 6 技能进出） | 补上最大测试缺口 | 低 |
| 7 | 客户端改真 .tsx + tsdown，产物不入库 | 得到类型安全 + 可测组件 | 中 |
| 8 | 加发行物纯度检查（外部依赖白名单 + 禁 `new Function`/`eval`） | 供应链可信度 | 低 |

---

## 7. 未核实项（诚实标注）

1. 上游 README 称"113 tests pass"——**已复核**：test() 计数为 113，无 skip/todo。
2. PR #5 正文声称 `dsh-skill` / `dsh-typert-protocol` 0.2.2 与 0.2.1-rc.2 逐字节相同、schemastery 3.19.0 与 3.18.4 逐字节相同——**未独立复核**。接管前必须自己跑 diff，否则兼容性声明无根据。
3. "order:50 位于约第 200 token 处"——作者估算，未实测。接管后应自己用真实 prompt 组装量一次。
4. 0.2.2 上 `TypertRemoteService` + `@Remote()` 装饰器仍存在（已在 dsh-action-cards / dsh-agent-preset-registry / dsh-api-account-controller 等多处确认），gateway 的 `Reflect.get(original, 'typertRemote')` 自动发现仍在 `dsh-api-gateway/lib/index.js:933/1268`——**但 upstream 注释里写的行号 706-719 已漂移**，证明这类"行号引用"是易腐化的注释。

---

## 8. 给接管项目的三条硬结论

1. **不要 fork。** 上游的目录结构（9 个平铺文件 + 18 篇 ADR）本身就承载着它要解决的历史包袱。fork 会把包袱继承下来，且与"源代码级重构"目标直接冲突。新仓库、按新模块边界重写，把 6 个 SKILL.md 原样搬过去即可。
2. **不要重写零缓存破坏。** ADR-0012 的三层设计经过 18 篇 ADR 迭代，且是唯一差异化资产。照抄设计，重写实现。
3. **不要保留配置自愈链。** 那是"持久化了不该持久化的东西"的补偿机制。删掉持久化，自愈链自然消失——这是本次重构最大的一笔净删除。
---

## 三、设计资产 vs 包袱

### 3.1 必须保留的设计资产（真知灼见）

以下 8 条经得起「换一个实现者、换一个宿主」的检验，属设计层而非实现层，重写时应作为约束写进新仓库的 `CONTEXT.md`。

| # | 资产 | 为什么是真知灼见 | 证据 |
|---|---|---|---|
| **A1** | **会话基线锁定（baselineMode 终身不变）** | 这是全仓最有价值的单个决策。`order: 50` 位于提示词最前端，任何字符级变化都会让其后数万 token 的历史前缀缓存全部失效。作者把「会话创建时原子捕获基线」与「运行中切档」彻底解耦：顶层 section 只读基线，切档走增量注入。这是**用架构约束消除一类性能故障**，而不是靠优化手段缓解。 | `ponytail-state.ts:362-365`（捕获）、`ponytail-instructions.ts:111-116`（只读基线）、`behavior.test.mjs:1851-1878`（逐字节相等的真断言） |
| **A2** | **单一注入点 + 零 Tool 注册** | 提示词只经 `systemPrompt.section('ponytail')` 一个出口，工具面为零。这把整个插件的可观测影响收敛到两处（一个 section、六条斜杠命令），使得「这个插件做了什么」可以被静态回答。绝大多数同类插件做不到。 | `ponytail.ts:369-374`、`ponytail.ts:74`、`verify.mjs:126-134` |
| **A3** | **`PonytailStorage` / `PonytailConfigSink` 双适配器模式** | 两个都有真实的两份实现（disk/memory、settings/file），不是为抽象而抽象。`createMemoryStorage` 让状态机成为可纯内存单测的对象——这是 ADR-0013/0016 自我批评后得到的真实收益。重写时必须保留「可替换持久化」这个接缝。 | `ponytail-state.ts:32-40/107-185/188-201`、`ponytail-settings.ts:51-62/84-149/488-509` |
| **A4** | **`resolvePriority` 纯函数 + 恒 3 项结构化诊断链** | 零 I/O、零依赖、输入输出完全可枚举。产出的 `hit`/`shadowed`/`problem` 三态把「配置为什么没生效」从猜测变成可读答案。这是本仓唯一「深模块 + 可测试性 + 用户价值」三者同时成立的模块。 | `ponytail-priority.ts:72-105`、`behavior.test.mjs:634-706` |
| **A5** | **`skills/change` 内禁止反向 `invalidate`** | 这条禁令是踩过坑换来的：宿主 `invalidateCache → notifyChange` 是同步广播且无防重入守卫，在事件处理器里反向触发会栈溢出。**知道「不能在哪做什么」比知道「该做什么」更难得**，这类知识必须原样继承。 | `ponytail.ts:280-286` 注释、ADR-0006 C5 否决记录 |
| **A6** | **Schema 刻意不给默认值** | `defaultMode`、`skillDescriptionLang` 不设 `.default()`，因为默认值会让「配过」与「没配过」不可区分，诊断面板随之说谎；语言字段靠三态（显式 zh / 显式 en / 未配置=auto）支撑「跟随宿主」。这是**可观测性驱动的 schema 设计**，反直觉但正确。 | `ponytail.ts:50-66`、`ponytail-config.ts:200-204`、ADR-0011 |
| **A7** | **`createTurnCoordinator` 把轮次生命周期收成一个对象** | ADR-0013 自曝 90+ 行胶水泄露在入口后做的重构，把「解析命令 → 穿透 waterfall → 变动检测 → 通知构造」收成一个可单独构造的对象。方向正确、边界清晰，是四个「后补接缝」中最成功的一个。 | `ponytail-commands.ts:253-331` |
| **A8** | **`whileServed` 配对注册 + `ctx.effect` 归还 disposer** | 客户端把 `configForms.whileServed` 与 `slots.inject` 嵌套成「服务就绪才注册」，并用 `ctx.effect` 归还 disposer。ADR-0009 记录过一段惨痛教训（「40 次×50ms 重试掩盖的是压根没挂载」），这条配对模式是那次事故的产物。 | `build-client.mjs:609-618`、ADR-0009 |

**次级资产（有价值但需重写适配）**：`salvageConfig` 的双阶抢救思路（先补 JSON、再正则提取字段）、`Object.create(null)` 防原型污染、`createSettingsSink` 包装官方 `mutate(ns, ops, revision)` 而不是自己造 HTTP 端点、`locale.register` + `bind` 走官方 i18n、`build-client.mjs` 单点生成产物、5 层嵌套的 `.catch` 分层（命令层 warn、状态层 best-effort、渲染层回退内置文本）——最后这一条虽被本文批评过度，但「每层各自决定失败语义」的分层意识是对的。

### 3.2 必须抛弃的包袱

| # | 包袱 | 为什么必须抛弃 | 证据 |
|---|---|---|---|
| **P1** | **配置自愈引擎（`salvageConfig` + `repairJsonSyntax` + `backupCorruptedFile` + 原地重写）** | 这是全仓最典型的过度设计，且**它自己引入的风险高于它防范的风险**：正则解析 JSON 会误伤字符串值（`settings.ts:247`）、未闭合数组贪婪到文件尾（`:337-346`）、读函数带写副作用（`:397-433`）、多会话并发重写互相覆盖。它防范的场景（JSON 被掉电截断）本身已被 A2 之外的写路径覆盖不到——作者自己都说「从物理底层彻底消灭」。正确做法：**写盘要么成功要么报错，读盘失败就备份 + 重置为默认 + 明确告知用户**。抢救半份配置的收益远小于「用户以为自己配好了但其实没配」的代价。 | `ponytail-settings.ts:243-379`、`ponytail-state.ts:128-180` |
| **P2** | **三套并存的默认档解析** | `resolvePriority`（env>patch>fallback）与 `getDefaultMode`（env>file>full）语义不同源，同时存活；命令层用后者、UI 用前者。ADR-0006 自曝、ADR-0009 声称收敛、`ponytail.ts:222` 注释写「此处一并修复」——**两次宣布收敛但两条都在**。这是「文档宣称已解决」与「代码实际未解决」之间落差最大的地方。 | `ponytail-config.ts:106-123` vs `ponytail-priority.ts:72-105`；`ponytail-commands.ts:153` |
| **P3** | **双写 flag 与双权威（`syncFromFile` 文件赢 / `syncToFile` 内存赢）** | 同一进程对同一文件施加相反权威，胜者靠调用时机。这是「状态对偶性」这个漂亮名字掩盖的真实竞态。会话级状态已由 `session-states.json` 承载（`baselineMode`/`effectiveMode`/`explicitlySet` 三字段齐备），flag 文件是历史遗留的第二真源，必须删除或降级为「无会话上下文时的只读默认」。 | `ponytail-instructions.ts:106` vs `ponytail.ts:430-434`；`ponytail-state.ts:289-324` |
| **P4** | **按文本形状猜结构裁剪提示词（`filterSkillBodyForMode`）** | 用两个正则去识别 Markdown 表格与列表的「模式标签」，依赖上游英文正文的具体排版。上游是外部真源（README 明说「正文取自上游原样保留」），上游改一个字即静默失效。**结构性信息必须由结构承载**，不能由正则猜。重写应改为显式分档文件（`SKILL.lite.md` 等）或显式标记区块。 | `ponytail-instructions.ts:6-26`、`skills/ponytail/SKILL.md:77-83` |
| **P5** | **静态文本门禁（`verify.mjs` 的 22 条 officialConfigChecks + 正则反向断言）** | 它属于 `prepublishOnly`，等于**发布门禁由字符串匹配决定**：重排代码不改行为会假红，保留特征串会假绿。它还给未来维护者植入「改实现必须先改正则」的错误激励。真正该断言的行为（原子写、优先级、waterfall 不断链）一条都没断言。重写时保留**目录结构/存在性**检查（`verify.mjs:11-26`、`:93-122`），删掉所有源码文本正则。 | `verify.mjs:225-255`、`:156-164`、`:209-215` |
| **P6** | **`FALLBACK_DESCRIPTION` 硬编码 12 条描述 + 三处元数据真源** | 与 CONTEXT 自己立的不变量直接冲突（「任何模块不得再硬编码技能描述」），且 verify 的反向断言恰好只扫 `build-client.mjs`，让 `src/` 的硬编码完美逃检。同时 `readSkillMeta` 完全不读 frontmatter，使「frontmatter 是唯一真源」成为纯文档。三处真源（frontmatter / descriptions.json / 硬编码表）必须收敛到一处。 | `ponytail-skills.ts:31-48`、`:81-89`、`:348`、`:389` |
| **P7** | **`ponytail-remote.ts` 的转发层 + `ponytail-commands.ts:227` 的重导出** | ADR-0015/0018 为「保留导出形状」而留下的纯噪声（Middle Man）。零逻辑转发不提供任何信息隐藏，只增加一个改代码时要同步维护的位置。 | `ponytail-remote.ts:35-45`、`ponytail-commands.ts:227` |
| **P8** | **`isShellSafe` 整套「Shell 安全」叙事** | 没有 shell 调用面，白名单唯一消费者是一条 warn 日志，且白名单本身放行空格与冒号。这是**用安全叙事给非安全代码贴标签**，比不做更糟——它让审阅者以为这里有防护。 | `ponytail-config.ts:41-43`、`ponytail.ts:256-258` |
| **P9** | **`PONYTAIL_SUBAGENT_MATCHER` 用户正则** | 唯一消费者是一行 debug 日志，却引入 ReDoS 面。装饰性功能换取真实攻击面，性价比为负。 | `ponytail.ts:404-413`、`:425-429` |
| **P10** | **`config <-> settings` 双向静态 import** | 真 ESM 环，当前靠「只在函数内调用」侥幸不爆。重写的模块分层必须从「基础符号层（路径/常量/归一化）→ 存储层 → 领域层 → 编排层」单向依赖，`normalizeMode`/`DEFAULT_MODE`/`getConfigPath` 下沉到最底层。 | `ponytail-config.ts:22-27` ↔ `ponytail-settings.ts:29-35` |
| **P11** | **`safeAtomicWriteFile` 的「原子」神话** | rename 失败回退直写、无 fsync、返回值全丢。要么做真原子（tmp + fsync + rename + 失败抛出），要么别叫「崩溃安全」。名字撒谎比实现不够好更有害。 | `ponytail-settings.ts:165-199` |
| **P12** | **`engines.dsh` 字段 + 自实现 semver 断言** | 非 npm 标准键，安装期零校验，纯装饰；配套的 `parseSemVer`/`compareSemVer`/`hostSatisfiesRange`（`behavior.test.mjs:2390-2494`）绕开 npm 真实解析器自定兼容语义。用 `peerDependencies` + 运行期版本探测替代。 | `package.json:94-97`、`behavior.test.mjs:2390-2494` |

### 3.3 判断「哪些是真缝隙」的判据（供后续复用）

本次审计反复用到的三条判据，建议写进我们自己的 `codebase-design` 实践：

1. **接缝必须有两份真实实现，且两份都被生产或测试实际使用。** 只有一份实现的「接口」不叫接缝，叫间接层。`PonytailStorage` 合格（memory 版本被 111 个测试用着），`PonytailRemote` 的转发不合格（两份实现都没有）。
2. **接缝的接口必须闭合。** 可选方法（`readSessions?`/`writeSessions?`）把「实现细节」泄露给每个调用方，调用方被迫写 `typeof === 'function'`——这是「深模块」的反面。
3. **宣称的保证必须在代码里能指出一行。** 「原子」要能指出锁或 CAS 或 fsync；「单一真源」要能指出真源那一行的读取，「唯一真源」而其他地方还有一份读取就是假的；「防注入」要能指出 shell 调用面。**指不出那一行，就只是命名。**

---

## 四、对我们重构的直接建议

### 4.1 目标架构（4 层，单向依赖）

```
L0  基础层   paths.ts        路径解析、DEFAULT_MODE、coerceMode(raw): RuntimeMode | null
                ↑ 无依赖，纯函数，零 I/O
L1  适配层   storage.ts      PonytailStorage（disk | memory）——闭合接口，三个必选方法 + 独立的 sessions 子接口
             sink.ts         PonytailConfigSink（settings | file）——写入返回 Promise<void>，失败抛出
             ↑ 只依赖 L0，禁止互相 import
L2  领域层   state.ts        会话表（唯一真源）、transition 消费
             priority.ts     resolvePriority（纯函数，唯一优先级链）
             prompt.ts       renderSection / renderUpdate（唯一提示词出口）
             skills.ts       PonytailProvider（含 skillDir 越权防护）
             ↑ 只依赖 L0/L1，彼此单向：state ← prompt，state ← skills
L3  编排层   plugin.ts       apply：注册 section / provider / 事件 / remote
             coordinator.ts  轮次生命周期
             ↑ 只依赖 L0/L1/L2
```

关键约束：**L1 不得 import L2；L2 内部不得出现双向 import**。`coerceMode` 是 L0 唯一入口，所有写模式的地方都过它（消除 M-09 的垃圾态）。

### 4.2 逐项取舍表（先做什么）

| 优先级 | 动作 | 对应缺陷 | 理由 |
|---|---|---|---|
| **P0** | `get()` 加 `skillDir` 前缀校验；`list()` 拒符号链接 | B-01 | 唯一「越权读任意文件并喂进模型上下文」的通道，成本低、收益确定 |
| **P0** | 客户端 `applyOps` 加 `.catch/.finally`；`busy` 改三态 | B-03 | 一行级修复，消除面板永久卡死 |
| **P0** | `write()` catch 里回滚 mirror + 重建 revision；`readXxx` 按需 describe | B-02 | 决定「配置到底有没有生效」的正确性 |
| **P1** | 删 `getDefaultMode`，命令层只吃 `resolvePriority().effective` | P2/M-08 | 消除文档与实现的第二次落差 |
| **P1** | 删 flag 双向权威：`.ponytail-active` 只读或删除，会话表为唯一真源 | P3/H-01 | 消除同进程竞态 |
| **P1** | 三处写入口统一过 `coerceMode` | M-09 | 一处修改消除三个逃逸点 |
| **P1** | 删除 `salvageConfig` 的正则救援，改为「备份 + 重置 + 告知」 | P1/M-04/M-05 | 减少代码量、消除读路径副作用与并发重写 |
| **P1** | `safeAtomicWriteFile` 去回退、加 fsync、失败抛出 | P11/H-02 | 要么真做，要么不叫这个名字 |
| **P2** | 打散 config↔settings 环，按 4.1 分层 | P10/M-07 | 结构性问题，越晚改成本越高 |
| **P2** | 提示词裁剪改显式分档文件 | P4/H-06 | 断开对上游排版形状的隐式依赖 |
| **P2** | 技能描述收敛到一处（推荐 `descriptions.json` 为唯一真源，删 `FALLBACK_DESCRIPTION`） | P6 | 与 README 的既有说法一致，成本最低 |
| **P2** | 删 `verify.mjs` 的源码正则、`isShellSafe`、`PONYTAIL_SUBAGENT_MATCHER`、两个转发/重导出、双写通道 | P5/P7/P8/P9/M-11 | 净删代码，同时消除 3 个 false-positive 门禁 |
| **P3** | `list()` 内 `descriptions()` 提到循环外 | H-03 | 一行级优化 |

### 4.3 测试策略（保留什么、补什么）

**原样迁移（这些断言已经证明过自己的价值）**：

- 零缓存逐字节相等（`behavior.test.mjs:1851-1878`）——重写后必须仍然通过，它是 A1 的守门人。
- 跨进程基线恢复（`:2041-2061`）、LRU 上限（`:1953-1977`）、`explicitlySet` 保护（`:1979-1999`）、幂等（`:1880-1918`）。
- 客户端接线桩（`:1307-1405`）与 `CardController` 的 `node:vm` 脱机测试（`:2232-2287`）——**这个模式值得抄**：不用 jsdom、不引 React 测试库，纯 Node 就能验纯函数，成本极低。

**必须新增（当前 6 个盲区）**：

| 用例 | 怎么测 | 防的是 |
|---|---|---|
| skill 越权 | 构造 `locator.path = '/tmp/x/SKILL.md'` 与指向 `skillDir` 外的符号链接，断言 `get()` 返回 `undefined` | B-01 回归 |
| 并发写会话表 | 两个 `createPonytailState` 共享同一 profileDir，交替 `setSessionMode`，断言最终值一致或明确检测到冲突 | H-04 |
| 原子写失败 | mock `renameSync` 抛错，断言函数返回失败且**目标文件内容未被破坏** | H-02/P11 |
| settings revision 冲突 | mock `mutate` 首次 reject，断言 mirror 回滚且后续写入用新 revision | B-02 |
| waterfall 下游抛错 | `next()` reject，断言异常向上传播而非被吞、且 section 状态未被污染 | M-10 同源 |
| 提示词裁剪 | 断言「lite 档渲染结果不含 ultra 段」的**行为**断言，而非文本形状 | H-06 |

**断言的度量口径**：新增用例一律禁止「读源码字符串做断言」。需要验证「没有 HTTP 端点」这类结构性事实时，改为在运行时检查 `ctx` 上是否注册了路由（有则失败），而不是 grep 源码。

### 4.4 文档纪律（这是本次审计最想留下的教训）

上游 18 篇 ADR 的自曝文化是**罕见且值得继承**的资产——ADR-0006/0007/0013/0014/0015/0016/0017/0018 每一篇都在列举自己的缺陷，这是极高水准的工程自省。但审计发现一个系统性偏差：**ADR 记录「决策已做」，`CONTEXT.md` 记录「不变量已成立」，而代码停在「部分实现」**。三次「声称收敛」全部未收敛（优先级、自愈内核、单一真源）。

因此我们的文档纪律建议：

1. **`CONTEXT.md` 的每条不变量必须附一个「验证位置」列**：指向一个具体的测试名或一个 `file:line`。指不出来的不变量不许写进去。
2. **ADR 的状态字段只允许三种值**：`proposed` / `implemented` / `superseded`。作者已经用了 `修订` 记录，但没有机械可查的状态位，导致「声称已收敛」长期无人核对。
3. **禁止用形容词做保证**（「彻底消灭」「100%」「确保免受」）。凡是写下的强断言，必须同段给出测量方式或指向测量代码。本次审计的 12 条「名不副实」里，有 8 条源于这类不可验证的强断言。

---

## 附录：审计覆盖范围

| 材料 | 行数/规模 | 读法 |
|---|---|---|
| `src/*.ts` | 9 文件 2709 行 | 逐行全读 |
| `scripts/behavior.test.mjs` | 2496 行 / 111 `test()` | 逐节扫读 + 抽查断言强度 |
| `scripts/verify.mjs` | 296 行 / 13 个检查段 | 逐行全读 |
| `scripts/build-client.mjs` + `lib/client.js` | 629 行 → 569 行产物 | 逐行全读 |
| `skills/*/SKILL.md` | 6 篇 393 行 | 逐篇全读 |
| `docs/adr/*.md` | 18 篇 | 逐篇读决策与自曝段 |
| `CONTEXT.md` / `README.zh-CN.md` / `package.json` / `tsconfig.json` / `cordis.patch.yml` / `locale/*.json` | — | 全文 |
| 未覆盖 | `assets/*.svg`、`CHANGELOG.md` 细节、`docs-verify.mjs`/`bump-dsh.mjs`/`version.mjs` 三个次要脚本、`lib/*.js` 与 `src` 的逐行一致性（仅抽查） | — |

未运行上游测试套件：`/tmp/dsh-ponytail-upstream` 无 `node_modules`（依赖未安装），本审计为纯静态阅读 + 引用既有断言。所有「断言强度」判断基于测试源码本身，不依赖运行结果。