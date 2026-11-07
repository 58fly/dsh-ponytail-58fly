# 上游源码级质量审计：@wenaixi/dsh-ponytail 5.6.2（机制层）

> **本目录三份材料的关系**
> - `upstream-ponytail-source-audit.md`（本文）：机制层源码审计，逐条把 `CONTEXT.md` 的宣称与代码对照，缺陷按 blocker/high/medium/low 分级并给 `file:line`。
> - `_peer-report-backup.md`：同工作区另一份独立审计（侧重生体量、生态位与分发层），两份在三处结论上分歧，见本文第六章。
> - `ponytail-plugin-landscape.md`：六个 DSH 移植的横向对比（非本次审计产出，本文引用其两条宿主层实测）。

> 对象：`/tmp/dsh-ponytail-upstream`（github.com/Wenaixi/dsh-ponytail，commit `7223820`，v5.6.2，MIT，作者已停止维护）。
> 方法：`src/*.ts` 9 文件 2709 行逐行全读；`scripts/behavior.test.mjs` 2496 行（111 个 `test()`）、`scripts/verify.mjs` 296 行、`scripts/build-client.mjs` 629 行循行读；6 篇 `skills/*/SKILL.md`、18 篇 `docs/adr/*.md`、`CONTEXT.md`、`README.zh-CN.md`、`package.json`、`locale/*.json` 全文。
> 全文 `file:line` 均可回到上游副本核对；未运行测试套件（上游无 `node_modules`），「断言强度」判断基于测试源码本身。
> 与同目录的生态对比报告互补：那篇回答「在六个移植里排第几」，这篇回答「代码本身哪里假、哪里真」。

## 摘要

工程纪律远高于代码质量：零 any、111 项测试、18 篇自曝 ADR、零 Tool 注册、会话基线锁定都是真资产。但 CONTEXT 六条不变量四条被源码证伪（frontmatter 真源、原子写、Shell 安全、优先级真源），「原子事务」只是换名。三个 blocker：技能读取越权、settings revision 冲突后永久静默失效、面板永久卡死。**架构可继承，实现应重写**。

---

## 一、架构验证：宣称 vs 代码

### 1.1 十二条不变量逐条核对

| # | 宣称（出处） | 判定 | 证据 |
|---|---|---|---|
| 1 | 零 Tool 注册（CONTEXT L118，ADR-0002） | ✅ 成立 | 全仓无 `tools.register` / `defineTool`；`scripts/verify.mjs:126-134` 用正则把它变成发布门禁 |
| 2 | 提示词只能经 `ctx.systemPrompt.section` 注入（CONTEXT L118） | ✅ 成立 | 唯一注册点 `src/ponytail.ts:369-374`；全局仅此一处 `section(` |
| 3 | 无状态直读，0.22ms（CONTEXT L120，ADR-0003） | ❌ 数值失真 | 一次 `systemPrompt` 组装至少 3 次同步 I/O：`src/ponytail-instructions.ts:102`（`reloadDisabledSkills` → 读 `config.json`）、`:106`（`syncFromFile` → 读 flag）、`:84`（`readFileSync(SKILL.md)`）。ADR-0003 只计了第 3 项 |
| 4 | Crash-Safe Atomic Write，「从物理底层彻底消灭掉电截断与 0 字节坏文件」（CONTEXT L45-47，ADR-0017） | ❌ 名不副实 | `src/ponytail-settings.ts:165-199`：`renameSync` 失败后 `:182-183` 直接 `writeFileSync(filePath)`——正是它宣称消灭的截断路径；全程无 `fsync`；随机后缀仅 4 字符（同毫秒同 pid 可撞名）；返回 `boolean` 但 6 处调用点有 5 处丢弃（`state.ts:119/143/172/182`、`settings.ts:430/466`） |
| 5 | Shell Safe Path 白名单「确保免受 Shell 元字符注入」（CONTEXT L51-53） | ❌ 名不副实 | `src/ponytail-config.ts:41-43` 的正则确实存在，但全仓 0 处 `exec` / `spawn` / `execFile`，唯一消费者是 `src/ponytail.ts:256-258` 一条 `warn`。且白名单放行空格、冒号、波浪号，对真实 shell 场景也不安全——这是给非安全代码贴安全标签 |
| 6 | 技能名称与描述一律以 `SKILL.md` frontmatter 为唯一真源，「任何模块不得再硬编码技能描述」（CONTEXT L77-79） | ❌ 名不副实 | `src/ponytail-skills.ts:31-48` 硬编码 12 条中英描述（`FALLBACK_DESCRIPTION`）；`:81-89` `readSkillMeta` 的取值顺序是 `descriptions.json > 硬编码 > id`，完全不读 frontmatter；`scripts/verify.mjs:209-215` 的反向断言只扫 `build-client.mjs`，`src/` 的硬编码完美逃检。`README.zh-CN.md:73` 反而写对了（真源是 `descriptions.{zh,en}.json`） |
| 7 | `resolvePriority` 是优先级唯一真源，config.json 层已退役（CONTEXT L128-144，ADR-0006/0009） | ❌ 名不副实 | `src/ponytail-config.ts:106-123` 的 `getDefaultMode`（env > config.json > full）仍存活，且被 `src/ponytail-commands.ts:153` 当 fallback 用。两条路径语义不同源。`src/ponytail.ts:222` 注释自称「此处一并修复」——第二次宣布收敛仍未收敛 |
| 8 | Session Transition Atomicity：一次性原子完成比对 / 发射标记落盘 / 通知构造（CONTEXT L33-35，ADR-0016） | ⚠️ 换名 | `src/ponytail-state.ts:389-408` 是四次同步调用顺序执行，无锁、无版本号、无 CAS、无回滚。「原子」= 同一个函数里写完四步。`behavior.test.mjs:2207-2230` 的 C31 也只断言 `changed` 布尔，未做任何并发或重试模拟 |
| 9 | 配置自愈引擎：语法修补 + 正则多阶提取 + 留样 + 原地重写（CONTEXT L41-43，ADR-0017/0018） | ⚠️ 部分成立 | 确实共享了 `repairJsonSyntax` / `backupCorruptedFile` 两个纯函数（ADR-0018 的收敛），但控制流仍是两套：`settings.ts:296-379` 与 `state.ts:128-180` 各自编排；且读函数带写副作用（`settings.ts:397-433` 在 `readDiskConfig` 里原地重写），被 `createFileSink`（`:488-509`）每次调用触发 |
| 10 | CardController 无 DOM 依赖、可纯 Node 脱机单测（CONTEXT L37-39，ADR-0016） | ✅ 成立 | `scripts/build-client.mjs:164-219` 六个静态方法纯数据转换；`behavior.test.mjs:2232-2287` 用 `node:vm` 加 `window.__ModuleLoader__` 桩加载产物直接测，无需 jsdom |
| 11 | Dual-Face 插件，客户端产物由脚本单点生成（CONTEXT L69-70） | ✅ 成立 | `build-client.mjs:628` 是唯一写 `lib/client.js` 的地方；`package.json` 的 `exports` 子路径 `./client` 指向它；`tsconfig` 的 `rootDir: src` 保证 tsc 不会产出同名文件 |
| 12 | Waterfall 中间件无论成败必须 `await next()`（CONTEXT L94-96） | ✅ 成立 | `src/ponytail-commands.ts:270` 的 `const decision = await next()`，且 `:271-273` 非 `enter` 轮次原样返回。异常路径也有保障：`:261-267` 的 `dispatchMessages` 在 `next()` 之前被 try/catch 包裹，不会因命令解析失败而断链 |

**小计：12 条宣称中 5 条成立、1 条换名、2 条部分成立或数值失真、4 条被证伪。**被证伪或失真的那几条，恰好是最容易被当成「安全 / 正确性保证」对外引用的几条。

### 1.2 真接缝 vs 换名

