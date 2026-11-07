# DSH 0.2.2-rc.1 插件契约调查：@wenaixi/dsh-ponytail 5.6.2 可运行性判定

> 调查对象：本机 DSH `0.2.2-rc.1`（`/Applications/DeepSeek Harness.app/Contents/Resources/app/dsh`）与 `@wenaixi/dsh-ponytail` `5.6.2`（`/tmp/dsh-ponytail-upstream`，HEAD `7223820`）。
> 方法：一手来源取证（安装目录 `node_modules/@deepseek-ai/*/lib/*.js` 与 `cordis/src/*.ts` 原文 + 临时 profile 实机启动与 HTTP 调用）。全程只读安装目录，未改 `web`/`desktop` profile，未改上游源码（`git status --porcelain` 为空）。

## 摘要

0.2.2-rc.1 没有破坏原插件依赖的宿主 API：`systemPrompt.section`、`settings.mutate`、`TypertRemoteService`/`@Remote`、`skills.registerProvider`、`agent/pre-step` waterfall、`agent/created`、`dsh.bundle.patch`、`dsh.client` 全部仍在且签名兼容。唯一硬拦点是安装期的版本判定——`engines.dsh: ">=0.2.0-rc.1 <=0.2.1"` 在 prerelease 参与匹配时把 0.2.2-rc.1 判为不兼容，安装预检直接拒绝，pnpm 都不执行。授予精确版本豁免并以 tarball 正式安装后，插件能完整加载、远程端点真实返回快照。重构的重点不是修 API，而是删掉自造的斜杠命令解析、把技能开关换成官方 `commands` + 保留官方仍缺的部分。

---

## 一、API 现状表

行号全部出自本机 `/Applications/DeepSeek Harness.app/Contents/Resources/app/dsh/node_modules/@deepseek-ai/`（下表简写为 `$A/`）与 `/tmp/dsh-ponytail-upstream/src/`。

### 1.1 提示词

| API | 当前签名 | 位置 | 原插件用法 | 状态 |
|---|---|---|---|---|
| `ctx.systemPrompt.section()` | `section(section: {name, order, text: string \| ((ctx) => string), interpolate?: boolean, complete?: boolean})` | `$A/dsh-system-prompt/lib/index.js:255` | `src/ponytail.ts:369-375` 单个对象 `{name:'ponytail', order:50, text:(context)=>renderPromptSection(...)}` | **仍存在，签名完全一致** |
| order 语义 | `Number.isFinite(order)` 否则 throw `prompt section "<name>" order must be a finite number` | 同上 `:256` | 用数字 `50` | **不变** |
| 排序规则 | order 升序，同 order 按 name 码点比较；渲染以 `\n\n` 连接并丢弃空段 | `:102-104`、`:120` | 依赖 order 控制相对位置 | **不变** |
| 官方 order 常量表 | `SECTION_ORDERS`：`DEPLOYMENT_PERSONA_PREFIX:0`、`PLAN_POLICY:500`、`TOOL_BASH:1000` … `HARNESS_SOURCE:10000`、`WEB_SURFACE:10100`、`DEPLOYMENT_PERSONA_SUFFIX:10200` | `:10-45` | 无 | **新增可读接口** `getSectionOrder(name)`（`:264`）；原插件 `order:50` 落在人设之后、计划策略之前，不撞号 |
| scoped 分层 | section/context/variable 注册在「调用 ctx 所属 scope」；scoped 段可遮蔽全局同名段，同层重复抛错 | `:223`、`:248` | 全局注册 | **仍兼容**；重构可用 per-preset 分层 |
| `{{var}}` 插值 | `interpolate: true` 时严格解析，未知变量 throw `unknown prompt variable`；变量名须 `/^[a-z][a-z0-9_]*$/` | `:161-181`、`:312` | 未用 | **官方已有，原插件手工拼字符串属多余** |

### 1.2 设置与表单

| API | 当前签名 | 位置 | 原插件用法 | 状态 |
|---|---|---|---|---|
| `ctx.settings.mutate` | `async mutate(ns, ops, expectedRevision)`，ops = `{op:'set'\|'unset', path: string[], value?}` 有序数组 | `$A/dsh-settings/lib/index.js:492` | `src/ponytail-settings.ts:45-49` 声明 `mutate(ns, ops, expectedRevision?)` | **仍存在，签名一致** |
| `describe` | `describe(options)` → **数组**，元素 `{autoGenerate, ns, schema, revision, applies:'live', value, base, user, secrets?}` | `:413` | `namespaceOf` 同时兼容数组与 `{namespaces}`（`ponytail-settings.ts:64-78`） | **仍存在**；返回形状是数组，原插件解析正确 |
| `update` / `replace` | `update(ns, patch, expectedRevision)` / `replace(ns, section, expectedRevision)` | `:474` / `:483` | 未用 | **可用** |
| volatile 字段语义 | `volatileForm(schema)` 只保留 `meta.volatile` 的字段组成表单；`isVolatilePath` 逐段判定 | `:122-131` / `:153-158` | `Config` 里 `defaultMode`/`disabledSkills`/`skillDescriptionLang` 标了 `.volatile()` | **仍存在**；实测 `describe` 确实只列这 3 个字段 |
| 错误文案 | `No configurable plugin entry "<ns>"` / `Plugin entry "<ns>" has no volatile fields` / `Config field "<path>" is not volatile` / `SettingsConflictError` | `:508-515` | 全部 catch 后 warn | **不变** |
| `ctx.configForms`（宿主侧） | **不存在**。宿主服务名是 `settings`（`SettingsForms`，`super(ownerContext,'settings')`） | `:322`、`:333` | 原插件正确用 `settings`，只在浏览器侧用 `configForms` | **宿主无此服务**；`configForms` 只存在于 `$A/dsh-client-ui-settings/lib/client.js:1252,1270`（浏览器侧） |
| `ctx.configForms`（浏览器侧） | `get(entryId)` → controller，写用 `scope.mutate(ops, revision)`；`whileServed(namespaces, register)` 占位插槽 | `$A/dsh-client-ui-settings/lib/client.js:1287,1294,1315` | `lib/client.js` `ctx.configForms.get("ponytail")` + `whileServed(["ponytail"], ...)` | **仍存在，用法一致** |
| 远程 settings 端点 | `settingsController`，namespace `settings`；`mutate(ns, ops, expectedRevision)` 返回**扁平 namespaceView**（`{ns,...,revision}`，非 `{value:{revision}}` 包裹） | `$A/dsh-api-settings-controller/lib/index.js:383,433,461-476,274-289` | `ponytail-settings.ts:113-114` 读 `response.value?.revision` | **已改返回形状**：原插件乐观 revision 永远读不到，下次写入可能带旧 revision 触发 `settings/conflict`。**需修正，非阻断**（写入失败只 warn） |

### 1.3 远程服务（Typert）

