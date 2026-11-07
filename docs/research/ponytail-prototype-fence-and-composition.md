# 原型验证：围栏感知提示词过滤 + 真 Cordis 组合测试骨架

> **本目录笔记关系**
> - `upstream-ponytail-source-audit.md`（机制层审计）：给缺陷定级，本文的 H-06（过滤函数靠正则猜结构）与 3.2 节（测试质量）是本文两个假设的起点。
> - `ponytail-plugin-contract-0.2.2.md`（宿主契约调查）：给 API 现状，本文第 4 章是它的行为级补证。
> - 本文：把两个假设做成可执行原型，给出**实测数字**而不只是判断。

> 对象：原型代码 `/tmp/ponytail-proto`（零外部依赖，Node v22.22.3）；上游样本 `/tmp/dsh-ponytail-upstream`（commit `7223820`，v5.6.2）；宿主 `/Applications/DeepSeek Harness.app/.../@deepseek-ai/`（0.2.2-rc.1，`cordis@4.1.0`）。
> 方法：状态机与四方案各自实现为独立模块（`src/*.mjs`，合计 189 行），用 4 条夹具 + 17 条形状漂移变体 + 4 条标记漂移变体 + 1 份真实正文量化；组合测试用宿主真实包 `new Context()` 起两轮生命周期。
> 一键复跑：`cd /tmp/ponytail-proto && sh run-all.sh`。本文所有数字均由该脚本或其子命令产出，无估算。
> 环境前提：本机 60 个 `*.dshpurge.bak` 补丁中，`cordis` 与 `dsh-skill` **零补丁**（结论可外推），`dsh-system-prompt` 4 处、`dsh-settings` 3 处有补丁（相关结论已标注依赖）。

## 摘要

两个假设都成立，但都推翻了票面的一半前提。假设 A：上游 `filterSkillBodyForMode` 的误删是真的，4 条夹具里 A 误删围栏内 14 行、围栏感知版误删 0 行，真实正文零回归——**且该缺陷当前是纯潜伏**（6 个技能 15 条形状行无一条在围栏内，实测）。但围栏只是半个问题：A 与 B 在 17 条形状漂移变体上都只对 12 条（29.4% 漏裁），放宽形状识别（B2）才到 17/17。假设 B：真 Cordis 组合测试**可以纯 Node 跑**（11 项断言全过），代价是必须先固化 5 条宿主契约；最有价值的发现是**漏写 `inject` 时的危险不对称**——属性读路径静默不注册、`ctx.get` 路径却照常注册，两者 `fiber.error` 都是 `null`，只断言「没报错」的测试会全盘漏掉。上游 113 个用例里 20 次 `apply()` 全部打在 19 个对象字面量桩上，只有子模块 `PonytailRemote` 有 2 次真 `ctx.plugin()`。附带查实：`createSinkFor` 的「有 settings 走官方路径」在 0.2.2 上是**不可达分支**。

---

## 一、假设 A：围栏感知的模式过滤

### 1.1 上游行为逐字复刻

`src/ponytail-instructions.ts:6-26` 的判定只有两条正则，作用于**行的文本形状**：

| 形状 | 正则 | 位置 |
|---|---|---|
| 表格行首列加粗 | `/^\|\s*\*\*(.+?)\*\*\s*\|/` | `:12` |
| 列表项 mode 名 | `/^-\s*([^:]+)(?::\|:|：)\s*["「]/` | `:18`（`:17` 注释说明为兼容中文「」与中文冒号） |

命中即 `return labelMode === effectiveMode`，未命中 `return true`；`effectiveMode` 由 `src/ponytail-config.ts:32-37` 的 `normalizeMode` 白名单归一，`DEFAULT_MODE='full'`（`:28`）。
调用点唯一：`src/ponytail-instructions.ts:85`，读盘 `:84`，路径由 `:66-68` `getMainSkillPath` 硬编码为 `join(skillDir,'ponytail','SKILL.md')`。

