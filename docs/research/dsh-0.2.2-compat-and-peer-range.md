# DSH 0.2.2 兼容性核实：PR #5 的字节级声明、逐包差异与 peer 区间设计

> **对象**：`@wenaixi/dsh-ponytail` 5.6.2（`/tmp/dsh-ponytail-upstream`，commit `7223820`）与其 PR #5 分支（`gh pr view 5 --repo Wenaixi/dsh-ponytail`；本地实体为 `refs/pull/5/head` = commit `12227b1`，父 `7223820`）；对照宿主 `@deepseek-ai/*` 0.2.0-rc.1 → 0.2.2-rc.1 全序列。
> **来源纪律**：本文所有版本核对**只用 npm registry 干净 tarball**（`npm pack <pkg>@<ver> --registry=https://registry.npmjs.org/` 解包到 `/tmp/dsh-compat-09/tarballs/` 与 `/tmp/dsh-compat-09/x/`）。本机 `/Applications/DeepSeek Harness.app/.../node_modules/@deepseek-ai` 下的副本被第三方打过补丁（`*.dshpurge.bak` 实计 63 个，地图记的 60 与实况差 3），**仅在两处作定位参考**并已逐处标注；凡与干净 tarball 冲突，一律以 tarball 为准。
> **工具链**：npm 10.9.8 / node v22.22.3 / pnpm 12.16.1 / semver 7.8.6（`/tmp/dsh-compat-09/x/semver-7.8.6`）。抽取的宿主判定模块在 `/tmp/dsh-compat-09/gate-extract.mjs`（`sed -n '1070,1154p'` 自干净 `dsh-app-boot/lib/index.js`，可复跑）。
> **复现**：各节的命令与输出摘要均随行给出；`/tmp/dsh-compat-09/lab/` 下 `full-matrix.mjs`（候选区间×宿主版本矩阵）、`matrix.mjs`（真实 5.6.2 manifest 判定）、`q.mjs`（两套 semver 语义对比）可直接重跑。

## 摘要

**PR #5 的三条「逐字节相同」声明全部成立**，但成立的方式比 PR 说得更强也更弱：`dsh-skill` 的 `lib/index.js` 从 0.2.0-rc.1 起就与 0.2.2-rc.1 完全一致（sha256 `4b88621b…`，23721 字节，实测四个版本 `0.2.0-rc.1 / 0.2.1-rc.2 / 0.2.1-rc.5 / 0.2.2-rc.1` 零差异）；`dsh-typert-protocol` 在 0.2.1-rc.2 起三版一致（`8d48ddbb…`，19373 字节），**但 0.2.0-rc.1 是另一份产物**（`f7e0fa4b…`，12267 字节，差 294 行）；`schemastery` 3.18.4 与 3.19.0 的四个产物文件逐字节相同，唯一差异是 `package.json` 的 version 与一条 devDependency（`@deepseek-ai/schemastery` 而非裸 `schemastery`——裸包在 npm 上只到 3.18.0）。

**宿主版本闸只有一道，且 `engines.dsh` 独占优先**：`unmetRequirements()` 见 `engines.dsh` 就直接返回，`peerDependencies` 全程不参与（`dsh-app-boot/lib/index.js:1097-1117`）。实测把两个 `dsh-*` peer 放宽到 `<=0.2.2` 而 `engines.dsh` 不动，判定返回值**逐字不变**。所以 PR #5 同时改 `engines.dsh` 是必要条件，不是冗余。

**必须回答的第五问有两处需要纠正**：0.2.2 的 `SECTION_ORDERS` 具名表是 **34 项**（0.2.1 是 32 项，新增 `TOOL_APPLY_PATCH: 1350` 与 `TOOL_SCHEDULE: 2500`）；`order: 50` 在完整 27 槽实测里落在**第 3 槽**（在 `harness:identity`(-1000) 与 `deployment:persona-prefix`(0) 之后、`plan:policy`(500) 之前），作者的「位于 persona 与工具之间」成立，但 ADR-0012 自称的「约第 200 个 Token 处」在宿源码里**没有任何依据**——order 只是排序键，与 token 偏移无映射。

---

## 一、PR #5 的三条字节级声明

### 1.1 复核方法

```bash
mkdir -p /tmp/dsh-compat-09/tarballs && cd /tmp/dsh-compat-09/tarballs
npm pack @deepseek-ai/dsh-skill@0.2.2-rc.1 --silent --registry=https://registry.npmjs.org/
npm pack @deepseek-ai/dsh-typert-protocol@0.2.2-rc.1 --silent --registry=https://registry.npmjs.org/
npm pack @deepseek-ai/schemastery@3.19.0 --silent --registry=https://registry.npmjs.org/
# ……各版本同法；解包：for f in *.tgz; do mkdir -p ../x/${f%.tgz}; tar -xzf "$f" -C ../x/${f%.tgz}; done
shasum -a 256 <path>/lib/index.js
cmp -s A B && echo SAME || echo DIFF
```

> **解包层级陷阱**：0.2.0-rc.1 的解包层级不统一——`dsh-skill` / `dsh-typert-protocol` / `dsh-system-prompt` 解出来是**平铺**的（`<dir>/lib/index.js`），而 `dsh-agent` / `dsh-settings` 仍是 `<dir>/package/lib/index.js`；0.2.1 起才全部统一为 `package/` 子层。第一次跑哈希时对平铺包按 `package/` 前缀拼路径会 `shasum: No such file or directory`，不是文件缺失。实测分类：
>
> | 包 | 0.2.0-rc.1 层级 |
> |---|---|
> | `dsh-skill` | FLAT（`<dir>/lib/index.js`）|
> | `dsh-typert-protocol` | FLAT |
> | `dsh-system-prompt` | FLAT |
> | `dsh-agent` | PKG-SUB（`<dir>/package/lib/index.js`）|
> | `dsh-settings` | PKG-SUB |

### 1.2 `@deepseek-ai/dsh-skill` 的 `lib/index.js`

| 版本 | 解包路径 | sha256 | 字节数 | 判定 |
|---|---|---|---|---|
| 0.2.0-rc.1 | `x/deepseek-ai-dsh-skill-0.2.0-rc.1/lib/index.js` | `4b88621be4e7ff09b05c175fc6dcb67e77a22e5c5570e3aa603338b2937ea791` | 23721 | 同 |
| 0.2.1-rc.2 | `…-0.2.1-rc.2/package/lib/index.js` | `4b88621b…` | 23721 | 同 |
| 0.2.1-rc.5 | `…-0.2.1-rc.5/package/lib/index.js` | `4b88621b…` | 23721 | 同 |
| 0.2.2-rc.1 | `…-0.2.2-rc.1/package/lib/index.js` | `4b88621b…` | 23721 | 同 |

**判定：声明成立，且强于声明。** PR 只声称「0.2.2 与 0.2.1-rc.2 逐字节相同」；实测该文件横跨 `0.2.0-rc.1 / 0.2.1-rc.2 / 0.2.1-rc.5 / 0.2.2-rc.1` **四个版本零差异**，`diff` 输出 0 行。`registerProvider` 的实现因此在整个 0.2.x 序列上是同一份代码。

### 1.3 `@deepseek-ai/dsh-typert-protocol` 的 `lib/index.js`

