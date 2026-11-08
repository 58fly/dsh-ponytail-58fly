<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-TITLE: 接管 ponytail：在 DSH 0.2.x 上重写一个自维护的懒人模式插件 -->
<!-- DSH-STATUS: closed -->
<!-- DSH-LABELS: wayfinder:map -->
<!-- DSH-IDEMPOTENCY-KEY: deck-plan-ponytail-takeover-v1-map -->
<!-- DSH-CREATED: 2026-11-07T03:34:34.129Z -->

## Destination

在 DSH 0.2.x 上发布一个我们自己维护的 ponytail 插件，取代 `@wenaixi/dsh-ponytail@5.6.2`。

判据（全部满足即达成）：

1. 在**干净的** DSH 0.2.2 宿主上可直接安装启用；`engines.dsh` / peer 区间与真实宿主矩阵 CI 一致，无一例 `incompatible-version`。
2. 保留 ADR-0012 零缓存破坏三层：会话 baseline 锁定、切档只在轮末追加 `<system-reminder>`、单通知原地幂等替换。用**真实 prompt 前缀逐字节比对**证明同一会话切档前后前缀不变。
3. 保持零 tool 注册；6 个技能全部经 skill provider 暴露。
4. 净删除上游的配置自愈链与会话状态持久化（约 350 行代码 + 6 篇 ADR 所描述的机制），会话状态改为内存 Map + `agent/disposed` 生命周期清理。
5. 模式过滤围栏感知；有真 Cordis 组合测试（`new Context()` + `ctx.plugin()`）与至少一条"围栏内 mode 形状行必须保留"的夹具。
6. 客户端 UI 缺失时宿主侧功能完整（可降级可跑）。**注（2026-11-07 核对）**：原文写「零 UI」，那是 v0.1 口径；#05 已交付 v0.2 面板，判据改按「可降级」验——`test/client-wiring.test.mjs` 与 `test/commands.test.mjs` 已证。但「宿主是否真的装载这份 UI」在核对时**未接通**，见 #14。**#14 已于 2026-11-08 关票**：`dsh.client` 声明已回补、verify 双向联动检查兜住「装得上但装不进去」，真机装载本身留给最终核对。
7. 有发行物纯度检查：外部依赖白名单、禁 `new Function` / `eval`、`lib/` 不入库。
8. 技能 provider 不得越出 `skillDir` 读文件：`get()` 对 `locator.path` 做 `resolve` 后的前缀校验，`list()` 对符号链接取 `realpath` 后同样校验（上游 B-01 是唯一一处「越权读任意文件并喂进模型上下文」的通道）。**已由 #13 落地（2026-11-07）：`src/l0/within.ts` 纯函数 + 两处 realpath 收口，14 条测试钉住。**

## Notes

- 上游对象：https://github.com/Wenaixi/dsh-ponytail · commit 7223820 · v5.6.2 · MIT。
- 仓内已有两份证据笔记（沿用，不重造）：
  - `docs/research/upstream-ponytail-source-audit.md` —— 源码级审计：S0–S3 缺陷清单、A1–A6 真实资产、8 条重构优先级、3 条硬结论。
  - `docs/research/ponytail-plugin-landscape.md` —— 生态调研：13 个 npm 派生包 / 14 个 GitHub 仓、10 条可借鉴做法、版本矩阵与竞争格局。
- 上游结论一句话：**不 fork，保留架构判断，重写实现。** 6 个 `SKILL.md` 可原样搬。
- 本机宿主被第三方打过 **63 个 `*.dshpurge.bak`** 补丁（`dsh-system-prompt/lib/index.js:230` 现行 `includeHarnessIdentity ?? false`，备份是 `?? true`）。**本机行为不能外推为官方 0.2.2 语义**，兼容性验收必须用干净 profile。
- 全生态只有 Wenaixi 一家做缓存保护；其余 5 家每切一次档就全量 prefill 一次。
- 上游确认的缺陷分两类：**行为/安全错误 3 处** —— B-01 技能读取越权（`skills.ts:378` 无前缀校验、`:333` 放行符号链接）、B-02 settings 写通道一次 revision 冲突后永久静默失效（`settings.ts:100` 只 `describe()` 一次，无 re-describe）、B-03 客户端面板 `mutate` reject 时 `busy` 永真卡死（`build-client.mjs:396-409` 无 `.catch`）；**行为错误 1 处** —— S1-1 过滤不围栏感知（当前因技能正文无围栏块而潜伏）。其余是工程债与耦合。
- 三个 blocker 的修法已落进 Decisions，判据 8 覆盖 B-01。**（2026-11-07 核对修正：B-01 的修法当时只停在 Decisions 层，`src/skills/provider.ts` 无任何前缀校验，两条逃逸路径实测可复现 → 补 #13。**#13 已于 2026-11-07 落地：`src/l0/within.ts` 纯函数 + list/get 两处 realpath 收口，判定在读取之前。**B-02 / B-03 不受影响：B-02 的冲突重试已在 `src/config/runtime.ts` 落地，B-03 属客户端 `mutate`，v0.2 面板走 `set`/`unset` 未用 `mutate`。）**
- 上游资产清单（以 `docs/research/upstream-ponytail-source-audit.md` §4.1 的 A1–A8 为准）：A1 零缓存破坏三层 / A2 单一注入点 + 零 tool / A3 `PonytailStorage`·`PonytailConfigSink` 双适配器 / A4 恒 3 项诊断链 / A5 `skills/change` 内禁止反向 `invalidate` / A6 Schema 不给默认值 / A7 `createTurnCoordinator` / A8 `whileServed` 配对注册 + `ctx.effect` 归还 disposer。**「原子写」不在资产内**（存在失败回退直写的缺陷 H-02）。测试面：111 个 `node:test` 用例确无 `skip`/空断言，但有 6 条真盲区与 3 类弱断言，缺真 Cordis 组合测试。

## Decisions so far

- **不 fork 上游目录结构**：新仓库、按新模块边界重写，6 个 `SKILL.md` 原样搬。理由：9 个平铺文件 + 18 篇 ADR 的形态本身承载着它要解决的历史包袱。
- **保留 ADR-0012 零缓存破坏**：照抄设计，重写实现。已有真断言背书（`behavior.test.mjs:1851-1878` 逐字节相等）。这是唯一差异化资产。
- **保留零 tool**：否决 @maci0 的 `ponytail` tool 自切档路线（模型自主性收益 < 常驻 schema + tool 声明区不稳定的代价）。
- **删掉配置自愈三件套 + `session-states.json` + LRU 100 + `.ponytail-active` 双通道**。会话状态改内存 + `agent/disposed`。这是本次重构最大的一笔净删除（约 350 行 + 6 篇 ADR 的机制）。
- **模式过滤改围栏感知状态机**（对齐 @maci0 `src/modes.ts` 的 FENCE 判定）。已实测复现误删。
- **版本区间放宽 + 真实宿主矩阵 CI**，不靠自建 `dsh.compatibility` 字段（宿主不读，见 `dsh-plugin-manager/lib/index.js:491/513-514/1479/1493-1494`）。
- **客户端 UI 做成可降级可选增强**：客户端面是漂移区，四家同期实现的 `dsh.client.inject` 与 slot 名各不相同。
- **零 shim（原「自建宿主类型 shim」的定案已作废）**：宿主 npm 发行物**完整发布** `.d.ts`（`npm pack @deepseek-ai/dsh-<x>@0.2.2-rc.1` 解包得 63 个，每包 `types = lib/types/index.d.ts`）；只有 Electron 打包裁剪了它们。做法是把 `@deepseek-ai/*` 装成 devDependency 直接吃官方类型。#03 实测推翻，见下节。
- **保留三条实现级资产**：恒 3 项结构化诊断链（`resolvePriority` 纯函数）、Schema 不给默认值（`defaultMode` / `skillDescriptionLang` 不写 `.default()`）、`skills/change` 内禁止反向 `invalidate`（防宿主同步广播重入栈溢出）。**不继承上游的原子写函数**（见下）。

### #01 grilling 定案（2026-11-07，用户拍板）

四题全部落定，后续票的边界以此为准：

- **Q1 包名与分发 → 新包名自建：`dsh-ponytail-58fly`**（用户指定）。**不接管 `@wenaixi/dsh-ponytail`**，不做同名发布。理由已确认：接管需上游 npm 组织权限，且同名发布会把存量用户直接推上 `engines.dsh <=0.2.1` 的不兼容路径；另起名可并存 + 给迁移说明。代价是重新积累下载量（上游 1183/周）。
  - 若日后要迁到 npm scope，等价形是 `@58fly/dsh-ponytail`；当前以无 scope 名 `dsh-ponytail-58fly` 为准。
  - 连带影响：仓库名、`package.json#name`、`dsh.client` 里的模块 id、settings 命名空间、config 目录名、README 全链路统一用这个名字；**不得**在任何地方继续用 `ponytail` 作包名（技能 id 前缀 `ponytail-*` 保留，那是技能名不是包名）。
- **Q2 首版范围 → v0.1 纯宿主侧，v0.2 再加客户端 UI**。客户端面是漂移区（四家同期实现 `dsh.client.inject` 与 slot 名全不同，0.2.2 里 `configForms` 归属仍在查）。地图判据 6「零 UI 也能完整工作」在纯宿主侧首版天然满足。
  - 连带影响：**#05 客户端 UI 不再阻塞 #11 首版发布**，降级为 v0.2 的独立票。
- **Q3 档位作用域 → 全局档 + 会话级内存覆盖，重启回全局档**。上游 `session-states.json` 持久化 100 个会话是 175 行自愈链的根因；改为内存 `Map` + `agent/disposed` 清理，净删约 350 行。「重启回默认」是设计语义，写进文档而非当缺陷。
- **Q4 上游定位 → README 明确声明「上游规则文本的移植，非官方」，并钉住同步的 commit**。真上游 DietrichGebert/ponytail 2026-10-29 仍在 push，规则文本变更不会通过版本号通知；把「同步得快」写成可验证承诺（CI diff + 钉住的 sha）。

**由此确定的命名与品牌约定**：包名 `dsh-ponytail-58fly`；技能 id 沿用 `ponytail`、`ponytail-audit`、`ponytail-debt`、`ponytail-gain`、`ponytail-help`、`ponytail-review` 六个（与上游一致，便于迁移与触发词兼容）；命令前缀 `/ponytail` 不变。

### 0.2.2 宿主契约实测带来的裁决（2026-11-07）

- **斜杠命令改用官方 `ctx.commands.register`**（0.2.2 新增）。删掉上游的文本解析 + `agent/pre-step` 消息注入；官方自带 `command/run`/`command/done`、斜杠菜单、scoped 遮蔽。命令前缀 `/ponytail` 不变。
- **技能目录渲染、frontmatter 解析、配置表单都不自造**：分别由 `dsh-tool-skill`、`dsh-skill-filesystem`、`settings` schema `autoGenerate` 承担。实测上游 3 个 volatile 字段已自动出现在设置页。
- **v0.1 目标零运行时依赖**：0.2.2 的 `settings.mutate` 自己写 `cordis.patch.yml`，我们只消费结构化对象，不需要 YAML 解析。`yaml` 仅在「必须读用户手写 patch 原文」时引回。
- **安装形态是独立的验收维度**：`dsh plugin add <本地目录>` 生成 `link:`，pnpm 不装 dependencies（实测 `ERR_MODULE_NOT_FOUND: Cannot find package 'yaml'`）；必须用 tarball。CI 两种形态都要跑。
- **必须自造的不变**：每技能启用/禁用、技能描述中英切换、模式三档文案与提示词段、（v0.2）客户端状态面板。