> 票面写作 `/^\|\s*\*\*([^*]+)\*\*\s*\*/` 与 `(["「])`，与源码有出入；本文与实现一律以源码的 `(.+?)` / `(?:：|:)` 为准。

复刻件：`src/variant-a-text-shape.mjs`（24 行）、`src/mode.mjs`（9 行）。

### 1.2 FENCE 状态机规则

`src/fence.mjs`（40 行）只回答「哪些行在围栏内」，不参与裁剪。规则对齐 CommonMark 0.31 §4.5：

| # | 规则 | 实现判据 | 反例（必须判为非边界） |
|---|---|---|---|
| 1 | 开围栏 = ≤3 空格缩进 + ≥3 个 ```` 或 `~~~` | `/^ {0,3}(`{3,}|~{3,})(.*)$/` | 4 空格缩进是缩进代码块，不是围栏 |
| 2 | 反引号围栏的 info string 不得含反引号 | `!(m[1][0]==='`' && m[2].includes('`'))` | `\`\`\` a\`b` 不是开围栏；`~~~` 围栏允许 info 含反引号 |
| 3 | 闭围栏必须与开围栏同字符 | `m[1][0]===open.char` | `~~~` 不能闭合 ```` |
| 4 | 闭围栏长度 ≥ 开围栏长度 | `m[1].length>=open.len` | 4 反引号围栏内的三反引号行是内容 |
| 5 | 闭围栏行尾只允许空白 | `/[ \t]*$/` | `\`\`\` 后面跟文字` 不是闭合 |
| 6 | 未闭合 → 其后到文末一律围栏内 | 状态机保持 `inFence=true` | — |

`node --test fence.test.mjs` → **`# tests 11 / # pass 11 / # fail 0`**。11 条断言逐条覆盖上表，另加「连续两段围栏之间在围栏外」「CRLF 输入不破坏判定」。

### 1.3 四条夹具的 before/after

命令：`cd /tmp/ponytail-proto && node run-fixtures.mjs` → **`PASS 30 / FAIL 0`**。
下表「行数」为 `split(/\r?\n/)` 后长度（文件末尾有换行，故比 `wc -l` 多 1）。

| 夹具 | 原文行 | A 出 | A 删 | A 围栏内误删 | B 出 | B 删 | B 围栏内误删 | 断言 |
|---|---|---|---|---|---|---|---|---|
| F1 `fixture1-fence-preserve.md` | 34 | 26 | 8 | **4** | 30 | 4 | **0** | F1.1–F1.6 |
| F2 `fixture2-outside-filtered.md` | 19 | 15 | 4 | 0 | 15 | 4 | 0 | F2.1–F2.5 |
| F3 `fixture3-unclosed-fence.md` | 16 | 11 | 5 | **4** | 15 | 1 | **0** | F3.1–F3.5b |
| F4 `fixture4-nested-lengths.md` | 32 | 24 | 8 | **6** | 30 | 2 | **0** | F4.1–F4.7b |

四条夹具覆盖票面要求的四个面：①围栏内 mode 形状行必须保留（F1）②围栏外非目标 mode 行仍被裁（F2，**A 与 B 输出逐字节相同**，证 B 不是少裁而是该裁的照裁）③未闭合围栏（F3，`fenceStats.unclosed=1`）④嵌套不同长度（F4，`opens=2 closes=2`，内层三反引号因长度不足不计边界）。

F1 里 A 误删的原文行（`fixtures/fixture1-fence-preserve.md`）：

| 行号 | 原文 | 位置 |
|---|---|---|
| :17 | `\| **full** \| 围栏内表格行，必须保留 \|` | ````markdown 围栏内（:13 开） |
| :18 | `\| **ultra** \| 围栏内表格行，必须保留 \|` | 同上 |
| :25 | `- full: "围栏内列表行，必须保留"` | ```` 围栏内（:23 开） |
| :26 | `- ultra: "围栏内列表行，必须保留"` | 同上 |