| 版本 | sha256 | 字节数 | 判定 |
|---|---|---|---|
| 0.2.0-rc.1 | `f7e0fa4b750267f6adaa1b901be7987f0d830800ec3a05f247251bf77de0b809` | 12267 | **与后三者不同** |
| 0.2.1-rc.2 | `8d48ddbb4bbc62585ce5a4d3a7f53b39f55581b5320c1cae681766edd15ff8af` | 19373 | 同 |
| 0.2.1-rc.5 | `8d48ddbb…` | 19373 | 同 |
| 0.2.2-rc.1 | `8d48ddbb…` | 19373 | 同 |

**判定：PR 的声明成立；但「跨 0.2.x 一致」这条更宽的推论不成立。** `diff f7e0fa4b… 8d48ddbb…` 输出 **294 行**，增量集中在新增的 `lib/types/remote-info.js` 段（`createTypertRemoteInfo` / `RemoteInfo` / `NamedInput` / `ResultValue` 的惰性装配）。对上游无影响：上游只 import `{ Remote, TypertRemoteService }`（`src/ponytail-remote.ts:19`），两个符号在两版都在导出名单里——

- 0.2.0-rc.1 导出（`…-0.2.0-rc.1/lib/index.js:278`）：`Remote, RemoteError, RemoteScope, TYPERT_OWNED_VALUE, TypertRemoteService, bindTypertRemote, isRemoteJsonValue, isRemoteUplinkItem, isTypertOwnedValue, isTypertRemoteSegment, remoteErrorOf, remoteMethods, typertOwnedValue`
- 0.2.2-rc.1 导出（`…-0.2.2-rc.1/package/lib/index.js:480`）：上述全项 + `createTypertRemoteInfo / isTypertRemoteMethod / principalOf`
- `TypertRemoteService` 的类体两版逐字相同（`:159` vs `:339` 起，构造体 `super(ctx, serviceKey); this.typertRemote = bindTypertRemote(this, this.name, options);`），唯一差异是一行注释：`optional distinct wire namespace` → `optional wire namespace`。

### 1.4 `schemastery` 3.18.4 vs 3.19.0

先说一处必须纠正的事实：**裸名 `schemastery` 在 npm 上只到 3.18.0**（`curl -s https://registry.npmjs.org/schemastery/3.18.4` 与 `/3.19.0` 均 404）。真实包名是 **`@deepseek-ai/schemastery`**，dist-tags `{latest: 3.19.0, next: 3.18.6-alpha.2, dsh-0-2-1-alpha-1: 3.18.5-alpha.1, dsh-0-2-1-alpha-3: 3.18.5-alpha.2}`。

| 文件 | 3.18.4 sha256 | 3.19.0 sha256 | 判定 |
|---|---|---|---|
| `lib/index.mjs` | `cfcbe46c7416bdb35ce891c252152bbf519e08199bede5930dd7cb880c65f1ef` | 同左 | 逐字节相同 |
| `lib/index.cjs` | `aca1c1a47c7b6034feee01501aefca3e6dd97a0bac4fe334fd30647ae5a9e480` | 同左 | 逐字节相同 |
| `lib/types/index.d.ts` | `fca846c1420a192b7ae749da96afa0c9b5c57b2e7dff418153674f90200f4e27` | 同左 | 逐字节相同 |
| `src/index.ts` | `a6647b515659cf439b701fa9f9574c9c310ce3872d26a13a81e9fa4d02ba10ad` | 同左 | 逐字节相同 |
| `package.json` | `81c5663da570b5072eecaa9d823dd600315308538ed1fd931b276523fb40d95f` | `b56f354704ff6e65c8a0c2639f0d46dffa74aaeef9c12e83d47d60f19021112b` | 差 2 行 |

`diff -r` 全目录仅两行差异：

```
4c4
<   "version": "3.18.4",
---
>   "version": "3.19.0",
37c37
<     "@deepseek-ai/cosmokit": "~1.8.5"
---
>     "@deepseek-ai/cosmokit": "~1.9.0"
```

**判定：成立。** 且 `~1.8.5` → `~1.9.0` 是 devDependency（`"devDependencies"` 块内），不影响安装产物。两版 `lib/index.mjs:52` 都有 `Object.defineProperty(Schema.prototype, "~standard", { get() {…})`，即 cordis 4.1 的 `resolveConfig` 所依赖的 standard-schema 接口两版都具备。

---

## 二、0.2.2 相对 0.2.1 到底变了什么

基线取 **0.2.1-rc.5 → 0.2.2-rc.1**（0.2.1 系列的最后一个 rc 与 0.2.2 唯一的 rc）。命令：

```bash
cd /tmp/dsh-compat-09/x
diff -rq --exclude='*.dshpurge.bak' deepseek-ai-dsh-<pkg>-0.2.1-rc.5/package \
                             deepseek-ai-dsh-<pkg>-0.2.2-rc.1/package
diff deepseek-ai-dsh-<pkg>-0.2.1-rc.5/package/lib/index.js \
     deepseek-ai-dsh-<pkg>-0.2.2-rc.1/package/lib/index.js | wc -l
```

### 2.1 逐包差异规模

| 包 | `lib/index.js` diff 行数 | 其余差异文件 | 运行时语义变更 |
|---|---|---|---|
| `dsh-skill` | **0** | README×3、package.json、6 个 locale | 无 |
| `dsh-typert-protocol` | **0** | README×3、`lib/types/index.d.ts`、`lib/types/types.d.ts`、package.json | 仅类型层 |
| `dsh-system-prompt` | **52** | README×3、`lib/types/index.d.ts`、package.json、6 locale | **两处实质变更** |
| `dsh-settings` | **12**（3 hunk） | `lib/types/index.js`、package.json、6 locale | Cordis 4.1 内省路径适配 |
| `dsh-agent` | **319** | README×3、`lib/types/{index,model-selection,projection,runtime-types,types}.{d.ts,js}`、package.json、6 locale | 新增 projection 与 `AgentModel`；pre-step 载荷加字段 |
| `cordis` 4.0.5 → 4.1.0 | 整体重写 `fiber` | `lib/types/{context,events,fiber,logger,reflect,utils}.d.ts(+.map)`、`src/*.ts`、package.json、README | Fiber 内省、Config 校验、inactive effect |

所有包的 `package.json` 都做了同一组版本对齐：`version` 升 0.2.2-rc.1、同族 `dsh-*` 依赖钉到 0.2.2-rc.1、`@deepseek-ai/cordis` `~4.0.5` → `~4.1.0`、`@deepseek-ai/schemastery` `~3.18.5` → `~3.19.0`。`dsh-agent` 另新增运行时依赖 `{ "zod": "4.4.3", "@deepseek-ai/dsh-brand": "0.2.2-rc.1" }`（0.2.1-rc.5 无 `zod`）。

### 2.2 对上游五个扩展点的实际影响