| API | 当前签名 | 位置 | 原插件用法 | 状态 |
|---|---|---|---|---|
| `TypertRemoteService` | `class X extends TypertRemoteService`，`constructor(ctx, serviceKey, options={})` → `super(ctx, serviceKey)` + `bindTypertRemote(this, name, options)`，支持 `options.namespace` | `$A/dsh-typert-protocol/lib/index.js:339,355-357` | `src/ponytail-remote.ts:72-83`：`super(ctx,'ponytailRemote',{namespace:'ponytail'})` | **仍存在，签名一致** |
| `@Remote` | 支持 `@Remote('name')`、`@Remote({name, mode:'stream', resources})`、装饰器工厂；`REMOTE_OPTION_KEYS={name,mode,resources}` | `:365,381` | `@Remote('snapshot')` | **仍存在** |
| 端点自动发现 | `claimsEndpoint` 遍历 `ctx.reflect.props` 里 `type==='service'` 的项，取 `originalOf(ctx.get(key)).typertRemote.namespace` 为 string 的，对每个 remote 方法登记 `namespace/method` | `$A/dsh-api-gateway/lib/types/index.js:205-218,228-247` | 依赖自动发现，无手工登记 | **仍存在**；第三方命名空间无需注册表 |
| HTTP 路径 | `/api/<namespace>/<method>`，POST + `content-type: application/json` + 信封 `{type:'client-request', rpcId, method, payload}` | `$A/dsh-client-connection/lib/index.js:14,631-642,888-902,1044-1058` | 未涉及 | **不变**；实测 `POST /api/ponytail/snapshot` 返回真实快照 |
| 客户端挂载 | `ctx.remote.$mount(contribution)`，contribution = `{package, descriptors:[{id, service, namespace, method, invocation:{kind:'direct'}, parameters, result:{mode:'strict',...}}]}`；校验 `requireStrictInputs` 要求每个 parameter/uplink 的 codec `mode==='strict'` | `$A/dsh-api-gateway/lib/client.browser.js:1626,1669,1697,1718,2101` | `lib/client.js:268-300` 自造 `PONYTAIL_REMOTE` 后 `await ctx.remote.$mount(...)` | **仍存在且必需**：官方 `dsh-api-remotes/lib/client.js:28285-28311` 只遍历它自己编译期写死的 27 项官方贡献，第三方命名空间必须自己 `$mount` |

### 1.4 技能（skills）

| API | 当前签名 | 位置 | 原插件用法 | 状态 |
|---|---|---|---|---|
| `ctx.skills.registerProvider(create)` | `create(control:{signal: AbortSignal, invalidate(): void})` **同步**返回 `{name, list(options), get(candidate, options)}`；`name==='runtime'` 保留字；fiber 销毁自动注销并失效缓存 | `$A/dsh-skill/lib/index.js:147-183` | `src/ponytail.ts:261-276` 传 `isSkillEnabled`/`getDescriptionLang` 闭包 | **仍存在，签名一致** |
| `skills.register` / `list` / `snapshot` / `get` | `register(skill)`（rank 250）；`list(options)`；`snapshot(options)`→`{skills, complete}`；`get(name, options)` | `:193,224,234,250` | 未用 `register`（用 provider） | **可用** |
| candidate 校验 | name 须 `/^[a-z0-9]+(?:-[a-z0-9]+)*$/`；description 非空 string；`invocation.{modelInvocable,userInvocable}` 布尔；`provider` 必须等于注册的 providerName；`source` string；`rank` 有限数 | `:462-468,513` | 原插件 provider 产出同形状 | **不变** |
| 目录渲染 | 官方 `tool-skill` 把技能描述渲染成 `- `name`: description`，逐条 `JSON.stringify([name,description])` 判重，目录是**替换式**下发 | `$A/dsh-tool-skill/lib/index.js:770,945,1029,1036,1094,979-999` | 原插件只提供 provider，不手写目录 | **官方已承担，无需自造** |
| frontmatter 契约（官方 filesystem provider） | 必须 `name`+`description`；可选 `whenToUse`(string)、`metadata`(object)、`disable-model-invocation`、`user-invocable`；**拒绝旧键** `disableModelInvocation`/`modelInvocable`/`userInvocable`，抛 `frontmatter field "<legacy>" is unsupported; use "<canonical>"` | `$A/dsh-skill-filesystem/lib/index.js:693-716,863-892` | 原插件自带解析器（`ponytail-skills.ts:141-147` 有同样的 legacy key 拒绝） | **契约一致**；原插件 6 份 SKILL.md 只写 `name`+`description`，双路径都能读 |
| 每技能开关 / 描述语言切换 | 官方 `skill-filesystem` 与 `dsh-client-ui-skill` **都没有**这两项 | `$A/dsh-skill-filesystem/lib/index.js:28-59`；`$A/dsh-client-ui-skill/lib/client.js`（`toggle*` 仅命中 `toggleExpand`/`toggleFromKeyboard`） | `disabledSkills` + provider 过滤 + `descriptions.<lang>.json` | **官方仍缺，必须自造**（这是原插件真正不可替代的部分） |
| 远程技能目录 | `sessionSkillCatalog`，namespace `skills`，`list(request{ sessionId })` → `[{name, path?, description, whenToUse?, modelInvocable}]`，只返回 user-invocable 技能，**无写方法** | `$A/dsh-api-session-controller/lib/index.js:3063,3073,3116` | 未用 | **只读**；开关必须走 settings |

### 1.5 命令（0.2.2 新增，原插件未用）

| API | 当前签名 | 位置 | 状态 |
|---|---|---|---|
| `ctx.commands.register(definition)` | `{name: /^[a-z][a-z0-9_-]*$/, description: 非空 string, handler(invocation) => {kind:'success', text?, sourceEventSeq?} \| {kind:'error', text}, input?: {hint: 非空 string, attachments?: boolean}, recordInput?}`；返回 disposer | `$A/dsh-commands/lib/index.js:149-182,266-269` | **官方内建** |
| scoped 注册 | 普通 ctx 全局；从 agent 注入的子 ctx 注册只对该 agent 生效，可遮蔽全局同名 | `:266-269` | **官方内建** |
| `execute(agent, line, attachments, signal)` | 先 append `command/run` 事件，再调 handler，结算 `command/done` | `:292-390` | **官方内建** |
| 客户端 UI | `dsh-client-ui-commands` 通过 `remote.commands.list` + `inputTrigger` 自动进斜杠菜单 | `$A/dsh-client-ui-commands/lib/client.js` | **官方内建** |
| 远程端 | `commands` 是 `TypertRemoteService`，`@Remote list`/`@Remote execute` | `$A/dsh-commands/lib/index.js:215,259` | **官方内建** |

对应到原插件：`src/ponytail-commands.ts:219-222`（`dispatchMessages`）、`:158-163`（`parsePonytailCommand`）属于**必须删除的自造件**。

### 1.6 事件与中间件

| 事件 | 当前签名 | 位置 | 原插件用法 | 状态 |
|---|---|---|---|---|
| `agent/pre-step` | waterfall，payload `{messages, turn, step, signal, modelSelection}` + 由 agentEvents 注入的 `agent`；监听器 `(payload, next) => Promise`，**必须 `await next()`**；默认 fallback 返回 `{kind:'enter', messages}`；`kind==='reject'` 时上游直接返回 | `$A/dsh-agent-loop/lib/index.js:668-710` | `ponytail-commands.ts:256-273`：先 dispatch，再 `await next()`，仅 `downstream.kind==='enter'` 时改消息 | **完全兼容**（原插件的断链守卫写法正确） |
| `agent/created` | `serial` 派发，payload `{agent, source, signal?}`，`source ∈ startup\|resume\|clear\|compact` | `$A/dsh-agent/lib/index.js:710` | `ponytail.ts:418` | **不变** |
| `session/event` | `(session, event)`；`user/message` 事件深冻结的是 `event.data`，故 `event.data.content` 正确 | `$A/dsh-session/lib/index.js:1088-1105` | `ponytail.ts:398` 读 `ev.data.content` | **不变**（该监听在改用 commands 后可整体删除） |
| `skills/change` | `ctx.events.dispatch('emit', ['skills/change'])` | `$A/dsh-skill/lib/index.js:404` | `ponytail.ts:284` | **存在** |
| `app-boot/config-reload` | `ctx.emit('app-boot/config-reload')` | `$A/dsh-app-boot/lib/index.js:4618`；`$A/dsh-settings/lib/index.js:336` 有订阅 | `ponytail.ts:331` | **存在** |
| `loader/volatile-update` | cordis loader 派发 | 实机订阅者见 `dsh-experimental-speech-to-text/lib/index.js:21` | `ponytail.ts:293` | **存在** |
| 消息自定义 source | `createMessage(input)` 只补 `id` 并 `deepFreeze`，`source` 是自由对象，可带自定义 `kind` | `$A/dsh-llm/lib/index.js:37-63` | `ponytail-commands.ts:285-300` 用 `source:{kind:'ponytail-mode-update'}` 做原地替换 | **合法** |

