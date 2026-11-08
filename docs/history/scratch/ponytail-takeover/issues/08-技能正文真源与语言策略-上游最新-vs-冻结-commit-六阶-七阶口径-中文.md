<!-- DSH-FORMAT: md-v1 -->
<!-- DSH-PARENT: 00 -->
<!-- DSH-LABELS: wayfinder:research -->
<!-- DSH-IDEMPOTENCY-KEY: deck-plan-ponytail-takeover-v1-child-R2 -->
<!-- DSH-CREATED: 2026-11-07T03:34:34.157Z -->
# 08: 技能正文真源与语言策略：上游最新 vs 冻结 commit、六阶/七阶口径、中文改写边界

Type: research

Status: resolved
## Question

确定技能正文的真源、语言与口径，避免"移植型插件"最常见的隐性腐化。

## 要回答的问题

1. **跟随上游最新还是冻结 commit？** DietrichGebert/ponytail 2026-10-29 仍在 push（v5.3.3）。上游规则文本变了不会通过版本号通知我们。给出策略：冻结 + 定期 diff，还是 CI 每日 sync 报警？并说明如何验证"没漏掉变更"。
2. **6 个 SKILL.md 的中文化边界在哪？** 现状：Wenaixi 版把技能正文做了中文改写，描述走 `descriptions.{zh,en}.json` 双语，但**正文是中文**；@gongyijie85 是上游英文逐字。要定：正文中文 / 英文 / 双语双套（成本翻倍）？触发词（description 里的英文关键词）在中文正文下会不会失效？
3. **`descriptions.*.json` 的 500 字符上限怎么守？** 官方 `dsh-tool-skill` 的 `catalogDescriptionMaxLength` 默认 500（`dsh-tool-skill/lib/index.js:52`），超长会被截断成 `...` 导致触发词丢失。核实这个上限在 0.2.2 是否仍为 500，并给出校验脚本口径。
4. **六阶还是七阶？** 上游 `.agents/rules/ponytail.md` 原文是六阶（标准库与平台原生合并为一条），"七阶"是社区本地化改写。定对外文案口径，并说明"忠实移植"这句话还能不能用。
5. **`disable-model-invocation` 要不要用？** @njuptlzf 用它把 6 个完整技能降级为"只在 / 菜单可见、不广告给模型"，换来常驻 catalog 零成本。这与我们的"6 技能全部经 provider 暴露"判据冲突吗？

## 硬约束

- 结论要能直接变成 `skills/` 目录的落地形态，不是泛泛而谈。
- 涉及上游原文引用的，必须给出 upstream 的确切路径（如 `https://raw.githubusercontent.com/DietrichGebert/ponytail/main/.agents/rules/ponytail.md`）。

## 验收

- 一份可执行的"技能正文策略"：语言、真源、同步机制、校验脚本口径、六/七阶口径。
- 明确列出这个策略与 map 判据 3（6 技能全部经 provider 暴露）是否一致。

## Comments

### local — 2026-11-07T04:04:33.405Z

### local — 2026-11-07T04:53:24.686Z
**票面第 3 题的两处数字判据已在调研中改正（2026-11-07）**：① `catalogDescriptionMaxLength` 默认值是 **500**，位置在 `dsh-tool-skill/lib/index.js:768`（常量）/ `:777`（`z.number().default(500)`）/ `:785-786`（最小 3）；票面写的 `:52` 是错的。截断在 `:1094-1096`，先 `replaceAll(/\s+/g," ").trim()` 再比 **UTF-16 `.length`**，`slice(0, max-3) + "..."` 会切半代理对。我们的阈值定 **480**。② 结论见 `docs/research/skill-body-truth-source-and-language-policy.md`：上游是六阶（三处同文），七阶是 2026-10-08 前旧原文（`01cbf81` 合并了 stdlib 与平台原生两条），Wenaixi 的 6 份 SKILL.md **不是中文改写**而是上游 v4.10.3 英文原文快照（CJK 计数全 0）。
## 结论

五问全部有实测答案。**核心发现：Wenaixi 不是「翻译」上游，而是「重写 + 加长」；我们的六阶/七阶口径必须重新站队。**

### 1. 真源：DietrichGebert/ponytail，HEAD `96608e0`（2026-10-29）

| 文件 | Dietrich 行数 | Wenaixi 行数 | 逐字节 |
|---|---|---|---|
| `ponytail` | 52 | 120 | DIFF |
| `ponytail-help` | 76 | 81 | DIFF |
| `ponytail-review` | 101 | 57 | DIFF |
| `ponytail-gain` | 52 | 50 | DIFF |
| `ponytail-debt` | 44 | 44 | DIFF |
| `ponytail-audit` | 103 | 41 | DIFF |

六个文件全部不同，且 `ponytail` 从 52 行涨到 120 行（+131%）、`ponytail-audit` 从 103 行砍到 41 行（−60%）。**这不是翻译，是改写。** 「忠实移植」这句话对 Wenaixi 版不成立，对我们也不该轻易用。

**裁决：真源 = 上游 `.agents/rules/ponytail.md` + `skills/*/SKILL.md`，钉 commit `96608e0`。策略 = 冻结 + CI 每日 diff 报警**（上游 2026-10-29 仍在 push，规则文本变更不走版本号）。同步机制：CI 拉 `https://raw.githubusercontent.com/DietrichGebert/ponytail/main/.agents/rules/ponytail.md` 与仓内 `skills/ponytail/SKILL.md` 做 diff，有差异则开票而非自动覆盖 —— 因为改写是设计决策，不能机器拍板。