| 扩展点 | 上游用法（`file:line`） | 0.2.2 变更 | 影响判定 |
|---|---|---|---|
| `systemPrompt.section` | `src/ponytail.ts:370-374` `{ name:'ponytail', order:50, text:(context)=>renderPromptSection(...) }` | 注册签名不变：`lib/index.js:255-256` 仍是 `section(section)` + `if (!Number.isFinite(section.order)) throw new TypeError(\`prompt section "${section.name}" order must be a finite number\`)`。无白名单、无枚举校验 | **无影响**。0.2.0-rc.1（`:240-241`）与 0.2.1-rc.5（`:253-254`）同形，字面量 order 50 三版都合法 |
| `skills.registerProvider` | `src/ponytail.ts:262` `skills.registerProvider((control) => {…})` | `lib/index.js` **sha256 完全一致**（`4b88621b…`，见 1.2）；类型 `lib/types/index.d.ts:247` 的 `registerProvider(create: (control: SkillProviderControl) => SkillProvider): () => void` 三版同签名 | **零变更** |
| `agent/pre-step` | `src/ponytail.ts:394-397` `anyCtx.on('agent/pre-step', (...args: unknown[]) => { const [payload, next] = args as […] ; return coordinator.handlePreStep(payload, next) })` | 载荷新增第 6 项：`lib/types/runtime-types.d.ts:332-339` 由 0.2.1-rc.5（`:304-310`）的五项 `{ agent, messages, turn, step, signal }` 变为六项，多 `modelSelection: Readonly<ModelSelection>`；注释新增 `@param payload.modelSelection - captured step selection, retained across retries; omitted effort uses adapter defaults.` 实现侧 `lib/index.js:232` 解构改为 `async ({ agent, messages, signal, step, modelSelection }, next) =>` | **纯增益**。上游只解构 4 项、经 `(...args: unknown[])` 转发，新增字段不影响；返回值契约 `PreStepDecision` 未变 |
| `settings.mutate` / `describe` | `src/ponytail-settings.ts:85-91`（`ctx.get('settings', false)`）、`:44` 注释声明只用 `describe`/`mutate` 等三方法 | 公开签名三版一致：`lib/types/index.d.ts:96` `describe(options?: SettingsDescribeOptions): SettingsDescriptor[]`、`:114` `mutate(ns: string, ops: readonly SettingsPathOp[], expectedRevision?: number): Promise<void>`；0.2.1-rc.5 与 0.2.2-rc.1 的该文件 sha256 同为 `90b021295cc5d453b77aa09acb088bb170f08506f7c19be0180893823c594204`。实现侧三行改动见下表 | **签名无影响**，但实现依赖 Cordis 4.1 的 `ctx.fiber` 结构，见 2.3 |
| `TypertRemoteService` | `src/ponytail-remote.ts:72-83` `super(ctx,'ponytailRemote',{namespace:'ponytail'})` | `lib/index.js` diff 0 行；`lib/types/types.d.ts:741-766` 把 `TypertResourceDeclaration` 从单一 interface 改为联合类型 `{ readonly field: string; readonly resolve?: never } \| { readonly field?: never; resolve(this: void, input: TypertResourceResolveInput): string \| undefined }`，并新增 `TypertResourceResolveInput` | **无影响**。上游不用 `resources` 声明 |

### 2.3 `dsh-settings` 的三行改动（Cordis 4.1 连带）

| 行 | 0.2.1-rc.5 | 0.2.2-rc.1 | 含义 |
|---|---|---|---|
| `:371` | `const fiber = owner;` | `const fiber = owner.ctx.fiber;` | Cordis 4.1 起 `Fiber` 不再直接暴露 `config`，须经 `owner.ctx.fiber` 取 |
| `:426` | `this.presentations.get(entry.fiber)?.auto ?? true` | `this.presentations.get(entry.fiber.ctx.fiber)?.auto ?? true` | 同上 |
| `:436` | `projectForm(form, plainConfig(entry.fiber.config))` | `projectForm(form, plainConfig(entry.fiber.effectiveConfig))` | `config` → `effectiveConfig`（Cordis 4.1 把「用户写的」与「校验后生效的」分开） |

证据锚点：`x/deepseek-ai-dsh-settings-0.2.2-rc.1/package/lib/index.js`，`diff` 只有 3 个 hunk（`371c371`、`426c426`、`436c436`）。

### 2.4 最该警惕的一处：`system-prompt/assemble` 载荷收窄

这是 0.2.2 唯一一处**会让第三方中间件读到 `undefined`** 的变更。

**0.2.1-rc.5**（`…-0.2.1-rc.5/package/lib/index.js:386-399`）：`assembly` 对象字面量里直接含 `tools: orderTools(collected, this.toolOrder, knownNames)`（`:395`），`waterfall` 在 `:398` 拿到完整 `assembly`，`:399` 直接 `return transformed;`。

**0.2.2-rc.1**（`…-0.2.2-rc.1/package/lib/index.js:386-410`）：
```js
:386  const sections = sectionDefinitions.map((section) => { … });
:395  const tools = orderTools(collected, this.toolOrder, knownNames);
:396  const assembly = { sections, contexts: …, variables };      // 不含 tools
:401  const transformed = await this.ctx.waterfall(scopeTarget(this, scope),
           "system-prompt/assemble", assembly, context, () => Promise.resolve(assembly));
:402  return { ...transformed, tools };                            // waterfall 之后补回
```

类型侧同步（`lib/types/index.d.ts`）：新增 `:114 export interface PromptPresentation { sections; contexts; variables }`（注释「tool declarations are owned by their providers」）与 `:120 export interface PromptAssembly extends PromptPresentation { tools: ToolSchema[] }`；事件签名 `:27` 由 `assembly: PromptAssembly … -> Promise<PromptAssembly>` 改为 `assembly: PromptPresentation … -> Promise<PromptPresentation>`。

**影响判定：对上游无直接影响**——`grep -rn "system-prompt/assemble" src/` 结果为空，上游不订阅该事件。但**任何将来想从 `assemble` 里读 `tools` 的派生实现都会拿到 `undefined`**，这是设计层面的破坏性收窄，必须记入兼容性档案。

另需注意：`AssembleContext` **不是**变更点——0.2.1-rc.5 与 0.2.2-rc.1 都是 `lib/types/index.d.ts:37 export interface AssembleContext { scope?: ScopeKey; signal?: AbortSignal; }`，逐字相同。

### 2.5 `cordis` 4.0.5 → 4.1.0

`diff -rq` 差异文件：`lib/index.js`、`lib/types/{context,events,fiber,logger,reflect,utils}.d.ts(+.map)`、`package.json`、`src/{context,events,fiber,logger,reflect,utils}.ts`、`README.md`。

`lib/index.js` 关键变更：

- 新增 `caller: Symbol.for('cordis.caller')`。
- `createShadow` 改签名 `createShadow(useSite, target, property, receiver)`，改用 `getPropertyDescriptor`，引入 `defSite = value[symbols.shadow] ?? value` 与 `useSite = ctx[symbols.shadow] ? Object.getPrototypeOf(ctx) : ctx`；调用处变为 `applyTraceable(tracker.noShadow ? proxy : createShadow(useSite, target, tracker.property, proxy), target, thisArg, args)`；方法派发改为 `const proxy = createTraceable(self['ctx'], self, tracker); return Reflect.apply(proxy, this, args)`。
- 新增整块 `lib/types/fiber.js`：`kValidationError` 符号、`ValidationError extends TypeError`（按 standard-schema issues 拼 `'invalid config:'`）、`resolveConfig(runtime, config)`（走 `runtime.Config['~standard'].validate(config)`，遇 then 抛 `TypeError('Async config validation is not supported')`）、`effectInertia` WeakMap、`runDisposable`、`emitPluginDisposed`、`CordisError`（`Code.INACTIVE_EFFECT = 'cannot create effect on inactive context'`）、`INACTIVE = '__INACTIVE__'`、`class Fiber`（字段 `parent/inject/runtime/uid/ctx/config/state/dispose/committed/provisions/inertia/_hooks/_disposables/context/_error/_revision/_configRevision/_effectiveConfig/_runner/_store/_release`，`this.ctx = this.context = parent.extend({ fiber: this })`）。