### 机制层审计（第二份、更细）追加的裁决

- **目标架构定为 L0–L3 四层单向依赖**：L0 基础层（路径/常量/归一化，纯函数零 I/O）→ L1 适配层（storage `disk|memory`、sink `settings|file`，闭合接口）→ L2 领域层（state / priority / prompt / skills）→ L3 编排层（plugin apply / coordinator）。硬约束：L1 不得 import L2；L2 内部不得双向 import。这一步直接消灭上游 `config ↔ settings` 的 ESM 环（`config.ts:22-27` ↔ `settings.ts:29-35`）。
- **`coerceMode(raw): RuntimeMode | null` 作为 L0 唯一写模式入口**：上游三处写入口各自归一化（`state.ts:298-306` 不归一、`:317-318` 算出 `nm` 却赋原值、`:372` 归一失败原样保留），一处修改消除全部垃圾态。
- **三个 blocker 全部采信并在新仓库里根治**（已逐条回源码复核）：
  - **B-01 技能读取越权**：`ponytail-skills.ts:378` `targetPath = locatorObj?.path ?? candidate.path` 直接交给 `parseSkillFile`，**无 skillDir 前缀校验**；`:333` `list()` 把 `isSymbolicLink()` 与 `isDirectory()` 并列放行。→ 新仓库 `get()` 必须 `resolve(targetPath).startsWith(resolve(skillDir) + sep)`，`list()` 用 `realpath` 后校验。
  - **B-02 settings 写通道永久静默失效**：`ponytail-settings.ts:109` 先乐观改 `mirror`，`:110-121` `void mutate().then().catch(warn)`；本模块**无任何 re-describe 路径**（`describe()` 只在工厂里跑一次，`:97-105`）。一次 revision 冲突后 mirror 永久陈旧，之后每次写入都失败且只打 warn，面板却显示已保存。→ `write` 必须返回 `Promise`，失败回滚 + 重新 `describe()` 取真值。
  - **B-03 客户端面板永久卡死**：`build-client.mjs:396-409` `applyOps` 只有 `.then` 没有 `.catch`/`.finally`，`mutate` reject 时 `busy` 永真、全部控件 `disabled`。→ 加 `.catch` + `.finally`，`busy` 改三态。
- **零缓存破坏的边界要写清楚，不夸大**：上游 README 说"历史 prompt / KV cache 100% 命中"。实测结论：**该保证对顶层 section 成立**（前缀逐字节不变，有真断言），但对注入的通知不成立——切档通知以 `role:'user'` 的新消息 `push` 进消息数组（`commands.ts:285-294`），幂等只在**当轮 messages 数组内**（`findIndex` 找旧通知原地替换），**旧通知会永久留在历史里**。新仓库要么接受这个语义并如实写进文档，要么改成从历史中移除旧通知。
- **`safeAtomicWriteFile` 不作资产继承**：新仓库的配置写入走宿主 settings 通道、会话状态留内存，两处都不自写盘，上游那条 175 行三件套（`writeDiskConfig` / `safeAtomicWriteFile` / `salvageConfig`）整体删除（与 #04 一致）。若将来确有自写盘需求，实现必须是 tmp 写入 → `fsyncSync(fd)` → `renameSync`、失败抛出、调用点处理返回值——上游 `settings.ts:182-183` 在 `renameSync` 失败后回退 `writeFileSync`，正是它宣称要消灭的截断路径；无 `fsync`；返回 `boolean` 但 6 处调用点 5 处丢弃。\n  - 编号备注：机制层报告第六章把这条写作「P12/H-02」，但其 §4.2 表格里 P12 是「`engines.dsh` + 自实现 semver」，此处以表格为准，记作缺陷 **H-02**。
- **两份审计的分歧裁决**（诚实记录，供后续复核）：
  - `safeAtomicWriteFile`：一份列资产 A5「该保留」，一份记作缺陷 H-02「该重写」→ **采后者**，理由是有具体失败分支证据（`settings.ts:182-183`）；且新架构根本不再自写盘，最终处置是删除而非重写。
  - `ponytail-remote.ts` 转发层：一份列 S2-3「可维护性债」，一份列 P8「噪声被写成契约」→ **采后者**，因为 `behavior.test.mjs:2371-2388` 用恒等断言锁死了本该消失的符号，删除时会假红。
  - 测试整体评价：一份称「无假测试」，一份称「6 条真盲区 + 3 类弱断言」→ **采后者**，`verify.mjs:225-255` 的 22 条源码正则挂在 `prepublishOnly` 上是比 `skip` 更隐蔽的假绿来源。
- **`verify.mjs` 的源码文本正则门禁整体废除**：保留目录/存在性检查，删掉所有"读源码字符串做断言"。要验证"没有 HTTP 端点"这类结构性事实，改为运行时检查 `ctx` 上是否注册了路由。
### #02 / #08 / #09 / #12 四张 research 票带来的定案（2026-11-07 收口）

- **模式过滤实现锁定 B2 形状状态机**（#02）：40 行渲染 + 27 行 FENCE 判定、零依赖。实测 17/17 形状变体正确、围栏内误删 0（对比 A 方案误删围栏内 14 行）、真实 6 份技能正文零回归。**废除「显式分档文件 `SKILL.lite.md`」与「显式标记区块」两条候选**——它们要求正文重构，而正文是上游移植的内容资产，不能为过滤机制改写。
- **技能正文真源钉 DietrichGebert/ponytail v5.3.3**（tag `7801d06`；HEAD `96608e0` 实测与 tag 对 skills/ 零差异，skills 树 `269bc3e0e49c5b2613ea83775f9cade599cc4021`）。CI 每日 diff 报警，不自动 sync（#08）。Wenaixi 的 6 份 `SKILL.md` 是上游 v4.10.3（`b6c0448`）英文原文快照 + 2 处 DSH 适配，**不是中文改写**（6 份 CJK 计数全 0），已落后上游一个大版本，不沿用。
- **阶梯口径统一说六阶**（#08）：上游三处同文（`AGENTS.md:13-18`、`.agents/rules/ponytail.md:13-18`、`skills/ponytail/SKILL.md:27-32`）。七阶是 2026-10-08 之前旧原文，`01cbf81` 把「3 Stdlib does it?」与「4 Native platform feature covers it?」合并；只在浏览器配图 alt 与 Wenaixi 文档里残留。
- **正文用中文重写，但保留英文触发词与 kebab-case 技能名**（#08）：宿主**不做任何检索匹配**——`dsh-tool-skill/lib/index.js:944 filter(isModelInvocable)` → `:1028-1030` 每行「- name: description」→ `:966-991` 包成 available_skills 段，纯文本给模型读；包内 `embedding|fuzzy|levenshtein|similarity|scoreSkill|matchSkill|rankSkills` 零命中。唯一硬机制是 `SKILL_GESTURE` 正则（`:1108`）：**斜杠命令后必须留 ASCII 空白**，紧跟全角标点（如「/ponytail，」）会漏匹配。
- **6 个技能一律吃默认 invocation `{modelInvocable:true, userInvocable:true}`**（#08）：全设 `disable-model-invocation: true` 会走 `:945` 空集 → `:955` 无技能分支，6 个技能全部从目录消失且 `skill` 工具调用抛错（`:875/:878`），与判据 3 冲突。
- **描述长度校验口径 = 先折叠空白再比 UTF-16 `.length`**（#08）：常量在 `dsh-tool-skill/lib/index.js:768`（默认 500）、`:777`（`z.number().default(500)`）、`:785-786`（最小 3）；截断在 `:1094-1096`，`slice(0, max-3) + "..."`，会切半代理对（实测「🚀」×300 → `out.length=500`、codePoint 252、尾部 U+FFFD）。**阈值定 480**（en/ponytail 现 492 需精简）。
- **版本区间定 `engines.dsh: ">=0.2.0-rc.1 <0.2.3-0"`**（#09，2026-11-07 修正）：上界必须显式排除 0.2.3 起。宿主 semver 7.8.6 实测（`includePrerelease: true`）：`<0.3.0-0` 会放行 `0.2.3-0` / `0.2.3-rc.1` / `0.2.3`，而 `<0.2.3-0` 全部拒绝、且与 `<=0.2.2` 逐格等价（0.2.0-rc.1 至 0.2.2 全系列 PASS）。判据 1 要求「区间与真实宿主矩阵 CI 一致」，CI 只覆盖到 0.2.2 系列，故不声明未验证的 0.2.3；等 CI 加上 0.2.3 再放宽。`peerDependencies` 只写 `@deepseek-ai/cordis: "~4.1.0"`，**不写 `@deepseek-ai/dsh`**——`engines.dsh` 存在时 `unmetRequirements` 直接 return，peer 一个字都不读。三处（engines + 两个 dsh-* peer）必须同步改。
- **区间放宽后 `commands` 必须可降级**（#09）：`@deepseek-ai/dsh-commands` 从 `0.2.1-alpha.3` 才有，故 `inject` 不能硬写 `commands`，要 `ctx.inject(['commands'], scope => scope.commands.register(...))`，缺失时退回只读 `settings.defaultMode`。
- **客户端 UI 三个服务都在、没改名；决定生死的是通道不是 API**（#12）：`configForms`（`dsh-client-ui-settings/lib/client.js:1270`）、`slots`（`dsh-client-ui-renderer/lib/client.js:1348`）、`commandUi`（`dsh-client-ui-commands/lib/client.js:1356`）都在，`getSnapshot()/subscribe()/mutate(ops, expectedRevision)`（`:1122/:1130/:1165`）与上游 ADR 记的逐字一致。真坑在失败语义相反：`slots.inject` 对未声明 slot 静默等待（`dsh-client-ui-renderer/lib/client.js:1393` `if (spec === void 0) return;`，slot 声明提交后自动补挂），裸 `slots.register` 对未声明 slot 直接抛错。→ **降级只能用 `inject` 通道，不能用 try/catch 探测。**`configForms` 用 loading/unavailable/ready 三态表达能力缺失而不抛异常；`remoteAccess.whenAccess` 权限不足时整块 UI 静默消失、权限恢复后自动重装（`dsh-api-remote-access/lib/client.js:648-702`、`:724`）。109 条 slot 目录可从 `dsh-cordis-client-runner/lib/client.js:2606-7559`（索引 `:7705`）完整导出，v0.2 会用到的只有 `settings.section` 与 `sidebar.right.pane.tab`。
- **#05 的技法是「照抄注册姿势，重写档位通道」**（#12）：上游 `whileServed` + `slots.inject` 的配对写法可原样保留（它就是官方姿势）；必须重写的是它自造的档位读写链。任何形态都成立的通路是官方 `/permission <preset>`（`dsh-permission-presets/lib/index.js:215-230`）与 `remote.settings.mutate`。**单技能开关官方没有原语**（`dsh-skill/lib/index.js:120` 的 Config 无 `enabled` 字段），只能 disable 整行 provider 或改 `customSkillDirs`；上游用的 `plugins.bundle.config` 是插件详情页 keyed slot，不是设置页。
- **`dsh.client.inject` 缺项只降级不报错**（#12）：`parseDshClient`（`dsh-client-modules/lib/index.js:86-104`）里 inject 缺失合法；浏览器侧 `arriveGraphRow`（`lib/client.js:791-794`）对取不到的包静默跳过，整包未激活只记 failures（`:547-564` 逐包 try/catch 隔离），页面不白屏。→ 客户端半面天然可缺，我们不需要为「UI 包缺席」写防御分支，只需要保证服务端功能独立可用。
- **客户端契约是 `exports["./client"]` 而不是文件名**（#12）：85 个 `lib/client.js` 首行都是 `__ModuleLoader__.load({id, factory})`，但 `dsh-api-gateway` / `dsh-client-connection` / `dsh-typert-registry` 三个包的 `exports["./client"]` 指向 `lib/client.browser.js`。构建时必须读 `exports` 字段，不能按 `lib/client.js` 硬猜。

