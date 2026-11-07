# DSH 0.2.2-rc.1 客户端 UI 稳定面调查：configForms / slots / commandUi 的存在性与可降级边界

> **本文与本目录其它材料的关系**
> - `upstream-ponytail-source-audit.md`：上游 `@wenaixi/dsh-ponytail@5.6.2` 的机制层源码审计，回答「代码本身哪里假、哪里真」。
> - `dsh-plugin-contract-0.2.2.md`：宿主 API 逐项兼容性判定（提示词、settings、Typert、skills、bundle），回答「原插件能不能在 0.2.2 上跑」。
> - `ponytail-plugin-landscape.md`：13 个 npm 派生包 / 14 个 GitHub 仓的生态位对比。
> - **本文**：只回答一个问题——0.2.2 的**客户端（浏览器侧）**UI 契约还在不在、叫什么名字、缺了以后靠什么降级。不评估上游代码质量，也不做安装可行性判定。

> 对象：本机 `/Applications/DeepSeek Harness.app/Contents/Resources/app/dsh/node_modules/@deepseek-ai/`（下文简写为 `$A/`，332 个包，版本统一 `0.2.2-rc.1`，`compose()` 返回的 release 为 `{version:"0.2.2-rc.1", commit:"c59d10a"}`，见 `$A/dsh-client-modules/lib/index.js:730` 区）。
> 方法：只读安装目录的 `lib/*.js` 原文（客户端包已构建、无 ts 源），逐条 grep 定义点而非消费点；slot 目录取自 runner 内嵌常量 `CLIENT_SLOT_API`；打包产物 `dsh-web-frontend/dist` 仅在必须时读取（seed 模块表、SlotCore 校验文案）。
> **本机补丁免责**：该安装目录被第三方打过 60 个 `*.dshpurge.bak` 补丁（39 个真有字节差异）。本文引用的 10 个关键客户端包——`dsh-client-ui-settings`、`dsh-client-locale`、`dsh-client-ui-commands`、`dsh-client-modules`、`dsh-client-ui-renderer`、`dsh-cordis-client-runner`、`dsh-web-frontend`、`dsh-commands`、`dsh-api-remote-access`、`dsh-agent-preset-registry`——**全部零补丁**（脚本 V3 输出 bak=0），故本文所有行号即官方行号。两处例外（`dsh-client-ui-conversation` +57 行、`dsh-settings` +4 行）在引用时单独标注，见附录 B。
> 未在浏览器中实际运行验证（仅静态读源码），未核实项集中在附录 A，请勿把「源码如此」读作「运行时已验证」。

## 摘要

六个问题全部有明确答案，且没有一个需要跨版本兜底：`configForms` 与 `commandUi` 都**实测存在且未改名**，`slots` 的 109 条 slot 目录可从源码完整导出，`window.__ModuleLoader__.load({id, factory})` 仍是唯一注册形态，`locale.bind(ns)` 签名不变、key 缺失时返回**原 key 字符串**而非空串。真正需要重构的不是 API 调用，而是**降级语义**：官方把「能力缺失」分成三种互不相同的表现——`slots.inject` 静默等待声明（不出现、不报错）、裸 `slots.register` 对未声明 slot **直接抛错**、`configForms` 快照进入 `unavailable` 态而非抛异常；外加 `remoteAccess.whenAccess` 的权限门禁（权限不足时整块 UI 静默消失、权限恢复后自动重装）。因此「UI 在不在」不该由插件 try/catch 探测，而应由**选对注册通道**决定。

一句话结论：**契约稳定，语义分层；上游 `whileServed + slots.inject` 的写法与 0.2.2 完全对得上，需要重写的是它自造的档位切换通道（应换成官方 `/permission` 或 `remote.settings.mutate`），而不是客户端 UI 接线。**

---

## 一、结论速查表

下表每行的判定只有三种取值：**实测存在** / **不存在** / **改了名字**。所有行号均在 `$A/` 下。

| # | 问题 | 判定 | 注册名 / 签名 | 证据锚点 |
|---|---|---|---|---|
| 1 | `configForms` 服务 | **实测存在**（浏览器侧） | `super(ctx, "configForms")`；方法 `describe()` / `get(entryId)` / `whileServed(ns[], register)` / `developerTools` | `$A/dsh-client-ui-settings/lib/client.js:1252`（类）、`:1270`（注册名）、`:1287`、`:1294`、`:1315`、`:1274` |
| 1b | 宿主侧 `ctx.configForms` | **不存在** | 宿主服务名是 `settings` | `$A/dsh-settings/lib/index.js:330`；与 `dsh-plugin-contract-0.2.2.md:36` 的判定一致 |
| 2 | `slots` 服务与 slot 名 | **实测存在**，目录 109 条 | `super(ctx, "slots")`；`inject` / `register` / `registerFactory` / `renderSlot` / `spec` / `subscribe` … | `$A/dsh-client-ui-renderer/lib/client.js:1305`（类）、`:1348`（注册名）、`:1368`（inject）、`:1531`（renderSlot）；目录 `$A/dsh-cordis-client-runner/lib/client.js:2606`–`:7559`（`CLIENT_SLOT_API`），索引 `:7705` |
| 3 | `commandUi.decorate` | **实测存在，未改名** | `super(ctx, "commandUi")`；`register` / `decorate` / `dismiss` / `popupFor` / `execute` | `$A/dsh-client-ui-commands/lib/client.js:1336`、`:1356`、`:1396`、`:1421`、`:1439`、`:1451`、`:1668` |
| 3b | `remote.commands.execute` | **实测存在** | `execute(agentId, line, attachments)` → `{commandId, result}` | 客户端调用 `$A/dsh-client-ui-commands/lib/client.js:1669`；typert 描述 `$A/dsh-commands/lib/typert.remote-client.js`（`commands/execute`）；宿主实现 `$A/dsh-commands/lib/index.js:327` |
| 4 | `window.__ModuleLoader__.load({id, factory})` | **实测存在，仍是唯一注册形态**（facade 另含 `create`） | 引导期 `{mode:"queue", pendingQueue, load, create}` | 引导脚本 `$A/dsh-client-modules/lib/index.js:521-547`；85 个 `lib/client.js` 首行统一为该形态（脚本 V5/§8.3） |
| 4b | `dsh.client.inject` 缺一项 | **不报错，降级** | 见 §5.3 | `$A/dsh-client-modules/lib/client.js:791`（`graphRows` 取不到即跳过）、`:547-564`（未激活记 `is waiting for activation`） |
| 5 | `locale.bind` | **实测存在，签名不变** | `bind(ns: string): Translate`；key 缺失返回**原 key** | 声明 `$A/dsh-cordis-client-runner/lib/client.js:1405`、`:1411`；实现 `$A/dsh-client-locale/lib/client.js:1702`、`:1711` |
| 5b | `locale` 的服务形态 | **改了名字（更准确说：换了提供方式）** | 不是 `Service` 子类，是 `ctx.provide("locale", locale)` | `$A/dsh-client-locale/lib/client.js:1475`（普通类）、`:1838`（provide） |
| 6 | 可降级矩阵 | 见 §7 | — | 逐格给替代通道与锚点 |

**两个容易误判的点，先点明**：

1. `configForms` 在 `$A/dsh-cordis-client-runner/lib/client.js` 里 grep 只剩一处命中（`:5424`，且位于 `plugins.bundle.config` 的 slot 文档正文里，原文提到 *every registrant already depends on it for* `ctx.configForms`），**不是服务声明**。runner 的 `SERVICE_API` 只声明 8 个客户端服务：`layout:1283`、`locale:1326`、`sessions:1422`、`slots:1518`、`theme:1555`、`timer:1608`、`uiWorkspace:1645`、`workspaces:1771`。`configForms` 与 `commandUi` 都是**包内自注册服务**，不在 runner 目录里——所以「在 runner 里 grep 不到」不等于「不存在」。
2. `slots.inject` 与 `slots.register` **不是同一层语义**：前者是「等声明」（缺失即静默），后者对未声明 slot **抛错**。把降级写在 `register` 里会炸，写在 `inject` 里才对。证据见 §3.2。

---

## 二、configForms 服务解剖

### 2.1 定位：两半同包，浏览器侧才有 `configForms`

`configForms` **没有独立包**。它的浏览器半与宿主半都长在 `dsh-client-ui-settings` 里，但两侧注册名不同：

| 侧 | 包 / 文件 | 注册名 | 证据 |
|---|---|---|---|
| 浏览器 | `$A/dsh-client-ui-settings/lib/client.js` | `configForms` | `:1252` `var ConfigForms = class extends _deepseek_ai_cordis.Service`；`:1270` `super(ctx, "configForms")` |
| 宿主 | `$A/dsh-settings/lib/index.js` | `settings` | `:330` `super(ownerContext, "settings")` |

上游 ADR 与 `build-client.mjs` 里写的 `ctx.configForms.get('ponytail')` 用法**完全成立**，因为那是浏览器侧代码（`/tmp/dsh-ponytail-upstream/lib/client.js:529`）。若把同一句写进 `lib/index.js`（宿主半）则必错——宿主没有该服务。这是 `dsh-plugin-contract-0.2.2.md:36` 已经记录过的坑，本文复核后维持原判。

### 2.2 类结构与方法表

`ConfigForms` 的字段与 `owner` 的用途，源码注释写得比文档清楚（`:1259-1262`）：

> The PROVIDING fiber, kept because a Service reads `ctx` as its *consumer's* fiber: letting a shared form write through the caller's context would make every caller declare `remote.settings` in its own `inject`.

也就是说：**共享 form 的写操作走 provider 的 fiber，而不是调用者的 fiber**。这条注释是理解 `configForms` 为什么存在（而不是让每个插件自己 `remote.settings.mutate`）的关键——客户端 bundle 的 purity gate 禁止跨插件值导入（`:1244-1250` 的注释原文指向 `packages/client/tsdown.client.ts`），跨插件协作只能走 cordis 服务。

| 成员 | 语义 | 行号 |
|---|---|---|
| `forms: Map` | entryId → `ConfigFormController`，惰性创建并缓存 | `:1253`、`:1294-1301` |
| `developerTools` | 本 settings provider 自有的开发视图开关，构造时立刻 `this.get("ui-settings")` | `:1255`、`:1274` |
| `mirror` | 共享的 settings describe 镜像（唯一 reader） | `:1256` |
| `schema` | settings 拥有的 schema 操作 | `:1257` |
| `owner` | providing fiber（见上方注释） | `:1263` |
| `describe()` | 返回共享 mirror 的读/折叠面 | `:1287-1290` |
| `get(entryId)` | 取或建该 entry 的 form；建后 `mirror.ensure()` | `:1294-1301` |
| `whileServed(namespaces, register)` | 仅当宿主真的服务了某个 ns 才执行 `register`；`register` 返回 disposer，ns 全部消失时自动卸 | `:1315-1334` |
| 析构 | `ctx.effect` 里 `Promise.all(forms.map(dispose))` 后清表 | `:1275-1278` |

`whileServed` 的实现核心（`:1315-1326` 原文）：

```js
whileServed(namespaces, register) {
  let off;
  const sync = () => {
    const served = new Set(this.mirror.getSnapshot().view?.namespaces.map((view) => view.ns) ?? []);
    const watched = namespaces.some((namespace) => served.has(namespace));
    if (watched && off === void 0) off = register(served);
    else if (!watched && off !== void 0) { off(); off = void 0; }
  };
  const unsubscribe = this.mirror.subscribe(sync);
  this.mirror.ensure();
  sync();
  return () => { unsubscribe(); off?.(); off = void 0; };
}
```