### 1.4 真实正文零回归，且缺陷是**潜伏**的

`node run-real-regression.mjs` → **ALL PASS**：

| 检查 | 结果 | 证据 |
|---|---|---|
| 上游主 `skills/ponytail/SKILL.md` 围栏统计 | `{"opens":0,"closes":0,"inFence":0}` | 同脚本末行输出 |
| mode=lite/full/ultra 三档 A 与 B 输出 | **逐字节相同**（各保留 98 行，其中 mode 形状行 2 条） | `RG.lite.*` / `RG.full.*` / `RG.ultra.*` 全 PASS |
| B2 删除集 ⊆ A 删除集 | 成立，不引入新裁剪 | `RG.*.3 ALL PASS` |

`node run-blast-radius.mjs` 给出 6 个技能的爆发面：

| 技能 | 行数（去 frontmatter） | 围栏 开/闭 | 形状行 | 其中围栏内 | 归一后有效模式名 |
|---|---|---|---|---|---|
| `ponytail` | 102 | 0/0 | 6 | **0** | 6 |
| `ponytail-audit` | 31 | 0/0 | 0 | 0 | 0 |
| `ponytail-debt` | 35 | 0/0 | 0 | 0 | 0 |
| `ponytail-gain` | 41 | 1/1 | 0 | 0 | 0 |
| `ponytail-help` | 74 | 3/3 | 9 | **0** | 3 |
| `ponytail-review` | 46 | 0/0 | 0 | 0 | 0 |
| **合计** | | | **15** | **0** | 9 |

**15 条形状行无一条在围栏内** → 误删缺陷在生产路径上不触发，只是潜伏。但把 filter 扩到 `ponytail-help`
（唯一既有形状行又有围栏的技能）就会立刻误伤——A 在 lite 档删掉档位说明表两行：

| mode | A 删除的行 |
|---|---|
| lite | `\| **Full** \| \`/ponytail\` \| ...`、`\| **Ultra** \| \`/ponytail ultra\` \| ...` |
| full | `\| **Lite** \| ...`、`\| **Ultra** \| ...` |
| ultra | `\| **Lite** \| ...`、`\| **Full** \| ...` |

即「档位说明表被裁成只剩当前档一行」。这条路径当前关着，靠的是 `src/ponytail-instructions.ts:66-68` 硬编码单文件。

**小计：围栏误删是真的，修它零风险（真实正文零回归），但不修它也暂时不炸——真正会炸的是形状识别，见 1.5。**

### 1.5 围栏只是半个问题：17 条形状漂移变体

`node run-comparison.mjs` 用 17 条合成变体验证「形状判定正确率」，V01–V09 是上游已覆盖的写法，V10–V14 是合理但不被覆盖的写法，V15–V17 是必须保留的：

| 变体 | 内容 | 期望 | A | B | B2 | C |
|---|---|---|---|---|---|---|
| V01–V05 | 标准表格行 / 大小写 / 内部空格 / 前后空格 / 竖线紧贴 | drop | drop | drop | drop | drop |
| V06–V09 | 标准列表 / 中文冒号引号 / 大小写 / 多空格 | drop | drop | drop | drop | drop |
| V10 | `* full: "..."` 星号 bullet | drop | **keep** | **keep** | drop | drop |
| V11 | `  - full: "..."` 两空格缩进 | drop | **keep** | **keep** | drop | drop |
| V12 | `- full (default): "..."` 括号注释 | drop | **keep** | **keep** | drop | drop |
| V13 | `- **full**: "..."` 加粗模式名 | drop | **keep** | **keep** | drop | drop |
| V14 | `1. full: "..."` 有序列表 | drop | **keep** | **keep** | drop | drop |
| V15–V17 | 目标档表格 / 列表 / 围栏内目标档 | keep | keep | keep | keep | keep |