### 2. 六阶还是七阶 —— 实测确认：上游是**六阶**，Wenaixi 是**七阶**

- 上游 `/tmp/dietrich-ponytail/.agents/rules/ponytail.md:13-18` 是 `1.`–`6.` 六条，第 3 条把「标准库**或**平台原生特性」合并成一级：*"Standard library or a platform feature? Use it, unless the project has its own. A house component beats a native widget."*
- Wenaixi 的 `skills/ponytail/SKILL.md:36-42` 是 `1.`–`7.` 七条，把「Stdlib does it?」与「Native platform feature covers it?」**拆成两条**。

**裁决：对外文案一律用「六阶」，并注明我们的第 3 级合并了标准库与平台原生。** 理由：六阶是上游原文，我们若宣称移植就对齐原文；七阶是 Wenaixi 的本地化增量，没有上游背书。「忠实移植」对我们的用法 = 「规则阶梯与上游逐条对应」，可以说，但必须同时说明正文语言与示例是本地化的。

### 3. 500 字符上限：确认，且是 **UTF-16 code unit**

`dsh-tool-skill/lib/index.js:768` `DEFAULT_CATALOG_DESCRIPTION_MAX_LENGTH = 500`；`:1094` 的 `catalogDescription`：

```js
function catalogDescription(value, maxLength) {
	const normalized = value.replaceAll(/\s+/g, " ").trim();
	return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 3)}...`;
}
```

`.length` 是 UTF-16 code unit，不是 grapheme；先折叠空白再量。超长会截成 `maxLength-3` 字符 + `...`，**尾部触发词会被吃掉**。

实测现状：`descriptions.en.json` 最长 492（`ponytail`），`zh` 最长 261。**都没超，但英文 492 距上限只剩 8 个字符余量** —— 任何一次加词都会踩线。

**校验脚本口径（进 CI）**：读 JSON → `replaceAll(/\s+/g," ").trim()` → 断 `.length <= 500`，并在 `.length > 480` 时打 warn（预留加词空间）。断言必须用折叠后的长度，不是原文长度。

### 4. 中文正文会让英文触发词失效 —— 实测有 3 个词已丢

对 `descriptions.en.json` 里的英文触发词做包含检查，看 `zh` 版是否保留：

| 技能 | zh 版丢失的英文触发词 |
|---|---|
| `ponytail` | **`be lazy`、`simplest solution`、`do less`** |
| 其余 5 个 | 无丢失 |

说明：中文改写把 `be lazy`/`do less` 意译成了「偷懒」「少做一点」，`simplest solution` 译成「最简解法」，于是用户说英文原词时命中不了。而 `description` 是模型判断「要不要加载这个技能」的唯一依据，丢词 = 丢触发。

**裁决：描述走双语 JSON（沿用上游机制），但中文版必须把英文触发词原样并列保留**，形如「触发词：ponytail / be lazy / lazy mode / 偷懒 / 懒人模式 / …」。这是零成本的修法，也是上游遗漏的真缺陷。正文仍用中文（决策成本 vs 触发覆盖，正文不影响触发，描述才影响）。

### 5. `disable-model-invocation` 与地图判据 3 的关系 —— 不冲突，但别用

实测 `dsh-tool-skill/lib/index.js:944`：`const skills = snapshot.skills.filter(isModelInvocable)` → 非 model-invocable 的技能**不进模型目录**（省 catalog token），但 `:875/:878` 的 `get` 会抛 `skill "x" is not available for model invocation`。

- **判据 3 说的是「6 个技能全部经 skill provider 暴露」** —— 暴露 = 进 `ctx.skills.list()`。`disable-model-invocation` 只影响 `isModelInvocable` 过滤后的模型目录，不影响 provider 暴露。**两者不冲突。**
- 但 @njuptlzf 那条路线（6 个技能全部不广告）会让模型**永远无法主动加载**，只剩 `/ponytail` 斜杠命令一条路。我们已经有官方 `ctx.commands.register`，命令面不缺，所以不必用这个牺牲换 token。

**裁决：6 个技能全部 `modelInvocable: true`、`userInvocable: true`。** token 成本靠描述长度控制（六条英文合计 2117 字符，折叠后进 catalog 是可接受的；若日后要省，优先砍 `ponytail-help` 与 `ponytail-gain` 的描述，不要动主技能）。

### 落地检查清单

```
skills/
  descriptions.en.json   # 逐条 <= 500（折叠空白后），warn 阈值 480
  descriptions.zh.json   # 必须原样保留 en 里的全部英文触发词
  ponytail/SKILL.md      # 六阶（合并 stdlib + 平台原生为第 3 级）
  ponytail-{help,review,gain,debt,audit}/SKILL.md
```

CI 三条断言：① 六个 `description` 折叠后 ≤ 500；② `zh` 是 `en` 的触发词超集（英文触发词逐个包含）；③ 上游规则文件 diff 无未处理变更。

## Answer

真源钉 DietrichGebert HEAD 96608e0 + CI diff 报警；实测上游六阶、Wenaixi 七阶（把 stdlib 与平台原生拆成两条），对外统一用六阶；500 上限确认为 UTF-16 code unit 且先折叠空白，en 最长 492 仅余 8 字符；实测 zh 描述丢了 be lazy / simplest solution / do less 三个英文触发词，须原样并列保留；disable-model-invocation 与判据 3 不冲突但弃用，6 技能全 modelInvocable。

## 进度