对上游的影响面：`ctx.fiber` 成为正规入口（`dsh-settings` 三行改动即其连带）；`ctx.effect()` 在 inactive context 抛 `CordisError`；插件 `Config` 走 standard-schema 校验。上游订阅的六个事件（`agent/created` `src/ponytail.ts:418`、`agent/pre-step` `:394`、`app-boot/config-reload` `:331`、`loader/volatile-update` `:293`、`session/event` `:398`、`skills/change` `:284`）全部是 DSH 层事件，Cordis 升级不改其语义。

补充一条结构事实：上游对 cordis 的三处引用**全是 `import type`**（`src/ponytail.ts:13`、`src/ponytail-remote.ts:20`、`src/ponytail-skills.ts:90`），运行时真依赖只有 `@deepseek-ai/dsh-skill`（`src/ponytail.ts:17`、`src/ponytail-skills.ts:98`）、`@deepseek-ai/dsh-typert-protocol`（`src/ponytail-remote.ts:19`）与 `@deepseek-ai/schemastery`（`src/ponytail.ts:18`，值导入）。所以 cordis 版本跳变不会在运行时直接崩，只影响类型层与宿主 fiber 语义。

---

## 三、`peerDependencies` 区间该怎么写

### 3.1 生态四种姿势（npm registry 实测 manifest）

| 包 | 姿势 | `engines` | `peerDependencies` 关键项 | `dependencies` |
|---|---|---|---|---|
| `@maci0/dsh-ponytail` 0.20.2 | 硬钉 alpha + 精确 deps | `{"dsh":">=0.2.2-alpha.3 <0.3.0","node":"^22.19.0 \|\| >=24.0.0"}` | `@deepseek-ai/cordis`: `4.0.6-alpha.2`（硬钉）、5 个 `dsh-client-*`: `*` | `{yaml:2.9.1, @deepseek-ai/dsh-skill:0.2.2-alpha.3, @deepseek-ai/dsh-tools:0.2.2-alpha.3, @deepseek-ai/schemastery:3.18.6-alpha.2}`；**`bundledDependencies` 为 undefined，不内联** |
| `@kb1slnlabs/dsh-ponytail` 5.3.3-dsh.6 | 钉小版本 `~` | 只有 `{"node":">=22"}`，**无 `engines.dsh`** | `cordis`: `~4.0.5`、`dsh-llm/dsh-skill/dsh-commands/dsh-system-prompt`: `>=0.2.1-rc.3 <0.3.0`、`schemastery`: `~3.18.5`、`zod`: `^4.4.3` | 无 |
| `@mengyuly/dsh-ponytail` 0.4.3 | 宽区间 | **无 `engines`** | `cordis`: `>=4.0.0-rc <5`、`dsh-llm/dsh-skill/dsh-commands/dsh-invariants/dsh-system-prompt`: `>=0.0.1-rc <2`、`schemastery`: `^3.18.0` | 无 |
| `@wenaixi/dsh-ponytail` 5.6.2（接管对象） | 钉到小版本序列 | `{"dsh":">=0.2.0-rc.1 <=0.2.1","node":">=20"}` | `cordis`: `^4.0.4`、`dsh-skill`/`dsh-typert-protocol`: `>=0.2.0-rc.1 <=0.2.1`、`schemastery`: `^3.18.4`、`react`: `^18.2.0` | `{yaml:^2.4.2}` |

四条实测命令形态：`curl -s https://registry.npmjs.org/<pkg> | node -e "…j['dist-tags'].latest…"`。注意 `@maci0` 的「自 bundle 内联」实际上是**假的**——它把 `dsh-*` 放进 `dependencies` 钉死精确版本，但 `bundledDependencies` 未设置，产物并不携带这些包。

### 3.2 候选区间 × 宿主版本（两套 semver 语义）

宿主判定用 `includePrerelease: true`（`dsh-app-boot/lib/index.js:1094-1096`），pnpm 用默认语义。矩阵脚本 `/tmp/dsh-compat-09/lab/full-matrix.mjs`，每格 `默认/includePrerelease`：

| 候选 | 区间 | 0.2.0-rc.1 | 0.2.1-rc.2 | 0.2.1 | 0.2.2-alpha.3 | 0.2.2-rc.1 | 0.2.2 | 0.2.3-rc.1 | 0.3.0 |
|---|---|---|---|---|---|---|---|---|---|
| 现状 5.6.2 | `>=0.2.0-rc.1 <=0.2.1` | P/P | F/P | P/P | F/F | F/F | F/F | F/F | F/F |
| PR #5 | `>=0.2.0-rc.1 <=0.2.2` | P/P | F/P | P/P | F/P | **F/P** | P/P | F/F | F/F |
| **候选 A（推荐）** | `>=0.2.0-rc.1 <0.2.3-0` | P/P | F/P | P/P | F/P | **F/P** | P/P | F/F | F/F |
| 候选 B | `>=0.2.0-rc.1 <=0.2.2-rc.1` | P/P | F/P | P/P | P/P | P/P | F/F | F/F | F/F |
| 候选 C | `^0.2.0-rc.1` | P/P | F/P | P/P | F/P | F/P | P/P | **F/P** | F/F |
| 候选 D | `>=0.2.0-rc.1 <0.3.0` | P/P | F/P | P/P | F/P | F/P | P/P | **F/P** | F/F |
| 生态：`~0.2.1` | `~0.2.1` | **F/F** | **F/F** | P/P | F/P | F/P | P/P | F/P | F/F |
| 生态：kb1sln | `>=0.2.1-rc.3 <0.3.0` | F/F | F/F | P/P | F/P | F/P | P/P | F/P | F/F |
| 生态：mengyuly | `>=0.0.1-rc <2` | F/P | F/P | P/P | F/P | F/P | P/P | F/P | **P/P** |

三处必须读懂的读数：

1. **`~0.2.1` 与 `^0.2.1` 在 `includePrerelease` 下漏掉 0.2.0-rc.*、0.2.1-rc.****（表格倒数第三行整列 F/F）。原因：`includePrerelease` 下 `~0.2.1` 展开为 `>=0.2.1 <0.3.0-0`，而 0.2.1-rc.5 语义上低于 0.2.1。**「钉小版本」这条生态姿势无法用于覆盖 0.2.1 的 rc 序列。**
2. **候选 B（`<=0.2.2-rc.1`）反而漏掉宿主当前版本**——它在 0.2.2-rc.1 是 P/P，但 0.2.2-rc.2 起就 F/F。写死上界到 rc.1 等于自绝于下一个 rc。
3. **所有以 `>=0.2.0-rc.1` 开头、上界不显式提到 0.2.2 的 pre-release 的区间，在 pnpm 默认语义下都会把 0.2.2-rc.1 判为不满足**（PR #5 与候选 A 的 0.2.2-rc.1 格都是 `F/P`）。这是 semver 的 prerelease 元组规则，不是配置错误。但 **pnpm 侧不阻断**（见 3.4），所以真正决定生死的是 P（`includePrerelease`）那一列。

