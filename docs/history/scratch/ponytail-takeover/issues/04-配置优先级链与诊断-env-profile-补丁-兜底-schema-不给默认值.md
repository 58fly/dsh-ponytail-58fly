<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-PARENT: 00 -->
<!-- DSH-LABELS: wayfinder:task -->
<!-- DSH-IDEMPOTENCY-KEY: deck-plan-ponytail-takeover-v1-child-T3 -->
<!-- DSH-CREATED: 2026-11-07T03:34:34.156Z -->
<!-- DSH-BLOCKED-BY: 03 -->
<!-- DSH-ASSIGNEES: lead -->
# 04: 配置优先级链与诊断：env > profile 补丁 > 兜底，Schema 不给默认值

Type: task

Blocked by: 03

Status: resolved
## Question

实现配置读取与"为什么我改了没用"的可诊断性。

## 要做的事

1. **三级优先级链**：环境变量 > profile 补丁 > 内置兜底。产出恒 3 项的诊断报告，每项带 `label / location / value / hit / shadowed / problem`。
2. **Schema 不给默认值**：`defaultMode` 刻意不写 `.default()`。理由（上游注释原文）：Cordis 校验会把缺省 fill 成显式配置，补丁"配过/没配过"不可区分，诊断面板会说谎。这条必须原样保留。
3. **可选注入**：用 `ctx.inject(['settings'], cb)` 回调形式，不硬依赖 `settings`（headless/CLI 没有该服务）。不用 `(ctx as unknown as {...})` 三重断言。
4. **写入走官方通道**：配置写入交给宿主的 settings / `loader/volatile-update`，**不自己写 JSON 文件**。上游的 `writeDiskConfig` / `safeAtomicWriteFile` / `salvageConfig` 三件套（约 175 行）整体删除。
   - **宿主侧服务名是 `settings`**（`dsh-settings/lib/index.js:330`），`ctx.configForms` 在宿主侧**不存在**——`configForms` 是客户端服务名（#12）。
   - **`@deepseek-ai/dsh-commands` / `dsh-commands` 从 0.2.1-alpha.3 才有**，而 `engines.dsh` 下界是 0.2.0-rc.1（#09）→ 凡是要用 `commands` 的地方一律 `ctx.inject(['commands'], scope => ...)`，缺失时本票的诊断只能走只读路径（#09 定案）。
   - **0.2.2 实测坑**：远程 `settings/mutate` 返回的是**扁平 namespaceView**（`{ns,...,revision}`），不是 `{value:{revision}}`。上游 `ponytail-settings.ts:113-114` 读 `response.value?.revision` 永远读不到 → 下次写入带旧 revision 触发 `settings/conflict`。新实现直接读扁平 `revision`，并把写入结果 `Promise` 返回给调用方（对应 B-02：失败要回滚 + 重新 `describe()`，不能只 `warn`）。
5. **诚实的失败**：配置非法时保留上一个好值并记诊断，不静默回落到默认档。

## 硬约束

- 判据是"用户问'为什么我改了没用'时，面板能指出是哪一层盖住了"。
- 不引入 `yaml` 之外的依赖；先确认 `yaml` 是否可去（见 #03）。

## 验收

- 一次人为制造的 `settings/conflict` 之后，下一次写入仍能成功（有断言，证明没有 B-02 那种永久静默失效）。
- 三条来源各设一次，诊断报告正确标出 `hit` 与 `shadowed`。
- 非法值注入后，运行档位不变且有可见诊断。
- 无 `settings` 服务时插件完整工作。

## Comments

### local — 2026-11-07T07:10:15.850Z
关票：三级链纯函数化（13 条测试）、唯一写入口 + 冲突重试一次（12 条）、真实 Cordis 接线（8 条）全部绿。补丁层读 describe().user 而非 value 是本票最关键判断；SettingsForms 三个写方法都返回 Promise<void>，revision 必须回读，这是上游 B-02 的根因。

## Answer