**真接缝（有两份真实实现，且两份都被生产或测试实际使用）**

| 接缝 | 双实现 | 谁在用 |
|---|---|---|
| `PonytailStorage` | `createDiskStorage`（`state.ts:107-185`）/ `createMemoryStorage`（`:188-201`） | 生产用 disk；测试大量用 memory，状态机因此可纯内存隔离 |
| `PonytailConfigSink` | `createSettingsSink`（`settings.ts:84-149`）/ `createFileSink`（`:488-509`） | `ponytail.ts:116-126` 用 try/catch 做能力探测二选一（异常控制流不优雅，但两份都是真的） |
| `renderPromptSection` | 单出口，无分叉 | `ponytail.ts:373` 是唯一调用点；`review` 与 `off` 在内部短路 |
| `resolvePriority` | 纯函数，输入即全部依赖 | `ponytail.ts:236/350/379` 三处调用，`behavior.test.mjs:634-706` 八项覆盖 |

**只是换名（改名不改变依赖结构）**

| 号称的抽象 | 实际 | 证据 |
|---|---|---|
| `ponytail-remote.ts` 是「传输层接缝」 | 两个零逻辑转发：`readSkillMeta` → `loadSkillMeta`、`readSkillDescriptions` → `loadSkillDescriptions`。没有一个字节的信息隐藏 | `remote.ts:35-45` |
| `commands.ts:227` 的 `resolveSessionId` 重导出是「向前兼容」 | 纯 re-export；`behavior.test.mjs:2371-2388` 专门断言「恒等」，等于把噪声写成契约 | `commands.ts:227` |
| `sink` 与 `writeDefaultMode` 是「双通道」 | `ponytail.ts:386/390` 同时注入，`commands.ts:153-156` 里 `env.sink` 优先，`writeDefaultMode` 是死参数 | `commands.ts:154-156` |
| `readService(ctx, name)` 是「能力探测」 | 用 `try { ctx[name] } catch {}` 绕过 cordis 的 `inject` 检查，读的是未声明注入的服务属性；这是对宿主 Proxy 抛错行为的隐式依赖，注释自己承认「读未 inject 的属性会抛」 | `ponytail.ts:89-106` |
| `PonytailStorage` 是闭合接口 | `readSessions?` / `writeSessions?` 两个方法可选，调用方每次要 `typeof === 'function'` 判断——实现细节漏给每个调用方 | `state.ts:32-40`、`:214`、`:229` |

### 1.3 依赖方向

存在一组真实的 ESM 循环依赖：`src/ponytail-config.ts:22-27` 从 settings 导入 4 个符号，`src/ponytail-settings.ts:29-35` 从 config 导入 3 个符号。当前未爆的原因是两边都只在函数体内调用（无顶层求值），属于侥幸而非设计。

另一组在 ADR-0015 里被作者自曝：`ponytail-skills.ts` 反向 import `ponytail-remote.js`。处理方式（把领域事实收敛到 skills、让 remote 退回纯 RPC）方向对了，但保留两个转发函数（见 1.2）把接缝又变回了间接层。

层级泄漏的典型是 `ponytail.ts`：编排层直接 `new RegExp(process.env['PONYTAIL_SUBAGENT_MATCHER'], 'i')`（`:408`）、直接 `state.set(...)`（`:248`）、直接 `readPatchMode()`（`:232-235`）。入口文件承担配置解析、服务探测、模块装配、事件注册、快照构造五类职责，450 行里没有一行是只属于入口的。

---

## 二、缺陷清单

分级口径：**blocker** = 造成越权/数据不可信/功能永久不可用；**high** = 静默错误行为或确定性性能/安全面；**medium** = 类型与结构缺陷，会在演进中放大；**low** = 局部噪声与文档失真。

### 2.1 blocker

| ID | 位置 | 证据 | 影响 | 修法 |
|---|---|---|---|---|
| **B-01** 技能读取越权 | `src/ponytail-skills.ts:372-403`（`get()`）、`:331-334`（`list()`） | `:378` 的 `targetPath = locatorObj?.path ?? candidate.path` 直接交给 `parseSkillFile` 读文件，**无「必须落在 skillDir 内」校验**；`:333` 的 `list()` 把 `isSymbolicLink()` 与 `isDirectory()` 并列放行 | 任何以 `---` 开头的文件（含任意路径、含指向 skillDir 外的符号链接）其 frontmatter 之后的正文会被当作 skill content 交给模型；`get()` 的 `candidate` 来自宿主/其他插件，输入未校验 | 解析 `resolve(targetPath)` 后断言 `startsWith(resolve(skillDir) + sep)`；`list()` 拒绝符号链接或用 `realpath` 后再校验；`locator.directory` 同样校验 |
| **B-02** settings 写通道永久静默失效 | `src/ponytail-settings.ts:84-149`（`createSettingsSink`）、`:107-122`（`write`） | `:109` 先 `mirror = applyOps(mirror, ops)` 乐观更新，`:110-121` `void service.mutate(...).then(...).catch(warn)` fire-and-forget；本模块**没有任何 re-describe 路径**（`:97-105` 的 `describe()` 只在工厂函数里跑一次） | 一旦 `mutate` 因 revision 冲突被拒，`mirror` 永久停在乐观值，之后每次写入都带陈旧 revision，进入「持续失败 + 只打 warn」的静默循环。用户看到面板显示已保存，实际 Profile 补丁从未落盘 | `write` 返回 `Promise`，失败时回滚 `mirror` 并重新 `describe()` 取真值；或改成乐观更新前先取 revision、失败重试一次 |
| **B-03** 客户端面板永久卡死 | `scripts/build-client.mjs:396-409`（`applyOps`） | `setBusy(true)` → `props.mutate(...).then(landed => { setBusy(false); ... })`，**没有 `.catch` / `.finally`** | `mutate` reject（网络/权限/revision 冲突被拒）时 `busy` 永久为 `true`：所有控件 `disabled`，面板再也不能操作，且无任何错误提示。这正是作者在 ADR-0006 里批评过的「界面卡住」同类缺陷 | 加 `.catch(err => setNote(t('error.operation')))` 与 `.finally(() => setBusy(false))`；`busy` 改三态（idle/pending/failed） |

### 2.2 high