| 方案 | 正确率 | 错误率 | 错项性质 |
|---|---|---|---|
| A 上游 | 12/17 | 29.4% | V10–V14，**全部漏裁**（该删没删） |
| B 围栏感知 | 12/17 | 29.4% | 同 A（B 只加围栏保护） |
| **B2 围栏感知 + 放宽形状** | **17/17** | **0%** | 无 |
| C 显式标记 | 17/17 | 0% | 无（另有专属漂移面，见 2.3） |

B2 的放宽点（`src/variant-b2-fence-loose.mjs:10-11`）：表格 `/^\s*\|\s*\*\*(.+?)\*\*\s*\|/`（去掉行首锚定）；
列表 `/^\s*(?:[-*+]|\d+[.)])\s+(?:\*\*)?([^:*()\n]+?)(?:\*\*)?\s*(?:\([^)\n]*\))?\s*(?::|：)\s*["「]/`，覆盖缩进、星号/加号/有序 bullet、加粗模式名、括号注释四种漂移。

**小计：漏裁（结构行被当正文保留）比误删更难发现——它不报错、只是让模型多读几行；而误删会让说明表缺档。两个方向都要治，只修围栏等于修了一半。**

---

## 二、三方案取舍：形状过滤 / 显式标记 / 显式分档文件

这一章直接服务地图的 **Not yet specified**：「保留按文本形状过滤，还是改显式分档文件或显式标记区块？」

### 2.1 实现成本（`wc -l` 实测）

| 方案 | 文件 | 行数 | 是否需 FENCE 状态机 |
|---|---|---|---|
| A 文本形状 | `src/variant-a-text-shape.mjs` | 24 | 否 |
| B 围栏感知 | `src/fence.mjs` 40 + `variant-b` 27 + `mode.mjs` 9 | 76 | 是 |
| B2 围栏感知 + 放宽形状 | 同 B，`variant-b2` 29 替 `variant-b` | 78 | 是 |
| C 显式标记 | `src/variant-c-explicit-markers.mjs` | 42 | 否 |
| D 分档文件 | `src/variant-d-tier-files.mjs` | 18 | 否 |

B2 只比 B 多 2 行，比 A 多 54 行。C 比 B2 少 36 行（不需要状态机），D 最少。

### 2.2 对正文作者的约束（真实 `skills/ponytail/SKILL.md`：去 frontmatter 102 行、非空 77 行、mode 形状行 6 条 = 表格 3 + 列表 3）

| 方案 | 正文改动 | 行数变化 | 结构性代价 |
|---|---|---|---|
| A / B / B2 | **0 行** | 102 → 102 | 无 |
| C 逐行包裹 | 插 12 行标记 | 102 → 114（**+11.8%**） | 无 |
| C 整块包裹 | 插 6 行标记 + 3 行小标题 | 102 → 111 | `\| Level \| What change \|` 表须拆成三张单行表 = **结构性重写** |
| D 分档文件 | 拆 3 份 | 102 × 3 = **306** | 任一规则改动需 3 处同步 |

### 2.3 腐化风险

| 方案 | 形状/标记漂移正确率 | 失效方向 | 具体失效模式 |
|---|---|---|---|
| A | 12/17 | 单向**漏裁** | V10–V14 五类合理写法被当正文保留 |
| B | 12/17 | 同 A | 同上 |
| **B2** | **17/17** | 仍依赖正则猜形状 | 正则之外的写法（如表格首列用行内代码而非加粗）仍会漏 |
| C | 17/17 | **双向**：漏裁 + **整篇裁空** | 见下表 |
| D | 不适用 | 三份文件内容漂移 | 无形状风险，风险转为「改了一处忘两处」 |

C 的专属漂移面（`node run-comparison.mjs` 实测输出）：