三级链与诊断已按票面落地，四条验收全部有断言。**结论：诊断的正确性靠"只读 patch 层原文"与"写入后必回读"两件事撑着，其它都是这两条的推论。**

**1. 三级链是纯函数，脱离宿主可证。** `src/config/priority.ts` 的 `resolvePriority({env, patch, rejected})` 零 I/O、不 import 宿主包，恒返回 3 项（顺序 env → patch → fallback），每项带 `label / location / value / hit / shadowed / problem`。与上游三处分歧写进了文件头：① 不做 `String()` 强转（上游把 `undefined` 变成字面量 `"undefined"`）；② `shadowed` 只在**该层真有合法值**时为真（上游 `winner < i` 让没配的层也被标成"被盖住"，正是面板说谎的典型现场）；③ `problem` 与 `shadowed` 互斥。

**2. Schema 一个默认值都没给，三个字段全 `.volatile()`。** 不给 `.default()` 保住了"配过/没配过"的区分（票面第 2 条），而 `.volatile()` 是宿主设置页的准入条件——`volatileForm(schema)` 对非 volatile 的 Config 返回 `undefined`，条目从 `describe()` 里整个消失、写入抛 `has no volatile fields`。实测 `.default()` 与 `.volatile()` 互斥：`z.string().default('x').volatile()` 的 `.get()` 仍是 `undefined`，默认值被丢弃。这条反向印证了票面定案，已写进 `docs/research/dsh-plugin-contract-0.2.2.md` §7.6。

**3. 补丁层读 `describe().user`，不读 `value`。** 这是本票最要紧的一处判断。`value` 是 `projectForm(form, plainConfig(fiber.effectiveConfig))`，已经混进环境变量与代码兜底；拿它当 patch 层，面板会把"兜底的 full"说成"用户配的 full"。`user` 才是 profile 补丁里最后一条带 config 的同 id 节点（`dsh-config-editor/lib/index.js:39-63` 的 `override`）。没有 settings 服务时才退回读 `apply` 收到的活引用——那时它是唯一可见来源，报成 patch 层是诚实的。

**4. 写入后必回读，冲突只重试一次。** `SettingsForms` 的 `update/replace/mutate` 全部返回 `Promise<void>`（`dsh-settings/lib/types/index.d.ts:96-114`），**没有任何一个把新 revision 交回来**——这就是上游 B-02 的根因。`ConfigRuntime.setMode` 的路径是：`coerceMode` → `mutate(…, revision)` → 失败且 `code === 'SETTINGS_CONFLICT'` 时 `refresh()` 重读 `describe().revision` → 再写一次 → 无论成败都再 `refresh()`。第二次仍冲突就如实返回，不再重试（持续冲突说明有别的写入者在竞争，无限重试会把一次点击变成写盘风暴）。认 `code` 而不 `instanceof`：`@deepseek-ai/dsh-settings` 对本包是纯类型依赖，运行时裸 import 会 `ERR_MODULE_NOT_FOUND`。

**5. 可选注入用 `ctx.inject(['settings'], cb)`，不写进 `inject`。** `Context.prototype.inject` = `this.plugin({inject, apply})`（`cordis/lib/index.js:1672`），依赖缺席时子 fiber 不启动、主插件照常跑——这就是降级本身，不需要 `try/catch` 探测。回调抛错会让 Fiber reject，所以 `void Promise.resolve(fiber).catch(…)` 接住。**已实测**：真实 `Context` + `ctx.provide('settings', 替身)` 下子 fiber 启动、`describe()` 被调用、两条广播都触发重读、卸载后监听真的断开（`test/config-wiring.test.mjs` 8 条）。

**6. 不自己写盘，也不自己保"上一个好值"。** 宿主 `dsh-config-editor.edit()` 已做 `withFileLock` + `fiber.resolveConfig` 预校验 + 写前覆盖核对 + `writeFileAtomic` + reconcile 失败回滚；`cordis-plugin-loader._commitVolatile()` 在 volatile 校验失败时只 warn、原值不动。上游那 175 行 `writeDiskConfig` / `safeAtomicWriteFile` / `salvageConfig` 在本实现里没有对应物。我们只补一件事：把拒绝原因并进诊断链的 `problem`，让面板说得出"你上次写的值被拒了，现在跑的还是旧的"。

