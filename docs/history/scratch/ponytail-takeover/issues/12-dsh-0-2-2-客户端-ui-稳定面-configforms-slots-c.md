<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-PARENT: 00 -->
<!-- DSH-LABELS: wayfinder:research -->
<!-- DSH-IDEMPOTENCY-KEY: deck-plan-ponytail-takeover-v1-child-R3 -->
<!-- DSH-CREATED: 2026-11-07T03:34:34.157Z -->
# 12: DSH 0.2.2 客户端 UI 稳定面：configForms / slots / commandUi 在不在，可降级边界在哪

Type: research

Status: resolved
## Question

摸清 DSH 0.2.2 客户端面的稳定边界，定"可降级"这条线画在哪。

## 要回答的问题

1. **`configForms` 在 0.2.2 到底存不存在？** 上游 `build-client.mjs` 注释与 ADR 都提到 `ctx.configForms.get('ponytail')` 带 `getSnapshot()/subscribe()/mutate(ops, expectedRevision)`，但本机 `@deepseek-ai/` 下**没有 `configForms` 独立包**（只有 `dsh-api-settings-controller` 与一批 `dsh-client-ui-settings-*`）。核实：它是服务名而非包名？还是已被移除？若存在，在哪个包里？
2. **`slots.inject` 的 slot 名在 0.2.2 是什么？** 四家同期实现的 slot 名各不相同（`settings.plugins.tab` / `conversation.input.left` / `conversation.input.dock` / `sidebar.panellist` / `main`）。列出 0.2.2 真实存在的 slot 名与其宿主包。
3. **`commandUi.decorate` 还在吗？** @kb1slnlabs 用它做档位 popupSelect 并回调 `remote.commands.execute(sessionId, '/ponytail <id>')`。核实 0.2.2 的命令执行通道。
4. **客户端包加载机制**：`window.__ModuleLoader__.load({id, factory})` 仍是唯一形态吗？`package.json` 的 `dsh.client.inject` 是否必须声明全部用到的客户端包？缺一个会怎样（报错还是降级）？
5. **`dsh-client-locale` 的用法**：`ctx.locale.bind` 的签名是什么？命名空间注册后 key 找不到时返回什么？
6. **可降级边界**：给出"零 UI 时宿主侧必须完整工作"的具体清单——哪些能力只能在 UI 里，哪些必须同时经命令/配置可达？

## 硬约束

- 结论必须来自 0.2.2 真机实测或包源码，不能引用其他插件的注释（那些注释已经证明会漂移，见 `dsh-api-gateway` 行号 706-719 vs 现行 933/1268）。
- 客户端面是漂移区。任何"稳定面"结论都要标注核实来源与版本。

## 验收

- 一份 slot / 服务 / 加载机制的可用性清单，逐项标注"0.2.2 实测存在 / 不存在 / 改了名字"。
- 一张可降级矩阵：每个 UI 能力 → 缺失时的降级行为。

## Comments

### local — 2026-11-07T04:06:20.349Z
## 结论

六问全部在 0.2.2-rc.1 真包上核实完毕。**好消息：客户端面比预期稳；坏消息：可降级不是「自动」的，必须显式写。** 原型期最该记住的一条：`dsh.client.inject` 缺失是**静默跳过**，不是报错，所以「零 UI 也能跑」不会自动成立，得靠代码结构保证。

### 1. `configForms` 存在，是**服务名不是包名**

`dsh-client-ui-settings/lib/client.js:1270`：

```js
var ConfigForms = class extends Service {
  constructor(ctx, config) { super(ctx, "configForms"); ... }
  describe()                              // 返回 shared mirror（只读面）
  get(entryId)                            // → ConfigFormController
  whileServed(namespaces, register)        // 命名空间被服务时才注册，消失时自动撤
}
```

19 处 `client.js` 声明消费它（`dsh-client-locale`、`-ui-chat`、`-ui-conversation`、`-ui-agent-preset`、`-ui-plugin-manager`、`-ui-settings-account` …）。**上游 ADR 里 `ctx.configForms.get('ponytail')` 的写法在 0.2.2 成立**，但注意参数是 **entryId（宿主插件条目的 id）**，不是配置命名空间名。

`ConfigFormController` 公开面（实测）：