### 1.7 插件声明契约

| 字段 | 当前规则 | 位置 | 原插件 | 状态 |
|---|---|---|---|---|
| `dsh.bundle.patch` | `bundlePatchPaths(packageDir, bundle)` 解析为补丁文件绝对路径 | `$A/dsh-app-boot/lib/index.js:1347` | `./cordis.patch.yml`，内容 `- insert: / - id: ponytail / name: "@wenaixi/dsh-ponytail"` | **兼容** |
| `dsh.bundle.platforms` | 缺省允许所有平台；给了就必须是非空 Node 平台名数组，否则 throw `dsh.bundle.platforms must be a nonempty list of Node platform names`；不含当前平台 throw `Bundle supports Host platforms <list>; the DSH Host is running <platform>` | `:1047-1067`，调用点 `:1805`、`:2001` | 未声明 | **兼容**（可选） |
| `dsh.client` | `{platform: string, inject?: string[], external?: string[], immediately?: boolean}`；`platform` 非 string throw `dsh.client.platform must be a string`；声明了但 `exports` 无 `./client` throw `client-modules: <pkg> declares dsh.client but exports no "./client" bundle` | `$A/dsh-client-modules/lib/index.js:88-97,789-799` | `{platform:'web', inject:['@deepseek-ai/dsh-client-locale','@deepseek-ai/dsh-client-ui-settings','@deepseek-ai/dsh-client-ui-primitives']}` | **兼容**；`dsh-client-ui-primitives` 不是 npm 包而是 shell 内建模块（`dsh-web-frontend/dist/assets/index-*.js` 内建模块表 `YZ()` 里含该项），实测插件客户端已被编入 boot 图 |
| `cordis.patch.yml` 的 `insert` | 带 `insert` 则先 `structuredClone`；有 `id` 时 target 必须是 group（否则 warn `patch insert: entry %C not found` / `is not a group`）并 push 进 `target.config`，无 id 则 push 进根数组；非 insert patch 必须有 id，`config` 是**整体替换、非深合并** | `:497-555`；schema 原文见 `:3793-3794` | 3 行 insert | **兼容** |
| `engines.dsh` 兼容判定 | `engines.dsh` 存在时**只**用它（`peerDependencies` 被忽略）；`satisfies` 用 `semver.satisfies(v, range, {includePrerelease:true})` —— **prerelease 参与匹配** | `:1094-1129` | `">=0.2.0-rc.1 <=0.2.1"` | **硬拦点**：0.2.2-rc.1 不在区间内 |
| 豁免文件 | `compatibility.json`，形如 `{"<pkg>@<exactVersion>": ["<exactRuntimeVersion>"]}`；`allow-version` 需 `--accept-risk` | `:1159,1183,1239-1252` | 无 | **必须补**才能启动 |

---

## 二、可运行性结论与报错原文

### 2.1 结论

**能跑，但要过两道门，且装的形态必须是正式包不能被 `link:`。**

1. 版本门：`engines.dsh` 的 `<=0.2.1` 上限让 0.2.2-rc.1 在第一道预检就被拒；
2. 形态门：`plugin add <本地目录>` 会生成 `link:` 依赖，pnpm 不装 dependencies，运行时 `import 'yaml'` 失败。用 `npm pack` 出的 tgz 安装则正确拉齐依赖。

越过这两道门后，插件在实机上**完整加载并工作**：无 `did not activate`、无 `failed to import`、无 `disabling profile plugin`；`POST /api/ponytail/snapshot` 返回真实快照（`currentMode:"full"`、三元 `priority.chain`、`skillLang:"zh"`、6 个技能元数据）；`settings` 命名空间里出现 `ponytail` 表单并可 `mutate` 落盘。

### 2.2 报错原文（逐字）

**A. 安装预检拒绝（pnpm 未执行）**

```
dsh: installation rejected: Plugin @wenaixi/dsh-ponytail@5.6.2 is incompatible with dsh 0.2.2-rc.1: requirements {"engines.dsh":">=0.2.0-rc.1 <=0.2.1"}. Running it may cause crashes or data loss. Update the plugin or install a plugin version compatible with this dsh runtime. To accept this risk explicitly, grant the exact-version exemption for @wenaixi/dsh-ponytail@5.6.2 on dsh 0.2.2-rc.1 with `dsh plugin allow-version` or the plugin manager, then retry the installation or restart dsh. Exact-version exemption: not active.
dsh: nothing was installed.
dsh: to accept the risk, run: dsh plugin --profile ponytail-probe allow-version @wenaixi/dsh-ponytail@5.6.2 --dsh-version 0.2.2-rc.1 --accept-risk
```

拦截点在 `$A/dsh-plugin-manager/lib/types/operations.js:378-389`（add 的每个 spec 先读 manifest，`evaluatePluginCompatibility` 不通过即 `rejected(preflight, 'nothing was installed')`，pnpm 根本不跑）。

**B. `link:` 形态的运行时失败**

```
dsh: warning: 1 entry did not activate
ponytail (@wenaixi/dsh-ponytail): failed to import: Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'yaml' imported from /private/tmp/dsh-ponytail-upstream/lib/ponytail-skills.js
```

根因不是 API：`pnpm` 明确警告 `The linked in dependency will not resolve the peer dependencies from the target node_modules.`，用 `link:` 时 dependencies 不落地。`npm pack` 成 tgz 安装后 `profile/node_modules` 里出现 `yaml`，此错消失。

**C. 启动期的两种 deny 文案（未豁免时）**

bundle 形式（`dsh.profile.bundles` 里列插件）：

```
dsh: skipping profile bundle "@wenaixi/dsh-ponytail": Error: Plugin @wenaixi/dsh-ponytail@5.6.2 is incompatible with dsh 0.2.2-rc.1: requirements {"engines.dsh":">=0.2.0-rc.1 <=0.2.1"}. ... Exact-version exemption: not active.
```

patch 行形式（`cordis.patch.yml` 的 `- insert:`）：

```
dsh: disabling profile plugin row "ponytail": <同一段文案>
```

patch 行形式会在每次 loader 拓扑变化时重复打印（一次启动观察到 5 次）。两条路径的代码位置：`$A/dsh-app-boot/lib/index.js:1798-1830`（bundle）与 `:3035-3105`（`prepareProfileEntries` → `deny(row, reason)` 设 `row.disabled = true`）。

**D. 单独 `node import` 不成立的假象（判据说明）**

```
Cannot find package '@deepseek-ai/dsh-typert-protocol' imported from .../node_modules/@wenaixi/dsh-ponytail/lib/ponytail-remote.js
```

DSH 通过 `createRuntimeResolution`（`$A/dsh-app-boot/lib/index.js:1545`）+`ProfileRuntimeResolution`（`:1583`）+`HostResolvedRootInclude.import`（`:4878-4889`）把安装目录的包注入裸模块解析，peerDeps 由宿主解析。**裸 `node` 从插件目录向上找必然失败，不能作为兼容性判据。**

---

## 三、官方已内建、我们不必自造的能力