| 变体 | 输入 | 输出 | 后果 |
|---|---|---|---|
| C01 | `<!-- ponytail:LITE -->` | 生效（`normalizeMode` 归一） | 大小写不构成保护，作者会误判 |
| C02 | 漏写闭合标记 | **`[]`** | **整篇被裁空**——比漏裁严重一个量级 |
| C03 | 标记拼错 `ponytal:full` | 整块当普通文本保留 | 漏裁 |
| C04 | 开始 `lite`、闭合 `full` | 范围错位 | 目标内容保留但边界错乱 |

### 2.4 结论（可直接支撑 Not yet specified 的裁决）

| 判据 | A | B | **B2** | C | D |
|---|---|---|---|---|---|
| 围栏误删 | ❌ 4/4 夹具误删 | ✅ 0 | ✅ 0 | ✅ 0 | ✅ 0 |
| 形状漏裁（17 变体） | ❌ 5 | ❌ 5 | ✅ 0 | ✅ 0 | 不适用 |
| 正文改动 | ✅ 0 行 | ✅ 0 行 | ✅ 0 行 | ❌ +12 行 | ❌ ×3 |
| 最坏失效 | 误删 | 误删 | 漏裁 | **整篇裁空** | 内容漂移 |
| 实现成本 | 24 行 | 76 行 | 78 行 | 42 行 | 18 行 |

**选 B2**：围栏零误删 + 形状零漏裁 + 正文零改动，78 行零依赖。
**暂不选 C**：它相对 B2 的唯一收益是「不靠正则猜形状」，代价是正文 +11.8% 标记，并新增一类
「标记写漏就整篇裁空」的故障（C02 实测输出 `[]`）。等 B2 的形状误判在真实编辑中真的触发过一次，
再用那时的真实漂移样本评估 C。
**暂不选 D**：把一个 102 行的文件变成 306 行三份，作者负担直接 ×3；D 与 B2 不互斥，将来若真要做
「按档位彻底不同」，应是构建期从单一源生成三份，而不是手维护三份。

---

## 三、假设 B：真 Cordis 组合测试骨架

### 3.1 可行性：能跑

```
$ cd /tmp/ponytail-proto && node --test composition.test.mjs
ok 1 - ① section 注册成功：进 assemble 结果，位置在 persona 前后缀之间
ok 2 - ①b order 真的决定排序：order 更小的插件段排到 ponytail 之前
ok 3 - ② 6 个技能全部进 catalog，get() 能取回正文
ok 4 - ③ fiber.dispose() 后 section 与 catalog 全清空，宿主服务仍在
ok 5 - ④ 无 settings 服务时不抛错，插件照常挂载
ok 6 - ④b 对照组：settings 服务存在时取到它，插件行为不变
ok 7 - ⑤ 无 inject 时属性读抛错、ctx.get 静默返回 undefined（必须在插件 fiber 内观测）
ok 8 - ⑥ 漏写 inject 的插件：属性读路径静默不注册；ctx.get 路径却能注册（危险的不对称）
ok 9 - ⑦ 重复挂载同名 section：第二个 ctx.plugin() 直接 reject
ok 10 - ⑧ Config 用 schemastery 校验：非法类型被拒绝，覆写项生效
ok 11 - ⑨ 整套生命周期可重复：连起两轮不残留（验证 dispose 彻底性）
# tests 11
# pass 11
# fail 0
# duration_ms 2116.4
```

骨架（`composition.test.mjs`）：

```js
const ctx = new Context()
await ctx.plugin(SystemPrompt)   // @deepseek-ai/dsh-system-prompt → ctx.systemPrompt
await ctx.plugin(SkillRegistry)  // @deepseek-ai/dsh-skill        → ctx.skills
const fiber = await ctx.plugin(stubPlugin, { promptSectionName: 'ponytail' })
// 断言 section / catalog / settings 缺失 / dispose
await fiber.dispose()            // 只拆本插件；根清理用 ctx.fiber.dispose()
```

票面四项要求逐条落实：① section 注册 = `ok 1`+`ok 2`；② 6 技能进 catalog = `ok 3`；
③ dispose 后全清空 = `ok 4`+`ok 11`；④ 无 settings 不抛错 = `ok 5`+`ok 6`（对照）。