- [终点形态与分发：新包名另起还是接管同名；首版要不要带客户端 UI](issues/01-终点形态与分发-新包名另起还是接管同名-首版要不要带客户端-ui.md): 四题定案 → 新包名 `dsh-ponytail-58fly`、v0.1 纯宿主侧、全局档 + 会话内存覆盖、README 声明移植并钉同步 commit。
- [最小验证原型：围栏感知过滤 + 真 Cordis 组合测试骨架](issues/02-最小验证原型-围栏感知过滤-真-cordis-组合测试骨架.md): 围栏感知过滤选定 B2（17/17 形状正确、围栏零误删、真实正文零回归、40+27 行零依赖实现）；真 Cordis 组合测试在 0.2.2-rc.1 真包上跑通，实测固化 provider.get 收 candidate、list 剥 …
- [技能正文真源与语言策略：上游最新 vs 冻结 commit、六阶/七阶口径、中文改写边界](issues/08-技能正文真源与语言策略-上游最新-vs-冻结-commit-六阶-七阶口径-中文.md): 真源钉 DietrichGebert HEAD 96608e0 + CI diff 报警；实测上游六阶、Wenaixi 七阶（把 stdlib 与平台原生拆成两条），对外统一用六阶；500 上限确认为 UTF-16 code unit 且先…
- [DSH 0.2.2 客户端 UI 稳定面：configForms / slots / commandUi 在不在，可降级边界在哪](issues/12-dsh-0-2-2-客户端-ui-稳定面-configforms-slots-c.md): configForms 是服务名（dsh-client-ui-settings:1270），参数是 entryId，controller 自带写队列+revision 栅栏+recovery read 可消 B-02 客户端侧；214 处 …
- [核实 DSH 0.2.2 兼容性：PR #5 的字节级相同声明是否成立，peer 区间该怎么写](issues/09-核实-dsh-0-2-2-兼容性-pr-5-的字节级相同声明是否成立-peer.md): 三条字节级相同声明全部成立（dsh-skill / dsh-typert-protocol lib/index.js sha256 完全相同；@deepseek-ai/schemastery 3.18.4 与 3.19.0 的 index.…

### #03 骨架带来的定案（2026-11-07 关票）

- **零 shim 落地**：`@deepseek-ai/*` 装成 devDependency，直接吃官方 `.d.ts`（`tsc --noEmit` 在 0.2.2-rc.1 / 0.2.1-rc.5 / 0.2.0-rc.1 全绿）。全仓 `as unknown as` = 0。唯一保留的 `as` 是 `provider.ts` 里对 `unknown` 错误码收窄。
- **产物里不得对 `@deepseek-ai/dsh-*` 做值导入**：宿主 profile 的 node_modules 只有 `cosmokit` 与 `schemastery`，`dsh-*` 只活在 App 打包树、不参与插件自己的解析。需要常量时**本地抄 + 哨兵测试**（现有例：`BUNDLED_SKILL_RANK = 600`）。`scripts/verify.mjs` 已把这条变成红灯（产物运行时依赖白名单只有 cordis / schemastery）。
- **`files` 白名单必须用 glob 撞真实产物**：手写 `lib/plugin.js` + `lib/client.js` 会漏掉 9 个被相对 import 的模块，装完直接 `ERR_MODULE_NOT_FOUND`。verify 现在把 `files` 展开成正则逐一覆盖 `lib/**/*.js` 与 `*.d.ts`。
- **声明生成必须显式标注类型**：`const Config = z.object({...})` 在旧版 dsh（schemastery 落到 `.pnpm/...`）上触发 `TS2742`，typecheck 与 test 都看不见、只有 `tsc -p tsconfig.build.json` 会炸。→ CI 的 compat job **必须跑 build**。
- **`lib/` 不入库**（与上游相反）。上游把产物提交进 Git 换取「GitHub 直装免构建」，代价是产物漂移无从审计；我们用 `prepublishOnly` 串四条链路。
- **安装形态是独立验收维度，已机器化**：`scripts/check-install.mjs` 在临时 profile 里真装真 import，tarball 与 `link:` 双形态进 CI。
- **PK 顺序（`plugin.ts`）**：`installSessionStore` → `resolveDshHome` → `resolveSkillDir` → `installSkills` → `installPrompt`。`inject` 只写硬依赖 `['systemPrompt','skills']`；`commands`(#07) / `settings`(#04) 走运行时 `ctx.inject`，因为 0.2.0 系列没有 `commands` 包。
- **`agent/pre-step` 与 `agent/disposed` 的声明住在 `@deepseek-ai/dsh-agent` 的 `declare module '@deepseek-ai/cordis'` 增强里**：只在 `import type` 里出现不生效，必须在回调参数标注中用上 `Agent`，否则同时报 `TS6133` 与 `TS2345`（#06 / #07 会再撞一次）。
- **0.2.2 的 assemble 固定先给 `harness:identity`（order -1000）**：#02 原型没算这段。section 顺序断言必须是 `['harness:identity','deployment:persona-prefix','ponytail-58fly','deployment:persona-suffix']`。
- **`ctx.plugin()` 返回 thenable Fiber 不是 Promise**：`assert.rejects` 用不了，测试里要 try/catch 捕 `error.message`。
- **客户端的 `SlotMap` 靠两层 `declare module` 才齐**：`slots` 服务声明在 `@deepseek-ai/dsh-client-ui-renderer/client`，槽位名合并来自 `@deepseek-ai/dsh-client-ui-plugin-manager/client`。两个都要 `import type {}` 才拿到 `plugins.bundle.config` 的类型。
- **客户端 `inject` 只写 `['slots']`**：不碰 `configForms` / `locale` / `remote`（#05 的活）。服务端 `inject` 缺项是硬失败，与 `dsh.client.inject` 的静默跳过不是一回事。

### #04 配置优先级链与诊断带来的定案（2026-11-07 关票）

- **补丁层读 `describe().user`，绝不读 `value`**：`value = projectForm(form, plainConfig(fiber.effectiveConfig))` 已把环境变量与代码兜底混进去，拿它当 patch 层会让面板把「兜底的 full」说成「用户配的 full」。`user = projectForm(form, override)` 才是 profile 补丁里最后一条带 config 的同 id 节点（`dsh-config-editor/lib/index.js:39-63`）。`base` 是继承层（摘掉本插件所有 config 后重新合成），**诊断的第二项与第三项就差在 `base` 与 `user` 这一对**。
- **`SettingsForms` 的 `update` / `replace` / `mutate` 全部返回 `Promise<void>`**（`dsh-settings/lib/types/index.d.ts:96-114`），没有任何一个交回新 revision → 上游 B-02「改一次成功、改第二次永远失败」的根因就在这里。正解：catch `code === 'SETTINGS_CONFLICT'` → 重新 `describe()` 读 `revision` → 再写一次，**只重试一次**（第二次仍冲突说明有别的写入者在竞争，无限重试会把一次点击变成写盘风暴）。
- **认 `code` 不 `instanceof`**：`@deepseek-ai/dsh-settings` 对本包是纯类型依赖，产物里裸 import 它必然 `ERR_MODULE_NOT_FOUND`（宿主 profile 解析不到）。
- **三个字段全 `.volatile()`，且 `.volatile()` 与 `.default()` 互斥**：`volatileForm(schema)` 对非 volatile 的 Config 返回 `undefined` → 条目从 `describe()` 里整个消失、写入抛 `has no volatile fields`。实测 `z.string().default('x').volatile()` 的 `.get()` 仍是 `undefined`，默认值被丢弃 —— 这条从另一个方向印证了「Schema 不给默认值」。加 volatile 后字段仍存在、仍被校验，只是输出从裸值变 `{get()}` 引用 → 读配置一律三态解包（引用 / 裸值 / undefined）。
- **`ctx.inject` 不是「条件注册钩子」而是「起一个子插件 fiber」**：`Context.prototype.inject = this.plugin({inject, apply, name})`（`cordis/lib/index.js:1672`），返回 `Fiber & PromiseLike<Fiber>`；依赖缺席时子 fiber 不启动、主插件照常跑 —— 这就是降级的全部实现，不需要 `try/catch` 探测。回调抛错会让 Fiber reject，必须 `void Promise.resolve(fiber).catch(…)`。
- **落盘三重保护与「保上一个好值」都不用我们写**：`config-editor.edit()` 已做 `withFileLock` → `hmr.runExclusive` → 条目可用性两次核对 → `fiber.resolveConfig(next)` 预校验 → 写前核对是否被 home patch / 命令行覆盖 → `writeFileAtomic(path, …, {mode: 0o600})` → reconcile 失败写回 `before`；`cordis-plugin-loader._commitVolatile()` 在 volatile 校验失败时只 warn 两条并保留原值。上游那 175 行三件套在本实现里没有对应物。
- **诊断可见性打的是「下一次读」而不是「写入那一刻」**：设置页写入路径非法值根本写不进文件（预校验先炸，调用方直接拿到 `ValidationError`）；手改 YAML 的非法值被 loader 吞掉，只有下一次 `describe()` 才在我们这里冒出 `problem`。这是宿主不通知的事实决定的，不是漏实现。
- **`off` 档的空 section 在 `assemble().sections` 里仍然存在**（`text: ''`）；真正丢空段的是 `renderPrompt`（`dsh-system-prompt/lib/index.js:119-121` 的 `.filter(text => typeof text === 'string' && text.length > 0)`）。**断言要打在 `renderPrompt` 的输出上，不要打在 sections 数量上**。
- **`runtimeOf(ctx)` 用 `WeakMap<Context, ConfigRuntime>` 而非往 ctx 挂属性**：#07 的命令 handler 与 #05 的快照出口要拿同一份状态；往宿主公共对象挂私有字段会撞名且变成隐式约定。`runtimeOf` 只对插件自己的 fiber ctx 有值，根 ctx 返回 `undefined`（已测）。
- **`settings.configure({auto:false})` 在 #05 落地前不调**：那会关掉宿主自动生成的设置表单，用户会面对一个空白设置页。

### #07 prompt 渲染核心带来的定案（2026-11-07 关票）

- **切档只走官方命令层，不再解析用户文本**：`ctx.commands.register({ name, input: { hint, attachments }, handler })` 返回精确 disposer；重名抛错不覆盖；handler 抛错由宿主结算成 `kind:'error'`。上游 `parsePonytailCommand` / `dispatchMessages` / 在 `session/event` 扒 `user/message` 三条路径整条删除——它们既与命令层重复解析，又能看见用户粘贴的代码里恰好写着的 `/ponytail`。
- **`agent/pre-step` 有两个 messages，别混**：`payload.messages` 是本步待处理的输入批次，`decision.messages` 是本步真正送进模型的消息。我们只加工 `decision`，且固定写法是 `const d = await next(); if (d.kind !== 'enter') return d;`。
- **「不累积」的对象是 `decision.messages`，不是会话历史**：每步至多一条通知，新通知原位替换同 kind 的旧通知，不需要时从批次里剔除；历史里已发生的旧通知不碰（改写历史才是真污染）。这与宿主 `dsh-tool-skill` 的目录摘要、`dsh-plan-mode` 的意图旁述两份官方范本一致。**「切档通知的历史语义」这条迷雾就此关闭**：答案是「旧通知永留历史，靠替换式措辞表达语义幂等」——文案里写「本指令集取代此前任何档位说明」，对应宿主 `renderCatalogUpdate` 的「This complete catalog replaces every earlier available-skills list in this session:」。
- **段正文能在运行时看见 agent，但类型不承认**：`AssembleContext` 只声明 `{ scope?, signal? }`，实装 `dsh-agent/lib/index.js:407-413 assembleContextFor()` 返回 `{ agent, scope: agent, ... }`，调用点 `dsh-agent-loop/lib/index.js:685`。baseline 锁靠这个未声明字段实现，**必须写降级**（读不到就退回全局活档位，不抛错、不让段消失）。依赖点收敛在 `AgentAssembleContext` 一个接口名上。
- **分层矩阵会逼出依赖倒置**：`prompt` 需要 config 的活档位与 state 的 baseline，但矩阵规定四层互不可见。解法是 `src/prompt/port.ts` 只声明 `{ readonly mode; ensure(id, fallback) }`，由 `plugin.ts` 造适配器；`describeError` 从 `config/runtime.ts` 下沉到 `src/l0/errors.ts`（config 保留 re-export 不动调用点）。**适配器里的 `mode` 必须是 getter**：写成字段会冻结成构造时的快照，切档不生效而面板显示正常。
- **中文正文的字节数不等于上游的 token 口径**：段正文 2955 字节（中文），上游「约 180 token」是英文原文口径。`scripts/measure-prompt.mjs` 只报 UTF-8 字节数，token 一律给 `null` 并写明「宿主未暴露统一 tokenizer」——不做伪估算。前缀实测 3005 / 3005 字节逐字节相同，切档 reminder 3167 字节。
- **围栏过滤的删除条件必须三条同时成立**：围栏外 + 是合法档位标签 + 不等于当前档位。少第三条会把当前档位也删掉，少第一条会误删围栏内示例行（上游纯行形状匹配误删 14 行）。缓存判据用 `mtimeMs + size` 而非内容哈希：哈希要读完整个文件，而省掉的正是那次读。

### #05 客户端 UI 与降级路径带来的定案（2026-11-07 关票）

- **两套 inject 的失败模式完全不同，可降级只能靠运行时那条**：客户端 `export const inject = [...]` 是硬依赖（服务缺席 → 整条客户端条目不装载，不是降级是消失）；`package.json#dsh.client.inject` 是模块图排序提示（`arriveGraphRow` 对取不到的包静默跳过）。所以顶层只写 `['slots']`，`configForms` 走运行时 `ctx.inject(['configForms'], scope => …)`——缺席时回调永不执行、一次 `slots.register` 都不发生。
- **客户端不能自造 Remote**：`requireStrictCodec`（`dsh-api-gateway/lib/client.browser.js:2101-2109`）要求每个参数 codec `mode === 'strict'`，而 strict codec 只能由 `@deepseek-ai/dsh-typert-generator` 生成——宿主打包树里没有这个包（`ls $H | grep -i generator` 为空）。定案：v0.2 只用宿主已 mount 的 `ctx.remote.settings.*`，**#07 留下的「Typert `@Remote('snapshot')` 是 05 唯一数据来源」这句判据作废**，改为 `configForms.get(PLUGIN_ID).getSnapshot()` 的 `value`/`base`/`user`/`revision` 四段（宿主 `settings.describe()` 的投影）。
- **诊断链的 env 行只能反推，且必须标注是反推**：客户端 platform 是 `browser`、`process.env` 空对象，读不到 `PONYTAIL_DEFAULT_MODE`。判据是「谁的值等于 `value.defaultMode`，命中的就是哪一层；若它既不等于补丁层也不等于兜底，剩下的唯一可能就是 env」。所以 env 行的 note 明写「按最终值与补丁层不一致反推」，不谎称实测。
- **兜底命中判据是「补丁层没给出这个值」，不是「生效值等于兜底值」**：用户层恰好写 `full`（= `DEFAULT_MODE`）时，原判据会让 patch 与 fallback 同时 `hit`，面板同时点亮两行。修成 `!envInferred && patchMode !== effective`。**一行只能有一层 hit**，这是诊断链可读性的底线。
- **`inject` 面的 `hooks` 会被改名，别自己加前缀**：`bindInjectSources` 把 `hooks: { snapshot }` 变成 `props.useSnapshot`（`standardHookPropName` = `use` + 首字母大写）。写 `hooks: { useSnapshot }` 会得到 `useUseSnapshot`。hook 源只需 `getSnapshot()` + `subscribe(fn)`，`ConfigForm` 正好满足。
- **selector 必须是模块级常量**：面板里的 `IDENTITY` 写成内联箭头会让 `useSyncExternalStoreWithSelector` 每帧认为 selector 变了（React 18 无限重渲染）。这条在「renderer 间接造 hook」的装配下格外难看出来。
- **`settings.section` 是 list slot**：注册项必须带 `id`（SlotCore 拒绝无 id 的 list 注册），`order` 定导航位置，`label` 可给 `() => string` thunk（换语言不必重注册）。**不写 `children`**——`RendersCheck` 要求「声明了 children 就必须消费 `renderSlot`」，本包不往下挂子槽位。
- **写路径不自己串行化**：`ConfigFormController.mutate` 内部已有 tail 队列 + `writeGeneration` + `pendingRevision` + `recover(generation)`。返回 `true`/`false` 只区分「宿主接受」与「宿主拒绝」，**传输失败是 reject**，面板必须同时处理返回值与异常。
- **「一键恢复默认」的正确文案是「清除用户层覆盖」**：宿主 `unset` 的语义是回退到**继承值**（§7.3），继承值可能是 profile 组合层给的值；叫「恢复默认」会撒谎。诊断链就在下方，用户能看到回落到哪一层。
- **描述语言切换暂不做旋钮**：六个 SKILL.md 的 description 是「英文首句 + `触发词：` 中文段」单份双语形态（#08 已证），`schema.ts` 的 `locale` 字段至今零消费者。做旋钮等于造一个没有消费端的开关，用户拨了什么都不会变。留给后续（真要做需给六份技能备中英两套 description 并在 `provider.list()` 分流）。
- **右栏 tab 未做且不必现在决定**：`sidebar.right.pane.tab` 是 keyed slot，且要先用 `ctx.sidebarRightTabs.register({ id, kind, patterns, priority, canOpen, title })` 注册类型才能被打开——需额外注入 `sidebarRight` 与 `sidebarRightTabs`，并把可降级面从 1 个服务扩到 3 个。本票的价值是「诊断链可见 + 可降级」，不是「多一个入口」。
- **`prepublishOnly` 曾引用未定义的 `check:matrix`**：`scripts/dsh-matrix.mjs` 早就在（支持 `--check`），但 `package.json#scripts` 从未定义它 → 发布前六道门必在第 5 道失败。已补 `"check:matrix": "node scripts/dsh-matrix.mjs --check"`。

### 最终依赖图与并行/串行排布（2026-11-07 收尾复核）

| 票 | blockedBy | 内容 | 排布 |
|---|---|---|---|
| 03 | — | 新仓库骨架 + L0 归一化（含 `coerceMode`） | **已完成（2026-11-07 关票）** |
| 04 | 03 | 配置优先级链与诊断（写面 `config/`） | **已完成（2026-11-07 关票）** |
| 06 | 03 | 会话状态内存 Map + `agent/disposed`（写面 `state/`） | **已完成（2026-11-07 关票）** |
| 10 | 08, 03 | 技能 provider（写面 `skills/`；08 已关） | **已完成（2026-11-07 关票）** |
| 07 | 02, 03, 04, 06 | prompt 渲染核心（写面 `prompt/`） | **已完成（2026-11-07 关票）** |
| 05 | 12, 07 | 客户端 UI，v0.2 范围（12 / 07 已关） | **已完成（2026-11-07 关票）**，写面 `client/` |
| 11 | 07, 10 | 发布卡口 v0.1（07 / 10 已关） | **已关（2026-11-07）**：v0.1 产物就绪，见 #11 的 ## Answer |
| 13 | 10 | 判据 8 落地：技能 provider 越界防护 + 告警文案修复（写面 `src/l0/within.ts` + `src/skills/provider.ts` + `test/skills-within.test.mjs`） | **已完成（2026-11-07 关票）** |
| 14 | — | 客户端入口接线：回补 `dsh.client` + verify 联动检查 + 文档口径（写面 `package.json` / `scripts/verify.mjs` / 三份 md） | **已完成（2026-11-08 关票）**，无前置 |

- **为什么 04/06/10 能并行**：三者写面完全不重叠（`config/` / `state/` / `skills/`），合拢只需 `plugin.ts` 装配，不产生冲突。
- **为什么 07 当初必须等 04+06**：07 要渲染优先级诊断链（依赖 04 的恒 3 项报告）与读写会话状态（依赖 06 的内存 Map）；且 `coerceMode` 是 07 的写模式入口，由 03 产出。
- **为什么 05 只等 07（且这条理由已在关票时被实测修正）**：原判据是「07 产出 Typert `@Remote('snapshot')` 是 05 唯一数据来源」。实测证明客户端无法自造 Remote（strict codec 只能由宿主生成器产出，宿主树里没有该生成器），真正可用的是 `configForms.get(PLUGIN_ID)` 的 `value`/`base`/`user`/`revision` 四段。**依赖边的方向仍成立**——05 需要 07 钉下来的档位语义与 `coerceMode` 唯一写入口，只是数据通道换了。
- **为什么 11 只等 07、10**：07 与 10 分别是这条主线唯二的两个产出面（提示词 + 技能），04/06 已由 07 的依赖链传递覆盖，不必重复连边。
- **去掉了两条传递冗余边**（05 的 03/04、11 的 04/06）：它们都已通过 07 的依赖链满足，重复连边会让 blockedBy「多出来」而不改变实际排布。当前 12 张票每张恰好一条 `Blocked by:` 行，隐藏注释 `DSH-BLOCKED-BY` 与正文逐票一致，已用脚本校验 ALL_CONSISTENT。
- **deck 的「可接 0 张」是统计口径问题不是数据错**：markdown 后端在 `assignees` 缺省时把工单记为 indeterminate（`tracker/deck-derive.js` 的 `claimedOf` 返回 null），不计入 frontier。**实际前沿必须按「open + 未认领 + 全部 blockedBy 已 resolved」手算**。03 关票后前沿曾是 04 / 06 / 10 三张并行，随后收缩到 07 一张；07、11、05 依次于 2026-11-07 关票。**12 张原计划票已全部 resolved。**
- **但 2026-11-07 的地图完成核对推翻了「八条判据全部落地」这句话**（见下节「完成核对」）：判据 8 只有决定没有实现，#05 的客户端入口没接上，三份文档口径仍停在 v0.1。已补两张票（#13 / #14），它们与前 12 张互不阻塞——**#13 与 #14 可并行**（#13 已关，见下节定案）（写面分别是 `src/skills/`+`test/skills-catalog.test.mjs` 与 `package.json`+`scripts/verify.mjs`+三份 md，合拢零冲突）。另有两件不属任何票阻塞面的动作：① 把 `dsh-ponytail-58fly-0.1.0.tgz` 发出去（需要 npm 账号与 provenance 环境）；② `Not yet specified` 里仍开的两条产品取舍（usage dashboard、单技能开关是否自造）。
- [新仓库骨架：模块边界、宿主类型 shim、构建链、基础 CI](issues/03-新仓库骨架-模块边界-宿主类型-shim-构建链-基础-ci.md): 骨架落地：11 源文件 / 37 产物；typecheck / build / verify / test 四条链路在 dsh 0.2.2-rc.1、0.2.1-rc.5、0.2.0-rc.1 上全绿，test 33 条；tarball 与…
- [技能 provider：6 技能、双语描述、invocation 策略、disable-model-invocation](issues/10-技能-provider-6-技能-双语描述-invocation-策略-disa.md): 六份中文正文 + provider 工厂形态 + `get(candidate)` 取 locator；补上"单条坏技能拖垮整份目录"的按粒度收口；invocation 六份全不设禁用键、旧键抛错；描述阈值 480（宿主 500 的 UTF-16 折叠口径）；`check:skills` 四类断言进 prepublishOnly + CI，新增 drift job 每日只报警不同步；真宿主实测 list=6、get 全文、dispose 归 0。
- [会话状态：内存 Map + agent/disposed 清理 + 子智能体真抑制](issues/06-会话状态-内存-map-agent-disposed-清理-子智能体真抑制.md): 五条待决点全部定案——子会话判定 `origin === 'subagent'`（不用 `parentSession`，宿主注释警告历史 fork 会残留）；`PONYTAIL_SUBAGENT_MATCHER` 从「用户正则」降级为逗号分隔子串词表（匹配 `agentPreset`，护栏 32/64/1024，`Array.some + includes` 零正则 → H-05 的 ReDoS 面构造上消失）；`baselineMode` 唯一裁决点 `agent/created` 同步写（`serial` 钩子不得 await）；能力缺失 fail-open、被抑制返回 `null` 而非 `'off'`；`bindLifecycle(ctx, store, hooks)` 解耦让清理可被直调断言 `size === 0`。写面 `state/`，可开工，解冻 #07。
- [配置优先级链与诊断：env > profile 补丁 > 兜底，Schema 不给默认值](issues/04-配置优先级链与诊断-env-profile-补丁-兜底-schema-不给默认值.md): 三级链做成纯函数（恒 3 项、无 I/O、不 import 宿主包），补丁层读 `describe().user` 而非 `value`；三个字段全 `.volatile()` 且全无 `.default()`（两者实测互斥）；`SettingsForms` 三个写方法都只返 `Promise<void>` → 写入后必 `describe()` 回读 revision，冲突只重试一次；`ctx.inject(['settings'], …)` 即降级本身；落盘与「保上一个好值」宿主已做完，上游 175 行三件套无对应物。测试 33 条（13 纯函数 + 12 替身 + 8 真 Cordis），全仓 102/102 pass。
- [prompt 渲染核心：baseline 锁 + 尾部 reminder + 单通知幂等 + 围栏过滤 + 进程内缓存](issues/07-prompt-渲染核心-baseline-锁-尾部-reminder-单通知幂等.md): 六件事全部落地，验收四项全绿：`npm test` 155/155 pass、`pnpm run verify` 通过（24 源文件 / 89 产物）、`node scripts/measure-prompt.mjs` exit 0。
- [发布卡口：宿主矩阵 CI + 产物纯度检查 + 首版发布（v0.1 纯宿主侧）](issues/11-发布卡口-宿主矩阵-ci-产物纯度检查-首版发布.md): 六项交付成立并经独立只读审计确认；三道卡口各带失败用例（verify --selftest 14/14、check-install --selftest 清空技能目录必红）；compat 矩阵穷举 registry 上区间内全部 **15** 个版本（票面写的 0.2.2-rc.9 实际未发布），每格打 tarball 真装配；
  `dsh-matrix --check` 防矩阵与 engines 漂移；零垃圾判据升级为「装前/装后/卸载后」三次快照差集 + `uninstallProbe`；skillDir 改由发布物自身声明 `${package}` 标记，装完即用；审计逼出的一处真不一致（声称零 UI 却真渲染一张空卡片）已按彻底方案治好——删 `dsh.client` 声明、`apply` 不注册槽位、tarball 内 `plugins.bundle.config` 命中 0。
- [客户端 UI（可降级，v0.2 范围）：设置面板 + 档位快照通道](issues/05-客户端-ui-可降级-设置面板-档位快照通道.md): 客户端 UI（v0.2）已落地：一个可降级、零自定义色值的设置页分区；`/ponytail` 命令与配置文件两条等价路径都有自动化测试兜住。**三条验收全部有可复现证据**；七件事里六件照做，第 2 条与第 4 条各有一处按实测改口径（见「…
- [判据 8 落地：技能 provider 越界防护 + 告警文案修复](issues/13-13-判据-8-落地-技能-provider-越界防护-告警文案修复.md): 判据 8 已从"决定层"落到"实现层"，三条逃逸路径全部收口（符号链接 / 伪造 locator / 悬空链接），`:129` 转义 bug 已修，14 条新测试钉住（修复前 2 红、修复后全绿）。

### #13 判据 8 落地带来的定案（2026-11-07 关票）

- **围栏判定必须是纯函数、必须放 l0**：`src/l0/within.ts` 的 `isWithinRoot(root, candidate)` 零 `node:` 导入、零 I/O，两种分隔符都归一。放 l0 是 verify 分层矩阵逼出来的（`skills` 可 import `l0`，反向不成立），而它本身也确实与文件系统无关。
- **不能用裸 `startsWith` 判「在目录里」**：`/a/bc` 以 `/a/b` 开头但是兄弟目录，攻击者只需在根旁边放一个同前缀目录就整条绕过。判据是「等于根，或以 根+斜杠 开头」。
- **不折大小写**：`realpath` 已给真实大小写，再折一次会在大小写敏感的文件系统上放过真实越界。唯一例外是 Windows 盘符字母。
- **fail-closed**：非绝对路径、含 `.` / `..` 段、空串一律判否。「说不清」必须当成「不在里面」，否则一个没规约的 `/skills/../../../etc` 就让校验形同虚设。
- **两侧必须都 realpath，且这不是理论风险**：改完后 `test/composition.test.mjs:127` 的 `resourceBase.path === join(dir,'ponytail')` 当场变红——provider 现在交出 realpath 后的路径，而 `os.tmpdir()` 给 `/var/folders/…`、`realpath` 回 `/private/var/folders/…`。已改成两侧都过 `realpath` 再比。**凡是用 `os.tmpdir()` 造目录又比路径字符串的测试都会踩这一脚。**
- **根缓存缓 Promise 而不是值**：`root ??= realpath(skillDir).catch(…)`。并发 `list()` 不各解析一遍，第一个失败也不会永久卡住；`null` 表示目录不存在，走原有空数组分支。
- **悬空符号链接是第三条逃逸路径**：`dirent` 是 lstat 语义，指向已删除目标的链接照样出现在列表里，对它的 `realpath` 抛 `ENOENT`。不单独接住的话一条悬空链接就让整个 `list()` 抛错，正好违反「越界一律降级」→ 已收口成 warn + continue。
- **`get()` 不能靠「读出来是空 body」兜越界**：`readSkillMarkdown` 把 I/O 失败折成空 body，看着像防住了，但那只对「文件不存在」成立——越界路径只要文件真存在就读到全文。判定必须自己 realpath + 判围栏，落在读取之前。
- **降级与重抛的分界**：`ENOENT` / `ENOTDIR` 降级成 undefined 或跳过；`EACCES` 之类系统错误照常重抛。与宿主 `dsh-skill-filesystem` 的 `isAbsentSkillPathError` 分界一致。
- **warn 必须能定位**：越界文案写出真实逃逸目标与根，解析失败文案写出条目路径与原因。测试断言逃逸目标落在 `realpath(outside)` 的真值上，并额外断言文案里没有未插值的占位符字面量。

### #14 客户端入口接线带来的定案（2026-11-08 关票）

- **「源码有注册」与「宿主会装载」是两件事，中间隔着 `package.json#dsh.client`**：`resolveMeta()`（`dsh-client-modules/lib/index.js:789-802`）见到 `decl === undefined` 直接 `return null`，`exports["./client"]` 在不在、`lib/client.js` 有多大都不影响这个判定。#05 之后所有质量门全绿而真机仍然没面板，根因就在这条缝：`verify` 当时的条件写成 `clientBlock === undefined || (…)`，结构上允许不声明。
- **`settings.section` 的声明方不是 `dsh-client-ui-settings`**：实测后者包内 grep `settings.section` 零命中，它只提供 `configForms`（`lib/client.js:1270`）；槽位由 `dsh-client-ui-settings-general/lib/client.js:1547-1550` 在 `ctx.slots.register` 的 `children` 里声明（`{kind:"list", scope:"root"}`），`:1587-1594` 自己又注册了「通用」那条。→「面板不出现」因此有两种成因，README 的 FAQ 按这两种写，不要笼统说「宿主没装」。
- **`dsh.client.inject` 里写的必须是包全名**：`parseDshClient` 只校验「是字符串数组」，真正拿它做模块图排序的是 `dsh-client-modules`；写服务名（`slots` / `configForms`）会被静默匹配不到且不报错。本仓最小声明只放两个真提供服务的包：`-ui-settings`（`configForms`）与 `-ui-renderer`（`slots`）。不写 `immediately`（面板不抢首屏）、不写 `external`（没有 gateway 侧依赖）。
- **联动检查必须双向，因为两个方向的坏法不一样**：有声明无注册 → 宿主装出一张只有标题的空卡片（#11 ⑥ 的「半张 UI」）；有注册无声明 → 宿主根本不装载（#14 本身）。只查一边，另一半就能悄悄漂掉。
- **两条检查视野不同，都要留**：`scripts/verify.mjs` 看得见仓库里的源码与声明两侧；`test/manifest.test.mjs` 看得见**发布出去的字节**（中间隔着 `npm pack` / `parseDshClient` / `clientExportOf` 三层），所以后者的重心是「inject 的每个包名都真在 devDependencies」「`exports["./client"]` 指向磁盘真文件」这两条只有打包后才成立的断言。
- **`slots.inject` 的静默等待有边界**：槽位未声明时 `if (spec === void 0) return;`（`dsh-client-ui-renderer/lib/client.js:1393`）是静默等待；但注册回调**自己抛错**走另一条路——`INACTIVE_EFFECT` 静默 stop，其余 `queueMicrotask(() => { throw failure; })`。所以「不为 UI 包缺席写防御分支」的前提是回调不抛错。
- **`scripts/check-install.mjs` 对 `dsh.client` 完全盲**：505 行只查 files 白名单里有没有 `lib/client.js`（`:390`）与它是不是 `__ModuleLoader__.load` 外壳（`:402-404`）。「装得上但装不进去」这一层此后由 verify 的联动检查兜住。
- **改 CHANGELOG 会撞上 CI 的版本一致性闸**：`.github/workflows/ci.yml` 的 pack job 取「第一行以 `## ` 后跟数字开头的版本头」，`[Unreleased]` 会被跳过、落到 0.1.0 那行；package.json 若保持 0.1.0 则字符串对、语义错。故版本抬到 **0.2.0**——装上去能看到的东西变了，按 semver 是 minor。
### 完成核对（2026-11-07）：12/12 这个数字不成立，补两张票

用户要求不信 12/12，逐条拿代码与实测证据验 Destination 八条判据。**结论：7 条成立，判据 8 未落地；另有 #05 的客户端入口没接上、三份文档口径说反。**

| 判据 | 结论 | 证据 |
|---|---|---|
| 1 干净 DSH 0.2.2 可装 | ✅ | `engines.dsh = >=0.2.0-rc.1 <0.2.3-0`；peer 只有 cordis + schemastery；零 `dependencies`；`dsh-matrix --check` → 覆盖区间内 15 个版本 |
| 2 零缓存破坏三层 | ✅ | `npm run measure` 真跑：整条 prompt 3005 / 3005 字节、**逐字节相同 true**；ponytail 段 2955/2955；token `null`（宿主无统一 tokenizer） |
| 3 零 tool 注册 + 6 技能经 provider | ✅ | `grep "ctx.tools\|registerTool" src/` 只命中两处注释；`test/skills-catalog.test.mjs` 在真宿主断言 `list({})` 恰好 6 个、provider=`ponytail-58fly`、rank 550、dispose 归 0 |
| 4 净删自愈链/持久化 | ✅ | `grep -rln "session-states\|ponytail-active\|LRU\|heal\|自愈" src/ test/ scripts/` 零命中 |
| 5 围栏感知 + 真 Cordis 组合测试 | ✅ | `test/fence.test.mjs` 10 条、`test/ladder.test.mjs` 24 条（V15 围栏内档位行一律保留、V16 缩进行按围栏外、V17 off 行）；`test/composition.test.mjs` 10 条全是 `new Context()` + `await ctx.plugin()` |
| 6 零 UI 可跑 | ✅（口径需改） | `test/client-wiring.test.mjs:158` configForms 缺席零注册零抛错；`test/commands.test.mjs` 6 条装真 `dsh-commands` 证明卸 UI 后 `/ponytail` 完整。**但「零 UI」是 v0.1 口径，#05 已交付 UI，「可降级」成立而「零 UI」不再是现状** → 见 #14 |
| 7 发行物纯度 | ✅ | `scripts/verify.mjs:576-577` 动态代码扫描器（`new Function(` / `eval(`）+`:597` 包名白名单；`files` 白名单与产物一致性；`.gitignore` 含 `lib/` |
| 8 skillDir 越界防护 | ❌ **未落地** | `src/skills/provider.ts` 唯一 `startsWith` 是 `:107` 的 `entry.name.startsWith('.')`。`:106` 放行符号链接、`:108` 无 realpath、`:150` 全信任 `candidate.locator.path`。探针实测：符号链接逃到 skillDir 外读到正文；伪造 `{locator:{path:'/etc/hosts'}}` 返回 `/etc/hosts` 全文 → 见 #13。**已由 #13 关闭（2026-11-07）：14 条新测试钉住，修复前 2 红、修复后全绿。** |

顺带实测到的两处：

- **#05 的客户端入口没接上**：`package.json#dsh` 实测是 `{"bundle":{"patch":"./cordis.patch.yml"}}`，**没有 `client` 键**。宿主唯一发现入口 `$H/dsh-client-modules/lib/index.js:789-802` 的 `resolveMeta()` 在 `decl === undefined` 时直接 `return null`，`exports["./client"]` 与 `lib/client.js`（16322 字节，真注册 `settings.section`）都不影响这个判定。→ **v0.2 面板在真机上不会出现**。这是 #11 删声明、#05 恢复注册却未回补声明留下的缝，`scripts/verify.mjs:160-170` 结构上允许「不声明」故抓不到 → 见 #14。
- **文档三处说反**：`CHANGELOG.md:7`、`:39` 与 `docs/migration-from-wenaixi.md:23`、`:62-64` 仍写「v0.1 零客户端 UI / 不声明 `dsh.client`」；`README.md:190` 仍写面板挂 `plugins.bundle.config`（#12 已定案那是插件详情页 keyed slot，实现早已改 `settings.section`）→ 一并归进 #14。
- **附带的真 bug**：`src/skills/provider.ts:129` 的模板占位符被反斜杠转义（`\\${name}` / `\\${path}`），实测告警原文逐字输出 `技能 ${name} 缺少 description…`，文件名与路径全丢；`test/` 零覆盖。→ 一并归进 #13。

**状态修正**：12 张票的 `Status` 实测全部 `resolved`，**无漏关、无误开**；票面 `Blocked by:` 与隐藏 `DSH-BLOCKED-BY` 逐票一致。真正的问题不是状态错，是**判据与实现脱节**——决定写进了 Decisions，却没有票承担实现。

**依赖边复核（新补两张）**：#13 blockedBy 只有 `10`（它改 `skills/` 的 provider，10 是 provider 的作者，读懂 #10 的按粒度收口原则是前提），`10` 已 resolved 故立即可做。#14 无前置（改的是 `package.json` 清单、`verify` 检查与三份文档，不依赖任何既有代码的决定）。**#13 与 #14 写面完全不重叠 → 并行**，两条都不连对方的边。两票都不阻塞既有的 12 张（它们已全部 resolved），故地图保持 open。**#13 已关（2026-11-07），#14 也已关（2026-11-08）——至此 14 张票全部 resolved，前沿为空。**
- [客户端入口接线：回补 dsh.client 声明 + verify 联动检查 + 文档口径归位](issues/14-14-客户端入口接线-回补-dsh-client-声明-verify-联动检查.md): 根因是入口声明从来没回补（`resolveMeta()` 见 `dsh.client === undefined` 直接 return null），不是面板写坏了；回补最小声明 + verify 双向联动检查（19/19 selftest）+ 三份文档口径归位 + 6 条清单形状测试，版本抬 0.2.0，205/205 全绿。


## Not yet specified

战争迷雾 —— 要靠后续决策解开的问题。**2026-11-08 第二次完成核对的结论是本段清零**：原先开着的三条在这一轮全部分流，没有一条留下。

- `usage dashboard` / 状态带可视化 → 越出 Destination 八条判据，移入 **Out of scope**。
- 技能级单开关是否自造 → 同上，宿主无原语且收益不支持，移入 **Out of scope**。
- 真机装载验证怎么做才不靠人眼 → 不是待决问题而是施工活（要造临时 profile + 真宿主进程的装置），进 **交棒** 的 /to-spec 范围。

历史清零记录（保留可追溯，勿再当未决项）：已由 #01 解开（新包名 / 全局档+内存覆盖 / v0.1 不带 UI）；已由 #07 解开（切档通知的历史语义）；已由 #02 / #08 / #09 / #12 解开（正文语言、上游跟随、六阶、500 上限口径、裁剪方式、版本区间、客户端可做边界）；已由 #13 确认（越界防护只需覆盖读路径，无写侧逃逸面）。

## Out of scope

- ponytail 之外的 token 经济学（caveman 文体压缩、RTK shell 压缩、gain 看板）。
- 多宿主适配（claude / cursor / opencode / gemini / copilot）—— 那是 DietrichHebert 上游的事。
- makuralymi 式的纯 UI 彩蛋（鞭子物理动画）。
- 官方 `deepseek-ai` 组织下的内置插件路线（该位置无对应包）。
- **usage dashboard / 状态带可视化**（生态里 @kb1slnlabs 有）：越出 Destination 八条判据，属 v0.3+ 的产品扩展，本 effort 不做。
- **技能级单开关**：宿主 `dsh-skill/lib/index.js:120` 的 Config 无 `enabled` 字段，官方无原语；自造只能在 `provider.list()` 里过滤，与宿主的 `catalogDescriptionMaxLength` / `rank` 逻辑脱钩，成本收益都不支持在 v0.2 做。
## 探索结论

**探索到此结束**（2026-11-08 核对）：Destination 八条判据逐条取证，全部成立；14 张子票全部 resolved，无漏关、无误开，前沿为空。本轮不只看数字——六道门与一次真装端到端都重跑过。

| 判据 | 结论 | 本轮实测证据 |
|---|---|---|
| 1 干净 DSH 0.2.2 可装 | ✅ | `node scripts/check-install.mjs --mode assemble --tarball ./dsh-ponytail-58fly-0.2.0.tgz` 退出 0：临时 profile 里 `import ok: name=ponytail-58fly inject=["systemPrompt","skills"]`、技能面六个、四档提示词体量 `{"off":0,"lite":1203,"full":1188,"ultra":1206}`、`$DSH_HOME` 装后只有 `/cordis.yml`、卸载后为空；`check:matrix` 覆盖区间内 15 个版本 |
| 2 零缓存破坏三层 | ✅ | `npm run measure`：整条 prompt 切档前后 3005 / 3005 字节、**逐字节相同 true**；ponytail 段 2955 / 2955；当轮 reminder 3167 字节；token `null`（宿主未暴露统一 tokenizer） |
| 3 零 tool + 6 技能经 provider | ✅ | `grep -rn "ctx.tools\|registerTool" src/` 命中 **0**；assemble 实测技能面 `ponytail / -audit / -debt / -gain / -help / -review` |
| 4 净删自愈链/持久化 | ✅ | `grep -rln "session-states\|ponytail-active\|LRU\|heal\|自愈" src/ test/ scripts/` 命中 **0 个文件** |
| 5 围栏感知 + 真 Cordis 组合测试 | ✅ | `test/ladder.test.mjs:80` 的 `V15 围栏内的档位行一律保留` 断言 `filtered.includes('| **lite** |')`；`test/composition.test.mjs` 全是 `new Context()` + `ctx.plugin()` |
| 6 客户端 UI 可降级 | ✅ | `test/client-wiring.test.mjs` 证 configForms 缺席零注册零抛错；`test/commands.test.mjs` 装真 `dsh-commands` 证卸 UI 后 `/ponytail` 完整；`package.json#dsh.client` 已回补，`scripts/verify.mjs` 双向联动检查兜住「装得上但装不进去」 |
| 7 发行物纯度 | ✅ | `scripts/verify.mjs:335` 运行时依赖白名单只有 cordis / schemastery；`:669-670` 禁 `new Function(` 与 `eval(`；`files` 白名单与产物一致性；`.gitignore` 含 `lib/` |
| 8 skillDir 越界防护 | ✅ | `src/l0/within.ts`（4597 B 纯函数）+ `src/skills/provider.ts` 两处 realpath 收口；`test/skills-within.test.mjs` 14 条，修复前 2 红、修复后全绿 |

**质量门（本轮重跑）**：`npm test` **205 / 205 pass / 0 fail**；`npm run verify` 26 源文件 / 97 产物 / 1 提醒；`npm run check:skills` 6 技能（阈值 480/500，上游漂移检查因 GitHub 403 跳过）；`npm run check:matrix` 15 版本全覆盖；`npm run measure` exit 0；`check-install --mode assemble` exit 0。

**判定：需要接着做。** 走不了「结论已是最终决定」那条：Destination 第一句是「**发布**一个我们自己维护的 ponytail 插件」，而 `npm view dsh-ponytail-58fly` 至今 404——仓根的 `dsh-ponytail-58fly-0.2.0.tgz`（90863 B / 60 files）是可发布物，还没真发出去。剩下的都是施工活，没有待决事项。

## 交棒

探索部分已完成、没有待决事项，剩下的施工活走交棒（每次交接都记在这一节，中断后照此接上）：

- **/to-spec：已生成**（2026-11-08）。规格落在 `.scratch/publish-0.2.0/spec.md`（198 行 / 21149 字节，`Status: ready-for-agent`，标签 `ready-for-agent`），标题「规格：把 dsh-ponytail-58fly 0.2.0 发出去，并让『宿主看得见我们』成为机器证据」。它覆盖原先规划的三件事，但按实测收窄了一处：① 首次发布 0.2.0 到 npm，只经 `prepublishOnly` 七道门，不用出产地签名（当时本仓不是 git 仓库、没有远端；**该前提已于 2026-11-08 失效——`58fly/dsh-ponytail-58fly` 是公开 GitHub 仓库，`main` 上有 commit 与 tag `v0.2.0`；但「不做产地签名」的决定保持：`--provenance` 与「署名信息各项为空」直接冲突，实测 `dist.attestations = null` 仍成立**），失败默认不撤回而是发补丁版；② 发布后从 registry 拉回真实字节复验（`npm pack` 取包 + `dist.integrity` 同源比对 + 复用 `check-install --mode assemble`，不新增参数面）；③ 「宿主看见我们」的机器证据——接缝选装配探针已起好的那棵真 cordis 树，挂上宿主的客户端模块登记服务，五条断言（模块图含本包 / 产物路径非空且真实存在 / 发现函数非空 / 平台是 web / 外部依赖是数组且路径同一个文件），配五种反向形态。**原计划的「临时 profile + 真宿主进程 + 断言设置页真多出那一栏」被证伪并降级**：槽位声明方是否存在于目标环境是用户环境的事实，复现整套客户端运行时的成本与收益不成比例，界面渲染与视觉验收明确列为 Out of scope。
- **接缝（已由本人确认）**：整份规格只用一条接缝——装配探针起的那棵真 cordis 树。它已于 2026-11-08 实测跑通：正向一次（真树 + 装好的 0.2.0 tarball，模块图 `["dsh-ponytail-58fly"]`、`resolveMeta` 返回 `platform: web`、`clientPath` 指向临时 profile 里的真实产物、`inject` 两项、`external` 空数组、`immediately: false`）与反向五态（原样有结果 / 删 `dsh.client` 返空 / 平台改非 web 返空 / 删 `exports["./client"]` 抛「声明了客户端入口但导不出产物」/ 恢复原样又有结果）。两代失败探针的教训已写进规格的进一步说明：不能拷包管理器布局、仓库只 hoist 已声明的包。
- **/to-tickets：已生成**（2026-11-08）。规格票编号 **00**（`.scratch/publish-0.2.0/spec.md`，与本图的 00 同号但分属不同目录）。拆出 4 张 tracer-bullet 实施票，全部落 `.scratch/publish-0.2.0/issues/`：① **01 宿主看见我们：装配验证里加客户端模块发现断言**（无前置）；② **02 发布前置：清单出处字段与安装文档归位**（无前置）；③ **03 发布后复验：从 registry 拉回真字节再走一遍装配与宿主断言**（等 01）；④ **04 首次发布 0.2.0：发出去、拉到真字节、留档三段证据**（等 01、02、03）。
- **并行与串行**：01 与 02 互不等待（写面不重叠：装配探针与自检 vs 清单、说明文档、发布清单），03 要复用 01 长在装配验证里的断言故串在 01 之后，04 是三件齐备后的那一次真实动作故串在 01+02+03 之后。
- **实施票全部完成**（2026-11-08）：01 / 02 / 03 / 04 四张全部 resolved，前置链条按原计划走完，没有绕行、没有并串翻转。04 的交付：0.2.0 于 2026-11-07T19:12:32Z 真实发布到 npm（`dist-tags.latest = 0.2.0`），从 registry 拉回字节复验通过，七份证据留档 `docs/releases/0.2.0/`。**当前前沿为空。**
- 两个交接都完成后，按 wayfinder 规则关闭这张地图（届时补一条收尾评论）。

**2026-11-08 核对后清零**：剩下三条在本轮全部分流——`usage dashboard` 与 `技能级单开关` 越出 Destination 八条判据，移入 **Out of scope**；`真机装载验证` 不是待决问题而是施工活，已进 **交棒** 的 /to-spec 范围。本段此后为空，若日后重画目的地再重新起雾。

## 证据锚点（复用时不贴全文，只记路径与一句话结论）

| 路径 | 一句话结论 |
|---|---|
| `docs/research/upstream-ponytail-source-audit.md` | 上游 S0–S3 缺陷、A1–A6 资产、8 条重构优先级、3 条硬结论 |
| `docs/research/ponytail-plugin-landscape.md` | 13 npm 包 / 14 仓横向对比、10 条可借鉴做法、生态风险 |
| `docs/research/dsh-plugin-contract-0.2.2.md` | 0.2.2-rc.1 宿主契约实测：API 全兼容、唯一硬拦是 `engines.dsh` 区间、官方已内建 commands/tool-skill/configForms、仍需自造 7 项；**§六（#03 补）**：宿主 npm 发行物完整发布 `.d.ts`（63 个，Electron 打包才裁剪）→ 零 shim、`skipLibCheck` 三处硬理由、TS2742 与显式标注修法、产物值导入 `dsh-*` 必炸 |
| `docs/research/ponytail-prototype-fence-and-composition.md` | 围栏感知 B2 状态机 17/17 形状正确、围栏零误删；真 Cordis 组合测试 11/11 固化 5 条宿主契约（Config 必须 schemastery、provider.get 收 candidate、`ctx.dispose` 不存在要用 `ctx.fiber.dispose()`、section/registerProvider 内部已绑 effect、getSectionOrder 只查内置表）；漏写 inject 的危险不对称实证 |
| `docs/research/skill-body-truth-source-and-language-policy.md` | 技能正文真源 v5.3.3、六阶口径、中文重写保留英文触发词、描述 500 上限为 UTF-16 code unit（阈值定 480）、宿主技能无检索匹配 |
| `docs/research/dsh-0.2.2-compat-and-peer-range.md` | PR#5 三条字节级声明成立（typert-protocol 仅 0.2.1-rc.2 起）、engines.dsh 与 peer 是一道闸、区间定 `>=0.2.0-rc.1 <0.2.3-0`、order 50 落第 3 槽 |
| `docs/research/skill-catalog-contract.md` | 技能目录契约：`get(candidate)` 而非 `get(name)`、单条坏技能必须按粒度收口、`disable-model-invocation` 三处自杀路径（:944/:955/:875-878）、描述 480/500 的 UTF-16 折叠口径、斜杠命令必须留半角空格；含 `pnpm run check:skills` 的四类断言与上游漂移检查（#10 的实现依据） |
| `docs/research/dsh-client-ui-surface-0.2.2.md` | 客户端 UI 稳定面：configForms 服务名与 entryId 参数、ConfigFormController 面、真实 slot 清单、commandUi 七方法、可降级边界 |
| `docs/research/dsh-plugin-contract-0.2.2.md` **§九（#05 补）** | 客户端不能自造 Remote（strict codec 无生成器）；describe 三段来源与 env 只能反推；两套 inject 的失败模式；`settings.section` 是带 id 的 list slot；`hooks` 改名规则；写路径不自己串行化；HOST_MODULES 与宿主 seed 表逐字相同；面板只能测产物不能测渲染 |

## Comments

### local — 2026-11-07T10:55:52.546Z
完成核对（用户要求不信 12/12）：12 张票 Status 实测全部 resolved，无漏关无误开，Blocked by 与 DSH-BLOCKED-BY 逐票一致。但 Destination 八条判据里**判据 8 只有决定没有实现**——src/skills/provider.ts:106 放行符号链接、:108 无 realpath、:150 全信任 candidate.locator.path，探针实测「符号链接逃逸读到区外正文」与「伪造 locator 返回 /etc/hosts 全文」两条都成立。另查出 #05 的客户端入口没接上（package.json#dsh 无 client 键，宿主 dsh-client-modules/lib/index.js:789-802 的 resolveMeta 直接 return null，lib/client.js 16322 字节真注册但真机不装载）、三份文档口径仍写 v0.1 零 UI、provider.ts:129 模板占位符转义 bug。处置：补 #13（判据 8 落地 + 告警文案修复，blockedBy 10，10 已 resolved）与 #14（客户端入口接线 + verify 联动检查 + 文档归位，无前置）；两票写面不重叠 → 并行。**地图保持 open，不进 /to-spec 交棒**——按 wayfinder 判定树，核对不通过就不交接。

### local — 2026-11-08T01:15:00.000Z
#14 关票，14 张票全部 resolved，前沿为空。四件事的落点：`package.json` 回补 `dsh.client` 最小声明（`platform: web` + 两个真提供服务的包名）、`scripts/verify.mjs` 加双向联动检查（`--selftest` 19/19）、三份文档口径归位（CHANGELOG / README / migration）、新建 `test/manifest.test.mjs` 6 条。版本抬到 0.2.0 并重打 tarball（`dsh-ponytail-58fly-0.2.0.tgz`，90863 B / 60 files）。质量门：typecheck 0 / verify 26 源文件 97 产物 / test 205 全过 / check:skills 6 技能 / check:matrix 15 版本。三条真发现：`settings.section` 由 `dsh-client-ui-settings-general` 声明而非 `-ui-settings`（后者只提供 `configForms`）；`slots.inject` 的静默等待不覆盖「回调自己抛错」；`check-install.mjs` 对 `dsh.client` 完全盲。**下一步由本人点详情页「完成」做最终核对**；真机装载是否真出面板，留作 `Not yet specified` 里那条新 fog（临时 profile + 真宿主进程的自动化装置，代价未评估）。
### local — 2026-11-08T01:30:00.000Z
第二次完成核对（14/14，只信证据）：Destination 八条判据逐条取证全部成立——判据 1 用 `check-install --mode assemble` 在临时 profile 里真装 0.2.0 tarball（import ok、技能面六个、四档体量 1203/1188/1206、`$DSH_HOME` 零垃圾）；判据 2 用 `measure` 得整条 prompt 3005/3005 字节逐字节相同；判据 3 与 4 的 grep 计数为 0；判据 5 的 V15 夹具仍在；判据 6 由 client-wiring + commands 两套测试与 verify 双向联动检查兜住；判据 7 的 `RUNTIME_ALLOWED_BARE` 与动态代码扫描器在位；判据 8 由 `within.ts` + 14 条测试钉住。六道质量门重跑全绿（test 205/205、verify 26/97、skills 6、matrix 15、measure、assemble）。**判定「需要接着做」**：`npm view dsh-ponytail-58fly` 仍 404，Destination 的「发布」还没发生；三条 fog 已分流（usage dashboard 与技能级单开关进 Out of scope，真机装载验证进交棒）。地图**不关闭**，等 /to-spec 与 /to-tickets 两个交接完成后再收尾。
## 进度

- 进度：100%（2026-11-08T17:35:40+08:00）：第三次完成核对：八条判据逐条重新取证成立，八道门全绿，地图关闭

| 时间 | 动作 | 结果 |
|---|---|---|
| 2026-11-07 | 12 张票全部解完并关票（01 grilling / 02 prototype / 03·04·05·06·07·10·11 task / 08·09·12 research） | 代码 25 源文件 / 185 条测试 / 六道质量门全绿 |
| 2026-11-07 | **地图完成核对**（用户要求不信 12/12） | 八条判据 7 条成立、**判据 8 未落地**；另发现 #05 客户端入口未接、三份文档口径说反、`provider.ts:129` 转义 bug |
| 2026-11-07 | 补票 #13（判据 8 落地 + 告警文案修复，blockedBy 10）与 #14（客户端入口接线 + verify 联动检查 + 文档归位，无前置） | 两票均 open，写面不重叠 → **并行**；地图保持 open |
| 2026-11-07 | 解 #13「判据 8 落地」 | `src/l0/within.ts`（89 行纯函数）+ `src/skills/provider.ts` 三处收口（list 符号链接 / get locator / :129 转义）；新增 `test/skills-within.test.mjs` 14 条（修复前 2 红、修复后全绿）；全量 **199/199 pass**、verify 26 源文件 / 97 产物 |
| 2026-11-08 | 解 #14「客户端入口接线」 | 回补 `package.json#dsh.client`；`scripts/verify.mjs` 双向联动检查（`--selftest` 19/19）；新建 `test/manifest.test.mjs` 6 条；三份文档口径归位；版本抬 **0.2.0**、tarball 重打（90863 B / 60 files）；全量 **205/205 pass**、verify 26 源文件 / 97 产物 |
| 2026-11-08 | **第二次地图完成核对**（14/14，不信数字） | 八条判据逐条取证全部成立；六道门重跑全绿（test 205/205、verify 26/97、check:skills 6、check:matrix 15、measure 逐字节相同 true、assemble 真装 exit 0）；判定「需要接着做」→ 走交棒 |
| 2026-11-08 | **/to-spec 交棒第一步**：产出规格并发到 tracker | `.scratch/publish-0.2.0/spec.md`（198 行 / 21149 字节，`ready-for-agent`）；接缝实测跑通（正向一次 + 反向五态）；原计划的真宿主进程断言被证伪并降级为「宿主发现函数」断言；规格等本人确认接缝后走 /to-tickets |
| 2026-11-08 | **/to-tickets 交棒第二步**：按已确认接缝拆实施票 | 4 张 tracer-bullet 票落 `.scratch/publish-0.2.0/issues/`：01 宿主发现断言（无前置）、02 清单与安装文档（无前置）、03 发布后复验（等 01）、04 首次发布（等 01+02+03）；**前沿 = 01 与 02 并行** |
| 2026-11-08 | **实施票 4 张全部解完**（01 / 02 / 03 / 04） | 01 加宿主判定五项 + 三破一复（selftest 19/19）；02 安装文档改按包名装 + 出处字段 + 发布清单七道门；03 新建 `verify:published`（从 registry 拉真字节复验，16 条测试）；04 真发布 0.2.0 并留档七份证据。全量 **221/221 pass**，`verify:published` exit 0。**前沿为空** |
| 2026-11-08 | **第三次地图完成核对 + 关闭**（本轮按八条判据重新取证，不看数字） | 八条判据全部重新取到证据（见「探索结论」表下方本轮备注）；`npm test` 256/256、`npm run verify` 26 源文件 / 97 产物、`check:matrix` 15 版本；零待决事项、零未交活的 fog、零无主票 → 判定「不需要接着做」，写结论、留收尾评论并关闭 |

**当前状态（2026-11-08 17:35，第三次核对）：探索结束、两个交接完成、施工走完、地图已关闭。**

三次核对叠起来看，这张地图的真实路线是：14 张探索票 → 判据 8 与客户端入口两处没落地（补 #13 / #14）→ 判据全部成立 → /to-spec → /to-tickets 拆 4 张实施票 → 4 张实施完 → 0.2.0 真发布 → 后续 readme-0-3-0 把版本推到 0.3.0。取数不看数字，看证据：

| 判据 | 本轮（2026-11-08 17:35）重新取到的证据 |
|---|---|
| 1 干净宿主可装 | 0.3.0 从 registry 拉回真字节后在临时 profile 真装：`docs/releases/0.3.0/05-verify-published.txt`（88648 B、shasum `b9b3f856…` 与 integrity 双一致、技能面六个、四档体量 `{"off":0,"lite":1203,"full":1188,"ultra":1206}`、`安装形态验证通过（mode=assemble）`）；`npm run check:matrix` 本轮跑出「兼容矩阵覆盖 engines.dsh 区间内全部 15 个版本 ✓」；`engines.dsh` 实测 `>=0.2.0-rc.1 <0.3.0-0`，本机宿主实测 `0.2.2-rc.1` 落在区间内 |
| 2 零缓存破坏三层 | `npm run measure` 本轮重跑：整条 prompt 切档前 3005 B / 切档后 3005 B、**逐字节相同 true**，ponytail 段 2955 / 2955，当轮 reminder 3167 B |
| 3 零 tool + 6 技能经 provider | `grep -rn "ctx.tools\|registerTool" src/` 本轮计数 **0**；技能面六个（ponytail / -audit / -debt / -gain / -help / -review）在 README 与 check:skills 双处一致 |
| 4 净删自愈链与持久化 | `grep -rln "session-states\|ponytail-active\|LRU\|heal\|自愈" src/ test/ scripts/` 本轮命中 **0 个文件** |
| 5 围栏感知 + 真 Cordis 组合 | `test/ladder.test.mjs:80` 的 V15 夹具在位；`test/composition.test.mjs` 用 `new Context()` + `ctx.plugin()` |
| 6 客户端 UI 可降级（含**真机装载**） | 判据 6 当初留的尾巴本轮补齐：0.3.0 真装进了本机 `~/.dsh/profiles/desktop`，宿主重启后本会话的技能列表里六个 ponytail 技能全部出现——真机装载不再是推断 |
| 7 发行物纯度 | `npm run verify` 本轮通过（26 源文件 / 97 产物 / 1 提醒）；tarball 60 条目里无 `src|test|scripts|docs|assets|.scratch|.github`，运行时依赖白名单只有 cordis / schemastery |
| 8 skillDir 越界防护 | `src/l0/within.ts`（4597 B 纯函数）+ `test/skills-within.test.mjs` **14** 条，本轮实数 |

**判定（收尾口径）：不需要接着做。** 三件事让这条路走到终点——① 八条判据逐条有本轮证据，不是继承旧结论；② 交棒两段（/to-spec、/to-tickets）早在 2026-11-08 完成，拆出的 4 张实施票全部 resolved，无在跑的活；③ 全量门本轮重跑 256/256 pass，`verify` / `check:matrix` / `measure` 全绿。按 wayfinder 判定树这属于「结论就是最终决定，改动已经在这张 map 里做完了」那一支，所以**不生成新规格、不拆新 ticket**，只写结论、留收尾评论、关闭地图。

**已知但不阻塞的三处口径漂移**（写在这里，免得日后当成新发现）：① 本图成立时 `latest` 是 0.2.0，此后 0.3.0 已发，且 0.3.0 把 README 从 269 行重排成 146 行——本图判据不涉及 README，但图里早期「三份文档口径」那几句描述的是当时的文本；② `docs/releases/0.2.0/` 与 `0.3.0/` 两套证据并存，各管各的版本，都不作废；③ 本图标题与 Notes 仍写着上游 `Wenaixi/dsh-ponytail`——那是本 effort 立项时的历史坐标，按品牌规则对外不再提，仓内保留可追溯。

### local — 2026-11-08T17:35:00.000Z
**第三次完成核对（收尾）：探索与交接都已完成，地图到此关闭。** 本轮不看 14/14 这个数字，把 Destination 八条判据重新取了一遍证据：判据 1 用 0.3.0 从 registry 拉回真字节在临时 profile 真装（`docs/releases/0.3.0/05-verify-published.txt`，88648 B、shasum 与 integrity 双一致、技能面六个、四档体量 `{"off":0,"lite":1203,"full":1188,"ultra":1206}`、`安装形态验证通过（mode=assemble）`）+ `check:matrix` 覆盖区间内 15 个版本 + `engines.dsh` `>=0.2.0-rc.1 <0.3.0-0` 对上本机宿主 `0.2.2-rc.1`；判据 2 用 `measure` 得 3005/3005 B 逐字节相同 true；判据 3 的 `ctx.tools`/`registerTool` 计数 0、技能面六个；判据 4 的自愈链/LRU/持久化关键词命中 0 个文件；判据 5 的 V15 夹具在 `test/ladder.test.mjs:80`、`test/composition.test.mjs` 用 `new Context()`；判据 6 当年留的真机装载尾巴本轮补齐——0.3.0 真装进 `~/.dsh/profiles/desktop`，宿主重启后本会话技能列表出现六个 ponytail 技能；判据 7 `npm run verify` 通过（26 源文件 / 97 产物 / 1 提醒）；判据 8 `src/l0/within.ts` 4597 B + `test/skills-within.test.mjs` 14 条实数。全量门本轮重跑 `npm test` **256/256 pass / 0 fail**。

**判定「不需要接着做」**：交棒两段早在 2026-11-08 走完（/to-spec 产出 `.scratch/publish-0.2.0/spec.md`、/to-tickets 拆出 4 张实施票并全部 resolved），无在跑的活、无待决事项、无未交活的 fog、无无主票。按 wayfinder 判定树属于「结论即最终决定 + 改动已在本 map 内做完」那一支，因此**不生成新规格、不拆新 ticket**，也不提 /to-spec 与 /to-tickets。

**三处已知但不阻塞的口径漂移**（本次一并记明，免得日后被当成新发现）：① 本图 2026-11-08 成立时 npm `latest` 是 0.2.0，此后 readme-0-3-0 一轮推进到 0.3.0（现行 `latest` = 0.3.0，已发布 0.0.0-stage / 0.2.0 / 0.2.1 / 0.2.2 / 0.3.0），该轮只改对外形态（README 269→146 行、双语、宿主区间上界打开），不动本图八条判据任何一条；② `docs/releases/0.2.0/` 与 `docs/releases/0.3.0/` 两套证据并存，各管各的版本，都不作废；③ 本图标题与 Notes 里仍写着上游 `Wenaixi/dsh-ponytail`，那是立项时的历史坐标，按品牌规则对外不再提，仓内保留可追溯，不构成待办。

**收尾动作**：结论已写进正文「探索结论」节（八条判据证据表 + 判定 + 口径漂移），进度表补了本轮一行，本评论即地图的总结评论，随后关闭地图。地图到此结束。