| 能力 | 官方载体 | 说明 |
|---|---|---|
| 斜杠命令注册 + 斜杠菜单 + 生命周期事件（`command/run`/`command/done`） | `ctx.commands.register` + `dsh-client-ui-commands` | 替代原插件「在 `agent/pre-step` 里扒 `user/message` 文本、自己 parse `/ponytail`」的全部代码；还自带 scoped 遮蔽与 `recordInput` |
| 技能目录渲染进模型上下文 | `dsh-tool-skill`（`catalogSourceEntries`/`catalogDescription`/`canonical` 判重） | 只要 provider 交出 `{name, description, whenToUse?}`，目录文本、替换式下发、长度截断（默认 500）全由官方负责 |
| 技能 frontmatter 解析 + 旧键拒绝 | `dsh-skill-filesystem` | 若不自建 provider，把 SKILL.md 放标准目录即可；原插件的手写 parser 只在需要 disabledSkills 过滤时才必要 |
| 配置表单（服务端 schema → 客户端表单） | `settings` 服务 + `volatileForm` + 客户端 `configForms`（`describe` 返回 `autoGenerate:true` + schema） | 不需要写任何表单代码就能得到界面；实测 `ponytail` 的 3 个 volatile 字段已自动出现在设置页 |
| 配置读写的 revision 冲突检测与落盘 | `settings.mutate` → 写 `cordis.patch.yml` 的 `config` 段 | 原插件自己的文件 sink 只在无 settings 服务时才有必要 |
| 跨端只读数据通道 | `TypertRemoteService` + `@Remote` + api-gateway 自动端点发现 + 客户端 `ctx.remote.$mount` | 不需要自己开 HTTP 路由、不需要轮询 |
| 提示词 `{{var}}` 插值 | `systemPrompt.section({interpolate:true})` + `variable(name, provider)` | 原插件手工字符串拼接可换成插值 |
| order 占位常量 | `systemPrompt.getSectionOrder('PLAN_POLICY')` 等 | 不要再写裸数字（原插件 `order:50` 本身没错，但应改为常量锚定） |
| 客户端 bundle 打包与内建模块 | `dsh.client.inject` + shell 内建模块表（含 `dsh-client-ui-primitives`） | primitives 无需安装，声明即可 |
| UI 插槽 / locale | `ctx.slots.register` / `ctx.locale.register` | 原插件已正确使用，自造成分不多 |
| 每 preset 分层 | `agentPresets`（`serviceFor(agent,name)`）+ `ScopedLayers` | 原插件「全局一个模式」可升级为 per-preset 模式 |
| 工作区指令文件注入 | `dsh-agent-instructions`（`AGENTS.md`/`CLAUDE.md`/local 变体） | 不必自己找文件，但 ponytail 的「模式注入」不是它的职责 |

---

## 四、仍需自造的部分

按「官方确定缺失」到「可以简化」排序。

1. **每技能启用/禁用**（确定缺失）。官方 `skills` 远程命名空间只读且只返回 user-invocable 技能（`dsh-api-session-controller/lib/index.js:3116`），`dsh-client-ui-skill` 无开关 UI，`skill-filesystem` 无开关字段。必须保留：`Config.disabledSkills`（volatile）+ 自建 provider 在 `list()` 里过滤。
2. **技能描述语言切换**（确定缺失）。官方 frontmatter 只有单一 `description`；中英切换必须自建 `descriptions.<lang>.json` + provider 覆写 `description`。
3. **模式（lite/full/ultra）的提示词段与三档文案**。这是插件本体，官方无对应物。要保留 `systemPrompt.section` + 按档渲染。
4. **模式的持久化与优先链**（env → `cordis.patch.yml` → 代码默认）。`defaultMode` 应改为 volatile 字段走 `settings`，env 优先级保留；原插件的三层 `priority.chain` 诊断可保留但简化。
5. **每轮注入「模式更新」提示**（若保留该行为）。官方 `agent/pre-step` 仍在，仍是唯一位置；但若只是「切换档位时告知模型」，用 `commands.register` 的 `command/done` 文本 + `systemPrompt` 段重算即可，不必再改 `decision.messages`。
6. **客户端面板**：状态展示（`snapshot`）+ 技能开关列表。表单本身可交给官方 `configForms`（`autoGenerate`），只有「开关列表的专门 UI」需要自造。
7. **`ponytail:` 债务指令与 `/ponytail-debt` 收割逻辑**。这是纯提示词 + 模型行为，无宿主 API 依赖。
8. **`settings` 远程返回形状的适配**（需修正而非自造）：`ponytail-settings.ts:113-114` 应从扁平 `{revision}` 读，而不是 `{value:{revision}}`。

**可以删除的自造件**：`ponytail-commands.ts` 的文本解析与消息注入（`dispatchMessages`/`parsePonytailCommand`/构造 `source:{kind:'ponytail-mode-update'}`）、`handlePreStep` 的断链守卫、`ponytail-skills.ts` 的 frontmatter 解析器（若改用官方 filesystem provider，只在需要过滤时保留 `get`/`list` 包装）。

---

## 五、实测环境与清理

**版本**：DSH 与全部官方包 `0.2.2-rc.1`；`@deepseek-ai/cordis` `4.1.0`（原插件 peer `^4.0.4` 满足）；node `v22.22.3`、pnpm `12.16.1`。

**本次新建的临时 profile（不在 web/desktop 内，删除即可彻底清理）**：

```bash
rm -rf ~/.dsh/profiles/ponytail-probe   # 主实验：tgz 安装 + 启动 + HTTP 验证 + mutate 落盘
rm -rf ~/.dsh/profiles/pp-probe2        # 复现 patch 行 deny 文案用
rm -rf /tmp/probe-pkg /tmp/probe-api.sh /tmp/fe.py /tmp/cl.py
rm -f  /tmp/deny-run.log /tmp/pp2.log /tmp/desktop-dump.err /tmp/compat-backup.json
```

`web` / `desktop` 两个 profile 的 `package.json`、`cordis.patch.yml`、`compatibility.json` 均未改动（desktop 里 5.6.2 仍是「已装但启动被 deny」的原状态，因为没有 `compatibility.json`）。

**复现命令（如需重跑）**：

```bash
DSH=/Applications/DeepSeek\ Harness.app/Contents/Resources/app/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js
(cd /tmp/dsh-ponytail-upstream && npm pack --pack-destination /tmp/probe-pkg)
node "$DSH" plugin --profile <p> add /tmp/probe-pkg/wenaixi-dsh-ponytail-5.6.2.tgz   # 先被拒
node "$DSH" plugin --profile <p> allow-version @wenaixi/dsh-ponytail@5.6.2 --dsh-version 0.2.2-rc.1 --accept-risk
node "$DSH" plugin --profile <p> add /tmp/probe-pkg/wenaixi-dsh-ponytail-5.6.2.tgz   # 成功
node "$DSH" --profile <p> --port 0 --no-open                                        # 抓 token 后 POST /api/ponytail/snapshot
```

## 六、宿主类型声明的分发事实（2026-11-07 由 #03 补齐，推翻本笔记早前的 `types/dsh/*.d.ts` 判断）

### 6.1 App 打包树里没有，npm 发行物里有

```bash
find "/Applications/DeepSeek Harness.app/Contents/Resources/app/dsh/node_modules" -name '*.d.ts' | wc -l
# 0

npm pack @deepseek-ai/dsh-skill@0.2.2-rc.1 && tar -tzf deepseek-ai-dsh-skill-0.2.2-rc.1.tgz | grep '\.d\.ts$' | wc -l
# 1  (lib/types/index.d.ts)
```

`npm pack` + 解包的完整统计（共 **63 个 .d.ts**）：

| 包 | .d.ts 数 | 包 | .d.ts 数 |
|---|---|---|---|
| dsh-skill | 1 | dsh-session | 10 |
| dsh-system-prompt | 1 | dsh-session-projection | 2 |
| dsh-tool-skill | 1 | dsh-app-boot | 22 |
| dsh-agent | 8 | dsh-client-modules | 9 |
| dsh-settings | 4 | dsh-util-values | 2 |
| dsh-commands | 6 | dsh-scope | 2 |
| dsh-llm | 15 | | |

每个包 `package.json#types = "lib/types/index.d.ts"`，与 `exports` 的 `types` 条件一致。

**结论**：Electron 打包（`electron-builder` 的 files 裁剪）丢掉了 `lib/types/**/*.d.ts`，但 npm 发行物完整发布。所以插件可以把 `@deepseek-ai/*` 装成 devDependency 直接吃官方类型，**不需要手写 shim**。宿主里 `dsh-agent/lib/types/`、`dsh-settings/lib/types/`、`dsh-commands/lib/types/` 三个目录确实存在，但内容是 `.js`（从 `.d.ts` 编译出的运行时代码），不是声明文件——早前把这当成「声明被裁掉」的证据是误读。