宿主模块解析唯一入口 `lib/cordis.mjs`（26 行）：路径含空格，必须 `pathToFileURL`，默认
`DSH_MODULES=/Applications/DeepSeek Harness.app/Contents/Resources/app/dsh/node_modules/@deepseek-ai`，可用环境变量覆写。

### 3.2 必须固化的五条宿主契约（每条都是踩出来的）

| # | 契约 | 证据（file:line / 实测报错） | 不遵守的后果 |
|---|---|---|---|
| 1 | 插件 `Config` 必须是 schemastery，不能是普通对象 | `cordis/lib/index.js:244-249` `resolveConfig` 读 `runtime.Config['~standard'].validate(config)`；上游 `src/ponytail.ts:47` 正是 `Schema.object` | `TypeError: Cannot read properties of undefined (reading 'validate')`，8 个测试全灭 |
| 2 | `provider.get` 第一参数是 **candidate 对象**，不是 name 字符串 | `dsh-skill/lib/index.js:250-256` `get(name)` 内部 `match.provider.get(match.candidate, options)`；`:480` 校验 | `TypeError: loaded skill name must be a string`（`:480`） |
| 3 | `ctx.dispose` 不存在；根清理用 `ctx.fiber.dispose()`，单插件用 `fiber.dispose()` | 实测 `TypeError: ctx.dispose is not a function`；`ctx.fiber.dispose()` 后 `ctx.systemPrompt`/`ctx.skills` 均为 `undefined`、`fiber.state === 2` | 写 `ctx.dispose()` 直接崩 |
| 4 | `section()` / `registerProvider()` 内部已绑 effect，调用方不必再包 `ctx.effect` | `dsh-system-prompt/lib/index.js:255-258` `return this.layers.effect(...)`；`ok 4` 实证 | 上游 `src/ponytail.ts:370` 那种「丢弃返回值」写法清理成立，多包一层只是一种语义重复 |
| 5 | `getSectionOrder(name)` 只查内置常量表，自定义段名返回 `undefined` | `dsh-system-prompt/lib/index.js:264-266` + `:10` `SECTION_ORDERS` | 用它断言排序会假失败 |

另有一条观测量陷阱（非契约）：`assemble()` 返回的 section 元素只有 `{name, text}`，**不带 `order`**
（实测 `Object.keys = ['name','text']`），排序断言必须靠两段的相对位置（`ok 2` 就是这样做的）。

### 3.3 最有价值的发现：漏写 `inject` 的危险不对称

`ok 8` 实测：一个**没有声明 `inject`** 的插件里，两条读同一服务的路径结果相反：

| 路径 | 结果 | `fiber.error` |
|---|---|---|
| `ctx[key]`（属性读 + try/catch，即上游 `readService`，`src/ponytail.ts:100`） | **静默不注册**（`sections.has('via-prop') === false`） | `null` |
| `ctx.get(key, false)` | **注册成功**（`sections.has('via-get') === true`） | `null` |

含义：**只断言「插件没报错」的组合测试会漏掉前一种**。必须显式断言
`layers.global.sections.has(name) === true` 与 `skills.list().length === 6`。
根因在 `cordis/lib/index.js:1257`：属性读未 inject 的服务直接抛
`cannot get property "<name>" without inject`；被 try/catch 吞掉后就是「什么都没发生」。

这条也解释了上游 111 个用例为何没抓到任何接线问题——见 3.4。

### 3.4 上游测试面的真实构成（修正票面假设）

票面说「111 个 `node:test` 用例全是单模块直调，没有一次真的 `new Context()` + `ctx.plugin()`」。
实测更精确（`grep` 于 `/tmp/dsh-ponytail-upstream/scripts/behavior.test.mjs`）：

