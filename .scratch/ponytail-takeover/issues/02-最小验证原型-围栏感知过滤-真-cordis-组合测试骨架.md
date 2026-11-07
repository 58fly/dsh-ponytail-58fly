<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-PARENT: 00 -->
<!-- DSH-LABELS: wayfinder:prototype -->
<!-- DSH-IDEMPOTENCY-KEY: deck-plan-ponytail-takeover-v1-child-P1 -->
<!-- DSH-CREATED: 2026-11-07T03:34:34.156Z -->
# 02: 最小验证原型：围栏感知过滤 + 真 Cordis 组合测试骨架

Type: prototype

Status: resolved
## Question

用最小可运行原型验证两个技术假设，避免在正式仓库里返工。

## 要验证的两件事

**假设 A：围栏感知的 mode 过滤可以做到零依赖、可单测。**
上游 `filterSkillBodyForMode` 只有两条行首正则，实测会把 ``` 围栏内的 `| **ultra** | maximal |` 删掉。原型要实现：
- FENCE 状态机：识别 ``` / ```` / `~~~` 开闭，跟踪当前是否在围栏内；
- 围栏内的行**一律保留**，不做 mode 过滤；
- 围栏外的表格行 / 示例行按 mode 裁剪；
- 至少 4 条夹具：围栏内 mode 行保留、围栏外 mode 行裁剪、未闭合围栏（到文末都算围栏内）、嵌套不同长度围栏。

**假设 B：真 Cordis 组合测试跑得起来。**
- `new Context()` + `ctx.plugin(SkillRegistry)` + `ctx.plugin(Ponytail.apply, Ponytail.Config({}))`
- 断言 `ctx.skills.list()` 返回 6 个技能（name / provider / source）
- 断言 dispose 后清空
- 断言没装 `settings` / `commands` 时插件不抛（可选注入路径）

## 硬约束

- 原型放在 `/tmp` 或 `prototypes/`，**不进正式仓库**，写完记结论即可。
- 必须在本机 DSH 0.2.2-rc.1 的真实 `@deepseek-ai` 包上跑（不 mock 宿主），但结论要标注"本机宿主被打过 dshpurge 补丁"这一前提。

## 验收

- 两段可复现的原型代码 + 运行输出。
- 结论一句话：围栏状态机与真组合测试各自要多少行、有没有踩到宿主契约的坑。

## Comments

### local — 2026-11-07T04:01:33.026Z
## 结论

两个假设全部验证通过，且给 #07 选定了实现方案（B2）。原型全部留在 `/tmp/ponytail-proto/`，未进仓库。

### 假设 A：围栏感知过滤 —— 成立

`src/fence.mjs` **40 行**状态机（识别反引号 / 波浪号开闭，跟踪长度，输出逐行 `inFence`），`variant-b2-fence-loose.mjs` **27 行**过滤逻辑。零依赖、纯函数、可单测。

四方案实测（夹具 `fixtures/fixture{1,2,3,4}-*.md`，30 PASS / 0 FAIL）：

| 方案 | 围栏内误删 | 17 条形状变体 | 真实正文回归 | 正文改动 |
|---|---|---|---|---|
| A 上游原样 | F1 删 8 行 / F3 删 4 行 / F4 删 8 行 | **5/17 错（29.4%）** | — | 0 |
| B 仅加围栏感知 | 0 | **5/17 错**（与 A 同错项） | 与 A 逐字节相同 | 0 |
| **B2 围栏感知 + 放宽形状** | **0** | **17/17 全对** | 与 B 逐字节相同 | 0 |
| C 显式标记 | 0 | 17/17 全对 | — | +12 行（+11.8%），且 4 类标记漂移会静默丢内容 |
| D 分档文件 | 0 | 无行级风险 | — | 3 份文件重复 |

A/B 的 5 条共同错项（上游两条正则只认「行首无缩进 + `-` bullet + 直接冒号 + 引号」）：`* full:` 星号 bullet、两空格缩进、`- full (default):` 括号注释、`- **full**:` 加粗模式名、`1. full:` 有序列表。

**裁决：选 B2。** 两条放松正则全部由 V10–V14 反推而来，不是凭感觉加宽：

```js
const TABLE_LABEL = /^\s*\|\s*\*\*(.+?)\*\*\s*\|/
const LIST_LABEL = /^\s*(?:[-*+]|\d+[.)])\s+(?:\*\*)?([^:*()\n]+?)(?:\*\*)?\s*(?:\([^)\n]*\))?\s*(?::|：)\s*["「]/
```

否决理由：A 既不感知围栏又有 29.4% 漏裁；C 的标记漂移（大小写、漏闭合、拼错、档名不匹配）会**静默丢内容**，比漏裁危险一个量级；D 与 B2 不互斥，可作未来「彻底不裁剪」路线的备选。

**关键前提**：真实上游 6 个 SKILL.md 围栏数为 **0**（`grep -c '^```'` = 0），所以该缺陷在上游当前潜伏不发作 —— 但用户可通过公开配置 `config.skillDir` 指向自带代码示例的正文，一踩就中。B2 的残留局限要写进实现注释：仍靠正文形状识别，作者换形状只会漏裁（多保留），不会误删。

### 假设 B：真 Cordis 组合测试 —— 成立，且踩到三个宿主契约坑

`new Context()` + `await ctx.plugin(SkillRegistry)` + `ctx.skills.registerProvider(factory)` 在本机 0.2.2-rc.1 真包上跑通，无 mock。

三个必须写进实现契约的实测结果：

1. **provider 工厂的 `get(candidate, options)` 收到的是 candidate 对象，不是技能名字符串。** 写成 `get(name)` 会抛 `TypeError: loaded skill name must be a string`（`dsh-skill/lib/index.js:480` `validateDefinition`）。candidate 形如 `{name, description, source, provider, rank, invocation, locator}`，取值走 `candidate.name` / `candidate.locator.path`。`options` 实测为 `{}`。
2. **`ctx.skills.list()` 只暴露 `name, description, invocation, source, provider`** —— `toSummary` 会剥掉 `rank` 与 `locator`，所以列表侧拿不到正文路径，必须靠 `get` 再取。
3. **provider disposer 真的清缓存并摘目录**：`const d = ctx.skills.registerProvider(...)` → `await Promise.resolve(d())` 之后 `list().length` 从 6 变 0。`agent/disposed` 的清理可以直接依赖它，不需要自己维护反注册表。

### 对下游票的直接影响

- **#07**：围栏过滤按 B2 实现；单测直接搬 4 条夹具 + 17 条形状变体。
- **#10**：provider 的 `get` 签名按 candidate 对象写；注销走 disposer。
- **#03**：组合测试骨架已在真宿主上跑通，可直接进 CI（注意标注「本机宿主被 dshpurge 打过补丁」这一运行环境前提）。

### 复现命令

```bash
node /tmp/ponytail-proto/run-fixtures.mjs      # 30 PASS / 0 FAIL
node /tmp/ponytail-proto/run-comparison.mjs    # 17 条形状变体三方案对照
node /tmp/ponytail-proto/probe-six2.mjs        # 六技能进目录 + get 契约
node /tmp/ponytail-proto/probe-dispose.mjs     # disposer 清目录
```

## Answer

围栏感知过滤选定 B2（17/17 形状正确、围栏零误删、真实正文零回归、40+27 行零依赖实现）；真 Cordis 组合测试在 0.2.2-rc.1 真包上跑通，实测固化 provider.get 收 candidate、list 剥 rank/locator、disposer 清目录三条契约。

## 进度