| ID | 位置 | 证据 | 影响 | 修法 |
|---|---|---|---|---|
| **H-01** flag 双向权威竞态 | `src/ponytail-instructions.ts:106` vs `src/ponytail.ts:430-434` | 前者每轮 `state.syncFromFile()`（**文件赢**：flag 缺失即清空内存）；后者在 `agent/created` 且 `source` 为 `startup`/`resume` 时 `state.syncToFile()`（**内存赢**：用内存覆盖文件） | 同进程对同一文件施加相反权威，胜者由调用时机决定；多会话并存时后启动的会话会覆盖其他会话刚做的切换。ADR-0009 只解决了跨 profile 的覆盖，同 profile 内多会话仍共享一个 flag | 删除 flag（会话级状态已由 `session-states.json` 的 `baselineMode`/`effectiveMode`/`explicitlySet` 承载），或降级为「无会话上下文时的只读默认」 |
| **H-02** 「原子写」三重缺陷 | `src/ponytail-settings.ts:165-199` | `:182-183` rename 失败回退 `writeFileSync(filePath)`；无 `fsync`；返回值被 5/6 处调用点丢弃（`state.ts:119/143/172/182`、`settings.ts:430/466`） | 掉电仍可能 0 字节或半截文件；失败无人知晓；Windows 上回退路径恰好是它宣称消灭的那条路径 | tmp 写入后 `fsyncSync(fd)`，再 `renameSync`；失败必须抛出或返回 `Result`，调用点一律处理 |
| **H-03** `list()` 循环内重复读同一 JSON | `src/ponytail-skills.ts:341`、`:297-299` | `list()` 对每个条目调一次 `this.descriptions()`，后者每次 `readSkillDescriptions()` 同步读 `descriptions.<lang>.json` | 6 个技能 = 6 次读同一个文件；叠加 `:344` 每个条目一次 `getDescriptionLang()` → `effectiveSkillLang()` → 可能 `svc.describe()`（宿主全量快照） | `descriptions()` 加一次调用级缓存（`list()` 开头取一次传入） |
| **H-04** 会话表全量重写、无锁 | `src/ponytail-state.ts:223-235`（`savePersistedSessions`）、`:375`、`:386`、`:396`、`:422` | 每次 `setSessionMode` / `markSessionEmitted` / `consumeSessionTransition` / `syncGlobalModeToSessions` 都 `JSON.stringify` 整张 Map（上限 100 项）后全量写盘；`consumeSessionTransition` 在每轮 `pre-step` 都被调用 | 每轮一次百项 JSON 序列化 + 写盘；多会话并发读改写无锁，后写覆盖先写（`session-states.json` 丢更新） | 只在变更时写；按会话分文件或改用宿主 `agent/disposed` 生命周期清理内存 Map（见 3.2 P2）；写入带版本号或 mtime 校验 |
| **H-05** 用户可控正则（ReDoS 面） | `src/ponytail.ts:404-413`、`:425-429` | `new RegExp(process.env['PONYTAIL_SUBAGENT_MATCHER'], 'i')` 无长度上限、无复杂度检查 | 环境变量写 `(a+)+$` 这类模式即可让每次 agent 创建时的匹配卡死；而**该正则的唯一消费者是一行 debug 日志**（`:425-429` 只 `logger.debug`），从未用于抑制 section | 删除；若确需匹配，改用字面量 `includes` 或加长度上限 + 超时 |
| **H-06** 按文本形状猜结构裁剪提示词 | `src/ponytail-instructions.ts:6-26` | `:12` 表格行正则 `/^\|\s*\*\*(.+?)\*\*\s*\|/`、`:18` 列表行 `/^-\s*([^:]+)(?:：|:)\s*["「]/`，靠「行的形状」判断模式标签 | 结构性信息由正则猜：上游改排版、正文出现示例表格（`skills/ponytail/SKILL.md:77-83` 的 `| **lite** |` 正是被依赖的形状）、或代码块内含同样形状的行，都会静默误删/误留。且该函数**零测试** | 改显式分档（`SKILL.lite.md` / `SKILL.full.md` / `SKILL.ultra.md`）或显式标记区块（`<!-- ponytail:lite -->`），把结构交给结构 |
| **H-07** 自愈引擎读路径带写副作用 | `src/ponytail-settings.ts:397-433`（`readDiskConfig`）、`:488-509`（`createFileSink`） | 破损时 `:419` salvage → `:422` backup → `:425-430` **原地重写**；而 `createFileSink` 的 `readDefaultMode` / `readDisabled` 每次调用都走 `readDiskConfig` | 一个「读」函数会写盘；并发读破损文件时多进程同时重写、后写覆盖；`readDiskConfig` 被 `renderPromptSection` 的 `:102` 每轮触发 | 读路径不写；自愈显式化为独立命令/启动阶段一次性修复 |

### 2.3 medium

| ID | 位置 | 证据 | 修法 |
|---|---|---|---|
| **M-01** 非空断言 | `src/ponytail-commands.ts:154-156`（`env.sink!` ×2）、`src/ponytail-skills.ts:348`、`:389`（`readString(...)!`） | `env.sink!` 靠三元短路兜住，`readString` 的 `!` 直接断言「一定有 description」，`assembleSkillBase` 已在 `:242-245` 抛过但这里仍断言 | 用局部 `const` 收窄 + 显式抛错；`readString` 返回 `string | undefined` 后由调用点决定 |
| **M-02** 类型逃逸 | 72 处 `as`：`ponytail.ts` 22、`settings.ts` 14、`config.ts` 13、`commands.ts` 10、`skills.ts` 8、`state.ts` 2、`remote.ts` 2、`instructions.ts` 1（`any` = 0） | 高危两处：`config.ts:214-220` `readVolatile` 的 `return field as T`（未校验形状即当 `VolatileRef` 用）、`config.ts:226-233` `resolveSessionId` 把 `unknown` 直接断言成三层嵌套结构 | 抽 `isVolatileRef(x): x is {get():T}` 与 `readSessionId(x: unknown): string | undefined` 做真校验 |
| **M-03** YAML 解析无限制 | `src/ponytail-skills.ts:176-192`（`parseFrontmatter`）、`:203-209` | `yaml.parse(text)` 无 `maxAliasCount` / schema / 大小限制（别名炸弹与超深嵌套无防护）；`:203-209` 把解析异常一律吞成 `undefined`，丢失「哪个文件坏了」的诊断 | `yaml.parse(text, { maxAliasCount: 100 })` 包 try/catch 后带上 `filePath` 上报 |
| **M-04** 自愈正则的误伤 | `src/ponytail-settings.ts:247`（`/,\s*([}\]])/g` 去尾逗号，会误伤字符串值里的 `, }`）、`:337-346`（`/"disabledSkills"\s*:\s*\[([\s\S]*?)(\]\|$)/` 数组未闭合时贪婪到文件尾，把后面所有字符串当技能名）；`src/ponytail-state.ts:151`（`sessionBlockRegex` 用 `[^}]*`，遇嵌套对象即截断） | 废除整套正则抢救（见 3.2 P1） |
| **M-05** 兼容性口径 | `package.json:46-52`（peer `>=0.2.0-rc.1 <=0.2.1`）vs `:53-60`（devDeps `0.2.1-rc.2`）；`:94-97` `engines.dsh` 非 npm 标准键，安装期零校验 | peer 范围收窄到与 devDeps 一致或用 `||` 列多段；删 `engines.dsh`（宿主不读）；版本断言改用 npm 的 `semver.satisfies` |
| **M-06** 循环依赖 | `src/ponytail-config.ts:22-27` ↔ `src/ponytail-settings.ts:29-35` | 按第 3.1 节的分层重排，`normalizeMode` / `DEFAULT_MODE` / `getConfigPath` 下沉到无依赖的基础模块 |
| **M-07** 两条默认档路径 | `src/ponytail-config.ts:106-123` vs `src/ponytail-priority.ts:72-105`；`src/ponytail-commands.ts:153` 把前者当 fallback | 删 `getDefaultMode`，命令层只吃 `resolvePriority().effective` |
| **M-08** 归一化落空（垃圾值入内存） | `src/ponytail-state.ts:298-306`（`set()` 不 `normalize`，`mode === 'off' ? null : mode` 原样存）、`:317-318`（算出 `nm` 却赋 `raw fileMode`）、`:372`（`normalizeMode(mode ?? '') ?? mode` 归一失败原样保留） | 所有写模式入口统一过 `coerceMode(raw): RuntimeMode | null`，非法值拒绝并告警 |
| **M-09** 同一命令被处理两次 | `src/ponytail-commands.ts:317-326`（`handleSessionEvent`）vs `:256-267`（`handlePreStep`） | 两处都解析命令且**无去重键**；`:321` 只认 `(session as {id?}).id`，而 `resolveSessionId` 支持三通道（`config.ts:226-233`），语义不一致会导致落到 `__default__` | 用 `(sessionId, messageId)` 做一次性去重集；`:321` 改用 `resolveSessionId` |
| **M-10** 过度抽象 | `src/ponytail-remote.ts:35-45`（两个零逻辑转发）、`src/ponytail-commands.ts:227`（纯重导出）、`src/ponytail.ts:386/390`（`sink` 与 `writeDefaultMode` 双注入，后者死参数） | 删转发与死参数，只保留一份 |
| **M-11** 快照三重 I/O | `src/ponytail.ts:346-365` | 一次 `snapshot()` = `resolvePriority` + `effectiveSkillLang()`（可能 `describe()` 全量快照）+ `readSkillMeta()`（读 JSON）；UI 会周期拉取 | 快照改为事件驱动的缓存 + 失效标记 |