JSDoc（`:1302-1314`）把它要解决的问题写死了：**A plugin whose page edits a namespace another plugin owns registers the page through this, so a deployment that never composed the owner shows no trace of the page.** 这正是上游 `lib/client.js:564-572` 用的那个 API，语义对得上，未改名。

### 2.3 `ConfigFormController`：三态快照与写入队列

`get()` 返回的不是裸值，而是 `ConfigFormController`（`:1080`，普通类，**不是** `Service`）。它自己持有一个 `createSnapshotStore`（`:1108-1115`）：

```js
{ status: "loading", value: void 0, base: void 0, user: void 0, revision: void 0, writable: false }
```

| 方法 | 语义 | 行号 |
|---|---|---|
| `getSnapshot()` | 返回上面那个 store 的快照 | `:1122` |
| `subscribe(listener)` | 订阅快照变化 | `:1130` |
| `set(field, value)` / `unset(field)` | 单字段写（内部组 ops 后走 `mutate`） | `:1140` / `:1153` |
| `mutate(ops, expectedRevision)` | 批量写 + revision 乐观锁；失败时 `recover()` 并返回 `false` | `:1165-1181` |
| `recover(generation)` | 冲突/失败后重新拉取并重放待写 | `:1184` |
| `dispose()` | 释放订阅 | `:1194` |
| `enqueue(task)` | 串行化写入队列（同一 form 的写不并发） | `:1200` |
| `derive()` | 从 mirror 快照重新计算三态 | `:1209-1231` |
| `decode(view)` | 按 spec 解码；非法形状返回 `undefined` | `:1233` |

`mutate` 原文（`:1165-1181`，逐字）：

```js
mutate(ops, expectedRevision) {
  const ownedOps = structuredClone(ops);
  const generation = ++this.writeGeneration;
  return this.enqueue(async () => {
    const revision = expectedRevision ?? this.pendingRevision ?? this.getSnapshot().revision;
    const response = await this.ctx.remote.settings.mutate(this.spec.namespace, ownedOps, revision);
    if (!response.ok) { await this.recover(generation); return false; }
    if (this.disposed) return true;
    if (generation === this.writeGeneration) { this.pendingRevision = void 0; this.mirror.acceptView(response.value); }
    else this.pendingRevision = response.value.revision;
    return true;
  });
}
```

注意三点，都对上游重构有直接影响：

1. `ops` 先 **`structuredClone`**——调用方传进去的对象不会被写入流程改写，但也不能靠「传引用后观察变化」来做进度。
2. `expectedRevision` 可省；省了就用 `pendingRevision ?? getSnapshot().revision`。**上游 `ponytail-settings.ts` 读 `response.value?.revision` 的老写法在客户端侧不适用**：这里读的是 `response.value`（整个 namespaceView），并且走的是 `mirror.acceptView`，不是自己拼 revision。
3. 失败路径**不抛**：`recover()` 后返回 `false`。所以 `if (!await form.mutate(...))` 才是正确判定；用 try/catch 捕不到冲突。

### 2.4 三态：`loading` / `unavailable` / `ready` —— 官方的「能力缺失」信号

`derive()`（`:1209-1231`）逐字给出三态迁移，且**没有任何一条路径抛异常**：

| 条件 | 结果 | 行号 |
|---|---|---|
| `mirrored.view === void 0`（mirror 还没拿到 describe） | 直接 `return`，维持 `loading` | `:1212` |
| `view === void 0`（宿主不服务该 ns） | `draft.status = "unavailable"`；`draft.writable = writable`；返回 | `:1215-1220` |
| 有 view 但 `decode()` 返回 `undefined` | 只更新 `revision/base/user/writable`，**status 保持原值**（不会假报 ready） | `:1223-1228` |
| 解码成功 | `draft.status = "ready"`；`draft.value = decoded` | `:1229-1230` |

结论：**「宿主没装这个插件」在 0.2.2 里是一个正常的快照状态（`unavailable`），不是异常。** 消费方的正确写法是读 `status` 决定渲染，而不是 try/catch 或 `if (form === undefined)`（`get()` 永远返回 controller，不会返回 undefined）。

### 2.5 `developerTools`：唯一一个跨插件共享的偏好开关

| 项 | 值 | 行号 |
|---|---|---|
| namespace | `ui-settings` | `:1067` |
| 字段 | `enabled: Schema.boolean().default(true)` | `:1069` |
| 读 | `getSnapshot: () => scope.getSnapshot().value?.enabled ?? false` | `:1042` |
| 订阅 | 仅在值真变化时通知 | `:1043-1051` |
| 写 | `setEnabled()` → `scope.set("enabled", enabled)`；失败抛 `Developer tools preference was not saved` | `:1059-1061` |
| 宿主 schema | `const Config = z.object({ enabled: DeveloperToolsSettingsFields["enabled"].volatile() })` | `$A/dsh-client-ui-settings/lib/index.js:10` |

两处值得记的细节：

- **默认值不对称**：schema 的 `default(true)` 与读取端的 `?? false` 方向相反。后果是「字段从未写过」时读到 `false`（开发视图关），只有显式 `true` 才开。这不是 bug，但重构时若照抄 schema 默认值会得到相反行为。
- 宿主半 `$A/dsh-client-ui-settings/lib/index.js:6` 有一句 `z.object(DeveloperToolsSettingsFields);`，**构造后未赋给任何变量**——死代码，别当成第二个 schema 出口。

消费面（谁受这个开关影响）：

| 消费点 | 行为 | 证据 |
|---|---|---|
| 会话视图过滤 | 关闭时跳过 `entry.options.id === "trajectory"` | `$A/dsh-client-ui-conversation/lib/client.js:22678`（**+57 补丁偏移**，官方原字节在 22621） |
| 轨迹视图刷新 | 订阅 `developerTools.enabled` 后刷新视图列表 | 同上 `:22721`（官方 22664） |
| 预设过滤 | 关闭时过滤 `requiresCodingTools` 的预设并强制回落 | `$A/dsh-client-ui-agent-preset/lib/client.js:1867`、`:1885`、`:2275`、`:2323`、`:2910-2912`、`:2990`、`:3070` |
| UI 开关本体 | 设置页「显示代码工作视图」 | `$A/dsh-client-ui-settings-general/lib/client.js:703-716`，文案 `:999-1001` |

### 2.6 configForms 的消费规模（判断「能不能摘掉」）

`grep -rln "configForms" $A/dsh-client-*/lib/client.js` = **18** 个文件；其中直接调用 `get` / `whileServed` / `describe` 的 14 个：`dsh-client-locale`、`dsh-client-ui-agent-preset`、`dsh-client-ui-chat`、`dsh-client-ui-conversation`、`dsh-client-ui-permission-presets`、`dsh-client-ui-plugin-manager`、`dsh-client-ui-settings-account`、`dsh-client-ui-settings-agent-loop`、`dsh-client-ui-settings-general`、`dsh-client-ui-settings-models`、`dsh-client-ui-settings-session-log`、`dsh-client-ui-settings-shell`、`dsh-client-ui-settings-subagent`、`dsh-client-ui-settings-web-search`；`dsh-client-locale` 属硬依赖（`inject = ["slots","remote","configForms"]`，`:1779` 区）。

再叠加 `dsh.client.inject` 的声明面：**20 个包**在 `dsh.client` 里直接 `inject` 或 `external` 了 `@deepseek-ai/dsh-client-ui-settings`（清单见 §5.4）。**`configForms` 不是单点可摘的能力，摘掉 `ui-settings` 会连带 20 个包的加载图。**

---

## 三、slots 与 109 条 slot 目录

### 3.1 服务定位与方法表

| 项 | 值 | 证据 |
|---|---|---|
| 类 | `var SlotRegistry = class extends _deepseek_ai_cordis.Service` | `$A/dsh-client-ui-renderer/lib/client.js:1305` |
| 注册名 | `super(ctx, "slots")` | 同上 `:1348` |
| 内核 | `this._core = new _deepseek_ai_dsh_client_ui_slots.SlotCore()` | 同上 `:1306` |
| 变更事件 | `onMutate` → `ctx.emit("slots/changed", key)` | 同上 `:1349-1351` |
| 目录声明 | runner 的 `SERVICE_API` 里 `key: "slots"` | `$A/dsh-cordis-client-runner/lib/client.js:1518` |

服务方法（`$A/dsh-client-ui-renderer/lib/client.js`）：

| 方法 | 语义 | 行号 |
|---|---|---|
| `inject(key, callback)` | **等声明**：已声明则同步执行；未声明则挂起，声明提交后再执行 | `:1368-1432` |
| `install(renderer)` | 装 shell 的渲染器，boot-once，二次调用抛 `slot renderer already installed (install() is boot-once)` | `:1434-1448` |
| `installLocale(...)` | 注入 locale 绑定 | `:1450` |
| `provideRoot(...)` / `installScope(...)` | 根节点 / 会话 scope 装配 | `:1465` / `:1491` |
| `bindStoreScope(...)` | 把 store 绑到 scope | `:1512` |
| `renderSlot(key, owner)` | 取 owner 的渲染面 | `:1531` |
| `entries(owner)` / `entriesOfSlot(key, owner)` | 列条目 | `:1542` / `:1554` |
| `snapshot()` / `subscribe(fn)` / `getVersion()` | 快照与订阅 | `:1562` / `:1591` / `:1599` |
| `spec(key)` | 取某 slot 的声明 | `:1582` |
| `onEntryError(...)` | **渲染期**错误通道 | `:1574` |
| `_register(options, component)` | 直接透传 `this._core.register(erased, component)`，**无 try/catch** | `:1603-1623` |
| `_registerFactory(...)` | 同上，工厂形态 | `:1624` |

### 3.2 `inject` 与 `register` 的失败语义是相反的（本文最关键的发现）

**`slots.register` 对未声明的 slot 直接抛错。** 校验发生在 dist 内联的 `SlotCore.register`（`$A/dsh-web-frontend/dist/assets/index-BgUyXZcc.js` offset≈491369）：

