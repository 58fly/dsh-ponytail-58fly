<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-PARENT: 00 -->
<!-- DSH-LABELS: wayfinder:research -->
<!-- DSH-IDEMPOTENCY-KEY: deck-plan-ponytail-takeover-v1-child-R1 -->
<!-- DSH-CREATED: 2026-11-07T03:34:34.157Z -->
# 09: 核实 DSH 0.2.2 兼容性：PR #5 的字节级相同声明是否成立，peer 区间该怎么写

Type: research

Status: resolved
## Question

核实上游 PR #5 的兼容性声明，产出可以直接写进 `peerDependencies` 与矩阵 CI 的结论。

## 要回答的问题

1. **PR #5 的三条"逐字节相同"声明成立吗？** 它声称：
   - `@deepseek-ai/dsh-skill` 0.2.2 与 0.2.1-rc.2 的 `lib/index.js` 逐字节相同
   - `@deepseek-ai/dsh-typert-protocol` 同上
   - `schemastery` 3.19.0 与 3.18.4 逐字节相同
   我方要以自己跑出来的 `sha256sum` / `cmp` 结果为准，不能引用他人自述。
2. **0.2.2 相对 0.2.1 到底变了什么？** 对 `dsh-system-prompt`、`dsh-skill`、`dsh-settings`、`dsh-agent`、`dsh-typert-protocol`、`cordis` 逐个包做 `diff -r`（排除 `.dshpurge.bak`），列出会影响本插件扩展点的实际变更。
3. **`peerDependencies` 区间该怎么写？** 现有生态有四种姿势：硬钉 alpha（@maci0）、钉小版本（@kb1slnlabs ~4.0.5/~3.18.5）、宽区间（@mengyuly >=0.0.1-rc <2）、自 bundle 内联（@mengyuly）。给出一个"既不误判不兼容、又不放过真破坏"的区间，并说明为什么。
4. **`engines.dsh` 与 peer 是不是两道闸？** 复核宿主判定只读 `engines` + `peerDependencies`（`dsh-plugin-manager/lib/index.js:491/513-514/1479/1493-1494`），确认放宽哪一道才真正生效。

## 硬约束

- 必须在**干净**宿主上验证。本机 `@deepseek-ai/` 下有 60 个 `*.dshpurge.bak`（`dsh-system-prompt/lib/index.js:230` 现行 `includeHarnessIdentity ?? false`，备份是 `?? true`），本机行为不能外推。
- 结论写入 `docs/research/`，沿用仓内现有笔记的体例；只记路径与一句话结论回填本票，不贴全文。

## 验收

- 每条"相同/不同"都有可复现命令与输出摘要。
- 给出一个候选 `engines.dsh` + peer 区间，并列出它覆盖与不覆盖的宿主版本。

## Comments

### local — 2026-11-07T04:31:21.088Z

### local — 2026-11-07T04:53:24.666Z
**票面第 3 题的推荐已过期（2026-11-07 修正）**：本票结论里的 `engines.dsh: ">=0.2.0-rc.1 <0.3.0-0"` 已作废。用宿主自带 semver 7.8.6 复测（`includePrerelease: true`）：`<0.3.0-0` 会放行 `0.2.3-0` / `0.2.3-rc.1` / `0.2.3`，而 `<0.2.3-0` 对 0.2.3 全系列拒绝、且与 `<=0.2.2` 逐格等价（0.2.0-rc.1 至 0.2.2-rc.9 全部 PASS）。判据 1 要求「区间与真实宿主矩阵 CI 一致」，而 CI 只覆盖到 0.2.2 系列，故最终定 `>=0.2.0-rc.1 <0.2.3-0`，不声明未验证的 0.2.3。其余结论（prerelease 语义、engines.dsh 独占优先、0.2.2 无破坏性变更、order 50 落第 3 槽）不变。
## 结论

四条全部实测完毕，**PR #5 的三条「逐字节相同」声明全部成立**，但它把包名写错了一个（是 `@deepseek-ai/schemastery`，npm 上的 `schemastery` 最高只到 3.18.0，没有 3.18.4/3.19.0）。另外票面第 4 问的表述要纠正：`engines.dsh` 与 peer **不是两道闸，是二选一**。

### 1. 三条「逐字节相同」声明：全部成立

用 `npm pack` 拉真包，取包内 `lib/index.js` 算 sha256：

| 包 | 0.2.1-rc.2 | 0.2.2-rc.1 | 判定 |
|---|---|---|---|
| `@deepseek-ai/dsh-skill` | `4b88621be4e7ff09b05c175fc6dcb67e77a22e5c5570e3aa603338b2937ea791` (23721 B) | 同左 | **完全相同** |
| `@deepseek-ai/dsh-typert-protocol` | `8d48ddbb4bbc62585ce5a4d3a7f53b39f55581b5320c1cae681766edd15ff8af` (19373 B) | 同左 | **完全相同** |
| `@deepseek-ai/schemastery` 3.18.4 vs 3.19.0 | `index.cjs` = `aca1c1a47c7b6034feee01501aefca3e6dd97a0bac4fe334fd30647ae5a9e480`，`index.mjs` = `cfcbe46c7416bdb35ce891c252152bbf519e08199bede5930dd7cb880c65f1ef` | 两个文件均同左 | **完全相同** |