### 3.3 推荐区间与覆盖说明

**推荐：`>=0.2.0-rc.1 <0.2.3-0`，三处同步改——`engines.dsh`、`peerDependencies["@deepseek-ai/dsh-skill"]`、`peerDependencies["@deepseek-ai/dsh-typert-protocol"]`。**

| 覆盖 | 不覆盖 |
|---|---|
| 0.2.0-rc.1、0.2.0-rc.2、0.2.0、0.2.1-alpha.*、0.2.1-rc.1…rc.5、0.2.1、0.2.2-alpha.*、0.2.2-rc.*、0.2.2（含尚未发布的 0.2.2 正式版） | 0.2.3-0、0.2.3-rc.1、0.2.3、0.3.0-alpha.1、0.3.0、0.1.x 及以下 |

选它而不选 `<=0.2.2` 的理由：两者在 `includePrerelease` 下**逐格等价**（矩阵同格），但 `<0.2.3-0` 把「排除整个 0.2.3 系列」写进了区间本身，而 `<=0.2.2` 达到同样效果靠的是 semver 的 prerelease 比较规则——读代码的人很容易误以为 `<=0.2.2` 会连带放行 `0.2.2-rc.9` 甚至 `0.2.3-rc.1`。

> **为什么上界不能用 `<=0.2.2` 之外的东西**：`<=0.2.2` 与 `<0.2.3-0` 在 `includePrerelease` 下实测对 0.2.2-rc.2 / rc.9 / rc.100 / 0.2.2-1 全部 PASS（`/tmp/dsh-compat-09/lab/p.mjs`）。区间对 RC 序号没有上限，这点是特性不是缺陷：宿主不会为每个 rc 重发插件。
>
> **为什么下界能写 0.2.0-rc.1**：见 3.5 的扩展点复核表——`dsh-skill` 的 `lib/index.js` 从 0.2.0-rc.1 起就与 0.2.2 逐字节相同，`systemPrompt.section` / `settings.mutate` / `agent/pre-step`（0.2.0-rc.1 与 0.2.1-rc.5 载荷相同）/ `TypertRemoteService` 四项在 0.2.0-rc.1 上都是可用形态。

**必须同时改 `engines.dsh` 的实证**：构造三份 manifest 跑抽取的 `evaluatePluginCompatibility`（`/tmp/dsh-compat-09/lab/matrix.mjs`），宿主版本 0.2.2-rc.1：

```json
// A. 真实 5.6.2
{"name":"@wenaixi/dsh-ponytail","version":"5.6.2","runtimeVersion":"0.2.2-rc.1",
 "requirements":{"engines.dsh":">=0.2.0-rc.1 <=0.2.1"},"exempted":false}

// B. 只把两个 dsh-* peer 放宽到 <=0.2.2，engines.dsh 保持原样
//    → 返回值与 A 逐字相同，requirements 仍只有 engines.dsh

// C. 删掉 engines.dsh，只留旧 peer
{"requirements":{"@deepseek-ai/dsh-skill":">=0.2.0-rc.1 <=0.2.1",
                 "@deepseek-ai/dsh-typert-protocol":">=0.2.0-rc.1 <=0.2.1"}}
```

### 3.4 `pnpm` 自身不构成第二道闸

| 检验 | 命令 | 结果 |
|---|---|---|
| peer 未满足是否阻断 | `pnpm add react-dom@18.2.0`（react 缺失） | exit=0，仅告警 |
| engines 不符是否阻断 | `pnpm add node-gyp@3.8.0`（engines 与当前 node 不符） | exit=0，正常装入 |
| `strict-peer-dependencies` | `pnpm config get strict-peer-dependencies` | `undefined` |
| `engine-strict` | `pnpm config get engine-strict` | `undefined` |
| `.npmrc` | `ls ~/.dsh/.npmrc` | 不存在（只有全局 `~/.npmrc`，内容不含这两项） |

**结论：pnpm 既不读 `engine-strict` 也不开 `strict-peer-dependencies`，安装期不会因 `engines` / `peerDependencies` 拒绝任何东西。** 唯一的闸在 DSH 自己手里，且用的是 `includePrerelease: true` 这套与 pnpm 不同参的语义（3.2 表格两列差异即此）。

### 3.5 下界 `0.2.0-rc.1` 的扩展点复核

| 扩展点 | 0.2.0-rc.1 | 0.2.2-rc.1 | 判定 |
|---|---|---|---|
| `systemPrompt.section` | `lib/index.js:240-241` 同形校验；类型 `lib/types/index.d.ts:60` 的 `text` 已是 `string \| ((context: AssembleContext) => string)` | `lib/index.js:255-256` | 兼容 |
| `skills.registerProvider` | `lib/index.js` sha256 = `4b88621b…` | 同 | 逐字节一致 |
| `settings.describe`/`update`/`replace`/`mutate` | `lib/types/index.d.ts:96/102/108/114` | 同签名 | 兼容 |
| `agent/pre-step` | 载荷五项（`package/lib/types/runtime-types.d.ts:304-310`） | 六项（`:332-339`，+ `modelSelection`） | 兼容（纯增益） |
| `agent/created` | `:227` 存在 | 存在 | 兼容 |
| `TypertRemoteService` | `:159` 类体；`:168-171` 构造体 | `:339`；`:348-351` 构造体逐字相同 | 兼容 |

---

## 四、`engines.dsh` 与 peer 是不是两道闸

**不是两道闸，是一道，且 `engines.dsh` 独占优先。** 判定逻辑不在 `dsh-plugin-manager`，在 `@deepseek-ai/dsh-app-boot`。

### 4.1 判定函数（`/tmp/dsh-compat-09/x/deepseek-ai-dsh-app-boot-0.2.2-rc.1/package/lib/index.js`）

```js
:1070  /** Evaluate plugin dsh requirements (`engines.dsh`, else dsh peers) without importing plugin code. */
:1089  function getDshRuntimeVersion()        // 读 new URL("../package.json", import.meta.url) 的 version，即 app-boot 包自身
:1094  function satisfies(runtimeVersion, range) {
:1095      return range.trim() !== "" && semver.satisfies(runtimeVersion, range, { includePrerelease: true });
:1096  }
:1097  function unmetRequirements(fields, runtimeVersion) {
:1098      const engines = Object.hasOwn(fields, "engines") ? objectOf$1(fields.engines, "Plugin manifest engines") : {};
:1099      if (Object.hasOwn(engines, "dsh")) {
:1100          const range = engines.dsh;
:1102          return satisfies(runtimeVersion, range) ? {} : { "engines.dsh": range };   // ← 直接返回，peer 完全不参与
:1103      }
:1104      if (!Object.hasOwn(fields, "peerDependencies")) return {};
:1109      if (name !== "@deepseek-ai/dsh" && !name.startsWith("@deepseek-ai/dsh-")) continue;   // cordis/schemastery/react 被跳过
:1110      if (!satisfies(runtimeVersion, ["workspace:^","workspace:~","workspace:*"].includes(range)
                                     ? runtimeVersion : range)) unmet[name] = range;
:1117  }
:1118  /** Check the plugin's dsh requirements against the runtime. An own `engines.dsh` range decides alone and
:1119   *  peerDependencies are ignored; otherwise every @deepseek-ai/dsh or @deepseek-ai/dsh-* peer must match. */
:1129  function evaluatePluginCompatibility(manifest, exemptions = {}, runtimeVersion = getDshRuntimeVersion())
:1151  function pluginCompatibilityWarning(issue)   // 文案含 'dsh plugin allow-version'
```