### 2.4 low

| ID | 位置 | 问题 |
|---|---|---|
| L-01 | `src/ponytail.ts:155` | `settingsService` 赋值后从未使用（死变量） |
| L-02 | `src/ponytail.ts:256-258` | `isShellSafe` 唯一消费者是一条 warn（见 1.1 #5） |
| L-03 | `src/ponytail-state.ts:261-269` | `toggleSkill` 未传参时用「当前是否禁用」当目标值，语义反转、读者易误解 |
| L-04 | `src/ponytail-commands.ts:94-101` | `arg.startsWith('default')` 使 `defaultlite`（无空格）也命中；`:180-196` 非法 `persistDefault` 静默忽略却仍返回 `switched: true` |
| L-05 | `src/ponytail.ts:294-323` | `touched.has('defaultMode')` 是「任意段等于字段名」判断，非路径前缀匹配，字段名作子串出现会误触发 |
| L-06 | `src/ponytail.ts:443-447` | `ctx.effect` 内只有一行 `logger.info('已卸载')`，无任何清理逻辑 |
| L-07 | `scripts/build-client.mjs:64`、`:571-572` | `localeCtx` 死变量；`t` 是模块级可变变量，被 `apply` 重新赋值，多实例会互相覆盖 |
| L-08 | `scripts/build-client.mjs:242` | `t('level.' + source.level)` 动态拼接键，`verify.mjs:174` 的正则抓不到，实际未被检查 |
| L-09 | `scripts/build-client.mjs:299-336` | `descriptors[0].sourceLocation` 写死 `line: 1, column: 1`（伪造元数据） |
| L-10 | `scripts/build-client.mjs:543` | 重置按钮直接调原生 `confirm()`，阻断式对话框，面板内不可测 |
| L-11 | `locale/zh.json` | `meta` 嵌套对象与 `meta.title` 扁平键并存；`error.operation` 定义但客户端无引用（死键） |
| L-12 | `CONTEXT.md:56` | 称中文实现是英文——与实际（`getFallbackInstructions` 英文、SKILL.md 英文、面板中文）描述混乱 |
| L-13 | `README.zh-CN.md:42` | 称裸 `/ponytail` 切到 full，实现是 `reportOnly: true`（`commands.ts:102-110`）；`:22` 的「缓存命中率始终 100%」无测量支撑 |
| L-14 | `package.json:22` | `lint` 脚本 `eslint ... \|\| echo "(no eslint config — skipped)"` 恒退出 0，假门禁；`src/ponytail-instructions.ts:8` 去 frontmatter 正则缺 `m` 修饰 |

### 2.5 分发与宿主层缺陷（跨仓证据，非本仓代码问题，但决定能否用）

| ID | 位置 | 证据 | 影响 | 修法 |
|---|---|---|---|---|
| **D-01** 版本区间已越界 | `package.json:46-52`（peer `<=0.2.1`）、`:94-97`（`engines.dsh` 同） | 宿主 `dsh-plugin-manager` 只读 `engines` 与 `peerDependencies`，命中即产出 `incompatible-version` 拒绝安装；上游自建的 `dsh.compatibility.dshReleases` 字段宿主**根本不读**。现成补丁（上游 issue #4 / PR #5，把区间放到 `<=0.2.2`）至今 open 未合并 | 在 0.2.2 系列宿主上直接装不上；这是「已停止维护」最硬的证据 | 接管后第一件事就是改区间并改用宿主真实读取的字段 |
| **D-02** 宿主实例已被第三方补丁改写 | 本机 `@deepseek-ai/` 下 60 余个 `*.dshpurge.bak` | 例如 `dsh-system-prompt/lib/index.js:230` 现行 `includeHarnessIdentity ?? false`，备份是 `?? true`。这是本机安装特有的改写，不是上游行为 | 任何「在本机跑一遍看行为」的结论都不可外推为官方语义 | 兼容性验收必须用干净 profile，或对照 `.bak` 逐处 diff；本文所有结论均基于源码静态阅读，不依赖本机运行 |

这两条来自同目录 `ponytail-plugin-landscape.md` 的用户态实测，与本文的代码机制结论互不依赖；列在此处是为了让接管者知道「代码写得对不对」与「当前能不能装上」是两个独立问题。

### 2.6 量化证据

| 指标 | 数值 |
|---|---|
| `any` | **0** |
| `as` 断言 | **72** |
| `catch` 块 | **51**（多数为空块或仅 `warn`/`debug`） |
| `readFileSync` / `readFile` 调用点 | **12** |
| 循环依赖组数 | **1**（config ↔ settings） |
| `test()` 数 | **111**（`assert` 约 430 处） |
| 已知零测试路径 | **6**：并发/多进程写、`next()` 抛错、skill 越权、ReDoS、原子写失败回退、settings revision 冲突 |

---

## 三、专项验证：客户端 / 测试 / 提示词

### 3.1 客户端面板（`scripts/build-client.mjs` → `lib/client.js`）

`build-client.mjs` 用 629 行字符串模板生成 569 行产物，`factory(require)` 内是手写 CommonJS。质量分块如下。

| 维度 | 判定 | 证据 |
|---|---|---|
| 状态管理 | ⚠️ 三层手写 store | `:283-297` 的 `createStore`（`Set` 订阅 + 同步 `forEach` 通知）→ `:354-378` 的 `createRemoteStore`（loading/ready/failed 三态）→ `:592-595` 的 `formStore`（只包 `getSnapshot`/`subscribe`）。**无错误边界**：任一 listener 抛错会中断其余 listener 的通知，且异常冒泡到 React 渲染栈 |
| 事件解绑 | ⚠️ 半对 | `apply` 里三处 `ctx.effect` 都返回了 disposer（`:561-565` 的 remote 卸载、`:568-570` 的 locale 注销、`:609-618` 的 slot 注册），方向正确。但 `remoteStore` 本身**没有 `dispose` 语义**（`:373` `store.dispose = function(){}` 空实现），`load()` 只调一次，无定时刷新、无重试；`createStore` 的 `listeners` 只能靠 React 退订 |
| 错误路径 | ❌ 关键缺失 | `applyOps`（`:396-409`）无 `.catch`（见 **B-03**）；`t()` 缺键时直接 `return key`（`:56`），界面会显示 `mode.lockedHint` 这种原始键名而不是告警；`descriptors[0].result.create` 用恒等函数绕过 zod（`:302-312`），意味着**宿主返回什么形状的 snapshot 都被接受**，下游 `report.chain.map` 对 `undefined` 无防护（`:249-277` 只在 `chain` 为空时降级） |
| 闭包正确性 | ⚠️ 陈旧风险 | `applyOps` 的 deps 只有 `[props.mutate, snapshot.revision]`（`:409`），但函数体用到 `message`、`t`、`snapshot`；`toggleSkill` 的 deps 是 `[applyOps, disabled]`（`:422`），`disabled` 是数组，每次渲染都是新引用，等于每帧重建 |
| DOM 逻辑 | ⚠️ 不可测 | 组件用 `e()` 手写元素树（`:452-548`），无 JSX；`confirm()` 直接调浏览器原生（`:543`）；只有 `CardController`（`:164-219`）的六个静态方法可脱机测 |
| 本地化 | ⚠️ 双重来源 | `t` 是模块级 `let`（`:54`），`apply` 里被 `ctx.locale.bind(NS)` 重新赋值（`:572`），**多实例/多 ctx 会互相覆盖**；`localeCtx`（`:64`）赋值后从未读取 |
| 元数据真实性 | ❌ 伪造 | `descriptors[0].sourceLocation` 写死 `line: 1, column: 1`（`:299-336`），指不到真实的 `src/ponytail-remote.ts:80` |