### 6.2 实测可编译的最小骨架（零 `as`）

```bash
# 只装这几个包就够写出真插件
pnpm add -D typescript@5.9.3 @deepseek-ai/cordis@4.1.0 \
  @deepseek-ai/dsh-skill@0.2.2-rc.1 @deepseek-ai/dsh-system-prompt@0.2.2-rc.1 \
  @deepseek-ai/dsh-agent@0.2.2-rc.1 @deepseek-ai/dsh-scope@0.2.2-rc.1
```

tsconfig 关键项：`target ES2023` / `module`+`moduleResolution` `nodenext` / `strict` / `noEmit` / **`skipLibCheck: true`** / `types: []` / `lib: ["ES2023","ESNext.Disposable"]`。

**类型不是 `any`**（故意写错三处全被抓）：

- `{name:'x',order:1,txt:'y'}` → `TS2561 ... 'txt' does not exist in type 'PromptSection'. Did you mean to write 'text'?`
- `payload.foo` → `TS2339 Property 'foo' does not exist on type '{ agent: Agent; messages: UserMessage[]; turn: number; step: number; signal: AbortSignal; modelSelection: Readonly<ModelSelection>; }'`
- `p.nope` → `TS2339 Property 'nope' does not exist on type '{ agent: Agent; }'`

### 6.3 `skipLibCheck` 为什么是硬要求

`skipLibCheck: false` 会炸三处，全部与我们的代码无关：

1. `@deepseek-ai/dsh-llm/lib/types/content.d.ts(5,101)` → `TS2307: Cannot find module '@deepseek-ai/dsh-attachment'`（dsh-llm 的依赖没随安装带进来）。
2. `@deepseek-ai/dsh-typert-protocol/lib/types/owned-value.d.ts(5,50)` → `TS2304: Cannot find name 'Disposable'`（要 `lib: ["ESNext.Disposable"]`）；`dsh-session/lib/types/preparation.d.ts(17,52)` 同类。
3. `@deepseek-ai/dsh-typert-protocol/lib/types/types.d.ts(415,9)` → `TS2717: Subsequent property declarations must have the same type. Property 'typert' must be of type 'TypertRegistryContract', but here has type 'TypertRegistryContract'.`（同一包装了两份，跨实例声明冲突，`skipLibCheck` 是唯一实用解）。

### 6.4 `agent/pre-step` / `agent/disposed` 的增强加载条件

两个事件定义在 `@deepseek-ai/dsh-agent/lib/types/runtime-types.d.ts`（`agent/pre-step` 约 :332，`@mode waterfall`；`agent/disposed` 约 :267，`@mode emit`），通过 `declare module '@deepseek-ai/cordis'` 合并进 `Events`。**增强只在该包类型被真正引用时生效**：只 `import type { Agent }` 而不用，会同时报

```
TS6133: 'Agent' is declared but its value is never read
TS2345: Argument of type '"agent/disposed"' is not assignable to parameter of type 'keyof Events'
```

做法：在回调参数标注里用上它，例如

```ts
ctx.on('agent/disposed', (payload: { readonly agent: Agent }) => { store.delete(payload.agent.id) })
```

`Agent` 只有一个成员 `readonly id: SessionId`（`dsh-agent/lib/types/types.d.ts:12-15`），所以从 agent 反推会话 key 就是 `agent.id`，零断言。

### 6.5 一个只在 `tsc -p tsconfig.build.json` 才炸的坑：TS2742

`export const Config = z.object({...})` 的类型是推导的，`declaration: true` 需要给它起名，TypeScript 会把 schemastery 内部类型的**物理路径**写进 `.d.ts`。当前版本（schemastery 装在最外层）不报；把 devDependency 切到 dsh `0.2.0-rc.1` / `0.2.1-rc.5` 后，peer `~3.19.0` 不被满足，pnpm 把 schemastery 落到 `.pnpm/@deepseek-ai+schemastery@3.18.5/node_modules/...`，同一份源码立刻报：

```
src/config/schema.ts(40,14): error TS2742: The inferred type of 'Config' cannot be named without a reference to
'.pnpm/@deepseek-ai+schemastery@3.18.5/node_modules/@deepseek-ai/schemastery'. This is likely not portable.
A type annotation is necessary.
```

**修法**：给 `Config` 显式标注 schemastery 自己声明的全局类型，声明文件从此只引用包名：

```ts
export interface ConfigShape {
  readonly defaultMode: Schemastery<RuntimeMode, RuntimeMode>;
  readonly skillDir: Schemastery<string, string>;
  readonly locale: Schemastery<'zh' | 'en', 'zh' | 'en'>;
}
export const Config: Schemastery<
  Schemastery.ObjectS<ConfigShape>,
  Schemastery.ObjectT<ConfigShape>
> = z.object({ defaultMode: modeSchema, skillDir: z.string(), locale: localeSchema });
```

`schemastery` 的 3.18.5 与 3.19.0 的 `lib/types/index.d.ts` **逐字节相同**（均 210 行），所以这个标注跨版本成立。`typecheck` 与 `test` 都看不见这个问题——只有声明生成会。CI 的版本矩阵必须跑 build。

### 6.6 产物里对 `@deepseek-ai/dsh-*` 的值导入会炸（解析事实）

```bash
node -e "createRequire('$HOME/.dsh/profiles/desktop/package.json').resolve('@deepseek-ai/dsh-skill')"
# Error: Cannot find module   —— 同上：cordis / dsh-typert-protocol 全部 FAIL
node -e "createRequire('$HOME/.dsh/profiles/desktop/package.json').resolve('@deepseek-ai/schemastery')"
# ~/.dsh/profiles/desktop/node_modules/@deepseek-ai/schemastery/lib/index.cjs
ls ~/.dsh/profiles/desktop/node_modules/@deepseek-ai/
# cosmokit  schemastery        （只有这两个）
```

→ `@deepseek-ai/dsh-*` 只活在 App 打包树里，**不参与插件自身的模块解析**。插件的 `.js` 里只要出现 `import '@deepseek-ai/dsh-skill'`，装完第一次装载就 `ERR_MODULE_NOT_FOUND`。

上游 Wenaixi 靠 `import type` 活下来（`ponytail.ts:13`、`ponytail-skills.ts:90-100` 全是类型导入，编译后擦除）；它唯一的值导入是 `@deepseek-ai/schemastery`（profile 里有）与 `@deepseek-ai/dsh-typert-protocol`（写进了 peerDependencies）。

**结论**：新仓库的产物运行时依赖白名单只有 `@deepseek-ai/schemastery`（与 `@deepseek-ai/cordis`，后者由宿主自身提供）。需要 `BUNDLED_SKILL_RANK` 这类常量时本地抄一份，并写一条哨兵测试断言它等于宿主真实值（宿主改档时立刻红灯）。
## 七、settings 写入通道的完整事实（2026-11-07 由 #04 补齐）

这一节把「配置写下去到底经过什么」逐层拆开。上一节解决的是**能不能 import**，这一节解决的是**写完怎么知道成了、失败怎么重试**。

### 7.1 三层来源在宿主侧已有权威定义，不必自己推

`$A/dsh-config-editor/lib/index.js:39-63` 的 `configuration()` 对每个 loader 条目返回三项：

| 字段 | 含义 | 本插件的用法 |
|---|---|---|
| `inherited` | 把本条目在**所有** profile patch 里的 `config` 都摘掉后重新合成的结果（= 继承层 / base） | 不直接用 |
| `override` | profile patch 里最后一条带 `config` 的同 id 节点 | = 诊断链的 **patch 层原文** |
| （`describe` 另算的）`value` | `projectForm(form, plainConfig(fiber.effectiveConfig))`，已混进 env 与代码兜底 | **不可当 patch 层**，否则面板会把「兜底的 full」说成「用户配的 full」 |