三条硬事实：

1. `engines.dsh` 存在时 **`peerDependencies` 一个字都不读**（`:1099-1102` 直接 return）。
2. `engines.dsh` 缺失时，只有 `@deepseek-ai/dsh` 与 `@deepseek-ai/dsh-*` 前缀的键进闸；`cordis`（`@deepseek-ai/cordis` 不匹配该前缀）、`schemastery`、`react` 全部被 `:1109` 跳过。逐键验证用 `^99.0.0` 毒值跑 `/tmp/dsh-compat-09/probe-peers.mjs`：只有 `dsh-skill` 与 `dsh-typert-protocol` 报不满足。
3. `satisfies` 恒用 `includePrerelease: true`（`:1095`）；`workspace:^` / `workspace:~` / `workspace:*` 三种 peer 写法的按当前 runtimeVersion 自比视为满足（`:1110-1114`），但 **`workspace:` 写在 `engines.dsh` 上不享受豁免**——实测 `engines.dsh = "workspace:*"` 判 FAIL。

### 4.2 读到不匹配时：拒绝，不是打日志

| 位置 | 形态 | 行为 |
|---|---|---|
| `app-boot:1806-1807` | `const issue = evaluatePluginCompatibility(bundleManifest, exemptions); if (issue !== void 0 && !issue.exempted) throw new Error(pluginCompatibilityWarning(issue));` | **抛错，bundle 装载中止** |
| `app-boot:3097-3141` `preflight()` | `denial(row, base)` 返回警告字符串，`deny(row, reason)` 置 `row.disabled = true`（并 `row.group = false`），`:3128-3130` 调用 | **禁用该插件行并继续启动**，stderr 打 `dsh: disabling profile plugin <label>: <reason>`（`:3092-3094`） |
| `app-boot:3114` | `return issue === void 0 || issue.exempted ? void 0 : pluginCompatibilityWarning(issue);` | 上面那条的判定源 |
| `plugin-manager` 七处调用点 | `:699`、`:822`、`:2222`、`:2418`、`:2515`、`:2843`、`:3056`，一律 `evaluatePluginCompatibility(...)` 后 `throw new ManagementFailure("incompatible-version", [incompatiblePlugin(compatibility)])`（或塞进 `preflight` 数组） | **安装/启用期拒绝**，文案导向 `dsh plugin allow-version` 精确版本豁免 |

所以「打日志放行」这个假设不成立：bundle 走 `throw`，profile 插件行走 `disabled = true`，安装预检走 `ManagementFailure` —— 三条路径都阻断，只是阻断形式不同。

### 4.3 `plugin-manager` 侧只是安装前预检

| 行 | 内容 |
|---|---|
| `:12` | `import { …, evaluatePluginCompatibility, getDshRuntimeVersion, pluginCompatibilityWarning, readProfileVersionExemptions, … } from "@deepseek-ai/dsh-app-boot";`（判定符号全部来自 app-boot） |
| `:489-499` | 文档注释：`A registry spec asks pnpm's own configuration for the version the range selects and its dsh requirements (`engines` and peerDependencies). A git or tarball spec needs the fetch itself, so the check after installation is what judges it.` |
| `:500` / `:507-517` | `async function namedSpecManifest(...)` → `execa(pnpm, [..., "view", parsed.spec, "name", "version", "engines", "peerDependencies", "--json", ...flags, "--config.fetch-retries=0"], {...})` |
| `:1443-1450` | `const VERSION_FIELDS = ["name","version","engines","peerDependencies","deprecated","dsh"];` |
| `:1485-1499` | `versionFacts()` 只搬 `{ name, version, ...engines, ...peerDependencies }` 四字段进 manifest |

> **票面行号已逐行复核，与干净 tarball 一致**（不是漂移）。`sed -n "<n>p"` 实测干净 0.2.2-rc.1 的 `plugin-manager/lib/index.js`：
>
> | 行 | 原文 |
> |---|---|
> | `:489` | `/** The manifest a named spec would install, read without installing it.`（注释块起） |
> | `:490` | `* A path spec is read from disk. A registry spec asks pnpm's own configuration for the version the` |
> | `:491` | `* range selects and its dsh requirements (\`engines\` and peerDependencies). A git or tarball spec needs the fetch itself, so the` |
> | `:492` | `* check after installation is what judges it.` |
> | `:510` | `parsed.spec,` |
> | `:511` | `"name",` |
> | `:512` | `"version",` |
> | `:513` | `"engines",` |
> | `:514` | `"peerDependencies",` |
> | `:515` | `"--json",` |
> | `:1478` | `/**` |
> | `:1479` | `* What one exact version's manifest says, from \`pnpm view <name>@<version> name version engines peerDependencies deprecated dsh --json\`.` |
> | `:1490` | `manifest: {` |
> | `:1493` | `...Object.hasOwn(fields, "engines") ? { engines: fields.engines } : {},` |
> | `:1494` | `...Object.hasOwn(fields, "peerDependencies") ? { peerDependencies: fields.peerDependencies } : {}` |
>
> 补充交叉验证：本机 `/Applications/DeepSeek Harness.app/.../@deepseek-ai/dsh-plugin-manager/lib/index.js` 与干净 0.2.2-rc.1 `diff -q` **无输出**（逐字节相同，该包未被 dsh-purge 改动），本机版本号实测 `0.2.2-rc.1`。所以本节的这几个行号可以放心引用。

### 4.4 交叉验证：0.2.2 没改这道闸

把两版 `dsh-app-boot` 的判定函数段整段抽出逐行对比，结果**逐字相同**：

```bash
A=/tmp/dsh-compat-09/x/deepseek-ai-dsh-app-boot-0.2.1-rc.5/package/lib/index.js
B=/tmp/dsh-compat-09/x/deepseek-ai-dsh-app-boot-0.2.2-rc.1/package/lib/index.js
grep -n "function getDshRuntimeVersion\|function satisfies\|function unmetRequirements\|function evaluatePluginCompatibility\|function pluginCompatibilityWarning" "$A" "$B"
sed -n '271,350p' "$A" > /tmp/dsh-compat-09/lab/gate-021.txt   # 0.2.1-rc.5
sed -n '1089,1168p' "$B" > /tmp/dsh-compat-09/lab/gate-022.txt  # 0.2.2-rc.1
diff /tmp/dsh-compat-09/lab/gate-021.txt /tmp/dsh-compat-09/lab/gate-022.txt
```

输出：`行数: 80 vs 80` / `--- diff ---` / `[无差异]`。两侧关键字计数也一致（`includePrerelease` 各 1、`workspace:` 各 5、`startsWith("@deepseek-ai/dsh-")` 各 1）。