**可取之处（重写时保留）**：`:302-312` 的注释诚实记录了「`dsh-api-remotes` 只遍历编译期写死的 25 个官方贡献」这一宿主限制，并用 `requireStrictCodec` 只校验 `mode === 'strict'` 的事实给出最小可用的 descriptor 写法；`:609-618` 的 `whileServed` + `slots.inject` 配对注册是 ADR-0009 事故后的正确产物。

### 3.2 测试质量（`behavior.test.mjs` 2496 行 / `verify.mjs` 296 行）

**真行为断言（有价值，重写后应原样迁移）**

| 用例 | 位置 | 断言了什么 |
|---|---|---|
| C19 零缓存 | `behavior.test.mjs:1851-1878` | 切档后**顶层 SystemPrompt 文本逐字节相等**（`assert.equal(promptAfterSwitch, initialPrompt)`）。这是全仓最强的一条断言，也是 A1 的唯一守门人 |
| C20 幂等 | `:1880-1918` | 三轮连续 `pre-step`，第三轮 `messages.length === 1`（不累积通知） |
| C21 跨会话隔离 | `:1920-1951` | 全局 volatile 变更后旧会话前缀不变、新会话取新档 |
| C22 LRU | `:1953-1977` | 105 + 5 个会话后 `__default__` 与 `sess-0` 存活，验证「跳过默认项防首键死锁」 |
| C23 `explicitlySet` 保护 | `:1979-1999` | 全局切档不覆盖显式设置过的会话 |
| C25 跨进程恢复 | `:2041-2061` | 新 state 实例从磁盘恢复 `baselineMode` |
| C33/C34 自愈端到端 | `:2289-2332`、`:2334-2369` | 截断的 `config.json` / `session-states.json` 被抢救 + 备份留样 + 原地重写；含 `Object.getPrototypeOf(recovered) === null` 的原型污染断言 |
| C12 客户端接线 | `:1307-1405` | 用 `globalThis` 桩执行产物，断言无 `fetch`、`configForms.get('ponytail')`、`whileServed(['ponytail'])`、`slots.inject === ['plugins.bundle.config']`、`locale.register` 调用一次 |
| C32 CardController | `:2232-2287` | `node:vm` + `window.__ModuleLoader__` 桩脱机加载产物，直接测六个纯函数（选项数、灯色、锁定、三条 ops） |
| C36 版本矩阵 | `:2390-2494` | 自实现 `parseSemVer` / `compareSemVer` / `hostSatisfiesRange`，覆盖 9 个版本、拒绝 6 个 |

**假测试 / 弱断言（必须识别出来）**

| 问题 | 位置 | 说明 |
|---|---|---|
| 「原子事务」只测顺序 | `:2207-2230`（C31） | 只断言 `changed` 布尔与 `previousMode`，**无并发、无重试、无失败注入**。ADR-0016 宣称的「原子」在测试里完全未被验证 |
| token 增量零验证 | C19 / C21 | ADR-0012 宣称「单次切档仅 ~180 Token」，但测试只断言 section 文本不变，从不测量通知本身的体积。实际注入的是完整裁剪正文（`instructions.ts:146-156`） |
| 文本正则代替行为 | `:1515-1545`、`:1781-1829` | 对 `lib/client.js` 去注释后正则匹配 `'!props.scope'`、`'s.level === "env" && s.hit'`；断言产物「不含中文」。这类断言在改实现时会假红、在保留特征串时会假绿 |
| 自证式断言 | `:2255-2257` | 断言 `client.js` 导出 `CardController`——但那是构建脚本自己写的，等于断言自己 |
| 零覆盖率 | 全仓 | 见 2.5 的六条盲区：并发、`next()` 抛错、skill 越权、ReDoS、原子写失败回退、settings revision 冲突 |

**`verify.mjs` 的性质**：13 个检查段、296 行，本质是**静态文本契约**而非行为验证。真正有价值的只有四段：目录/文件存在性（`:11-26`、`:93-122`）、零 Tool 正则（`:126-134`）、locale 键集一致性（`:170-191`，且只抓两段式键，三级键逃检）、浏览器 CJS 兼容性（`:197-203`，禁 `import.meta` / `process.`）。

**最危险的 22 条**：`:225-255` 的 `officialConfigChecks` 全部是对 `src/*.ts` 的正则文本匹配（如 `/defaultMode: Schema\.union\(\[[^\]]*\]\)\.volatile\(\)/`、`!/@Remote\('(set|write|update|reset|toggle)'\)/`、`!/webServer/.test(hostSrc)`）。它挂在 `prepublishOnly` 上（`package.json:27`），等于**发布门禁由字符串决定**；`:156-164` 甚至锁死了 `t("level." + source.level)` 这个字面量写法，而产物里真正跑的是 `:242` 的动态拼接，正则抓的是源码文本不是产物行为。`:209-215` 的「不得硬编码技能描述」反向断言只扫 `build-client.mjs`，正好绕开 `src/ponytail-skills.ts:31-48` 的 12 条硬编码。

### 3.3 提示词工程（`skills/*/SKILL.md` + `ponytail-instructions.ts`）

**「零缓存破坏」成立，且是真正的设计胜利。** 机制三层，逐层可验：

1. `baselineMode` 在会话诞生时捕获（`state.ts:362-365`），终身不变；顶层 section 只渲染它（`instructions.ts:111-116`）。`C19` 用逐字节相等证明。
2. 切档走 `agent/pre-step` 的增量注入，不动前缀（`commands.ts:270` 之后）。
3. 单轮幂等靠 `source.kind === 'ponytail-mode-update'` 原地替换（`commands.ts:297-306`）。

**与 ADR-0012 的事实偏差四处**：

| ADR-0012 宣称 | 实际 |
|---|---|
| 在「当前最新轮次用户消息末尾追加」 | 是新增一条 `role: 'user'` 的独立消息（`commands.ts:285-294`，`id: randomUUID()`），不是拼进已有消息 |
| 「绝不重复生成多余 Token」，发射后即不再产生 | 幂等只在**当轮 `decision.messages` 数组内**成立（`:297-306`）；已持久化的历史通知永远不会被清理，切十次档历史里就留十条 |
| 单次切档约 180 Token | 正文是 `render(skillDir, newMode)` 的**完整裁剪结果**（`instructions.ts:147-156`），估 1000–1500 token，是宣称值的 6–8 倍 |
| 「历史缓存 100% 命中」 | 只对**顶层 section** 成立。每次增量注入都在对话尾部追加新内容，这一轮的 prefix 相对上一轮必然变化——尾部追加的代价是真实的，只是远小于破坏前缀 |

**裁剪逻辑的真实脆弱性**：`filterSkillBodyForMode`（`instructions.ts:6-26`）只认两种行形状，且**没有代码围栏状态机**。当前上游 6 篇正文里 `grep -c '^```'` 为 0，所以今天不发作；但 `skillDir` 是公开配置项（`render(skillDir, mode)` 显式接收），任何自带代码示例的正文都会被误裁——围栏内本应是字面量的 `| **ultra** | maximal |` 会被当规则表行删掉。**这是本次审计里唯一一个「行为错误」级别的缺陷**（其余是工程问题），接管后必须立刻修。

**围栏裁剪的行为错误已复现**（复刻其两条行首正则后喂入夹具）。输入正文含一张真表格与一个展示该表格语法的代码围栏块，按 `lite` 过滤后的输出里，**围栏块内的 `| **ultra** | maximal |` 被删掉了**——围栏内本应是字面量示例，被当成了规则表行。当前上游 6 篇正文一个围栏块都没有，所以今天不发作；但 `skillDir` 是公开配置项，我们重写的正文大概率带示例，接管后必须立刻修（见 5.2 P0 第 4 项）。