复现：

```bash
cd /tmp/pkcheck
for v in 0.2.1-rc.2 0.2.2-rc.1; do
  for p in dsh-skill dsh-typert-protocol; do npm pack "@deepseek-ai/${p}@${v}" --silent; done
done
for f in deepseek-ai-dsh-{skill,typert-protocol}-*.tgz; do
  d=$(mktemp -d); tar -xzf "$f" -C "$d"
  shasum -a 256 "$d/package/lib/index.js"; rm -rf "$d"
done
for v in 3.18.4 3.19.0; do npm pack "@deepseek-ai/schemastery@${v}" --silent; done
# 解包后分别对 index.cjs / index.mjs 算 sha256
```

**这条结论对我们直接有用**：`skills.registerProvider` 与 `TypertRemoteService`/`@Remote` 这两条契约在 0.2.1→0.2.2 之间零漂移，我们的 provider 与远程通道**不需要写版本分支**。

### 2. 0.2.2 相对 0.2.1 到底变了什么（对本插件有影响的）

逐包 `diff -rq` + `diff -u`（排除 `.dshpurge.bak`）：

**`dsh-system-prompt`（19817 → 19994 B，有变更）**
- `SECTION_ORDERS` 新增两个键：`TOOL_APPLY_PATCH: 1350`（插在 `TOOL_EDIT: 1300` 与 `TOOL_GLOB: 1400` 之间）、`TOOL_SCHEDULE: 2500`（插在 `TOOL_GOAL: 2400` 与 `TOOL_WORKFLOW: 2600` 之间）。**`ponytail` 的 `order: 50` 位置不受影响**（50 远在 `TOOL_*` 段之前）。
- `assemble()` 语义变更：新增 `system-prompt/assemble` waterfall，且 **`tools` 改为 provider 自有、不再被 waterfall 返回值覆盖**：

```js
const tools = orderTools(collected, this.toolOrder, knownNames);
const transformed = await this.ctx.waterfall(scopeTarget(this, scope), "system-prompt/assemble", assembly, context, () => Promise.resolve(assembly));
if (completeSection === void 0 && !runtimeContextSuppressed) return { ...transformed, tools };
```

  → 对我们的意义：**不要试图在 waterfall 里改 `tools`**，改了也会被还原。我们只改 `sections`，本来也只改 sections，无影响。但这个 waterfall 是新的扩展点，可用于「不重启就换 section 文本」——与我们的 baseline 锁策略冲突，明确不用。

**`dsh-settings`（22636 → 22665 B，有变更，3 处）**
- `configure(presentation, owner)` 内部从 `owner` 改为 `owner.ctx.fiber`；
- `autoGenerate` 查表从 `this.presentations.get(entry.fiber)` 改为 `get(entry.fiber.ctx.fiber)`；
- `projectForm(form, plainConfig(entry.fiber.config))` 改为 `plainConfig(entry.fiber.effectiveConfig)`。

  → **第 3 条是真行为变更**：0.2.1 下 `value` 来自 `fiber.config`（原始声明值），0.2.2 来自 `effectiveConfig`（合并了 patch 与默认值）。这意味着 `describe()` 返回的 `value` 在 0.2.2 更"完整"，我们不需要自己再叠默认值。配合 #04 已记的「远程 `settings/mutate` 返回扁平 namespaceView」一起看：**0.2.2 的 settings 面比 0.2.1 更自洽，B-02 的宿主侧修复面因此缩小到"重新 describe"一步。**

**`dsh-agent`（28257 → 32197 B，+14%，变更最大但对我们无影响）**
- 新增 `lib/types/projection.js`（`turnBoundary` 投影，`stateVersion: 2`）、`lib/types/model-selection.js`（`toSelection(provider, model, reasoningEffort)`）；
- 新增 `@deepseek-ai/dsh-brand` 与 `zod` 依赖，`sessionSeqSchema = z.number().int().nonnegative().transform(brandNumber)`。

  → 这些是宿主内部的状态投影与模型选择重构，**`agent/pre-step` 与 `agent/created` 签名未变**（已在本机实测 payload 形状：`{ agent, messages, signal, step, modelSelection }`，无 `sessionId`）。

**零变更的**：`dsh-skill`、`dsh-typert-protocol`（见上）、`@deepseek-ai/schemastery`（见上）。

### 3. `peerDependencies` 区间：候选 `engines.dsh: ">=0.2.0-rc.1 <0.3.0-0"`

实测 `semver.satisfies(v, range, { includePrerelease: true })`（宿主就是这么调的，`dsh-app-boot/lib/index.js:1095`）：