行号对照：函数在 0.2.1-rc.5 落在 `:271`（`getDshRuntimeVersion`）/`:276`（`satisfies`）/`:279`（`unmetRequirements`）/`:311`（`evaluatePluginCompatibility`）/`:333`（`pluginCompatibilityWarning`）；在 0.2.2-rc.1 落在 `:1089`/`:1094`/`:1097`/`:1129`/`:1151`。**行号整体后移是文件其它部分扩张所致，函数体本身零变更。**

即 0.2.2 相对 0.2.1 在版本闸上零变更，PR #5 面对的规则与 5.6.2 发布时完全相同。

### 4.5 宿主自身不自我约束

逐包读 `package.json`：`dsh-system-prompt` / `dsh-skill` / `dsh-agent` / `dsh-settings` / `dsh-typert-protocol` / `dsh-plugin-manager` / `dsh-app-boot` 的 `engines` **全部为 null**；它们之间用精确版本互相钉（如 `dsh-agent` 0.2.2-rc.1 的 8 个 `@deepseek-ai/dsh-*` peer 全为 `0.2.2-rc.1`），`cordis` 用 `~4.1.0`，`schemastery` 用 `~3.19.0`。**这道闸只对第三方插件生效。**

---

## 五、`order: 50` 的落点

### 5.1 `SECTION_ORDERS` 0.2.2-rc.1 全表（34 项）

来源：`x/deepseek-ai-dsh-system-prompt-0.2.2-rc.1/package/lib/index.js:10-45`（`sed -n '8,56p'` 原文）。

| 常量 | 值 | 常量 | 值 |
|---|---|---|---|
| `HARNESS_IDENTITY` | `-1e3` | `TOOL_LSP` | `2200` |
| `DEPLOYMENT_PERSONA_PREFIX` | `0` | `TOOL_SESSION_QUERY` | `2300` |
| `PLAN_POLICY` | `500` | `TOOL_GOAL` | `2400` |
| `TEAM_POLICY` | `600` | **`TOOL_SCHEDULE`** | **`2500`**（0.2.2 新增） |
| `PTC_ONLY` | `800` | `TOOL_WORKFLOW` | `2600` |
| `FILE_REFERENCE` | `900` | `TOOL_RALPH` | `2700` |
| `TOOL_BASH` | `1e3` | `TOOL_SUBAGENT` | `2800` |
| `TOOL_PWSH` | `1010` | `TOOL_REPORT` | `2900` |
| `TOOL_READ` | `1100` | `TOOL_COMPUTER_USE` | `3e3` |
| `TOOL_WRITE` | `1200` | `MCP_SERVERS` | `3100` |
| `TOOL_EDIT` | `1300` | `TOOLS_SDK` | `5e3` |
| **`TOOL_APPLY_PATCH`** | **`1350`**（0.2.2 新增） | `DELIVERABLE_FILE_REFERENCES` | `9e3` |
| `TOOL_GLOB` | `1400` | `STRUCTURED_OUTPUT` | `9900` |
| `TOOL_GREP` | `1500` | `HARNESS_SOURCE` | `1e4` |
| `TOOL_JOBS` | `1600` | `WEB_SURFACE` | `10100` |
| `TOOL_PTY` | `1700` | `DEPLOYMENT_PERSONA_SUFFIX` | `10200` |
| `TOOL_WEB_SEARCH` | `2e3` | | |
| `TOOL_WEB_FETCH` | `2100` | | |

项数核对：0.2.0-rc.1 / 0.2.1-rc.2 / 0.2.1-rc.5 各 **32 项**（起 `:10` 止 `:43`），0.2.2-rc.1 **34 项**（起 `:10` 止 `:45`）。`diff` 该段只有两行：`12a13 > TOOL_APPLY_PATCH: 1350,` 与 `21a23 > TOOL_SCHEDULE: 2500,`。

`CONTEXT_ORDERS`（`:46-54`，7 项，三版一致）：`WORKING_DIRECTORY` 100、`SANDBOX_POLICY` 110、`APPROVAL_POLICY` 115、`SUBAGENT_DELEGATION` 120、`TEAM_IDENTITY` 125、`HARNESS_SOURCE` 200、`WEB_SURFACE` 210。

### 5.2 `order` 的语义：只是排序键

```js
:98   /** Code-unit name comparison — locale-independent, so the order is identical on every machine. */
:99   function compareNames(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
:104  function comparePromptSections(a, b) { return a.order - b.order || compareNames(a.name, b.name); }
:382  const sectionDefinitions = [...sectionByName.values()].sort(comparePromptSections);
:119  function renderPrompt(assembly) {
:120      return assembly.sections.map(…).filter((text) => text.length > 0).join("\n\n");
:121  }
```

`:256` 的注册校验只要求 `Number.isFinite(section.order)`，**无白名单、无枚举、无区间约束**——任何有限数都能注册。`:119-121` 渲染时丢弃空串 section，所以「第几槽」与实际 token 偏移**无线性对应**（上游 `renderPromptSection` 在 `mode === 'off'` 时返回 `''`，见 `/tmp/dsh-ponytail-upstream/src/ponytail-instructions.ts:115` 与 `:121`，此时该 section 整段被丢弃）。

### 5.3 完整 27 槽实测

脚本 `/tmp/dsh-compat-09/order-table.cjs`：解析干净 0.2.2-rc.1 的 `SECTION_ORDERS`，扫本机 bundle 里全部 `.section({… getSectionOrder('KEY') …})` 与字面量 order 注册点，按 name 去重后排序。**仅用于定位槽位**（本机 bundle 与干净版在 `SECTION_ORDERS` 段逐项一致，已核）。

| 槽 | order | section 名 | 提供方 | 常量 |
|---|---|---|---|---|
| 1 | `-1000` | `harness:identity` | `dsh-system-prompt` | `HARNESS_IDENTITY` |
| 2 | `0` | `deployment:persona-prefix` | `dsh-subagent` | `DEPLOYMENT_PERSONA_PREFIX` |
| **3** | **`50`** | **`ponytail`** | **`@wenaixi/dsh-ponytail`** | **字面量，非表项** |
| 4 | `500` | `plan:policy` | `dsh-plan-mode` | `PLAN_POLICY` |
| 5 | `600` | `team:policy` | `dsh-experimental-tool-agent-team` | `TEAM_POLICY` |
| 6 | `900` | `context:file-reference` | `dsh-file-reference-local` | `FILE_REFERENCE` |
| 7–11 | `1000/1010/1100/1200/1300` | `tool:bash` / `tool:pwsh` / `tool:read` / `tool:write` / `tool:edit` | `dsh-tool-bash` 等 | `TOOL_*` |
| 12 | `1350` | `tool:apply_patch` | `dsh-tool-fs` | `TOOL_APPLY_PATCH`（0.2.2 新增） |
| 13–16 | `1400/1500/1600/1700` | `tool:glob` / `tool:grep` / `tool:jobs` / `tool:pty` | — | `TOOL_*` |
| 17–18 | `2000/2100` | `tool:web_search` / `tool:web_fetch` | `dsh-tool-web` | `TOOL_WEB_*` |
| 19–23 | `2300/2400/2500/2600/2700` | `tool:session-query` / `tool:goal` / `tool:schedule` / `tool:workflow` / `tool:ralph` | — | `TOOL_*` |
| 24–25 | `3100` | `mcp-resource-servers` / `mcp:${server}` | `dsh-mcp-resources` / `dsh-mcp-client` | `MCP_SERVERS` |
| 26 | `9000` | `ui:deliverable-file-references` | `dsh-deliverable-file-references` | `DELIVERABLE_FILE_REFERENCES` |
| 27 | `9900` | `tool:${STRUCTURED_OUTPUT_TOOL}` | `dsh-subagent` | `STRUCTURED_OUTPUT` |