另有两处一致性缺口：`getFallbackInstructions`（`instructions.ts:28-62`）硬编码约 35 行**英文**提示词，与 `skills/` 的中文/英文双语体系脱节，读盘失败时静默降级（用户看不到任何提示）；`skills/ponytail/SKILL.md:77-83` 的 Intensity 表只有 lite/full/ultra 三行、没有 `off` 行，靠 `render()` 在 `off` 档提前返回空串兜住（`instructions.ts:111-117`）——两个地方各守一半契约。

---

## 四、设计资产 vs 包袱

### 4.1 必须保留的设计资产

以下 8 条经得起「换一个实现者、换一个宿主」的检验，属设计层而非实现层，重写时应作为约束写进新仓库的 `CONTEXT.md`。

| # | 资产 | 为什么是真知灼见 | 证据 |
|---|---|---|---|
| **A1** | **会话基线锁定（`baselineMode` 终身不变）** | 全仓最有价值的单个决策。`order: 50` 位于提示词最前端，任何字符级变化都会让其后数万 token 的历史前缀缓存全部失效。作者把「会话创建时原子捕获基线」与「运行中切档」彻底解耦：顶层 section 只读基线，切档走增量注入。这是**用架构约束消除一类性能故障**，而非靠优化手段缓解。其余 5 个移植每切一次档就全量 prefill 一次，只有这一份不付这个代价 | `state.ts:362-365` 捕获、`instructions.ts:111-116` 只读、`behavior.test.mjs:1851-1878` 逐字节相等的真断言 |
| **A2** | **单一注入点 + 零 Tool 注册** | 提示词只经 `systemPrompt.section('ponytail')` 一个出口，工具面为零。整个插件的可观测影响收敛到「一个 section + 六条斜杠命令」，使「这个插件做了什么」可以被静态回答。绝大多数同类插件做不到。且它拒绝「注册 tool 让模型自切档」这个更诱人的选项，理由（常驻 schema 会破坏 tool 声明区稳定性）与 A1 同源 | `ponytail.ts:369-374`、`ponytail.ts:74`、`verify.mjs:126-134`、ADR-0002 |
| **A3** | **`PonytailStorage` / `PonytailConfigSink` 双适配器** | 两个都有真实的两份实现（disk/memory、settings/file），不是为抽象而抽象。`createMemoryStorage` 让状态机成为可纯内存单测的对象——这是 ADR-0013/0016 自我批评后得到的真实收益。重写时必须保留「可替换持久化」这个接缝 | `state.ts:32-40/107-185/188-201`、`settings.ts:51-62/84-149/488-509` |
| **A4** | **`resolvePriority` 纯函数 + 恒 3 项结构化诊断链** | 零 I/O、零依赖、输入输出完全可枚举。`hit`/`shadowed`/`problem` 三态把「配置为什么没生效」从猜测变成可读答案。这是全仓唯一「深模块 + 可测试性 + 用户价值」三者同时成立的模块。其余移植全都没有 | `priority.ts:72-105`、`behavior.test.mjs:634-706` |
| **A5** | **`skills/change` 内禁止反向 `invalidate`** | 踩过坑换来的：宿主 `invalidateCache → notifyChange` 是同步广播且无防重入守卫，在事件处理器里反向触发会栈溢出。**知道「不能在哪做什么」比知道「该做什么」更难得**，这类知识必须原样继承 | `ponytail.ts:280-286` 注释、ADR-0006 的 C5 否决记录 |
| **A6** | **Schema 刻意不给默认值** | `defaultMode` / `skillDescriptionLang` 不设 `.default()`，因为默认值会让「配过」与「没配过」不可区分，诊断面板随之说谎；语言字段靠三态（显式 zh / 显式 en / 未配置=auto）支撑「跟随宿主」。这是**可观测性驱动的 schema 设计**，反直觉但正确 | `ponytail.ts:50-66`、`config.ts:200-204`、ADR-0011 |
| **A7** | **`createTurnCoordinator` 把轮次生命周期收成一个对象** | ADR-0013 自曝 90+ 行胶水泄露在入口后做的重构，把「解析命令 → 穿透 waterfall → 变动检测 → 通知构造」收成一个可单独构造的对象。方向正确、边界清晰，是四个「后补接缝」中最成功的一个 | `commands.ts:253-331` |
| **A8** | **`whileServed` 配对注册 + `ctx.effect` 归还 disposer** | 客户端把 `configForms.whileServed` 与 `slots.inject` 嵌套成「服务就绪才注册」，并用 `ctx.effect` 归还 disposer。ADR-0009 记录过一段惨痛教训（「40 次×50ms 重试掩盖的是压根没挂载」），这条配对模式是那次事故的产物 | `build-client.mjs:609-618`、ADR-0009 |

**次级资产（有价值但需重写适配）**：`salvageConfig` 的双阶抢救思路（先补 JSON、再正则提取字段）、`Object.create(null)` 防原型污染、`createSettingsSink` 包装官方 `mutate(ns, ops, revision)` 而不是自造 HTTP 端点、`locale.register` + `bind` 走官方 i18n、`build-client.mjs` 单点生成产物、失败语义分层（命令层 warn、状态层 best-effort、渲染层回退内置文本）——最后一条虽被本文批评过度，但「每层各自决定失败语义」的分层意识是对的。

### 4.2 必须抛弃的包袱

| # | 包袱 | 为什么必须抛弃 | 证据 |
|---|---|---|---|
| **P1** | **配置自愈引擎（`salvageConfig` + `repairJsonSyntax` + `backupCorruptedFile` + 原地重写）** | 全仓最典型的过度设计，且**它自己引入的风险高于它防范的风险**：正则解析 JSON 会误伤字符串值（`:247`）、未闭合数组贪婪到文件尾（`:337-346`）、读函数带写副作用（`:397-433`）、多会话并发重写互相覆盖。正确做法：写盘要么成功要么报错，读盘失败就备份 + 重置为默认 + 明确告知用户。抢救半份配置的收益，远小于「用户以为自己配好了其实没配」的代价 | `settings.ts:243-379`、`state.ts:128-180` |
| **P2** | **`session-states.json` 持久化 + LRU 100** | 这是 P1 的**根因**。官方有 `agent/disposed` 生命周期事件，按生命周期清理内存 Map 比按容量淘汰更精确，且不需要把会话状态落盘。上游把 100 个会话状态持久化成 JSON，才制造出整条自愈链。**这条链存在的原因是「持久化了不该持久化的东西」** | `state.ts:128-180/203-425` |
| **P3** | **`.ponytail-active` flag 与双权威** | 同一进程对同一文件施加相反权威（`syncFromFile` 文件赢 / `syncToFile` 内存赢），胜者靠调用时机。会话级状态已由三字段齐备的会话表承载，flag 是历史遗留的第二真源，必须删除或降级为「无会话上下文时的只读默认」 | `instructions.ts:106` vs `ponytail.ts:430-434` |
| **P4** | **三套并存的默认档解析** | `resolvePriority`（env>patch>fallback）与 `getDefaultMode`（env>file>full）语义不同源且同时存活；命令层用后者、UI 用前者。ADR-0006 自曝、ADR-0009 声称收敛、`ponytail.ts:222` 注释写「此处一并修复」——**两次宣布收敛但两条都在**。这是「文档宣称已解决」与「代码实际未解决」落差最大的地方 | `config.ts:106-123` vs `priority.ts:72-105`；`commands.ts:153` |
| **P5** | **按文本形状猜结构裁剪提示词** | 结构性信息必须由结构承载，不能由正则猜。上游是外部真源（README 明说正文取自上游原样保留），上游改一个字即静默失效；自带代码示例的正文会被误裁（见 3.3）。重写应改显式分档文件或显式标记区块 | `instructions.ts:6-26` |
| **P6** | **静态文本门禁（`verify.mjs` 的 22 条源码正则）** | 它挂在 `prepublishOnly` 上，等于发布门禁由字符串匹配决定：重排代码不改行为会假红，保留特征串会假绿。它还给未来维护者植入「改实现必须先改正则」的错误激励。保留目录/存在性检查，删掉所有源码文本正则 | `verify.mjs:225-255`、`:156-164`、`:209-215` |
| **P7** | **`FALLBACK_DESCRIPTION` 硬编码 12 条 + 三处元数据真源** | 与 CONTEXT 自己立的不变量直接冲突，且反向断言恰好只扫 `build-client.mjs` 让 `src/` 逃检。三处真源（frontmatter / descriptions.json / 硬编码表）必须收敛到一处——推荐 `descriptions.json`（README 的说法，成本最低） | `skills.ts:31-48`、`:81-89`、`:348`、`:389` |
| **P8** | **`ponytail-remote.ts` 转发层 + `commands.ts:227` 重导出** | ADR-0015/0018 为「保留导出形状」留下的纯噪声（Middle Man）。零逻辑转发不提供信息隐藏，只增加一个改代码时要同步维护的位置；把重导出写成测试断言（C35）等于把噪声变成契约 | `remote.ts:35-45`、`commands.ts:227`、`behavior.test.mjs:2371-2388` |
| **P9** | **`isShellSafe` 整套「Shell 安全」叙事** | 没有 shell 调用面，白名单唯一消费者是一条 warn，且白名单本身放行空格与冒号。**用安全叙事给非安全代码贴标签，比不做更糟**——它让审阅者以为这里有防护 | `config.ts:41-43`、`ponytail.ts:256-258` |
| **P10** | **`PONYTAIL_SUBAGENT_MATCHER` 用户正则** | 唯一消费者是一行 debug 日志，却引入 ReDoS 面。装饰性功能换取真实攻击面，性价比为负 | `ponytail.ts:404-413`、`:425-429` |
| **P11** | **`config ↔ settings` 双向静态 import** | 真 ESM 环，当前靠「只在函数内调用」侥幸不爆。重写的模块分层必须从「基础符号层（路径/常量/归一化）→ 存储层 → 领域层 → 编排层」单向依赖 | `config.ts:22-27` ↔ `settings.ts:29-35` |
| **P12** | **`engines.dsh` + 自实现 semver 断言** | 非 npm 标准键，安装期零校验，纯装饰；配套的 `parseSemVer`/`compareSemVer`/`hostSatisfiesRange`（`behavior.test.mjs:2390-2494`）绕开 npm 真实解析器自定兼容语义。用 `peerDependencies` + 运行期版本探测替代 | `package.json:94-97`、`behavior.test.mjs:2390-2494` |
| **P13** | **字符串模板生成 client（629 行）** | 无 JSX、无 TS 检查、无 IDE 补全、组件不可脱机测；产物 `lib/client.js` 入库，与「源码级重构」目标冲突 | `build-client.mjs`、`.gitignore` |