| 区间 | 0.2.0-rc.1 | 0.2.1 | 0.2.1-rc.5 | 0.2.2-alpha.2 | 0.2.2-rc.1 | 0.3.0-rc.1 | 0.3.0 |
|---|---|---|---|---|---|---|---|
| `>=0.2.0-rc.1 <=0.2.1`（上游现用） | Y | Y | Y | **n** | **n** | n | n |
| `>=0.2.0-rc.1 <0.3.0` | Y | Y | Y | Y | Y | **Y** | n |
| **`>=0.2.0-rc.1 <0.3.0-0`** ← 推荐 | Y | Y | Y | Y | Y | **n** | n |
| `^0.2.0-rc.1` | Y | Y | Y | Y | Y | n | n |
| `>=0.2.0-rc.1`（无上限） | Y | Y | Y | Y | Y | Y | Y |

**为什么是 `<0.3.0-0` 而不是 `<0.3.0`**：`includePrerelease: true` 下 `<0.3.0` 会把 `0.3.0-rc.1` 判为满足（上表实测），等于对下一个大版本的预发布**无条件放行**——而 0.3.0 正是最可能破坏 `systemPrompt.section` 或 `commands` 的地方。`<0.3.0-0` 是所有 `0.3.0-*` 预发布的下界之外，只放行 0.2.x 全系。

**为什么不钉 `<=0.2.2`**：0.2.3/0.2.4 的补丁版几乎必然兼容（`dsh-skill` 与 `dsh-typert-protocol` 在两个版本间零字节变化就是证据），钉死会让用户每次小版本升级都要等我们发版，重现上游 S0-1 的困局。

**为什么不写 `peerDependencies`**：见下条。

### 4. 票面第 4 问的表述要改：不是两道闸，是**二选一**

`dsh-app-boot/lib/index.js` `unmetRequirements()`：

```js
if (Object.hasOwn(engines, "dsh")) {
  const range = engines.dsh;
  if (typeof range !== "string") throw new Error("Plugin manifest engines.dsh must be a string");
  return satisfies(runtimeVersion, range) ? {} : { "engines.dsh": range };   // ← 直接返回，peer 永不检查
}
if (!Object.hasOwn(fields, "peerDependencies")) return {};
// 只有没有 engines.dsh 时才走 peer 检查
```

**`engines.dsh` 一旦存在，`peerDependencies` 里的 dsh 相关项被完全忽略。** 所以：

- 想放宽 → 改 `engines.dsh`，改 peer 没用；
- 想两道都卡 → 做不到（宿主不给你两道）；
- `peerDependencies` 只用来表达「需要宿主提供 `@deepseek-ai/cordis` / `dsh-llm` 等运行时注入的包」，**不要在里面写 `@deepseek-ai/dsh`**，写了也不生效，只会误导读者。

推荐的清单写法：

```json
{
  "engines": { "dsh": ">=0.2.0-rc.1 <0.3.0-0" },
  "peerDependencies": {
    "@deepseek-ai/cordis": "~4.1.0"
  }
}
```

### 5. 区间放宽后必须配套的运行时能力探测

区间放到 0.2.0 意味着**可能跑在没有 `commands` 服务的宿主上**（`@deepseek-ai/dsh-commands` 在 0.2.1-alpha.3 才出现，见 npm 版本列表）。所以：

- `inject` 里**不要硬写 `'commands'`**，否则 0.2.0 宿主上整个插件不激活；
- 用 `ctx.inject(['commands'], (scope) => scope.commands.register(...))` 注册斜杠命令，缺失时自动跳过，退回「只读 `settings.defaultMode`」；
- 这正好与 #12 的结论合流：**可降级必须靠运行时 `ctx.inject` 写，不能靠清单声明。**

### 6. 未核实项

1. 0.2.2 之后是否还有 0.2.3+（本次取样止于 2026-11-07 的 npm registry）。
2. `@deepseek-ai/dsh-commands` 在 0.2.0-rc.1 / 0.2.1-rc.1 上是否真的不存在——只看了 npm 版本列表，未逐版解包确认 `register` 是否存在。
3. 本机 60 个 `*.dshpurge.bak` 补丁对 `dsh-system-prompt` / `dsh-settings` 的影响：本次 diff 用的是 **npm 原版 tarball**（干净），结论可外推；但本机运行时行为仍是打过补丁的版本。

## Answer

三条字节级相同声明全部成立（dsh-skill / dsh-typert-protocol lib/index.js sha256 完全相同；@deepseek-ai/schemastery 3.18.4 与 3.19.0 的 index.cjs/index.mjs 也完全相同，注意是 @deepseek-ai 前缀而非裸 schemastery）。0.2.2 实际变更：system-prompt 加 TOOL_APPLY_PATCH/TOOL_SCHEDULE 且 tools 改为 provider-owned、settings 的 value 改从 effectiveConfig 投影、agent 加 turnBoundary 投影与 model-selection（对插件无影响）。推荐 engines.dsh = ">=0.2.0-rc.1 <0.3.0-0"（<0.3.0 在 includePrerelease 下会放行 0.3.0-rc.1）。engines.dsh 存在时 peerDependencies 被完全忽略，是二选一不是两道闸。区间放宽后 commands 必须走 ctx.inject 可降级。

## 进度