（表中缺 `dsh-tool-lsp` / `dsh-tool-computer-use` 的注册点，是因为本机未安装这两个包，不影响落点结论；脚本输出「含 NaN 的（键不在表里）: 0」。）

**结论：`order: 50` 落在第 3 槽**——在 `harness:identity`(-1000) 与 `deployment:persona-prefix`(0) 之后、`plan:policy`(500) 与全部工具段之前。

### 5.4 「约第 200 个 Token 处」没有源码依据

该说法出自上游自己的 ADR，不是宿主文档：`/tmp/dsh-ponytail-upstream/docs/adr/0012-zero-cache-miss-session-baseline-and-turn-override.md:12` ——「`order: 50` 位于整个 Prompt 序列的最前端（约第 200 个 Token 处）」。源码侧的 `src/ponytail.ts:367` 注释只敢说「`order: 50` 位于 persona 与工具之间」。

- 「位于 persona 与工具之间」：**成立**（实测第 3 槽，persona-prefix 在第 2 槽，第一个工具段在第 7 槽）。
- 「约第 200 个 Token 处」：**宿源码里找不到任何 order → token 偏移的映射**。`comparePromptSections` 只做数值排序（`:104`），`renderPrompt` 丢弃空串后以 `\n\n` 拼接（`:119-121`）。token 位置取决于每个 section 的实际文本长度、有多少空 section 被丢弃、以及 `personaPrefix` 配置值——宿主动态决定，插件无从静态断言。

---

## 六、结论与建议

### 6.1 五问速答

| # | 问题 | 结论 |
|---|---|---|
| 1 | PR #5 三条字节级声明成立吗 | **全部成立**。`dsh-skill` 跨 0.2.0-rc.1…0.2.2-rc.1 四版零差异；`dsh-typert-protocol` 从 0.2.1-rc.2 起三版零差异（0.2.0-rc.1 是旧产物，差 294 行）；`schemastery` 3.18.4/3.19.0 四个产物文件逐字节相同，仅 `package.json` 差两行 |
| 2 | 0.2.2 相对 0.2.1 变了什么 | 运行时：`dsh-system-prompt`（SECTION_ORDERS +2 项、assemble 载荷收窄）、`dsh-settings`（3 行 Cordis 4.1 适配）、`dsh-agent`（319 行，+projection +AgentModel，pre-step 载荷 +modelSelection）、`cordis` 4.1（Fiber / Config 校验 / inactive effect）。`dsh-skill` 与 `dsh-typert-protocol` 的 `lib/index.js` **零变更** |
| 3 | peer 区间怎么写 | `>=0.2.0-rc.1 <0.2.3-0`，`engines.dsh` 与两个 `dsh-*` peer 三处同步改。覆盖 0.2.0-rc.1 至 0.2.2 全系列（含未发布的 0.2.2 正式版），排除 0.2.3 起全部 |
| 4 | `engines.dsh` 与 peer 是两道闸吗 | **不是**。`engines.dsh` 存在时 peer 被完全忽略（`dsh-app-boot/lib/index.js:1099-1102`）。不匹配时：bundle 路径 `throw`（`:1806-1807`）、profile 插件行 `disabled = true`（`:3097-3141`）、安装预检 `ManagementFailure("incompatible-version")`。pnpm 自身不阻断（`strict-peer-dependencies` 与 `engine-strict` 均未设） |
| 5 | `SECTION_ORDERS` 实际值与 order 50 落点 | 0.2.2 表 **34 项**（0.2.1 为 32 项，新增 `TOOL_APPLY_PATCH:1350`、`TOOL_SCHEDULE:2500`）。`order: 50` 落**第 3 槽**，在 `deployment:persona-prefix`(0) 后、`plan:policy`(500) 前。「约第 200 token」无源码依据 |

### 6.2 已知取证盲区

1. **未在真宿主上实跑安装与启动。** 版本闸部分只用抽取的 `unmetRequirements` / `evaluatePluginCompatibility`（`/tmp/dsh-compat-09/gate-extract.mjs`，89 行，逐字来自干净 `dsh-app-boot/lib/index.js:1070-1154`）做纯函数级验证，未把 manifest 改成 `<0.2.3-0` 后走一遍 `dsh plugin install`。抽取时直接 import 原包会 `ERR_MODULE_NOT_FOUND`（缺 `@deepseek-ai/cordis`），这是必须抽取而不能引用的原因。
2. **cordis 4.1 的两条行为未坐实。** `/tmp/dsh-compat-09/lab/probe.mjs` 里「`app2.plugin(plugin, { mode: 'nope' })` 不抛 `ValidationError`」与「inactive context 上 `ctx.effect()` 不抛 `CordisError`」两条探针结果存疑——前者可能是 fiber 异步启动把错误吞了，后者可能是探针拿到的 ctx 仍在活跃 fiber 上。**两条均未写入任何结论。**
3. **0.2.2 正式版在 npm 上不存在。** `@deepseek-ai/dsh-skill` / `dsh-typert-protocol` / `dsh-system-prompt` / `dsh-app-boot` / `dsh-agent` / `dsh-settings` / `dsh-plugin-manager` 的 0.2.x 序列各 15 个版本，止于 `0.2.2-rc.1`，无 `0.2.2`。所以 PR #5 标题里的「0.2.2」在 registry 上只能落到 `0.2.2-rc.1`；「`<=0.2.2` 的上界」是面向未来发布的声明，当前无法实测该正式版。
4. **PR 分支已从远端删除。** `gh api refs/feat/dsh-0.2.2-compat` 返回 404，`git fetch origin feat/dsh-0.2.2-compat` 失败（PR 本身仍为 OPEN）。只能走 `git fetch origin refs/pull/5/head:pr5`。
5. **本机补丁副本的偏差已隔离，但未穷尽。** `dsh-system-prompt` 本机版与干净 0.2.2-rc.1 有 6 处实质差异（全部带 `// [dsh-purge]` 标记），其中 `:217` `includeHarnessIdentity` 默认值由 `true` 反转为 `false`、`:233` identity 文案被清空——**任何依赖 identity section 的测量都会失真**。`SECTION_ORDERS` 段与 `dsh-plugin-manager` 全文经 `diff` 确认与干净版一致，故槽位实测与行号对照可用。`*.dshpurge.bak` 实计 **63 个**（地图记 60）。
6. **27 槽表不完整。** 缺 `dsh-tool-lsp`（`TOOL_LSP:2200`）与 `dsh-tool-computer-use`（`TOOL_COMPUTER_USE:3e3`）的注册点，因本机未装这两个包；另有 2 个注册点的 `order` 非字面量也非 `getSectionOrder`，未纳入扫描。此缺口不影响「order 50 落第 3 槽」的结论。