```js
register(e, t) {
  const r = this.records.get(e.name);
  if (!r?.spec) throw new Error(`slot ${JSON.stringify(e.name)} is not declared (a parent entry's children table must declare it)`);
  ...
}
```

（原文是一段模板串，插值处即 `e.name`；此处为便于阅读写成 `JSON.stringify(e.name)`。）

而 renderer 的 `_register`（`:1603-1623`）是**裸透传**，不捕获：

```js
_register(options, component) {
  ...
  return this._core.register(erased, component);
}
```

**`slots.inject` 对未声明的 slot 静默等待，不抛、不执行 callback。** 实现（`:1368-1432`）的关键行：

```js
const spec = this._core.specDynamic(key);
const epoch = this._core.declarationEpoch(key);
if (active !== void 0 && activeEpoch === epoch) return;
...
if (spec === void 0) return;            // ← 未声明：直接 return，callback 不执行
```

并且订阅了 `subscribeDeclaration(key, changed)`（`:1421`），声明提交后 `epoch` 变化会再次 `reconcile()` 把 callback 装上。异常处理也分了两路（`:1404-1416`）：`error?.code === "INACTIVE_EFFECT"` → `stop()` 静默结束；其他错误 → `stop()` 后 `queueMicrotask(() => { throw failure })`。

四种「能力缺失」通道的对照：

| 通道 | slot / 服务未就绪时 | 就绪后 | 适合场景 |
|---|---|---|---|
| `slots.register(...)` | **抛错**（`is not declared`） | 正常注册 | 宿主 slot 一定在（同包声明，或已用 `inject` 包住） |
| `slots.inject(key, cb)` | **静默，什么都不发生** | 自动补执行 `cb` | 跨插件挂载点、可降级 UI |
| `configForms.whileServed(ns, register)` | **静默**（ns 不在 describe 镜像里） | 自动补注册 | 依赖宿主服务某 settings namespace 的页面 |
| `remoteAccess.whenAccess(action, cb)` | **静默**（权限不足），权限恢复后自动重装 | — | 受权限门禁的 UI 块 |

**结论：0.2.2 把「UI 能力缺失」设计成分层的正常态，而不是异常。** 上游 `$A/lib/client.js:564-572` 的 `whileServed → slots.inject → slots.register` 三层嵌套正好压在正确的通道上。任何把 `slots.register` 提到 `inject` 外面的重构，都会在「宿主未挂该 slot」时抛错。

`whenAllowed` 的实现（`$A/dsh-api-remote-access/lib/client.js:648-702`）证实了最后一行的幂等性：

```js
const allowed = answer.getSnapshot();
if (allowed === (installed !== void 0)) return;      // 状态未变，什么都不做
if (!allowed) { uninstall(); return; }
const disposeEffect = ctx.effect(callback, ${{label}: allowed${);   // 权限恢复 → 重装
```

入口 `:724` `whenAccess(action, callback) { return whenAllowed(this.ctx, this.state.global(action), callback, ...) }`。实测存在 5 个 access 键：`account/watch`、`directoryPicker/pick`、`pluginManager/listBundles`、`schedule/catalog`、`settings/describe`。

补两条同类校验文案（同一 dist 的 `registerFactory`，offset≈489635），可作运行时排障索引：

| 情形 | 文案 |
|---|---|
| 子 slot 已被声明 | `slot "<child>" is already declared (by <declaredBy 或 an unknown entry>)` |
| single 槽已有注册 | `single slot "<name>" already has a registration ...` |
| keyed 槽缺 key | `keyed slot "<name>" requires options.key` |
| priority 冲突 | `at priority <n> (registered by <registrant>) — register at a different priority to shadow it (lowest renders)` |

### 3.3 目录从哪来：`CLIENT_SLOT_API` 与 `SLOT_CATALOG`

slot 名的权威清单**不在某个包的源码里，而在 runner 内嵌的一个常量数组**：

| 项 | 位置 | 规模 |
|---|---|---|
| `const CLIENT_SLOT_API = [` | `$A/dsh-cordis-client-runner/lib/client.js:2606` | 起于 2606、止于 `:7559`（`];`），共 **109** 条 |
| `const SLOT_CATALOG = new Map(CLIENT_SLOT_API.map((entry) => [entry.key, entry]))` | 同上 `:7705` | 索引表 |

每条 entry 的字段（以 `plugins.bundle.config` 为例，全部实测存在）：`key` / `kind` / `scope` / `summary` / `doc` / `registerOptions`（`{name, requirement, type, doc}` 数组）/ `ownerProps` / `standardProps` / `keyDomain` / `declaredBy` / `occupants` / `replaceRisk` / `example` / `source`。

其中 `source` 直接指回上游 ts 源（例：`packages/client/ui-plugin-manager/src/client/slot-contract.ts:142`），`example` 是可直接抄的 `inject + register` 骨架——**「查 slot 怎么用」不需要读实现包**。

统计（脚本 §8.2 输出）：

| 维度 | 分布 |
|---|---|
| `kind` | `single` 43、`list` 42、`keyed` 20、`chain` 4 |
| `scope` | `root` 53、`session` 51、`session-maybe` 5 |

### 3.4 109 条 slot 按宿主包分组

| 宿主包 | 条数 | slot key |
|---|---|---|
| `dsh-client-ui-conversation` | 28 | `conversation.composer`、`conversation.composer.bar`、`conversation.composer.dock`、`conversation.header`、`conversation.header.leading`、`conversation.hero.agentPreset`、`conversation.hero.brand.mark`、`conversation.hero.options`、`conversation.hero.workspace`、`conversation.input.activity`、`conversation.input.attachments`、`conversation.input.dock`、`conversation.input.left`、`conversation.input.model`、`conversation.input.overlay`、`conversation.input.permission`、`conversation.input.plan`、`conversation.input.right`、`conversation.session`、`conversation.session.header`、`conversation.session.header.actions`、`conversation.session.header.corner`、`conversation.session.header.lineage`、`conversation.session.header.utilities`、`conversation.session.header.views.actions`、`conversation.user.text.node`、`conversation.view`、`main.conversation` |
| `dsh-client-ui-chat` | 11 | `conversation.chat.assistant-actions`、`conversation.chat.commandview`、`conversation.chat.flow`、`conversation.chat.message.images`、`conversation.chat.node`、`conversation.chat.reasoning.body`、`conversation.chat.text-interaction`、`conversation.chat.turnTail`、`conversation.chat.user.before`、`conversation.chat.user.images`、`shell.quota-notice` |
| `dsh-client-ui-plugin-manager` | 9 | `plugins.add.actions`、`plugins.bundle.activation`、`plugins.bundle.config`、`plugins.detail.actions`、`plugins.detail.badge`、`plugins.detail.section`、`plugins.item`、`plugins.row.config`、`plugins.tab` |
| `dsh-client-ui-settings-general` | 9 | `settings.action`、`settings.close`、`settings.general.item`、`settings.header`、`settings.launcher`、`settings.onboarding`、`settings.section`、`settings.section.icon`、`settings.trigger` |
| `dsh-client-ui-workspace` | 8 | `conversation.hero.workspace.directoryFlow`、`sidebar.session.row.hover`、`sidebar.session.row.leading`、`sidebar.session.row.trailing`、`sidebar.workspaces.directoryFlow`、`sidebar.workspaces.session.menu.item`、`sidebar.workspaces.session.row.action`、`workspace.toast` |
| `dsh-client-ui-sidebar` | 8 | `sidebar.brand.mark`、`sidebar.brand.name`、`sidebar.footer.action`、`sidebar.panellist`、`sidebar.panellist.actions`、`sidebar.settings`、`sidebar.toggle.badge`、`sidebar.workspaces` |
| `dsh-client-ui-sidebar-right` | 7 | `rightbar.session`、`sidebar.right.pane.tab`、`sidebar.right.pane.tab.title`、`sidebar.right.tab.guide`、`sidebar.right.tab.guide.actions`、`sidebar.right.tab.guide.entry`、`sidebar.right.tab.menu.item` |
| `dsh-client-ui-layout` | 6 | `main`、`rightbar`、`shell.bottom`、`shell.leading`、`shell.overlay`、`sidebar` |
| `dsh-client-ui-sidebar-documentpreview` | 5 | `sidebar.right.tab.document`、`sidebar.right.tab.document.action`、`sidebar.right.tab.document.actions`、`sidebar.right.tab.document.office.pdf`、`sidebar.right.tab.document.unpreviewable` |
| `dsh-client-ui-settings-models` | 3 | `settings.models.footer`、`settings.models.provider-card`、`settings.models.sign-in` |
| `dsh-client-ui-context-menu` | 2 | `contextMenu.content`、`contextMenu.icon` |
| `dsh-client-ui-deliverables` | 2 | `deliverables.file.actions`、`deliverables.review.file.actions` |
| `dsh-client-ui-tool` | 2 | `tool.call.images`、`tool.call.toolview` |
| `dsh-client-ui-approval` | 1 | `conversation.approval.detail` |
| `dsh-client-ui-model-selection` | 1 | `conversation.input.model.label` |
| `dsh-client-ui-user-questions` | 1 | `conversation.plan-review.actions` |
| `dsh-client-ui-trajectory` | 1 | `conversation.trajectory.images` |
| `dsh-client-ui-settings-plugins` | 1 | `settings.plugins.tab` |
| `dsh-client-ui-subagent` | 1 | `sidebar.chat.conversation` |
| `dsh-client-ui-sidebar-files` | 1 | `sidebar.right.tab.files.actions` |
| `dsh-client-ui-cordis` | 1 | `tool.view.cordis` |
| （runtime 内建） | 1 | `root` —— `declaredBy` 原文 "the runtime itself (built in; always present)" |

**合计 109。**

### 3.5 本票相关 slot 的精确元数据

字段取自 `CLIENT_SLOT_API` 条目原文：

| key | kind | scope | declaredBy | entry.source |
|---|---|---|---|---|
| `root` | single | root | the runtime itself（built in） | `$A/packages/client/ui-renderer/src/client/registry.ts:44` |
| `main` | keyed | root | an entry in `root`（client-ui-layout） | `$A/packages/client/ui-layout/src/client/index.ts:75` |
| `shell.overlay` | list | root | an entry in `root`（client-ui-layout） | `$A/ui-layout/src/client/index.ts:107` |
| `sidebar.settings` | single | root | an entry in `sidebar`（client-ui-sidebar） | `$A/packages/client/ui-sidebar/src/client/contract/slots.ts:51` |
| `settings.section` | list | root | an entry in `sidebar.settings`（client-ui-settings-general） | `$A/packages/client/ui-settings/src/client/contract/slots.ts:57` |
| `settings.general.item` | list | root | an entry in `settings.section`（client-ui-settings-general） | 同上，`:100` |
| `settings.launcher` | single | root | an entry in `sidebar.settings`（client-ui-settings-general） | 同上，`:17` |
| `settings.trigger` | single | root | an entry in `sidebar.settings`（client-ui-settings-general） | 同上，`:27` |
| `settings.plugins.tab` | list | root | an entry in `settings.section`（client-ui-settings-plugins） | 同上，`:74` |
| `plugins.item` | list | root | an entry in `main`（client-ui-plugin-manager） | `$A/ui-plugin-manager/src/client/slot-contract.ts:136` |
| `plugins.bundle.config` | keyed | root | an entry in `main`（client-ui-plugin-manager） | 同上，`:142` |
| `conversation.hero.agentPreset` | single | session-maybe | factory `conversation.content`（client-ui-conversation） | `$A/ui-conversation/src/client/contract/slots.ts:289` |
| `conversation.composer` | chain | session | factory `conversation.content`（client-ui-conversation） | 同上，`:283` |
| `conversation.input.model` | single | session | an entry in `conversation.composer.bar` | 同上，`:353` |
| `conversation.input.permission` | single | session | an entry in `conversation.composer.bar` | 同上，`:346` |
| `conversation.view` | list | session | an entry in `conversation.session` | 同上，`:278` |
| `tool.call.toolview` | keyed | session | an entry in `conversation.chat.node`（client-ui-tool） | `$A/ui-tool/src/client/contract/slots.ts:23` |

`plugins.bundle.config` 的 `keyDomain` 原文值得单独记：**"open: any string the owner dispatches… already taken: @deepseek-ai/dsh-cua-bundle, @deepseek-ai/dsh-experimental-cot-translation-bundle, @deepseek-ai/dsh-experimental-voice-input-bundle"**——key 是插件包名，官方三个包已占位，第三方用自己包名不撞。

### 3.6 `declaredBy` 与 `occupants` 的读法

`declaredBy` 不是「slot 归谁」，而是**「由谁的哪一层 children 表声明」**，原文形如：

- `"an entry in 'shell.overlay' (client-ui-context-menu)…"`
- `"factory 'conversation.approval.card' (client-ui-approval)…"`

`occupants` 列出已被官方包占用的注册，`replaceRisk` 常见值 `"shadows-shipped-ui"` 表示该槽已被官方 UI 占用、再注册会**遮蔽**（不是叠加）。

对重构的直接含义：**想在设置页加一页，落点是 `settings.section`（list）或 `settings.general.item`（list）；`settings.launcher` / `settings.trigger` 是 single，注册会遮蔽官方启动器/触发器。** 上游用的是 `plugins.bundle.config`（按包名 keyed），那是**插件详情页里的配置卡片，不是设置页**——两者可见位置不同，重构时必须按目标位置选槽，不能照抄。

### 3.7 实测的调用面

`grep -rho "ctx\.slots\.[a-zA-Z]*"` 在全部 `$A/dsh-client-*/lib/client.js` 上的计数：

| 方法 | 调用点数量 |
|---|---|
| `register` | 373 |
| `inject` | 22 |
| `registerFactory` | 8 |
| `provideRoot` | 6 |

`register` 远多于 `inject`，说明绝大多数注册发生在「自己声明或已知存在」的槽上；22 处 `inject` 才是跨插件可降级挂载。这解释了为什么 `slots.inject` 的静默语义很少被踩坑——用到它的地方少，且都配了 `whileServed` / `whenAccess` 门禁。

---

## 四、commandUi 与命令通道

### 4.1 服务定位

| 项 | 值 | 证据 |
|---|---|---|
| 类 | `var CommandUiRuntime = class extends _deepseek_ai_cordis.Service` | `$A/dsh-client-ui-commands/lib/client.js:1336` |
| 注册名 | `super(ctx, "commandUi")` | 同上 `:1356` |
| 静态依赖 | `["inputTriggers","sessions","remote","remote.commands"]` | 同上 `:1337-1342` |
| 构造期硬依赖 | `const locale = ctx.get("locale"); if (locale === void 0) throw new Error("ui-commands: locale service unavailable")` | 同上 `:1357-1359` |
| 内部目录 | `CommandDirectory`（按 sessionId 懒加载 `remote.commands.list`） | 同上 `:1360-1367` |

`commandUi` **不在 runner 的 `SERVICE_API` 里**（`grep -c commandUi $A/dsh-cordis-client-runner/lib/client.js` = 0），与 `configForms` 同属包内自注册服务。所以「官方服务目录里查不到」只是说明它不参与 shell 的类型合并表，不代表不存在。

### 4.2 方法表

| 方法 | 签名 / 行为 | 行号 |
|---|---|---|
| `register(contribution)` | 注册客户端命令贡献；重名抛 `ui-commands: duplicate contribution for /<name>`；返回 disposer（`ctx.effect` label `"command.register()"`） | `:1402-1420` |
| `decorate(decoration)` | **仍在，未改名**。给宿主命令挂「裸调用装饰」；重名抛 `ui-commands: duplicate decoration for /<name>`；label `"command.decorate()"` | `:1421-1433` |
| `dismiss(name)` | 关闭该命令的所有弹层（草稿保留） | `:1439-1443` |
| `popupFor(actx)` | 取该会话的弹层控制器；无保留会话时抛 `command.popupFor requires a retained Session scope` | `:1451-1456` |
| `execute(session, line, attachments = [])` | 走 `remote.commands.execute`；`!result.ok` 抛 `command.execute failed: <code>: <message>`；`result.value === undefined` 返回 `{kind:"error", text:"unknown or malformed command: <line>"}` | `:1668-1681` |

`decorate` 的 JSDoc 原文（`:1415-1420`）：

> Hang a bare-invocation decoration on one host command; effect disposer (rides the caller's fiber). Duplicate names throw.

「bare-invocation decoration」的语义：**用户只输入 `/命令名` 而不带参数时，由装饰者提供弹层/选择器**，而不是让命令以空参数直接执行。dsh-permission-presets 的档位切换就靠这个把 `/permission` 变成可点选面板。

真实消费方（4 个包）：

| 消费点 | 用法 | 证据 |
|---|---|---|
| `dsh-client-ui-message-feedback` | `ctx.inject(["commandUi"], (scope) => scope.effect(() => scope.commandUi.decorate({ ... })))` | `$A/dsh-client-ui-message-feedback/lib/client.js:1010-1011` |
| `dsh-client-ui-permission-presets` | `ctx.get("commandUi")` 后 `decorate` | `$A/dsh-client-ui-permission-presets/lib/client.js:930`、`:968`、`:1034` |
| `dsh-client-ui-model-selection` | 同上 | `$A/dsh-client-ui-model-selection/lib/client.js:1999`、`:2025-2026` |
| `dsh-client-ui-conversation` | `this.rootCtx.get("commandUi")?.popupFor(actx)`（**可选链，缺服务即无声降级**） | `$A/dsh-client-ui-conversation/lib/client.js:16368`（**+57 偏移**，官方约 16311）、`:22817-22818` |

最后一行值得注意：官方自己消费 `commandUi` 时用 `?.popupFor`，即**服务缺席时不报错，只是没有弹层**。这与 §3.2 的三种降级语义同构。

### 4.3 「改了名字」的核查：`decorate` 没有替代者

为排除「改名成别的动词」的可能，在 `$A/dsh-client-ui-commands/lib/client.js` 全文检索贡献面动词：

| 检索 | 结果 |
|---|---|
| `decorate(` | 定义 1 处（`:1421`），同包内调用 0 处 |
| `register(` | 定义 1 处（`:1402`），同包内调用 0 处 |
| `decorations` | `live.decorations: new Map()`（`:1344`）与 `decorate` 内两处读写 |
| `contribute` / `extend` / `decorator` | 无命中 |

即：**`decorate` 既没有改名，也没有平行的第二套机制**；对外唯一形态是 `commandUi.decorate({name, ...})`。

### 4.4 `remote.commands.execute` 确实存在，且三层贯通

| 层 | 证据 |
|---|---|
| 客户端调用 | `$A/dsh-client-ui-commands/lib/client.js:1669` `const result = await this.ctx.remote.commands.execute(session.sessionId, line, attachments)` |
| 客户端列表 | 同上 `:1367` `const result = await ctx.remote.commands.list(sessionId)` |
| typert 描述 | `$A/dsh-commands/lib/typert.remote-client.js`：`commands/execute` 参数 `agentId`(string) / `line`(string) / `attachments`(array of `{type:"image"` \| `"file"}`)；结果 `undefined` 或 `{commandId, result:{kind:"success"` \| `"error"}}`。首行原文 `/* Generated by @deepseek-ai/dsh-typert-generator from the Host FaceModel - do not edit. */` |
| 宿主实现 | `$A/dsh-commands/lib/index.js:327` `async execute(agent, line, submittedAttachments, signal)`；`:328` `parseCommand`；`:329-330` 未知命令返回 `undefined`（**不抛**） |
| 服务注册 | 同上 `:259` `super(ctx, "commands")`；`:266` `register`；`:287` `list`；`:296` `find` |

一个细节：**客户端有两套入口**——`remote.commands.execute`（宿主服务名 `commands`，直连、轻）与 `commandUi.execute`（`:1668`，带 UI 语义包装：`notifyExecuted`、统一错误文案）。重构时按「要不要官方 UI 反馈」二选一。

### 4.5 客户端触发斜杠命令的完整路径

| 步 | 行为 | 证据 |
|---|---|---|
| 1 | 草稿以 `/` 开头 → 不进 `send`，进 `adjudicating` 阶段，派发 `{type:"adjudicate", attempt, draft}` | `$A/dsh-client-ui-conversation/lib/client.js:5438-5449`（**+57 偏移**，官方约 5381-5392） |
| 2 | 解析命令名：`submittedCommandName` 取首个空白前的段并去掉前导 `/` | `$A/dsh-client-ui-commands/lib/client.js:1330-1335` |
| 3 | 命中宿主命令 → `remote.commands.execute(sessionId, line, attachments)` | 同上 `:1669` |
| 4 | `ok === false` 抛错；`value === undefined` 视为未知命令并给用户文案 | 同上 `:1670`、`:1672` |
| 5 | 成功 → `notifyExecuted`；宿主侧写 `command/run` 生命周期日志 | 同上 `:1675`；`$A/dsh-commands/lib/index.js:346` |

### 4.6 0.2.2 内置的宿主命令（无 UI 也能用）

| 命令 | 注册点 | 说明 |
|---|---|---|
| `/compact` | `$A/dsh-command-compact/lib/index.js:93-95` | 压缩上下文 |
| `/feedback` | `$A/dsh-command-feedback/lib/index.js:165-167` | 反馈 |
| `/goal` | `$A/dsh-command-goal/lib/index.js:175-177` | 目标模式 |
| `/permission` | `$A/dsh-permission-presets/lib/index.js:213-215` | **档位切换**（sandbox 模式 + approval 策略） |
| `/plan` | `$A/dsh-plan-mode/lib/index.js:188-190` | 计划模式 |
| `/export` | `$A/dsh-session-log-export/lib/index.js:789-791` | 导出会话 ZIP；Web 版不接受路径参数 |

**没有** `/settings`、`/locale`、`/agent-preset` 命令（`grep -rn 'name: "settings"' $A/dsh-*/lib/index.js` 空输出）。这三项要改只能走 settings 服务或配置文件，见 §7。

`/permission` 的 handler 值得逐字看（`$A/dsh-permission-presets/lib/index.js:215-230`）：不带参数时返回 `current preset <name> (available: <列表>)`；带未知档位返回 `unknown preset "<name>" (available: ...)`；合法则 `apply`。**因此在完全没有 UI 的部署里，用户仍可问当前档位并切换**——这是 §7「档位切换」降级的正解。

### 4.7 绕过客户端：SDK / JSON-RPC 也能发斜杠命令

`$A/dsh-sdk-jsonrpc-server/lib/index.js:530-545`：`query(params)` 中若 `text.text.trim().startsWith("/")`，直接取 `ctx.get("commands")` → `queryCommand(...)` → `commands.execute(...)`；`:552` 命令不可用时抛 `The selected command is unavailable in this SDK profile`。

**结论：斜杠命令不是「客户端 UI 的功能」，而是宿主 `commands` 服务的功能**，客户端只是其中一个入口。这决定了 §7 中「设置面板缺失 → 用命令/配置替代」是官方支持的路径，不是 hack。

---

## 五、客户端包加载机制与 inject 缺失语义

### 5.1 88 个包声明 `dsh.client`，3 个入口不叫 `lib/client.js`

| 项 | 数量 / 结论 | 证据 |
|---|---|---|
| 目录内包总数 | 332（其中 `dsh-*` 前缀 320，其余 12 个是 `cordis` / `cordis-plugin-*` / `cosmokit` / `schemastery` / `libreoffice-kit*` / `node-addon-*`） | `ls -d $A/*/ \| wc -l` = 332；`ls -d $A/dsh-*/ \| wc -l` = 320 |
| 声明 `dsh.client` 的包 | **88**，`platform` 全为 `"web"`（`{"web":88}`） | 脚本 V8 |
| 文件名为 `lib/client.js` 的 | 85 | `ls $A/dsh-*/lib/client.js` 计数（脚本 V8） |
| 差 3 个 | `dsh-api-gateway`、`dsh-client-connection`、`dsh-typert-registry` —— 三者 `exports["./client"]` 指向 `./lib/client.browser.js`，且 `dsh.client.immediately = true` | 三个包的 `package.json` |

**因此「入口文件名是 `lib/client.js`」不成立，唯一契约是 `exports["./client"]`。** 85 个 `lib/client.js` 的首行形态**全部统一**为 `window.__ModuleLoader__.load({ ... })`（脚本逐文件 `head -c 200` 检查，非该形态的清单为空）。

### 5.2 宿主侧：能进来的、被静默忽略的、会抛错的

`$A/dsh-client-modules/lib/index.js` 的 `resolveMeta` 是唯一准入点，几条分支语义完全不同：

| 情形 | 行为 | 行号 |
|---|---|---|
| 包没声明 `dsh.client` | 返回 `null`，不参与 compose | `:791` `if (decl === void 0 \|\| decl.platform !== "web") return null;` |
| `platform ≠ "web"` | **静默忽略**（同一行） | `:791` |
| 声明了但 `exports["./client"]` 取不到 | **抛错** `client-modules: <pkg> declares dsh.client but exports no "./client" bundle` | `:792` |
| Loader 里 `disabled: true` | 完全不参与 compose（干净降级，浏览器连包都不下载） | `:911` `if (entry.fiber === void 0 \|\| entry.disabled) continue;` |
| 同包多源 | 硬错误 `package <pkg> resolves from multiple active Loader sources ...; remove one entry` | `:944-951` |
| 自己在 `external` 里点名自己 | 硬错误 `a row must not declare its own package in dsh.client.external` | `:493` |

`parseDshClient`（`:86-104`）的判定顺序：

```js
function parseDshClient(pkgName, value) {
  if (value === void 0) return void 0;
  if (typeof value !== "object" || value === null) throw new Error("client-modules: " + pkgName + " has a non-object dsh.client declaration");
  const decl = value;
  if (typeof decl.platform !== "string") throw new Error("client-modules: " + pkgName + " dsh.client.platform must be a string");
  const inject = optionalStringArray(pkgName, "dsh.client.inject", decl.inject);
  const external = optionalStringArray(pkgName, "dsh.client.external", decl.external);
  if (decl.immediately !== void 0 && typeof decl.immediately !== "boolean") throw new Error("client-modules: " + pkgName + " dsh.client.immediately must be a boolean");
  return { platform: decl.platform, ... };
}
```

（原文用模板串拼接包名，此处改写为等价的字符串相加，便于阅读。）

**关键：`inject` 缺失是合法的**（`optionalStringArray` 返回 `undefined`），只有**类型错**才抛。并且 `inject` 只在有值时进 graphRow（`:798` `...decl.inject !== void 0 ? { inject: decl.inject } : {}`；宿主侧同形 `:465`）。

构造期失败的聚合语义（`:615-619`）：`compose()` 后 `flush` 收集每个包的错误，`failures.length > 0` 时抛 `ClientPackageCompositionError`（`:173`，首行 `client-modules: N client package(s) failed to compose:`）。**这会让宿主侧该服务构造失败，而不是悄悄跳过。**

### 5.3 `inject` 指向的包不存在时会怎样：静默跳过 + 记 failures，页面不白屏

这是问题 4 的核心，答案是**降级，不报错**，证据链三段。

第一段：`inject` 只按 graphRows 存在与否决定是否先装依赖（`$A/dsh-client-modules/lib/client.js:791-794`）：

```js
for (const packageName of row.inject) {
  const dependency = this.graphRows.get(packageName);
  if (dependency !== void 0) await this.arriveDependency(row.id, dependency, [], visited);
}
```

`graphRows` 取不到就**什么都不做**——既不抛也不记错。真正的失败判定在 `reconcile` 第二遍（`:547-564`）：`entry.fiber?.state === ACTIVE` 则跳过；`entry.fiber === void 0` 记 `client-modules: <id> import failed (see console)`；`await entry.fiber.await()` 未激活则记 `client-modules: <id> is waiting for activation`；最后 `:565-569` `publish({ syncing: false, failures })`。第一遍的 `try/catch`（`:539-544`）也是**逐包隔离**，单包失败只进 `failures` 数组。

| 情形 | 运行时表现 | 证据 |
|---|---|---|
| `inject` 里的包不在 graph（未安装 / 非 web / disabled） | 该依赖被跳过；消费者自己照常加载 | `:791-794` |
| 消费者的 cordis `inject` 声明了某服务但提供者没加载 | 消费者停在未激活 → 记 `is waiting for activation` → **其余 UI 照常渲染** | `:547-564` |
| 单包 factory 抛错 | 记入 `failures`，继续装下一个包 | `:539-544` |
| 要求一个既非 seed、又非已物化、又无 factory 的模块 | `client-modules: require("<spec>") missed the module table ...` | `:825-843` |
| 动态 `import()` 解析不到 | `client-modules: cannot resolve "<specifier>" ... (the runtime mirror of the bundle purity gate)` | `:888-893` |
| 模块依赖成环 | `client-modules: module arrival cycle ... (the host must reject this graph before serving it)` | `:782` |

**结论：`dsh.client.inject` 缺一项不会让页面崩，只会让那个依赖不来；真正决定「我能不能活」的是消费者自己的 cordis `inject`——服务缺席 → 停在未激活 → UI 缺席，但别人的 UI 不受影响。** 这比 try/catch 更硬：**插件不会因为依赖缺席而白屏，只会自己消失。**

### 5.4 `inject` 的可解析性实测：6 个包指向不存在的目录

| 项 | 结果 |
|---|---|
| 声明 `dsh.client` 的包 | 88 |
| web shell 的 seed 模块表里 `@deepseek-ai` 条目 | **5 个**：`dsh-client-store`、`dsh-client-ui-slots`、`dsh-client-ui-primitives`、`dsh-client-ui-dockkit`（另有 `cordis`、`react` 系与 `zod`、`@tanstack/react-virtual`） |
| seed 表位置 | `$A/dsh-web-frontend/dist/assets/index-BgUyXZcc.js` 中唯一一处 `function YZ(){return{react:fk,"react/jsx-runtime":gk,...,"@deepseek-ai/dsh-client-ui-dockkit":WZ}}`（308 字符） |
| `inject` 指向 node_modules 里不存在目录的包 | **6 个**：`dsh-client-ui-jobs`、`dsh-client-ui-schedule`、`dsh-client-ui-subagent`、`dsh-experimental-client-ui-agent-team`、`dsh-experimental-client-ui-voice-input`、`dsh-experimental-liveshare` —— 它们的 `inject` 都含 `@deepseek-ai/dsh-client-ui-primitives`，而该包在 node_modules 里**没有目录**（只有 dist 内联实现） |
| 没有任何 `inject` 指向「存在但无 `dsh.client` 且不在 seed」的包 | 已用脚本穷举确认 |

这 6 个包的 `primitives` 依赖靠 **seed 表**满足（`require` 命中 `this.seed` 直接返回，`:825-843`），不在 boot graph 里也不报错。**这是「`inject` 不必都指真实包」的现成反例，也解释了为什么 `dsh-client-ui-primitives` 在 `node_modules` 里查不到却处处被 import。**

依赖面统计（判断「摘掉某个包会连带什么」）：

| 被依赖的包 | 依赖它的包数 | 清单 |
|---|---|---|
| `@deepseek-ai/dsh-client-ui-settings`（提供 `configForms`） | **20** | `dsh-client-locale`、`ui-agent-preset`、`ui-chat`、`ui-conversation`、`ui-deliverables`、`ui-permission-presets`、`ui-settings-account`、`ui-settings-agent-loop`、`ui-settings-general`、`ui-settings-models`、`ui-settings-plugin-inventory`、`ui-settings-plugins`、`ui-settings-session-log`、`ui-settings-shell`、`ui-settings-subagent`、`ui-settings-web-search`、`ui-shortcuts`、`ui-sidebar-documentpreview`、`ui-theme`、`dsh-experimental-client-ui-cot-translation` |
| `@deepseek-ai/dsh-client-locale` | **60** | 略（篇幅考虑不逐条列，脚本 §8.4 可复现） |
| `@deepseek-ai/dsh-client-ui-commands`（提供 `commandUi`） | **4** | `ui-message-feedback`、`ui-model-selection`、`ui-permission-presets`、`dsh-session-log-export` |
| `@deepseek-ai/dsh-api-remotes`（`remote` 的挂载面） | 含 `ui-settings` 自身（`dsh.client.inject = ["@deepseek-ai/dsh-api-remotes"]`） | —— |

`external` 非空的只有 6 个包，且全部指向 `"@deepseek-ai/dsh-api-gateway/client"`：`dsh-api-job-controller`、`dsh-api-remote-access`、`dsh-api-session-controller`、`dsh-api-terminal-controller`、`dsh-api-workspace-controller`、`dsh-experimental-client-ui-voice-input`。

### 5.5 `__ModuleLoader__` 的引导脚本原文

来源 `$A/dsh-client-modules/lib/index.js`：`:508` `CLIENT_MODULES_ID`、`:510` `PARSER_PRELOAD_IDS`、`:518` `bootInjections(graph)`、`:629` `table.push(...bootInjections(this.composed))`、`:549` `kind:"script-preload"`、`:553` `kind:"script-src"`、`:565` `kind:"global"` name `"__DSH_BOOT__"`。

`:521-547` 注入的队列脚本（逐字；模板串已改写为字符串拼接）：

```js
(() => {
  const pendingQueue = [];
  window.__ModuleLoader__ = {
    mode: "queue",
    pendingQueue,
    load(registration) { pendingQueue.push(registration); },
    create(options) {
      if (this.mode !== "queue") throw new Error("client-modules: window.__ModuleLoader__.create called after module-system boot");
      const index = pendingQueue.findIndex((registration) => registration.id === "@deepseek-ai/dsh-client-modules");
      const registration = pendingQueue[index];
      if (registration === undefined) throw new Error("client-modules: HTML did not preload @deepseek-ai/dsh-client-modules/client.js");
      pendingQueue.splice(index, 1);
      const exports = registration.factory((specifier) => {
        throw new Error("client-modules: @deepseek-ai/dsh-client-modules/client.js requested external " + specifier + " before the module system existed");
      });
      if (typeof exports !== "object" || exports === null || typeof exports.createClientModuleSystem !== "function" || typeof exports.apply !== "function") {
        throw new Error("client-modules: @deepseek-ai/dsh-client-modules/client.js did not export the bootstrap module face");
      }
      return exports.createClientModuleSystem(this, { id: registration.id, exports }, options);
    }
  };
})();
```

**结论：`load({id, factory})` 仍是唯一注册形态，但 facade 不是「单方法对象」**——引导期是 `{mode, pendingQueue, load, create}`，boot 后 `createClientModuleSystem`（`$A/dsh-client-modules/lib/client.js:988`）把 `mode` 换掉并接管后续 `load`。**任何「window.__ModuleLoader__ 只有一个 load 方法」的假设（上游 build-client.mjs 的注释如此）都只对注册侧成立，对探测侧不成立。**

配套链路：

| 环节 | 行为 | 证据 |
|---|---|---|
| 注入行顺序 | `[queue script(head)] → [application 组 script-preload] → [bootstrap 组 script-src(head)] → [__DSH_BOOT__ global]` | `$A/dsh-client-modules/lib/index.js:629` |
| 渲染 | `renderRow(row)` switch `kind`：`global` / `script` / `script-src` / `script-preload` / `style` / `html`；未知 kind `assertNever` 抛 `webserver: unknown index injection row <json>` | `$A/dsh-host-webserver/lib/index.js:32`、`:30` |
| ready 信号 | 末尾追加 `READY_MARKUP`：`(globalThis.__DSH_BOOT_READY__ ??= Promise.withResolvers()).resolve()` | 同上 `:72`、`:84` |
| boot 后重复注册 | 抛 `duplicate factory registration for "<name>" (bundle executed twice without invalidate?)` | `$A/dsh-client-modules/lib/client.js:710` |
| HMR invalidate 复用同一 sink | `this.env.modules.invalidate(moduleId)` 后 `sink.load({ id: moduleId, factory: () => surface })` | `$A/dsh-cordis-client-runner/lib/client.js:713-716` |
| sink 缺失 | 抛 `cordis-client-runner: window.__ModuleLoader__ is missing (booted outside the web shell?)` | 同上 `:715` |
| web shell 侧 | `const r = globalThis.__ModuleLoader__; if (r === void 0) throw new Error("web boot: window.__ModuleLoader__ bootstrap facade is missing"); ... this.modules = r.create({ boot: globalThis.__DSH_BOOT__, staticModules: YZ(), ... })` | `$A/dsh-web-frontend/dist/assets/index-BgUyXZcc.js` offset≈949401（`class oV.run`） |

---

## 六、locale 用法与 key 兜底

### 6.1 服务形态：不是 `Service` 子类，是 `ctx.provide`

| 项 | 值 | 证据 |
|---|---|---|
| 类 | `var LocaleRuntime = class {`（**普通类**，不是 `Service`） | `$A/dsh-client-locale/lib/client.js:1475` |
| 提供方式 | `ctx.provide("locale", locale)` | 同上 `:1838` |
| 实例化 | `const locale = new LocaleRuntime(ctx, ctx.configForms.get(LOCALE_SETTINGS_NAMESPACE), bootstrap)` | 同上 `:1805` |
| 插件级 inject | `["slots","remote","configForms"]`（**硬依赖 `configForms`**） | 同上 `:1779-1783` |
| runner 声明 | `key: "locale"`，summary `"Dictionary registry plus locale preference."` | `$A/dsh-cordis-client-runner/lib/client.js:1326` |

**所以「`locale` 是不是 `Service`」这个问题的答案是：不是。** 它是 `ctx.provide` 挂的普通对象（与 `theme` 同形，`$A/dsh-client-ui-theme/lib/client.js:2318`）。后果是：它**没有** `super(ctx, "locale")` 那种「服务名与 fiber 生命周期绑定」的自动语义，生命周期由插件 `apply` 自己管。

### 6.2 `bind` 的签名与稳定性

runner 的 `SERVICE_API` 里 `locale` 有两个 `bind` 重载声明：

| 声明 | signature | description 摘要 | 行号 |
|---|---|---|---|
| 类型化 | `bind<N extends Extract<keyof LocaleNamespaceMap, string>>(ns: N): TranslateNS<N>` | "Bind a declared namespace to a translate function typed to its dictionary key union (plus the shared common vocabulary)… The returned reference is stable per namespace (repeat binds return the same function)" | `:1405` |
| 非类型化 | `bind(ns: string): Translate` | "Untyped form for namespaces outside the merge table (dynamic composition, tests)." returns "the translate function." | `:1411` |

实现（`$A/dsh-client-locale/lib/client.js:1702` 区）：

```js
bind(ns) {
  let t = this.bound.get(ns);
  if (!t) {
    t = (key, params) => this.translate(ns, key, params);
    this.bound.set(ns, t);
    return t;
  }
  return t;
}
```

**同一个 `ns` 反复 `bind` 返回同一函数引用**——可以直接放进 `React.memo` 依赖数组，或用 `===` 判断稳定性。

### 6.3 key 找不到时返回什么：**原 key 字符串**（不是空串）

```js
// `$A/dsh-client-locale/lib/client.js:1711-1716`
translate(ns, key, params) {
  const chain = this.fallbackChain(this.snapshot.active);
  const template = this.lookup(ns, key, chain) ?? (ns !== "common" ? this.lookup("common", key, chain) : void 0) ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name) => name in params ? String(params[name]) : match);
}
```

三段兜底顺序，逐条可读：

| 顺序 | 查找 | 命中即返回 |
|---|---|---|
| 1 | `lookup(ns, key, chain)` —— 沿 fallback 链在自己的 ns 里找 | 该 locale 的字典值 |
| 2 | `ns !== "common"` 时 `lookup("common", key, chain)` | `common` 命名空间的同 key |
| 3 | 都没有 | **`key` 原字符串** |

配套细节：

| 项 | 行为 | 证据 |
|---|---|---|
| fallback 链 | 沿 catalog 的 fallback 走，末尾若无 `en` 则补 `en`；结果缓存进 `this.fallbackChains` | `:1657` |
| 参数插值 | `/{` 形式；**`params` 里没有的占位原样保留**（不替换成空串） | `:1715` |
| 注册重复 | 同一 `(ns, locale)` 二次注册抛 `locale namespace "<ns>" already has locale "<locale>"` | `:1675` |
| locale id 非法 | 不过 `LOCALE_ID_PATTERN` 抛 `locale id "<id>" is not a BCP 47-style tag` | `:1675` |
| 切换未注册 locale | 抛 `locale "<id>" is not registered` | `:1566` |
| 切换时持久化 | 即便目标 locale 已是当前值也会写一次：`this.host?.set(LOCALE_PREFERENCE_FIELD, match.id)`（`host` 即 `ConfigFormController`） | `:1566-1572`；runner 声明侧同义 `:1371` |

**「返回原 key」这条对降级很重要**：意味着**字典没跟上时 UI 不会显示空白，而是显示 key**（例如 `ponytail.mode.title`）。这既是可观测性（一眼看出缺翻译），也是缺陷面（用户看到 `xxx.yyy` 而不是提示）。上游 `$A/tmp/dsh-ponytail-upstream/lib/client.js:14-16` 的完整 `ZH`/`EN` 字典正是为了避免这个。

### 6.4 `register`：命名空间注册方式

| 形态 | 签名 | 说明 |
|---|---|---|
| 类型化 | `register<N extends Extract<keyof LocaleNamespaceMap, string>>(ns: N, dicts)` | 一次给多个 locale 的字典；description 记 "Duplicate (ns, locale) throws (single occupant)" |
| 非类型化 | `register(ns: string, locale: string, dict: LocaleDict)` | 单 locale 单次注册（动态组装、测试用） |

上游用法 `$A/tmp/dsh-ponytail-upstream/lib/client.js:523`：`return ctx.locale.register(NS, { zh: ZH, en: EN })` —— 走的是类型化多 locale 形态，**0.2.2 仍支持**。

`LOCALE_SETTINGS_NAMESPACE = "locale"`、`LOCALE_PREFERENCE_FIELD = "preference"`（`$A/dsh-client-locale/lib/index.js`，该文件全文 28 行），且 `Config = z.object({ preference: ... .volatile() })` —— **语言偏好只有一个 `volatile` 字段**，因此设置行必须由插件自己注册 slot（locale 自己就在 `settings.general.item` 注册了 `id: "language"` 的 `LanguageRow`，`:1865`）。

### 6.5 语言开关落在哪个 slot

```js
// `$A/dsh-client-locale/lib/client.js:1865`
ctx.slots.inject("settings.general.item", () => ctx.slots.register({
  name: "settings.general.item",
  id: "language",
  order: 0,
  store,
  locale: SETTINGS_NS,
  inject: injected
}, LanguageRow));
```

对照 `$A/dsh-client-ui-settings-general/lib/client.js:1356-1358`（id: "developer-tools"`）与 `:1372-1374`（id: "current-version"`）：**语言开关只是 `settings.general.item` 这一 list slot 里的第三个 item**，order 0 排最前。这决定了「语言切换缺失」的边界：只要 `settings.general.item` 这个 list 还在（它由 `settings.section` 声明），语言项就在；真正会整体消失的是**上游那条 `settings.section → sidebar.settings` 的 whenAccess 链**（§7）。

---

## 七、可降级矩阵

### 7.1 单向判定：六项 UI 能力的降级面

「缺失」分两种：**(a) 宿主根本没加载提供者包**、**(b) 宿主加载了但权限门禁关闭 / slot 未声明**。两者表现相同（UI 静默消失），替代通道相同。

| # | UI 能力 | 提供者（file:line） | 缺失时的表现 | 替代通道（官方、可无 UI 使用） | 证据 |
|---|---|---|---|---|---|
| 1 | **设置面板** | 整条链受 `whenAccess("settings/describe")` 门禁：`$A/dsh-client-ui-settings-general/lib/client.js:1469` → `sidebar.settings`（`$A/dsh-client-ui-sidebar/lib/client.js:761` 声明）→ `settings.section` / `settings.launcher` / `settings.trigger` | 侧栏无设置入口，**不报错**；权限恢复后自动重装 | ①直接写 profile 的 `cordis.patch.yml`（settings 的唯一持久化载体，`$A/dsh-config-editor/lib/index.js:24` → `$A/dsh-app-boot/lib/index.js:1398`）；②`remote.settings.mutate(ns, ops, revision)`；③`configForms.get(ns).mutate(...)`（浏览器侧）；④宿主 `settings.describe` 快照 | `$A/dsh-api-remote-access/lib/client.js:648-702`（whenAllowed）、`:724`（whenAccess）；`$A/dsh-settings/lib/index.js:474/492/505` |
| 2 | **档位切换控件** | `$A/dsh-client-ui-agent-preset/lib/client.js:3027-3038`（`conversation.hero.agentPreset` + `conversation.session.header.actions`）、`:3080-3087`（`settings.section` id `agent-presets`）、`$A/dsh-client-ui-permission-presets/lib/client.js:862`（`remote.settings.mutate`） | 两个槽位都不出现；`/permission` 的 `decorate` 弹层也不出现 | ①斜杠命令 `/permission <preset>`（`$A/dsh-permission-presets/lib/index.js:215-230`，不带参数返回当前档位）；②`remote.settings.mutate("permission", [...])`；③profile patch 的 `permission: {defaultPreset: ...}` | 同上；`$A/dsh-client-ui-commands/lib/client.js:1421`（decorate） |
| 3 | **诊断信息展示** | `$A/dsh-client-ui-trajectory/lib/client.js:9584`（`conversation.view`）；开关 `$A/dsh-client-ui-conversation/lib/client.js:22678`（读 `configForms.developerTools.enabled`，**+57 偏移**） | 关闭 `developer-tools` 时轨迹视图整条不渲染；宿主未装 trajectory 包时该 `conversation.view` item 不出现 | ①打开 `ui-settings` 的 `enabled`（`configForms.get("ui-settings").set("enabled", true)` 或 profile patch）；②`/export` 导出会话 ZIP（`$A/dsh-session-log-export/lib/index.js:789-791`，`/api/session.export` `:767`、`/api/session.markdown` `:770`）；③`remote` 的 trajectory 快照 | `$A/dsh-client-ui-settings/lib/client.js:1042`（默认 false）、`:1069`（schema default true） |
| 4 | **语言切换** | `$A/dsh-client-locale/lib/client.js:1865`（settings.general.item` id `language`）；持久化 `:1566-1572` | 设置行不出现；已选 locale 仍生效（偏好从 `configForms` 快照读） | ①profile patch 写 `locale: { preference: zh }`（实测本机已有：`$A/Users/sunkai/.dsh/profiles/desktop/cordis.patch.yml`）；②`locale.setLocale("zh")`（`:1566`，会持久化）；③宿主无 `/locale` 命令 | `$A/dsh-client-locale/lib/index.js`（Config = z.object({ preference: .volatile() })`） |
| 5 | **单技能开关** | **官方无此原语** | — | ①patch 里 `disabled: true` 掉整个 provider 行（如 `dsh-skill-badge` / `dsh-skill-office` 整包不加载）；②调 `customSkillDirs` / `includeDefaultRoots` 让技能不被发现；③技能自身 `invocation` 字段（`modelInvocable` / `userInvocable`） | `$A/dsh-skill/lib/index.js:120`（Config` 无 enabled）、`$A/dsh-skill-filesystem/lib/index.js:30-43`（Config` 无 per-skill 过滤）；`dsh-skill/lib/index.js:206-209`（invocation 默认值） |
| 6 | **插件配置卡片**（上游实际用的那个） | `$A/dsh-client-ui-plugin-manager/lib/client.js:6022`（在插件详情页里 `renderSlot("plugins.bundle.config", { view: "page" }, { entryKey })`）；门禁 `:7718`（`whenAccess("pluginManager/listBundles")`） | 插件详情页无配置卡片；`plugins.item` 摘要卡也不出现 | ①`configForms.get("<ns>").mutate(...)` 直写；②profile patch 手写 ns 段；③`configForms.whileServed` 的 `unavailable` 状态告知用户「宿主未服务该 ns」 | `$A/dsh-client-ui-settings/lib/client.js:1315`（whileServed）、`:1217`（unavailable） |

### 7.2 三条通用降级原语（记住这三条即可覆盖全部六项）

| 原语 | 语义 | 何时用 | 证据 |
|---|---|---|---|
| `configForms.get(ns)` + 读 `snapshot.status` | `loading` / `unavailable` / `ready` 三态，**永不抛** | 需要读写某个 settings ns，且不要求 UI 出现 | `$A/dsh-client-ui-settings/lib/client.js:1209-1231` |
| `slots.inject(key, cb)` | slot 缺席时静默等待，声明后自动补挂 | 任何跨插件 UI 挂载 | `$A/dsh-client-ui-renderer/lib/client.js:1368-1432` |
| `remoteAccess.whenAccess(action, cb)` | 权限不足时卸载并静默，恢复后重装（幂等） | 受权限门禁的整块 UI | `$A/dsh-api-remote-access/lib/client.js:648-702`、`:724` |

**反过来，三个「不要」**：

1. 不要用 `try { ctx.slots.register(...) } catch {}` 探测 slot 存在——`register` 抛的是 `is not declared`，catch 掉之后**不会有任何补挂机会**；`inject` 才会等。
2. 不要用 `if (form === undefined)` 判断「宿主没装这个插件」——`get()` 永远返回 controller；要读 `snapshot.status === "unavailable"`。
3. 不要指望 `mutate` 抛异常来发现冲突——它 `recover()` 后返回 `false`。

### 7.3 形态级降级：整套客户端不要也能跑

| 形态 | 包 | 是否加载任何 `dsh-client-*` | 证据 |
|---|---|---|---|
| Web | `dsh-web-app` | 是（主 patch 592 行含全部 client 挂载，共 5 层 patch） | `$A/dsh-web-app/package.json` 的 `dsh.bundle.patch` 数组 |
| Headless | `dsh-headless` | **否** | 其 `cordis.patch.yml` 注释原文 "It mounts no Host, HTTP server, Web runtime, or browser plugin."，且 `disabled:true` 掉 `hmr`/`credentials`/`authorization`/`deepseek-account` |
| ACP | `dsh-acp-app` | **否**（只 disable `session-title-llm` 与 `hmr`，插 acp） | `$A/dsh-acp-app/package.json` |

**这是最硬的降级证据：官方自己就有一个「客户端 UI 全部缺失、宿主功能完整」的发行形态（`dsh-headless`）。** 所以「UI 缺失时靠命令/配置/remote 快照替代」不是权宜之计，而是被官方形态验证过的路径。

---

## 八、可复现核对脚本

本章给出**能自证的命令与输出**。全部只读、无副作用，在任一台装了 0.2.2-rc.1 的机器上跑出同样结果；脚本正文见 §8.1，逐节输出见 §8.2–§8.10（实际运行结果，exit=0）。

### 8.1 脚本正文（`/tmp/verify12.sh`，62 行）

```bash
#!/bin/bash
# 票 #12 可复现核对脚本  —— 全只读，无副作用
# 用法: bash /tmp/verify12.sh
# 环境: HOST=/Applications/DeepSeek Harness.app/Contents/Resources/app/dsh/node_modules/@deepseek-ai
cd "/Applications/DeepSeek Harness.app/Contents/Resources/app/dsh/node_modules/@deepseek-ai" || exit 1

echo "## V1 客户端服务注册名（三项 + locale 反证）"
grep -n 'super(ctx, "configForms")\|super(ctx, "slots")\|super(ctx, "commandUi")\|super(ctx, "locale")' \
  dsh-client-ui-settings/lib/client.js dsh-client-ui-renderer/lib/client.js \
  dsh-client-ui-commands/lib/client.js dsh-client-locale/lib/client.js
echo "-- locale 实际用 ctx.provide："
grep -n 'ctx.provide("locale"' dsh-client-locale/lib/client.js

echo
echo "## V2 CLIENT_SLOT_API 条数"
node -e 'const fs=require("fs");const s=fs.readFileSync("dsh-cordis-client-runner/lib/client.js","utf8");const i=s.indexOf("const CLIENT_SLOT_API = [");const j=s.indexOf("\n\t\t];",i);console.log("slots="+(s.slice(i,j).match(/\n\t\t\t\{\n/g)||[]).length);console.log("start_line="+(s.slice(0,i).split("\n").length),"end_line="+(s.slice(0,j).split("\n").length))'

echo
echo "## V3 关键包零补丁核验"
for p in dsh-client-ui-settings dsh-client-locale dsh-client-ui-commands dsh-client-modules \
         dsh-client-ui-renderer dsh-cordis-client-runner dsh-web-frontend dsh-commands \
         dsh-api-remote-access dsh-agent-preset-registry; do
  printf '%-32s bak=%s\n' "$p" "$(find $p -name '*.dshpurge.bak' | wc -l | tr -d ' ')"
done
echo "-- 全库备份总数与真有差异数："
echo "bak_total=$(find . -name '*.dshpurge.bak' | wc -l | tr -d ' ')"
n=0; for b in $(find . -name '*.dshpurge.bak'); do o="${b%.dshpurge.bak}"; cmp -s "$b" "$o" || n=$((n+1)); done; echo "bak_differs=$n"

echo
echo "## V4 configForms 的 getSnapshot / subscribe / mutate"
sed -n '1122,1124p;1130,1132p;1165,1172p' dsh-client-ui-settings/lib/client.js

echo
echo "## V5 slots.inject 的「未声明即静默等待」"
sed -n '1368,1372p' dsh-client-ui-renderer/lib/client.js
node -e 'const fs=require("fs");const s=fs.readFileSync("dsh-client-ui-renderer/lib/client.js","utf8").split("\n");for(let i=1368;i<1435;i++){if(/spec === void 0|declarationEpoch|specDynamic/.test(s[i-1]))console.log(i+": "+s[i-1].trim())}'

echo
echo "## V6 commandUi.decorate 与 remote.commands.execute"
grep -n 'decorate(decoration)' dsh-client-ui-commands/lib/client.js
grep -n 'remote.commands.execute' dsh-client-*/lib/client.js

echo
echo "## V7 locale 兜底：找不到 key 返回原 key"
sed -n '1711,1716p' dsh-client-locale/lib/client.js

echo
echo "## V8 dsh.client 声明统计（88 个）"
node -e 'const fs=require("fs");const dirs=fs.readdirSync(".").filter(d=>d.startsWith("dsh-")&&fs.existsSync(d+"/package.json"));let n=0,ext=0,files=0,impl=false;const plat={};for(const d of dirs){const p=JSON.parse(fs.readFileSync(d+"/package.json","utf8"));const dc=p.dsh&&p.dsh.client;if(!dc)continue;n++;plat[dc.platform]=(plat[dc.platform]||0)+1;if(dc.external&&dc.external.length)ext++;if(dc.immediately)impl=true}console.log("packages="+dirs.length,"declare="+n,"platform="+JSON.stringify(plat))'
echo "lib/client.js 文件数：$(ls dsh-*/lib/client.js 2>/dev/null | wc -l | tr -d ' ')"
echo "lib/client.browser.js 文件数：$(ls dsh-*/lib/client.browser.js 2>/dev/null | wc -l | tr -d ' ')"
ls dsh-*/lib/client.browser.js 2>/dev/null

echo
echo "## V9 inject 缺失合法（parseDshClient）"
sed -n '86,104p' dsh-client-modules/lib/index.js

echo
echo "## V10 形态级降级：headless 不挂任何 client"
grep -n 'mounts no Host' dsh-headless/cordis.patch.yml
grep -c 'dsh-client' dsh-headless/cordis.patch.yml || true
echo "--- exit=0"
```


### 8.2 V1 输出：三个服务名 + locale 的反证

```text
## V1 客户端服务注册名（三项 + locale 反证）
dsh-client-ui-settings/lib/client.js:1270:				super(ctx, "configForms");
dsh-client-ui-renderer/lib/client.js:1348:				super(ctx, "slots");
dsh-client-ui-commands/lib/client.js:1356:				super(ctx, "commandUi");
-- locale 实际用 ctx.provide：
1838:			ctx.provide("locale", locale);
```

`grep` 同时查 `super(ctx, "locale")` 得到**零命中**，而补查 `ctx.provide("locale"` 命中 `:1838`——**这就是 §6.1「locale 不是 Service 子类」的机器可复现证据**，不是推断。

### 8.3 V2 输出：109 条 slot 与常量区间

```text
## V2 CLIENT_SLOT_API 条数
slots=109
start_line=2606 end_line=7559
```

计数方法与 §3.3 一致：统计 `CLIENT_SLOT_API = [` 到首个 `\n\t\t];` 之间形如 `\n\t\t\t{\n` 的 entry 起始行。`SLOT_CATALOG` 索引在 `:7705`。

### 8.4 V3 输出：零补丁核验与全库补丁统计

```text
## V3 关键包零补丁核验
dsh-client-ui-settings           bak=0
dsh-client-locale                bak=0
dsh-client-ui-commands           bak=0
dsh-client-modules               bak=0
dsh-client-ui-renderer           bak=0
dsh-cordis-client-runner         bak=0
dsh-web-frontend                 bak=0
dsh-commands                     bak=0
dsh-api-remote-access            bak=0
dsh-agent-preset-registry        bak=0
-- 全库备份总数与真有差异数：
bak_total=60
bak_differs=39
```

**这十行是全文行号可信度的地基**：本文引用的所有 `configForms` / `slots` / `commandUi` / `__ModuleLoader__` / `locale` 锚点都落在这十个包内，全部 `bak=0`，即**本机字节与官方一致**。60 个备份中 21 个与原文件字节相同（只备份未修改），39 个真有差异，集中在宿主侧（`dsh-sandbox` `-17` 行、`dsh-agent-loop` `+14` 行等），与客户端 UI 契约无关。

### 8.5 V4 输出：configForms 三方法逐字

```text
## V4 configForms 的 getSnapshot / subscribe / mutate
			getSnapshot() {
				return this.store.getSnapshot();
			}
			subscribe(listener) {
				return this.store.subscribe(listener);
			}
			mutate(ops, expectedRevision) {
				const ownedOps = structuredClone(ops);
				const generation = ++this.writeGeneration;
				return this.enqueue(async () => {
					const revision = expectedRevision ?? this.pendingRevision ?? this.getSnapshot().revision;
					const response = await this.ctx.remote.settings.mutate(this.spec.namespace, ownedOps, revision);
					if (!response.ok) {
						await this.recover(generation);
```

**签名与上游 ADR 记的 `getSnapshot()` / `subscribe()` / `mutate(ops, expectedRevision)` 逐字一致，一个都没改名。**

### 8.6 V5 输出：`slots.inject` 的静默等待

```text
## V5 slots.inject 的「未声明即静默等待」
			inject(key, callback) {
				const ctx = this.ctx;
				const disposeController = ctx.effect(() => {
					let active;
					let activeEpoch;
1386: const spec = this._core.specDynamic(key);
1387: const epoch = this._core.declarationEpoch(key);
1393: if (spec === void 0) return;
```

`:1393` 的 `if (spec === void 0) return;` 是整个降级矩阵的技术支点：**slot 没声明就直接 return，不注册、不抛错、不记日志**；等 `declarationEpoch` 变化（声明提交）后 `reconcile` 再跑一遍才补挂。

### 8.7 V6 输出：`decorate` 与 `remote.commands.execute`

```text
## V6 commandUi.decorate 与 remote.commands.execute
1421:			decorate(decoration) {
dsh-client-ui-commands/lib/client.js:1669:				const result = await this.ctx.remote.commands.execute(session.sessionId, line, attachments);
dsh-client-ui-plan/lib/client.js:824:					const result = await ctx.remote.commands.execute(sessionId, "/plan off", []);
```

两个独立消费者（`ui-commands` 自己的 `execute` 封装、`ui-plan` 的直接调用）都走 `remote.commands.execute`，说明该通道不是「只在自家代码里出现的死 API」。

### 8.8 V7 输出：`translate` 的三段兜底

```text
## V7 locale 兜底：找不到 key 返回原 key
			translate(ns, key, params) {
				const chain = this.fallbackChain(this.snapshot.active);
				const template = this.lookup(ns, key, chain) ?? (ns !== "common" ? this.lookup("common", key, chain) : void 0) ?? key;
				if (!params) return template;
				return template.replace(/\{(\w+)\}/g, (match, name) => name in params ? String(params[name]) : match);
			}
```

第三段 `?? key` 是「返回原 key」的直接证据（不是 `""`、不是 `undefined`）。

### 8.9 V8 输出：88 个包声明、85 + 3 个入口

```text
## V8 dsh.client 声明统计（88 个）
packages=320 declare=88 platform={"web":88}
lib/client.js 文件数：85
lib/client.browser.js 文件数：3
dsh-api-gateway/lib/client.browser.js
dsh-client-connection/lib/client.browser.js
dsh-typert-registry/lib/client.browser.js
```

（`packages=320` 是 `dsh-*` 前缀目录数；含非 `dsh-` 前缀的 `cordis` / `cosmokit` / `schemastery` / `libreoffice-kit*` / `node-addon-*` 共 12 个后，目录总数为 332。）

### 8.10 V9 / V10 输出：inject 合法性 与 headless 形态

```text
## V9 inject 缺失合法（parseDshClient）
function parseDshClient(pkgName, value) {
	if (value === void 0) return void 0;
	if (typeof value !== "object" || value === null) throw new Error(`client-modules: ${pkgName} has a non-object dsh.client declaration`);
	const decl = value;
	if (typeof decl.platform !== "string") throw new Error(`client-modules: ${pkgName} dsh.client.platform must be a string`);
	const inject = optionalStringArray(pkgName, "dsh.client.inject", decl.inject);
	const external = optionalStringArray(pkgName, "dsh.client.external", decl.external);
	if (decl.immediately !== void 0 && typeof decl.immediately !== "boolean") throw new Error(`client-modules: ${pkgName} dsh.client.immediately must be a boolean`);
	return {
		platform: decl.platform,
		...inject !== void 0 ? { inject } : {},
		...external !== void 0 ? { external } : {},
		...decl.immediately !== void 0 ? { immediately: decl.immediately } : {}
	};
}
/**
* The bare package-root specifier `specifier` names, or undefined for a subpath, a path, or any scheme-qualified
* specifier (`cordis:` builtins, `node:` modules, URLs).
* @param specifier - Loader row name.

## V10 形态级降级：headless 不挂任何 client
2:# It mounts no Host, HTTP server, Web runtime, or browser plugin. An ordinary
0
--- exit=0
```

`V10` 段里倒数第二行的 `0` 是 `grep -c 'dsh-client' dsh-headless/cordis.patch.yml` 的计数，末行 `--- exit=0` 是脚本自己的收尾标记——**headless 形态的 patch 里一个 `dsh-client` 字样都没有**，与 §7.3 的结论互证。

`V9` 段尾部多出的三行 `/** ... @param specifier */` 是 `sed -n '86,104p'` 越过了 `parseDshClient` 函数边界所致（函数体在 `:104` 结束，紧接着是下一个函数的 JSDoc），不影响 §5.2 的引用。

---

## 附录 A：未核实项

以下七项**没有**做到，本文任何结论都不依赖它们，但读者若要把结论用于运行时决策，需自行补验：

| # | 未核实项 | 影响范围 | 补验方式 |
|---|---|---|---|
| A1 | 未在浏览器实际运行验证 slot 注册失败的运行时表现（§3.2 的抛错、§5.3 的 `is waiting for activation` 都只是静态读源码 + dist 内联实现） | §3.2、§5.3 的「运行时表现」列 | 起 `dsh web`，故意给某个包写错 slot 名，看控制台与 `failures` 数组 |
| A2 | `dsh-web-frontend/dist` 是打包产物，slot 声明与 seed 模块表只能读 dist，没有对应 src 可给包级 `file:line` | §3.3 的 `declaredBy` 与 §5.4 的 seed 表 | 只能读到 `index-BgUyXZcc.js` 的字节偏移（`offset≈947104` / `≈491369`） |
| A3 | `dsh-client-ui-primitives` / `dsh-client-store` / `dsh-client-ui-slots` / `dsh-client-ui-dockkit` 在 `node_modules` 里**没有目录**，只有 dist 内联实现 | §3.1 的 `SlotCore` 签名只能引自 runner 的 declaration 字符串 | 无法给出「`SlotCore` 定义在第几行」 |
| A4 | 未验证 `dsh-client-hmr` 下 `__ModuleLoader__` 的 `invalidate` 路径（只读到 `dsh-cordis-client-runner/lib/client.js:713-716` 复用 sink 的调用点） | §5.5 的 HMR 行 | 改一个 client 包的源码触发 HMR，观察 `duplicate factory registration` 是否出现 |
| A5 | 未逐一核对 109 条 slot 与 dist 实际可注册集合的完全一致性（只核对了 runner 常量区间与 dist 的 `SlotCore.register` 错误文案） | §3.3、§3.4 的完整性 | 写脚本从 dist 提取 `register("...")` 字面量做差集 |
| A6 | 未实测 `disabled: true` 掉 `ui-settings` 后那 20 个依赖包的实际表现（结论基于 `client.js:791-794` 的静默跳过 + `:547-564` 的 failures 记录） | §5.3、§5.4 的依赖面 | 在 profile patch 里 disable 掉 `dsh-client-ui-settings` 行，看页面剩什么 |
| A7 | `dsh-api-remotes` 的 descriptor 键名不是 `namespace`，未逐条列出 27 个包各自暴露的 namespace 名（只确认了 `package` 字段的 27 个值） | §5.4 的 `remote` 说明 | 读 `dsh-api-remotes/lib/client.js` 的 `$mount` 贡献结构 |

另外两条**方法论层面的限制**，读者须知：

1. 本文所有「运行时行为」均来自**静态源码阅读**（含 dist 内联实现的错误文案），**没有一次实际浏览器执行**。凡涉及「会不会白屏」「失败后页面还剩什么」的表述，严格说是「源码规定的行为」，不是「观测到的行为」。
2. 本机安装被 `dsh-purge` 打过 60 个备份（39 个真有差异），本文只保证**引用的十个关键包零补丁**（§8.4 输出）。引用宿主侧文件（`dsh-settings` `+4`、`dsh-permission-presets` 内容替换但行数不变）时已在正文逐处标注。

## 附录 B：本机补丁偏移表

本机 `$A/` 下共 60 个 `*.dshpurge.bak`，39 个与原文件有字节差异。与本文相关的只有三处：

| 包 / 文件 | 行数（当前 vs 备份） | 偏移 | 补丁内容 | 对本文的影响 |
|---|---|---|---|---|
| `dsh-client-ui-conversation/lib/client.js` | 23201 / 23144 | **+57** | `:2524` 起插入 `isRewindMarker` / `rewindVisibleEntries`（隐藏 `rewind-*` 用户消息及其覆盖区间） | **该文件所有行号整体后移 57**。正文引用处已标注「+57 偏移」并给出官方约值 |
| `dsh-settings/lib/index.js` | 548 / 544 | **+4** | `:435` 后与 `:465` 各插一条 `emit("settings/updated")` | 引用 `:474`（update）/`:492`（mutate）/`:505`（write）时已标注含 +4 偏移；官方原值为 `:470` / `:488` / `:501` |
| `dsh-permission-presets/lib/index.js` | 414 / 414 | **0**（内容替换，行数不变） | `:150` 权限描述文案改写；`:384` `defaultPreset` 改为按 `shell.sandboxMode` 取 `danger-full-access` | **行号不受影响**，但 `/permission` 默认档位的语义被改过——引用 handler 逻辑（`:215-230`）安全，引用「默认档位」需注明本机被改 |

其余 57 个备份与客户端 UI 契约无关，未列表。另有 21 个备份与原文件字节完全相同（只备份未修改），不计入差异。

**读表须知**：凡本文引用 `dsh-client-ui-settings`、`dsh-client-locale`、`dsh-client-ui-commands`、`dsh-client-modules`、`dsh-client-ui-renderer`、`dsh-cordis-client-runner`、`dsh-web-frontend`、`dsh-commands`、`dsh-api-remote-access`、`dsh-agent-preset-registry` 的行号，**都是官方行号，可直接用于 0.2.2 的任何一份干净安装**（§8.4 已给出 `bak=0` 的机器输出）。

---

## 九、结论：给 ticket #12 的答案

（正文答案见回报消息与票面 `## Answer` 段，此处只留一句方法论收束。）

**「API 在不在」这个问题在 0.2.2 上的答案全部是「在」；真正决定插件生死的不是 API，而是「缺能力时走哪条注册通道」。** 走 `slots.inject` / `configForms.get` / `remoteAccess.whenAccess` 这三条通道，UI 缺席时插件静默降级；走裸 `slots.register` 或硬读 `.value`，UI 缺席时就抛错或读到 `undefined`。