| 指标 | 实测值 | 命令 |
|---|---|---|
| `test(` 声明 | **113**（另有 `version.test.mjs` 3 条，合计 116） | `grep -cE '^test\(' scripts/*.mjs` |
| `new Context()` | **3** 处：`:1226`、`:1248`、`:1287` | `grep -n 'new Context()'` |
| 真 `await ctx.plugin(` | **2** 处：`:1228`、`:1249`，且**挂的是子模块 `PonytailRemote`，不是主插件** | `grep -nE '^\s+await ctx\.plugin\('` |
| `apply(ctx` 直调 | **20** 处 | `grep -cE '\bapply\(ctx'` |
| `const ctx = {` 对象字面量桩 | **19** 处（`:117/294/716/751/767/794/1026/1046/1067/1094/1116/1160/1201/1736/1854/1882/1923/2026/2065`） | `grep -cE '^  const ctx = \{'` |

准确表述：**主插件的 20 次 `apply()` 全部打在对象字面量桩上；只有远程子模块有 2 次真 `ctx.plugin()`。**

`:1287` 那个 `new Context()` 更值得注意：它先逐项属性赋值伪造宿主服务（`:1289-1293`），再 `apply(ctx, {})`：

```js
ctx.skills = { registerProvider: () => () => {} }
ctx.systemPrompt = { section: () => () => {} }
ctx.logger = { info: () => {}, warn: () => {}, debug: () => {} }
ctx.on = () => {}
ctx.effect = (setup) => { const r = setup(); return () => {} }
```

看起来像真 Context，实际是普通属性赋值。**实测这条伪造路径在真 cordis 上「看起来能跑」**（`probe/fake-inject.mjs`）：

```
声明 inject = false | apply 被调用 = true  | fiber.state = 2
声明 inject = true  | apply 被调用 = false | fiber.state = 0
```

即属性赋值伪造的服务对「不声明 inject」的插件有效，对「声明了 inject」的插件**完全无效**——`apply` 根本不被调用、
`fiber.state` 停在 `0`（等待依赖）。上游 `src/ponytail.ts:74` 明确声明
`export const inject = ['skills','systemPrompt'] as const`，所以 `:1287-1295` 这条测试测的是一份
**在真宿主上不存在的执行路径**：它断言「服务挂上了」，但真 Context 下 apply 压根没跑。

**小计：上游不是「没做组合测试」，而是「做了一个看起来像、实际绕过了 cordis 依赖系统的组合测试」。这比没有更危险——它给出了已覆盖的错觉。**

---

## 四、附带查实：`createSinkFor` 的 settings 通道在 0.2.2 上不可达

上游 `src/ponytail.ts:116-126` `createSinkFor` 用 `readService(ctx,'settings')`（属性读）做能力探测，
失败回退 `createFileSink`（`:124`）；`readService` 定义在 `:100`。而 `inject = ['skills','systemPrompt']`（`:74`）不含 `settings`。

用**真实的** `@deepseek-ai/dsh-settings` 包实测（`probe/real-settings.mjs`）：

```
dsh-settings 挂载 fiber.state = 2 | fiber.error = none
ctx.get("settings") = SettingsForms | mutate: function | describe: function
兄弟插件（inject 不含 settings）属性读  → THROW:cannot get property "settings" without inject
兄弟插件 ctx.get("settings", false)  → 拿到实例
→ 上游 createSinkFor 用属性读，结论： 回退文件通道
```

可达性矩阵（`probe/sink-fallback2.mjs`）：

| settings 由谁注册 | 插件 inject 含 settings | 属性读 | `ctx.get` |
|---|---|---|---|
| `ctx.provide`（root） | 否 | **可用** | 可用 |
| `ctx.provide`（root） | 是 | 可用 | 可用 |
| 兄弟插件（`Service` 子类） | 否 | **`undefined`**（且抛错被吞） | 可用 |
| 兄弟插件（`Service` 子类） | 是 | 可用 | 可用 |
| 无人注册 | 否 | `undefined` | `undefined` |