### 4.3 判断「哪些是真缝隙」的三条判据（供后续复用）

本次审计反复用到的判据，建议写进我们自己的 `codebase-design` 实践：

1. **接缝必须有两份真实实现，且两份都被生产或测试实际使用。** 只有一份实现的「接口」不叫接缝，叫间接层。`PonytailStorage` 合格（memory 版本被 111 个测试用着），`PonytailRemote` 的转发不合格（两份实现都没有）。
2. **接缝的接口必须闭合。** 可选方法（`readSessions?`/`writeSessions?`）把实现细节泄露给每个调用方，调用方被迫写 `typeof === 'function'`——这是「深模块」的反面。
3. **宣称的保证必须在代码里能指出一行。** 「原子」要能指出锁、CAS 或 `fsync`；「单一真源」要能指出真源那一行的读取（别处还有一份读取就是假的）；「防注入」要能指出 shell 调用面。**指不出那一行，就只是命名。**

---

## 五、对我们重构的直接建议

### 5.1 目标架构（4 层，单向依赖）

```
L0  基础层   paths.ts      路径解析、DEFAULT_MODE、coerceMode(raw): RuntimeMode | null
                          无依赖、纯函数、零 I/O
L1  适配层   storage.ts    PonytailStorage（disk | memory）——闭合接口，三个必选方法
             sink.ts        PonytailConfigSink（settings | file）——write 返回 Promise<void>，失败抛出
                          只依赖 L0，两者不得互相 import
L2  领域层   state.ts      会话表（唯一真源）、transition 消费
             priority.ts   resolvePriority（纯函数，唯一优先级链）
             prompt.ts     renderSection / renderUpdate（唯一提示词出口）
             skills.ts     PonytailProvider（含 skillDir 越权防护）
                          只依赖 L0/L1；内部单向：state ← prompt，state ← skills
L3  编排层   plugin.ts     apply：注册 section / provider / 事件 / remote
             coordinator.ts 轮次生命周期
                          只依赖 L0/L1/L2
```

关键约束：**L1 不得 import L2；L2 内部不得出现双向 import**。`coerceMode` 是 L0 的唯一入口，所有写模式的地方都过它（一处修改消除 M-08 的垃圾态）。

### 5.2 接手顺序（按 ROI）

| 优先级 | 动作 | 对应缺陷 | 理由 |
|---|---|---|---|
| **P0** | `get()` 加 `skillDir` 前缀校验；`list()` 对符号链接用 `realpath` 后校验 | B-01 | 唯一「越权读任意文件并喂进模型上下文」的通道，成本低、收益确定 |
| **P0** | 客户端 `applyOps` 加 `.catch` / `.finally`；`busy` 改三态 | B-03 | 一行级修复，消除面板永久卡死 |
| **P0** | `write()` 失败回滚 `mirror` + 重新 `describe()` | B-02 | 决定「配置到底有没有生效」的正确性 |
| **P0** | `filterSkillBodyForMode` 加围栏状态机（或直接改显式分档） | 3.3 行为错误 | 唯一一个会产生错误输出的缺陷，上游正文当前无围栏块所以潜伏，我们重写的正文大概率带示例 |
| **P1** | 删 `getDefaultMode`，命令层只吃 `resolvePriority().effective` | M-07/P4 | 消除文档与实现的第二次落差 |
| **P1** | 删 flag 双向权威：`.ponytail-active` 只读或删除，会话表为唯一真源 | H-01/P3 | 消除同进程竞态 |
| **P1** | 三处写入口统一过 `coerceMode` | M-08 | 一处修改消除三个逃逸点 |
| **P1** | 删除 `salvageConfig` 的正则救援，改「备份 + 重置 + 告知」 | P1/M-04/H-07 | 减少 175 行、消除读路径副作用与并发重写 |
| **P1** | `safeAtomicWriteFile` 去回退、加 `fsync`、失败抛出 | H-02/P12 | 要么真做，要么别叫这个名字 |
| **P2** | 打散 config ↔ settings 环，按 5.1 分层 | M-06/P11 | 结构性问题，越晚改成本越高 |
| **P2** | 提示词裁剪改显式分档文件 | H-06/P5 | 断开对上游排版形状的隐式依赖 |
| **P2** | 技能描述收敛到 `descriptions.json`，删 `FALLBACK_DESCRIPTION` | P7 | 与 README 既有说法一致，成本最低 |
| **P2** | 会话状态改内存 Map + `agent/disposed` 清理，删 `session-states.json` | P2 | 一次性删除自愈链的根因与 LRU 全量重写 |
| **P2** | 删 `verify.mjs` 源码正则、`isShellSafe`、`PONYTAIL_SUBAGENT_MATCHER`、两个转发/重导出、双写通道 | P6/P8/P9/P10/M-10 | 净删代码，同时消除 3 个 false-positive 门禁 |
| **P3** | `list()` 内 `descriptions()` 提到循环外 | H-03 | 一行级优化 |
| **P3** | client 改真实 `.tsx` + esbuild/tsdown，`lib/` 退出 git | P13 | 让组件可 TS 检查、可脱机测 |

### 5.3 测试策略（保留什么、补什么）