| 方法 | 返回 | 备注 |
|---|---|---|
| `getSnapshot()` | `{status, value, base, user, revision, writable}` | 同步、引用稳定 |
| `subscribe(listener)` | disposer | |
| `set(field, value)` | `Promise<boolean>` | 单字段写 |
| `unset(field)` | `Promise<boolean>` | 单字段清 |
| `mutate(ops, expectedRevision?)` | `Promise<boolean>` | 原子多字段；**自带写队列 + revision 栅栏 + recovery read** |

**这一条直接消掉了上游 B-02**：`mutate` 内部维护 `tail` 串行队列与 `writeGeneration`，注释写明「whether the Host accepted the write, **after any recovery read**」，且 `pendingRevision` 处理「被取代的写仍领先 mirror」的栅栏问题。我们自己再写一套 revision 重试是重复劳动 —— **#04 的范围因此收窄：宿主侧仍需要 re-describe（B-02 在宿主侧照旧存在），客户端侧交给 configForms。**

### 2. slot 名：0.2.2 实测存在 214 处注入，真实名单（按使用量）

```
conversation.chat.node(19)            tool.call.toolview(15)
shell.overlay(14)                     sidebar.right.pane.tab(13)
settings.general.item(12)             sidebar.right.pane.tab.title(9)
sidebar.right.tab.document(8)         conversation.user.text.node(6)
settings.section(5)                   conversation.session.header.utilities(5)
plugins.item(4)                       conversation.input.dock(4)
conversation.chat.turnTail(4)         contextMenu.icon(4)
main(3)                               conversation.view(3)
conversation.session.header.actions(3) conversation.input.overlay(3)
conversation.composer(3)              plugins.bundle.config(2)
sidebar.panellist(2)                  settings.onboarding(2)
conversation.input.permission(2)      conversation.input.model(2)
contextMenu.content(2)                ...
```

对 v0.2 面板有用的四个：**`settings.section`**（设置页一节）、`settings.general.item`（设置页通用条目）、`sidebar.right.pane.tab`（右侧面板页签）、`conversation.input.dock`（输入框下方条）。四家同期实现用的 `settings.plugins.tab` / `conversation.input.left` / `main` 里**只有 `main` 真实存在**。

### 3. `commandUi` 与远程命令通道都在

- `ctx.commandUi`（`dsh-client-ui-commands/lib/client.js:1356` `super(ctx, "commandUi")`）公开面：`register(contribution)` / `decorate(decoration)` / `dismiss(name)` / `popupFor(actx)` / `dispatch(pick)` / `invoke(...)` / `notifyExecuted(sessionId, name, result)`。两个注册方法都返回 disposer，重名抛错。
- `remote.commands.execute(sessionId, line, attachments)` 存在，两处真实调用：`dsh-api-session-controller/lib/client.js:2484`（`(this.sessionId, line, [])`）与 `dsh-client-ui-commands/lib/client.js:1669`（带 attachments）。
- 宿主侧 `commands/execute` 是 Typert 远程方法，签名 `execute(agent, line, submittedAttachments, signal): Promise<CommandExecution | undefined>`，另有 `commands/list`。

**@kb1slnlabs 的档位 popupSelect 路线在 0.2.2 完全可行**：`commandUi.decorate({name, ...})` 挂到宿主的 `/ponytail` 上，选中后回调 `remote.commands.execute(sessionId, '/ponytail lite', [])`。

### 4. `window.__ModuleLoader__.load({id, factory})` 仍是唯一形态

`dsh-api-gateway/lib/client.browser.js:1` 与 `dsh-api-job-controller` / `dsh-api-remotes` / `dsh-api-remote-access` / `dsh-api-session-controller` / `dsh-api-terminal-controller` 的 `client.js` 全部是这个形态。**没有变化。**

### 5. `dsh.client.inject` 缺失 = 静默跳过（关键坑）

`dsh-client-modules/lib/client.js` `arriveGraphRow`：

```js
for (const request of row.external) { ... await this.arriveDependency(...) }   // external 缺失 → 抛错
for (const packageName of row.inject) {
  const dependency = this.graphRows.get(packageName);
  if (dependency !== void 0) await this.arriveDependency(row.id, dependency, [], visited);  // inject 缺失 → 静默跳过
}
```