`describe()` 返回 `{autoGenerate, ns, schema, revision, applies:'live', value, base, user, secrets?}`（`$A/dsh-settings/lib/index.js:413-454`）。**`user` 就是 patch 层**，直接读即可。

### 7.2 写入一律 `Promise<void>`，revision 必须自己回读

`update` / `replace` / `mutate` 三个方法的返回类型都是 `Promise<void>`（`$A/dsh-settings/lib/types/index.d.ts:96-114`），**没有任何一个把新 revision 交回来**。

→ 上游 `ponytail-settings.ts:113-114` 读 `response.value?.revision` 读不到，第二次写入就带旧 revision，触发 `SettingsConflictError`（`code === 'SETTINGS_CONFLICT'`，带 `expected` / `actual`）。这是 0.2.2 下「改一次成功、改第二次永远失败」的根因。

**正解**：catch 到 `SETTINGS_CONFLICT` → 重新 `describe()` 取 `descriptor.revision` → 再写一次。只重试一次就够：第二次仍冲突说明有别的写入者在持续竞争，无限重试会把一次点击变成写盘风暴。

### 7.3 `mutate` 的 unset 是「回退到继承值」，不是删除

`mutate` 里非数组路径的 `unset`：先从 `base`（继承层）取同路径值，取到就变成 `set(inherited)`，取不到才真 unset（`$A/dsh-settings/lib/index.js:492-504`）。`config-editor.edit()` 在 `isDeepStrictEqual(next, inherited)` 时会把该条目的 `config` 整段从 YAML 里删掉（`$A/dsh-config-editor/lib/index.js` 的 edit）。

→ 「恢复默认」的语义等于 `unset`，不需要我们自己算默认值再写回去。

### 7.4 落盘的三重保护宿主已经做完

`dsh-config-editor.edit()` 依次做：`withFileLock(profile/package.json)` → `hmr.runExclusive` → 条目可用性两次核对 → `fiber.resolveConfig(next)` 先试校验 → 写前再核对补丁是否被 home patch / 命令行覆盖 → `writeFileAtomic(path, …, {mode: 0o600})` → reconcile 失败则写回 `before` 并重抛。

→ 上游 175 行 `writeDiskConfig` / `safeAtomicWriteFile` / `salvageConfig` 全部没有存在理由。地图 `:79` 的定案（两处都不自写盘）由此落实。

### 7.5 「非法配置保留上一个好值」也不用我们写

`cordis-plugin-loader` 的 `_commitVolatile()`：校验失败 → `logger.warn` 两条 → `return true`（当作已处理，不触发完整重载），`fiber.effectiveConfig` 里的 volatile 引用**原值不动**；成功则 `updateVolatile(ref, source)` 并 `emit('loader/volatile-update', paths)`，`paths` 是 `string[][]`。

→ 插件该做的是**显性化**：监听这条事件 → 重新 `describe()` → 把拒绝原因并进诊断链，让面板说得出「你上次写的值被拒了，现在跑的还是旧的」。

### 7.6 `.volatile()` 与 `.default()` 互斥（实测）

`z.string().default('x').volatile()` 的 `validate(undefined)` 仍返回引用，但 `.get() === undefined`——默认值被丢弃。这从另一个方向印证了票面 #04 的定案：**Schema 不给默认值**。

加 `.volatile()` 后字段**仍然存在、仍然被校验**，只是输出从裸值变成 `{get()}` 引用（缺席时 `.get()` 返回 `undefined`）。所以读配置必须走三态解包（引用 / 裸值 / undefined），且 `validate({defaultMode:'LITE'})` 仍会给出 `$.defaultMode expected "off" | "lite" | "full" | "ultra" but got "LITE"`。

### 7.7 `ctx.inject` 是「起子插件」，不是条件钩子

`Context.prototype.inject(inject, callback)` = `this.plugin({ inject, apply: callback, name: callback.name })`（`$A/cordis/lib/index.js:1672`），返回 `Fiber & PromiseLike<Fiber>`。依赖缺席时该子 fiber **不启动**，主插件照常跑。

→ 这就是「settings 可选」的正确写法，不需要 `try/catch` 探测，也不需要三重断言。副作用：回调里抛错会让这个 Fiber reject，必须 `void Promise.resolve(fiber).catch(…)` 接住，否则变成未处理的 rejection 崩进程。

官方范本：`$A/dsh-client-locale/lib/index.js` 全文只有 25 行，`Config` 里唯一的字段标了 `.volatile()`，`apply` 里 `ctx.inject(['settings'], (child) => child.effect(() => child.settings.configure({auto:false}, ctx.fiber)))`。

### 7.8 本仓的落点

| 文件 | 职责 |
|---|---|
| `src/config/priority.ts` | 纯函数三级链，恒 3 项诊断，零 I/O |
| `src/config/volatile.ts` | 三态解包（不 import cosmokit，避免新增 peer） |
| `src/config/schema.ts` | 三字段全 `.volatile()`、全无 `.default()` |
| `src/config/runtime.ts` | 唯一写入口 + 只读快照 + 订阅 + 冲突重试一次 |
| `src/config/events.ts` | `declare module` 声明两条事件，避免用宽松重载骗过类型 |
| `src/plugin.ts` | `ctx.inject(['settings'], …)` 接线 + `runtimeOf(ctx)` 供 #05 / #07 取同一份状态 |

## 八、命令通道与 pre-step reminder 的完整事实（2026-11-07 由 #07 补齐）

### 8.1 `commands.register` 的精确契约

来源：`npm pack @deepseek-ai/dsh-commands@0.2.2-rc.1` 的 `lib/types/index.d.ts`。

```ts
interface CommandInvocation { commandId; agent: Agent; rawInput: string; attachments: readonly (ImageBlock|FileBlock)[]; signal: AbortSignal }
interface CommandDefinition {
  definitionId?: CommandDefinitionId;   // 可选，@deepseek-ai/dsh-plan-mode 用它标来源
  name: string;                          // 小写、无斜杠
  description: string;
  input?: { hint: string; attachments?: boolean };
  recordInput?: boolean;                 // 默认 true
  handler: (invocation: CommandInvocation) => CommandResult | Promise<CommandResult>;
}
type CommandResult = { kind: 'success'; text?: string; sourceEventSeq?: SessionSeq } | { kind: 'error'; text: string };
```

四条实测结论：

1. `register()` 返回**精确的 effect disposer**（内部 `this.layers.effect(this.ctx, …)`），调用方不必再包 `ctx.effect`。
2. 重名直接抛 `command "<name>" is already registered`，不做静默覆盖。
3. `input.hint` 必须非空字符串、`input.attachments` 必须是 boolean——`normalizeDefinition` 会校验；未声明 `attachments` 的命令，`invocation.attachments` 恒为空数组。
4. handler 抛错不用自己兜：宿主在 handler 前 append `command/run`、之后 append `command/done`，thrown / aborted 一律结算成 `kind:'error'`。

### 8.2 `agent/pre-step` 有**两个** messages，别混

```ts
'agent/pre-step'(
  payload: { agent; messages: UserMessage[]; turn; step; signal; modelSelection },
  next: () => Promise<PreStepDecision>,
): Promise<PreStepDecision>

type PreStepDecision = { kind: 'reject' } | { kind: 'enter'; messages: UserMessage[]; startsRequestSeries?: true }
```

- `payload.messages` = 本步**待处理**的输入批次；
- `decision.messages` = 本步**真正送给模型**的消息（`next()` 的产出）。

官方卫兵写法固定为 `const decision = await next(); if (decision.kind === 'reject') return decision;`，配 `signal.aborted` / `signal.throwIfAborted()`。我们只加工 `decision`，从不改 `payload`。

### 8.3 幂等的对象是「本步注入批次」，不是会话历史