**7. 一个诚实的边界。** "配置非法时保留上一个好值"在**两条写入路径上都成立但可见性不同**：走设置页 `mutate` 时 `config-editor.edit()` 先 `fiber.resolveConfig` 预校验，非法值根本写不进文件，调用方直接拿到 `ValidationError`；走手改 YAML 时 loader 的 `_commitVolatile` 吞掉校验失败，只有等下一次 `describe()` 才会在我们这边冒出 `problem`。因此 `ConfigRuntime` 的可见诊断打的是"**下一次读**"这个锚点，而不是"写入那一刻"——这是宿主不通知我们的事实决定的，写在这里以免后来者以为是漏实现。

### 交付物

| 文件 | 内容 |
|---|---|
| `src/config/priority.ts` | 183 行，纯函数三级链 + 六字段诊断 |
| `src/config/volatile.ts` | 三态解包（引用 / 裸值 / undefined），不引 cosmokit |
| `src/config/schema.ts` | 三字段全 `.volatile()`、全无 `.default()`，保留 TS2742 显式标注 |
| `src/config/runtime.ts` | 唯一写入口 `setMode` + `getSnapshot` + `subscribe` + 冲突重试一次 |
| `src/config/events.ts` | 声明 `settings/updated` 与 `loader/volatile-update`，避免拿宽松重载骗类型 |
| `src/plugin.ts` | 接线 `ctx.inject(['settings'], …)`；`runtimeOf(ctx)` 供 #05 / #07 取同一份状态 |
| `test/config-priority.test.mjs` | 13 条，纯函数层（含上游缺陷的回归） |
| `test/config-runtime.test.mjs` | 12 条，替身层（冲突重试、写入失败可见、订阅去重、volatile 活引用） |
| `test/config-wiring.test.mjs` | 8 条，真实 Cordis + `ctx.provide('settings')`（接线、广播、卸载断开、无服务降级） |
| `docs/research/dsh-plugin-contract-0.2.2.md` §7 | 设置写入通道的完整事实（三层来源语义、`Promise<void>` 与 revision 回读、unset = 回退继承值、落盘三重保护、`.volatile()` 与 `.default()` 互斥、`ctx.inject` 是起子插件） |

质量门：`tsc --noEmit` 干净，`build` 通过（client bundle 2938 bytes），`verify` 16 源文件 / 57 产物文件通过，`check:skills` 通过，`npm test` **102/102 pass**。

### 给下游两张票的接口（已可用，不需要再改）

- **#07**：`runtimeOf(ctx)` 拿 `ConfigRuntime`，切档只调 `setMode(raw)`——与设置面板同一条路径，归一化只有 `coerceMode` 一处。渲染器已改成每轮读 `runtime.mode`，切档不必重装 section；`off` 时返回空串，`renderPrompt` 会丢掉该段（`assemble().sections` 里它仍在，这是宿主行为，别在那一层断言）。
- **#05**：`getSnapshot()` 返回 `{effective, chain, revision, writable, documentPath}`，扁平、可序列化，正好喂 Typert 只读通道。**不要**把写入后本地先改再渲染：`setMode` 返回 `WriteOutcome`（`ok` 与 `note` 正交），成功与否以 `refresh()` 后的快照为准。

### 未做 / 留给别处

- `settings.configure({auto:false})` **刻意没调**：那会关掉宿主自动生成的设置表单，而自定义面板属于 #05。在 #05 落地前关掉，用户会面对一个空白设置页。
- 设置在 `app-boot/config-reload` 下的重读：该事件由 `dsh-settings` 自己订阅并 `invalidate()`，我们经 `settings/updated` 被动收到，不额外订阅，避免同一轮重载触发两次刷新。

## 进度