- `dsh.client.inject` 里列的包**不在宿主** → **不报错，直接跳过**，你的 bundle 照常加载。
- `dsh.client.external` 里列的包缺失 → 抛 `client-modules: "<consumer>" not loaded because dependency "<dep>" failed`。

**所以「可降级」必须靠运行时 `ctx.inject([...], (scope) => ...)` 写，不能靠清单。** 正确姿势：`inject` 只声明真正必需的（`@deepseek-ai/dsh-client-locale`、`dsh-client-ui-settings`、`dsh-client-ui-primitives`），面板逻辑全部包在 `ctx.inject(["configForms", "commandUi", "slots"], ...)` 里 —— 缺任何一个，面板不出现，宿主侧功能不受影响。

### 6. `locale.bind(ns)` 签名与回落

```js
bind(ns) { ... t = (key, params) => this.translate(ns, key, params) }
translate(ns, key, params) {
  const chain = this.fallbackChain(this.snapshot.active);
  const template = this.lookup(ns, key, chain)
    ?? (ns !== "common" ? this.lookup("common", key, chain) : void 0)
    ?? key;                        // ← 找不到返回 key 本身，不是 undefined，不抛
  ...
  return template.replace(/\{(\w+)\}/g, (m, name) => name in params ? String(params[name]) : m);
}
```

- 签名：`bind(ns: string) => (key: string, params?: Record<string, unknown>) => string`，同一 ns 返回**同一个函数引用**（`bound` Map 缓存）。
- 找不到 key：**回落 `common` 命名空间 → 再找不到返回 key 原文**。所以占位文案会以 key 形式露出来，不会崩，便于发现漏翻。
- 参数替换是 `{name}`；缺参数保留原占位符。
- **注意**：字典注册（`locale/change` 之外）不发事件，注释写明「registration-heavy boot 不能 storm 事件监听器」。所以注册文案要在**组件挂载前**完成，别指望注册后触发重渲染。

### 可降级矩阵（v0.2 面板）

| UI 能力 | 依赖 | 缺失时降级 | 宿主侧等价入口 |
|---|---|---|---|
| 模式三档切换 | `commandUi` 或 `configForms` | 面板不渲染 | `/ponytail lite|full|ultra|off` |
| 每技能启用/禁用 | `configForms` | 面板不渲染 | settings schema 自动生成的表单（实测已出现） |
| 技能描述中英切换 | `configForms` + `locale` | 用宿主 locale 推断 | settings schema 表单 |
| 右侧状态面板 | `sidebar.right.pane.tab` | 用 `settings.section` 一栏 | 命令 `/ponytail status` |
| 档位下拉（装饰） | `commandUi.decorate` | 退回纯文本参数 | `/ponytail <mode>` |
| 全部 UI | 任意 | 零 UI 完整工作 | 命令 + settings schema 双通道 |

**这张矩阵就是判据 6 的验收口径**：逐行在「删掉 `dsh.client` 声明」的形态下手动验一遍。

### 对下游票的改动要求

- **#05**：slot 用 `settings.section`（主）+ `sidebar.right.pane.tab`（次）；`configForms` 当服务用、参数传 entryId；面板必须整体包在 `ctx.inject([...])` 里；`dsh.client.inject` 只列必需三项。
- **#03**：客户端 bundle 形态照旧 `window.__ModuleLoader__.load({id, factory})`；但**不要学上游的字符串模板**，直接写 `.tsx` + tsdown（宿主自己是 `tsdown.client.ts`）。
- **#07**：确认宿主侧 `ctx.commands.register` 有对应客户端面（`dsh-client-ui-commands` 自动进斜杠菜单，`commands/change` 事件驱动目录失效），不需要自建 UI。

## Answer

configForms 是服务名（dsh-client-ui-settings:1270），参数是 entryId，controller 自带写队列+revision 栅栏+recovery read 可消 B-02 客户端侧；214 处 slots.inject 实测出真实 slot 名单，v0.2 用 settings.section + sidebar.right.pane.tab；commandUi 与 remote.commands.execute 均在；__ModuleLoader__ 形态未变；dsh.client.inject 缺失是静默跳过、external 缺失才抛错，故可降级必须靠运行时 ctx.inject；locale.bind 返回 (key,params)=>string，找不到回落 common 再返回 key。

## 进度