两个官方范本给出同一条做法：

- `dsh-tool-skill/lib/index.js:931-990`：算出目录摘要 `digest`，与每个 agent 的持久记录比；相等且 `decision.messages` 里已有同 kind 消息时，**把那条从批次里剔除**；不等则原位替换或追加。
- `dsh-plan-mode/lib/index.js:168-190`：`WeakMap` 按 session 记待提交意图，只在 `pending` 存在且未中止时追加一条 narration。

→ 所谓「不累积」= 每步最多一条通知。历史里已发生的旧通知**不改写**——改写历史才是真污染。

`renderCatalogUpdate` 的首句原文是「This complete catalog replaces every earlier available-skills list in this session:」：用**替换式措辞**表达语义幂等，而不是回去动历史。我们照此：切档文案里写「取代此前任何档位说明」。

### 8.4 消息来源是 merge-extensible sum type，自定义 kind 合法

`dsh-llm/lib/types/message.d.ts` 的注释原文：「each producer declares its own kind in its own module; there is no shared catch-all plugin kind」「consumers fall through unknown kinds」。

```ts
interface MessageSourceMap { user: …; model: …; tool: …; 'system-prompt': … }
type MessageSource = MessageSourceMap[keyof MessageSourceMap];
```

所以 `source.kind = 'ponytail-mode-update'` 是**被设计允许**的（用 `declare module '@deepseek-ai/dsh-llm'` 增强即可），不是黑科技。

工厂实现只有三行且运行时等价于字面量：`createUserMessage(i) => createMessage({...i, role:'user'})`、`createMessage(i) => deepFreeze(structuredClone({...i, id: brandString(randomUUID())}))`、`MessageId(id) => brandString(id)`。

→ 但 `@deepseek-ai/dsh-llm` **不在**宿主 profile 的解析范围里，值导入会让产物第一次装载就 `ERR_MODULE_NOT_FOUND`（见 §6.6）。本仓因此手写消息字面量，并把全仓唯一一处断言收在 `src/prompt/notice.ts` 的 `brandMessageId()`（一行，理由写在注释里）。

### 8.5 `off` 档要让段整段消失，判据打在 `renderPrompt` 上

`dsh-system-prompt/lib/index.js:119-121`：

```js
assembly.sections.map(s => s.interpolate === false ? s.text : interpolate(...))
  .filter(text => typeof text === 'string' && text.length > 0)
  .join("\n\n")
```

→ 段对象在 `assemble().sections` 里**仍然存在**（`text: ''`），真正丢空段的是 `renderPrompt`。断言必须打在渲染结果上，打在 sections 上会误判成「off 没生效」。

### 8.6 `AssembleContext` 的类型没有 `agent`，实装有

类型只声明 `{ scope?: ScopeKey; signal?: AbortSignal }`（`dsh-system-prompt/lib/types/index.d.ts:37-45`），但实装 `dsh-agent/lib/index.js:407-413` 的 `assembleContextFor(agent, signal)` 返回 `{ agent, scope: agent, ...signal }`，调用点是 `dsh-agent-loop/lib/index.js:685`。源码注释：「Build the prompt assembly context with agent and scope set together, so agent-scoped prompt and tool contributions cannot be silently omitted.」

→ baseline 锁可以在段内实现（读这个未声明字段），但必须**降级**：读不到 agent 就退回全局活档位，绝不能抛错或让段消失。本仓把这件事收在 `AgentAssembleContext` 一个接口里，grep 接口名即可找到全部依赖点。

### 8.7 分层矩阵逼出的依赖倒置（本轮改动）

`scripts/verify.mjs` 的矩阵是 `plugin.ts → {prompt, state, config, skills} → l0`，**四层互不可见**。提示渲染需要「当前活档位」（config）与「会话诞生档位」（state），于是必须倒置：

- `src/prompt/port.ts` 只声明 `PromptPorts { readonly mode: RuntimeMode; ensure(id, fallback): SessionRecord }`，只 import l0 的 `RuntimeMode`；
- `src/plugin.ts` 造一次适配器：`get mode(){ return runtime.mode }` + `ensure: (id, fb) => sessions.ensure(id, fb)`；
- `describeError` 从 `src/config/runtime.ts` 下沉到 `src/l0/errors.ts`（config 保留 re-export 不动调用点）——它只是 `String(error)` 的护栏版，不含配置语义。

`mode` 必须是 **getter**：写成 `{ mode: runtime.mode }` 会冻结成构造时的快照，切档不生效且面板显示正常——最难查的一类 bug。

### 8.8 前缀稳定性的实测口径

`scripts/measure-prompt.mjs`（`node scripts/measure-prompt.mjs`）在真宿主上装一次插件、切一次档、再装配一次并逐字节比对：

| 指标 | 实测值 |
|---|---|
| 整条 system prompt 字节（切档前 / 后） | 3005 / 3005 |
| 逐字节相同 | true |
| ponytail 段字节（切档前 / 后） | 2955 / 2955 |
| 切档 reminder 字节 | 3167 |
| token | null（宿主不暴露统一 tokenizer） |

注意两点：

1. 段正文 2955 字节是**中文正文**的字节数，不是 token 数。上游「约 180 token」是英文原文口径，中文改写后按字节算必然翻倍；本仓因此不宣称 token 数，只给可复现的字节数。
2. 脚本里 reminder 必须用 `stripFrontmatter(SKILL.md)` 的结果算——直接读原文会多算 frontmatter（我第一版多算了 845 字节）。

### 8.9 本仓落点

| 文件 | 职责 |
|---|---|
| `src/prompt/fence.ts` | CommonMark 围栏扫描（开/闭围栏行本身不算内容），只回答「这一行在不在围栏里」 |
| `src/prompt/ladder.ts` | 档位行形状识别 + 围栏感知过滤 + 两套文案（段正文 / reminder） |
| `src/prompt/source.ts` | 正文缓存：`stat` 指纹（mtimeMs + size）变了才重读；失败保留上一份 |
| `src/prompt/notice.ts` | 自定义 source kind、造消息、批次内幂等替换 |
| `src/prompt/prestep.ts` | `agent/pre-step` 接线：不断链、只认 `enter`、先标记后返回 |
| `src/prompt/port.ts` | prompt 层唯一的外部依赖形状（依赖倒置的接缝） |
| `src/commands/ponytail.ts` | 官方 `commands.register`；空参数报当前档位与可选值 |
| `src/l0/errors.ts` | `describeError`（三层共用，不含配置语义） |


## 九、客户端 UI 与降级路径的完整事实（2026-11-07 由 #05 补齐）

### 9.1 客户端侧不自造 Remote，只用宿主已 mount 的生成物

宿主的 `dsh-api-remotes` 在客户端插件 `apply` 里逐个 `ctx.remote.$mount(contribution)`，其中包含 `settingsController` 的生成物（`$H/dsh-api-remotes/lib/types/client/index.js`，27 个）。这些生成物自带 strict codec。

自己手写 contribution 走不通，`$H/dsh-api-gateway/lib/client.browser.js:2101-2109` 的 `requireStrictCodec`：

```js
function requireStrictCodec(codec, endpoint, field) {
  if (codec.mode !== "strict") throw new Error(`client api: generated Remote ${endpoint} field ${JSON.stringify(field)} has no strict codec`);
}
```

`validateContribution` 对每个 descriptor 的每个参数、`uplink`、`context` 调用的 codec 逐个校验。strict codec 只能由 `@deepseek-ai/dsh-typert-generator` 生成，而宿主打包树里没有这个包（`ls $H | grep -i generator` 为空）。**结论：v0.2 只用 `ctx.remote.settings.*`，不新建命名空间。**

客户端拿到的是**解开信封后的值**：`invoke` 在 `$H/dsh-api-gateway/lib/client.browser.js:1819-1841` 里对 `result.ok` 为真的情况执行 `descriptor.result.mode === "strict" && descriptor.result.decode !== void 0 ? descriptor.result.decode(result.value) : result.value`，所以 `form` 之外的直接调用要写成 `const response = await ctx.remote.settings.describe(); response.ok ? response.value : …`。