真实宿主里 `settings` 由 `dsh-settings` **插件**注册（`dsh-base/cordis.patch.yml:109-111` 是插件行；
`dsh-settings/lib/index.js:322-330` `class SettingsForms extends Service` + `super(ownerContext,'settings')`），
属上表第 3 行 → **属性读永远抛错、永远回退文件通道**。

后果链：

| # | 事实 | 证据 |
|---|---|---|
| 1 | `createSinkFor` 永远走 `createFileSink` | 上表 + `probe/real-settings.mjs` 末行 |
| 2 | 注释里「有 settings 服务时走官方路径：写入落到 profile 补丁」是**不可达分支** | `src/ponytail.ts:111-112` 注释 vs 实测 |
| 3 | `src/ponytail.ts:155` 的 `const settingsService = readService(ctx,'settings')` 永远 `undefined`，且该变量在全文件**只出现 1 次**（死变量） | `grep -c "settingsService" src/ponytail.ts` → 1 |
| 4 | 对照：`:166-177` 的 `hostLocalePreference` 写了 `ctx.get('settings', false)` 优先、属性读兜底，所以它能工作 | `src/ponytail.ts:167-178` |

第 4 条反证作者知道 `ctx.get` 是正确读法，只是 `createSinkFor`（`:116-126`）没有同步改。
修法一行：`readService(ctx,'settings')` → `ctx.get('settings', false)`。
**这条决定 v0.1 是否还要保留「settings 通道」这层抽象——如果永远走文件通道，那层包装就是纯负担。**

---

## 五、复现清单

| 验证 | 命令 | 期望输出 |
|---|---|---|
| 全部 | `cd /tmp/ponytail-proto && sh run-all.sh` | 各段 PASS/ALL PASS |
| 四夹具 | `node run-fixtures.mjs` | `PASS 30 / FAIL 0` |
| 四方案量化 | `node run-comparison.mjs` | 成本表 + 17 变体表 + C 的 4 条漂移 |
| 真实正文回归 | `node run-real-regression.mjs` | `ALL PASS`，围栏统计 `{0,0,0}` |
| 爆发面 | `node run-blast-radius.mjs` | 6 技能表 + 合计「围栏内 0」 |
| 围栏边界 | `node --test fence.test.mjs` | `# pass 11` |
| 组合测试 | `node --test composition.test.mjs` | `# pass 11` |
| settings 可达性 | `node probe/real-settings.mjs` | 末行「回退文件通道」 |

---

## 六、未核实项

| # | 项 | 为什么没核实 |
|---|---|---|
| 1 | 60 个 `*.dshpurge.bak` 补丁对官方 0.2.2 语义的影响 | `cordis`/`dsh-skill` **零补丁**（第 3 章契约可外推），但 `dsh-system-prompt` 4 处、`dsh-settings` 3 处有补丁，涉及 section text 过滤与 settings 事件；无法确认官方原版是否同行为 |
| 2 | npm 上 `@deepseek-ai/*` 0.2.2 原版 | 只查本机安装副本，未联网比对 `package.json` 与产物 |
| 3 | 真 `ponytail` 插件跑进本骨架 | 需先完成上游 12 模块 TS 构建与 skillDir 布局；本票只证明骨架可行，未做接线迁移 |
| 4 | B2 放宽正则在更长真实文本上的误裁 | 只跑 17 条合成漂移变体 + 6 个真实 SKILL.md，无大样本 |
| 5 | `ctx.fiber.dispose()` 与 DSH 真实 boot 流程的等价性 | 上游走 loader 的 fiber 树；本骨架只测根 fiber，未测 loader 管理的子树 |
| 6 | C 方案「整块包裹」对表格的实际改造代价 | 只做了行数量化（+6 标记 +3 标题），没有真写出一份可读的 SKILL.md |
| 7 | 上游 116 个用例整体是否可跑 | 上游无 `node_modules`，未安装依赖；测试面统计基于源码文本 |