**原样迁移（这些断言已经证明过自己的价值）**：

- 零缓存逐字节相等（`behavior.test.mjs:1851-1878`）——重写后必须仍然通过，它是 A1 的守门人。
- 跨进程基线恢复（`:2041-2061`）、LRU 上限（`:1953-1977`）、`explicitlySet` 保护（`:1979-1999`）、单轮幂等（`:1880-1918`）、自愈端到端含 `Object.getPrototypeOf === null`（`:2289-2332`）。
- 客户端接线桩（`:1307-1405`）与 `CardController` 的 `node:vm` 脱机测试（`:2232-2287`）——**这个模式值得抄**：不用 jsdom、不引 React 测试库，纯 Node 就能验纯函数，成本极低、收益确定。

**必须新增（当前 6 个盲区）**：

| 用例 | 怎么测 | 防的是 |
|---|---|---|
| skill 越权 | 构造 `locator.path = '/tmp/x/SKILL.md'` 与指向 `skillDir` 外的符号链接，断言 `get()` 返回 `undefined` | B-01 回归 |
| 并发写会话表 | 两个 `createPonytailState` 共享同一 profileDir 交替 `setSessionMode`，断言最终值一致或明确检测到冲突 | H-04 |
| 原子写失败 | mock `renameSync` 抛错，断言返回失败且**目标文件内容未被破坏** | H-02 |
| settings revision 冲突 | mock `mutate` 首次 reject，断言 `mirror` 回滚且后续写入用新 revision | B-02 |
| waterfall 下游抛错 | `next()` reject，断言异常向上传播而非被吞、且 section 状态未被污染 | 2.5 盲区 |
| 提示词裁剪 | 断言「lite 档渲染结果不含 ultra 段」的**行为**，并覆盖代码围栏内的同名形状 | H-06 / 3.3 |

**断言口径**：新增用例一律禁止「读源码字符串做断言」。需要验证「没有 HTTP 端点」这类结构性事实时，改为在运行时检查 `ctx` 上是否注册了路由（有则失败），而不是 grep 源码。这条直接对应 P6 的教训。

### 5.4 文档纪律（本次审计最想留下的教训）

上游 18 篇 ADR 的自曝文化是**罕见且值得继承**的资产——ADR-0006/0007/0013/0014/0015/0016/0017/0018 每一篇都在列举自己的缺陷，这是极高水准的工程自省。但审计发现一个系统性偏差：**ADR 记录「决策已做」，`CONTEXT.md` 记录「不变量已成立」，而代码停在「部分实现」**。三次「声称收敛」全部未收敛（优先级、自愈内核、单一真源）。

因此建议：

1. **`CONTEXT.md` 的每条不变量必须附一个「验证位置」列**：指向一个具体测试名或一个 `file:line`。指不出来的不变量不许写进去。
2. **ADR 的状态字段只允许三种值**：`proposed` / `implemented` / `superseded`。作者已用「修订」记录，但没有机械可查的状态位，导致「声称已收敛」长期无人核对。
3. **禁止用形容词做保证**（「彻底消灭」「100%」「确保免受」）。凡写下的强断言，必须同段给出测量方式或指向测量代码。本次审计的 5 条「名不副实」里，条目 4/5/6/7 全部源于这类不可验证的强断言。

---

## 六、与并行审计的分歧点（诚实标注）

同一工作区里另有一份独立审计（备份在 `_peer-report-backup.md`，其生态位对比在 `ponytail-plugin-landscape.md`）。两份在多数事实上一致（零缓存破坏是核心资产、自愈链该删、零 Tool 该保留、版本区间已越界），但有三处结论相反，列出并给出我这边的理由，便于接管者自行裁断。

| 争议点 | 对方结论 | 本文结论 | 理由 |
|---|---|---|---|
| `safeAtomicWriteFile` 该保留还是该抛弃 | 该保留（列为资产 A5），只是应该独立成模块 | 该保留**意图**、必须**重写**（列为包袱 P12，缺陷 H-02） | 对方的描述是「renameSync 原子替换 → Windows 失败降级直写」，与源码一致，但没有把这句读成缺陷。我的判断：一个函数如果在自己的失败分支里退回它宣称要消灭的路径（`:182-183`），且 6 处调用点有 5 处丢弃返回值，那它提供的不是保证而是**错觉**。函数该留着，但必须加 `fsync`、删回退、失败抛出 |
| `ponytail-remote.ts` 的转发与 `commands.ts:227` 的重导出 | 列为 S2-3「重复导出」，属可维护性债 | 列为 P8，且指出 `behavior.test.mjs:2371-2388` 用「恒等断言」把噪声写成了契约 | 分歧不在定性而在**处置力度**：对方归为风格债，我认为它有一层额外危害——测试锁死了一个本该消失的符号，删它时会假红 |
| 测试整体评价 | 「无假测试」（`grep skip|todo|assert.ok(true)` = 0），质量高 | 有 6 条真盲区 + 3 类弱断言（文本正则、自证式、只测顺序不测并发），且最强宣称（~180 token）零验证 | 「没有 skip」不等于「没有假测试」。`verify.mjs:225-255` 的 22 条源码正则挂在 `prepublishOnly` 上，是比 skip 更隐蔽的假绿来源；C31 名为「原子事务」却只做顺序调用，是教科书式的「断言存在而非断言行为」 |

另有一处对方提到、本文未展开但我认同的事实：**`ponytail-skills.ts:146-153` 正确处理了 `disable-model-invocation`**（`parseInvocationPolicy` 拒绝 `modelInvocable`/`userInvocable` 旧键并映射到 `{modelInvocable, userInvocable}`）。这是 skills 模块里少数几个「按宿主协议正确实现」的地方，重写时应保留其语义。

---

## 附录：审计覆盖与未核实项

| 材料 | 规模 | 读法 |
|---|---|---|
| `src/*.ts` | 9 文件 2709 行 | 逐行全读 |
| `scripts/behavior.test.mjs` | 2496 行 / 111 个 `test()` | 逐节扫读 + 抽查断言强度 |
| `scripts/verify.mjs` | 296 行 / 13 个检查段 | 逐行全读 |
| `scripts/build-client.mjs` → `lib/client.js` | 629 行 → 569 行产物 | 逐行全读 |
| `skills/*/SKILL.md` | 6 篇 393 行 | 逐篇全读 |
| `docs/adr/*.md` | 18 篇 | 逐篇读决策与自曝段 |
| `CONTEXT.md` / `README.zh-CN.md` / `package.json` / `tsconfig.json` / `cordis.patch.yml` / `locale/*.json` | — | 全文 |

**未覆盖**：`assets/*.svg` 的图像内容；`CHANGELOG.md` 逐条；`docs-verify.mjs` / `bump-dsh.mjs` / `version.mjs` 三个次要脚本；`lib/*.js` 与 `src` 的逐行一致性（仅抽查两个样本）。

**宿主实例差异警告**：本机 `@deepseek-ai/` 下有 60 余个 `*.dshpurge.bak` 备份（第三方补丁改写过宿主实现，例如 `dsh-system-prompt/lib/index.js:230` 的 `includeHarnessIdentity` 默认值被改），因此本机上「跑一遍看行为」的结论不可外推为官方语义。本文不依赖本机运行。

**未运行上游测试套件**：`/tmp/dsh-ponytail-upstream` 无 `node_modules`（依赖未安装）。所有「断言强度」判断基于测试源码本身，不依赖运行结果。凡标注「实测」的结论都限定在源码可推导范围内；行为级结论（如围栏裁剪误伤）以「复刻其正则后喂入夹具」的方式验证，非在上游仓库内运行。

**版本口径**：本文所有行号对应 commit `7223820`（v5.6.2）。上游已停止维护，`engines.dsh` 声明的 `<=0.2.1` 与更新宿主不兼容（同类对比报告有详述），但那是分发层问题，不影响本文对代码机制的判断。