### 9.2 诊断链的三段来源，以及浏览器为什么算不出 env 行

`settings/describe` 的 namespace view 带 `value` / `base` / `user` 三段（`$H/dsh-settings/lib/index.js:413-468`）：

| 段 | 来源 | 语义 |
|---|---|---|
| `value` | `projectForm(form, plainConfig(entry.fiber.effectiveConfig))` | 最终生效值（含 env 插值与代码默认） |
| `base` | `projectForm(form, plainConfig(inheritedConfig(entry.fiber.runtime, resolved)))` | 组合/继承层，清空字段后回落到这里 |
| `user` | `projectForm(form, override)` | 用户补丁层原文；**字段存在本身**才是「被覆盖」的证据 |

`ns` 是宿主插件条目 id（`entry.options.id`），与本包 `PLUGIN_ID = 'ponytail-58fly'` 同源，所以客户端 `configForms.get(PLUGIN_ID)` 与宿主 `describe()` 指的是同一个命名空间。

env 段的坑：客户端 platform 是 `browser`，`process.env` 是空对象，拿不到宿主进程的 `PONYTAIL_DEFAULT_MODE`。所以诊断链在客户端只能**按值归属反推**：谁的值等于 `value.defaultMode`，命中的就是哪一层；若 `value` 既不等于补丁层也不等于兜底，剩下的唯一可能就是 env。这条反推写成纯函数放在 `src/l0/diagnosis.ts`，env 行必须显式标注「按反推得出」而不是「实测」。

### 9.3 客户端 `inject` 缺项是硬失败，`dsh.client.inject` 缺项才是静默跳过

两个 inject 完全不同：

- 客户端 cordis 的 `export const inject = [...]` 是**硬依赖**：服务缺席时整条客户端条目不会装载。所以本包顶层只写 `['slots']`，把 `configForms` 留到运行时 `ctx.inject(['configForms'], scope => …)`——那里缺席只是回调不执行。
- `package.json#dsh.client.inject` 是模块图的排序提示，`arriveGraphRow`（`$H/dsh-client-modules/lib/client.js:780-796`）对取不到的包**静默跳过**，不报错。

因此「卸掉设置页后 UI 零损失」的机制是：`configForms` 缺席 → 运行时 `ctx.inject` 的回调永不执行 → 一次 `slots.register` 都不会发生 → 设置页里没有这个 section，而宿主侧命令、提示段、技能全部照常。这条路径由 `test/client-wiring.test.mjs` 的第 2 条与第 3 条钉住。

### 9.4 `settings.section` 是 list slot，注册项必须带 `id`，`label` 可以用 thunk

`$H/dsh-client-ui-settings-general/lib/client.js:1587-1596` 是唯一权威范例：

```js
ctx.slots.inject("settings.section", () => ctx.slots.register({
  name: "settings.section", id: "general", order: 0,
  label: () => t("general.nav"), locale: NS,
  children: { "settings.general.item": { kind: "list", scope: "root" } }
}, GeneralSection));
```

三点沿用：

1. list slot 的条目必须带 `id`（SlotCore 拒绝没有 id 的 list 注册），`order` 决定导航位置。
2. `label` 接受 `string | (() => string)`，thunk 每次读都重求值，切换语言不必重注册。
3. 同一个 cell、同一个 priority 二次注册会抛错；第三方要共存就得显式给 `priority`。

**不写 `children`**：本包不往下挂子槽位，写一个空的 `children` 只会让组件被迫消费 `renderSlot`（`RendersCheck` 在编译期就要求「声明了 children 就必须消费 renderSlot」）。

### 9.5 `inject` 面的 hooks 会被改名，别自己做前缀

`$H/dsh-client-ui-renderer/lib/client.js:444-459` 的 `bindInjectSources` 把 `hooks: { snapshot: form }` 变成 props 上的 `useSnapshot`，命名规则是 `standardHookPropName`（`$H/dsh-client-ui-slots/lib/index.js:7-9`）：

```js
`use${name[0]?.toUpperCase() ?? ""}${name.slice(1)}`
```

所以注册项里写 `hooks: { useSnapshot: … }` 会得到 `props.useUseSnapshot`。测试第 5 条专门钉这件事（`face.useSnapshot === undefined`，`Object.keys(face.hooks) === ['snapshot']`）。

hook 源只需有 `getSnapshot()` 与 `subscribe(fn)`：`bindSnapshotSelector`（`:155-161`）直接把它交给 `useSyncExternalStoreWithSelector`。`ConfigForm` 正好满足。

**selector 必须是模块级常量**：写成内联箭头 `(value) => value` 会每帧新建函数，`useSyncExternalStoreWithSelector` 认为 selector 变了，在 React 18 下触发无限重渲染。

### 9.6 写路径不需要自己串行化

`ConfigFormController.mutate`（`$H/dsh-client-ui-settings/lib/client.js:1165`）内部已有 `tail` 串行队列 + `writeGeneration` + `pendingRevision` + `recover(generation)` 回读。返回值语义：`true` = 宿主接受或跳过，`false` = 宿主拒绝；**传输层失败是 reject，不是 false**。所以面板的 `run()` 必须同时处理返回值与异常：

```ts
try { setFeedback(await operation()); } catch (error) { setFeedback({ ok: false, message: '写操作抛错：' + String(error) }); }
```

### 9.7 构建期白名单与宿主 seed 表逐字相同，不扩不缩

`scripts/build-client.mjs` 的 `HOST_MODULES` 11 项与宿主页面 `staticModules` 内联表（`$H/dsh-web-frontend/dist/assets/index-*.js`）逐字一致。这意味着：

- 不能 `import` 任何宿主客户端服务包（`dsh-client-ui-settings` / `dsh-client-locale`）的**值**——它们不在 seed 表里，esbuild 会内联出一个带 `clsx` / `shiki` 依赖的副本，构建末尾的断言会拦下。
- `import type {}` 是安全的：擦除后不留 `require`。本轮的 `lib/client.js` 只有三个 require（primitives / react / react-jsx-runtime），证明类型面全擦干净了。

### 9.8 面板组件的可测形态

`node_modules` 里只有 `react`，没有 `react-dom`，面板无法真渲染。可行的测法是**测打好的产物**：给 `globalThis.window.__ModuleLoader__` 一个收集器，`import('../lib/client.js')` 后拿 `spec.factory(pageRequire)`，再断言 `apply` 的外部可见行为（注册了什么、hook 源是谁、写入映射到哪个字段）。`react` / `react/jsx-runtime` / primitives 三个用打桩替身——它们在宿主页面里本来就是 seed 模块，不是从包的 `node_modules` 解析的。

### 9.9 本仓落点

| 文件 | 职责 |
|---|---|
| `src/l0/diagnosis.ts` | 诊断链纯函数：输入 `describe` 的三段，输出三行状态 + `overriddenBy`；四处字面量与 `src/config/priority.ts` 靠哨兵测试钉住 |
| `src/client/index.ts` | 运行时 `ctx.inject(['configForms'], …)` + `slots.inject('settings.section', …)`；写操作经 `form.set/unset` |
| `src/client/panel.tsx` | 四档 `SegmentedControl` + 诊断链三行 + 一键清除用户层；零 hex 色值 |
| `test/client-diagnosis.test.mjs` | 14 条：三行恒在、五态、env 反推、归一化、非字符串、四字面量哨兵 |
| `test/client-wiring.test.mjs` | 9 条：产物外壳、降级、`slots.inject`、注册项形状、hooks 改名、写映射、拒绝、清除、接线抛错 |
| `test/commands.test.mjs` | 6 条：命令进表、只读、写入、报错不写、缺 settings 仍可读、卸载不留幽灵 |

